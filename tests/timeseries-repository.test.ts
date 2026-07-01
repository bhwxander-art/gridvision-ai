/**
 * INFRA-007: TimeSeries Repository tests
 *
 * Unit tests:
 *   - insertScadaBatch: validation, chunking, empty input
 *   - queryScadaByBus / queryScadaByBranch: filter passthrough
 *   - deleteScadaRange: range delete
 *   - insertLmpBatch: validation, chunking
 *   - queryLmpByPnode / queryLmpHourly / deleteLmpRange
 *   - insertGeneratorOutputBatch / queryGeneratorOutput / queryGeneratorOutputByFuel
 *   - insertWeatherBatch: coordinate validation, chunking
 *   - queryWeatherByStation / latestWeatherByStations dedup
 *   - insertAmiBatch / queryAmiByMeter / queryAmiByFeeder
 *   - All delete-range methods
 *   - TimeRange is forwarded as gte/lte filters
 *   - Tenant isolation: tenant_id in every query
 *
 * Integration tests (skipped without SUPABASE_URL):
 *   - Insert and retrieve round-trip for each table
 *   - Chunking with > BATCH_SIZE rows
 *
 * Performance benchmarks:
 *   - insertScadaBatch validation: 1,000 rows < 10 ms
 *   - insertLmpBatch validation: 1,000 rows < 10 ms
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TimeSeriesRepository,
  TimeSeriesValidationError,
} from "@/lib/db/repositories/timeseries.repository";
import type { TimeRange } from "@/lib/db/repositories/timeseries.repository";
import {
  validateScadaReading,
  validateLmpPrice,
} from "@/lib/db/types-timeseries";
import type {
  DbScadaReadingInsert,
  DbLmpPriceInsert,
  DbGeneratorOutputInsert,
  DbWeatherObservationInsert,
  DbAmiIntervalInsert,
} from "@/lib/db/types-timeseries";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = "00000000-0000-0000-0000-000000000002";
const NOW = "2025-06-15T12:00:00Z";
const RANGE: TimeRange = { from: "2025-06-15T00:00:00Z", to: "2025-06-15T23:59:59Z" };

function makeScada(overrides: Partial<DbScadaReadingInsert> = {}): DbScadaReadingInsert {
  return {
    ts: NOW,
    tenant_id: TENANT_ID,
    model_id: null,
    bus_id: "bus-uuid-001",
    branch_id: null,
    measurement_type: "voltage_mag_pu",
    value: 1.02,
    quality: 0,
    source: "SCADA",
    ...overrides,
  };
}

function makeLmp(overrides: Partial<DbLmpPriceInsert> = {}): DbLmpPriceInsert {
  return {
    ts: NOW,
    tenant_id: TENANT_ID,
    iso_id: "ISNE",
    bus_id: null,
    pnode_id: ".H.INTERNALHUB",
    pnode_name: "ISNE Internal Hub",
    lmp_total: 35.50,
    lmp_energy: 30.00,
    lmp_congestion: 4.00,
    lmp_loss: 1.50,
    market_type: "RT",
    interval_min: 5,
    ...overrides,
  };
}

function makeGenOut(overrides: Partial<DbGeneratorOutputInsert> = {}): DbGeneratorOutputInsert {
  return {
    ts: NOW,
    tenant_id: TENANT_ID,
    iso_id: "ISNE",
    generator_id: "EIA-10750-GEN1",
    generator_name: "Brockton Power Unit 1",
    bus_id: null,
    fuel_type: "natural_gas",
    output_mw: 310.0,
    scheduled_mw: 315.0,
    capacity_mw: 350.0,
    source: "EIA_930",
    interval_min: 60,
    ...overrides,
  };
}

function makeWeather(overrides: Partial<DbWeatherObservationInsert> = {}): DbWeatherObservationInsert {
  return {
    ts: NOW,
    tenant_id: TENANT_ID,
    station_id: "KBOS",
    station_name: "Boston Logan",
    latitude: 42.36,
    longitude: -71.01,
    temp_c: 22.5,
    wind_speed_ms: 5.2,
    wind_dir_deg: 270,
    solar_irr_wm2: 450,
    precip_mm: 0,
    humidity_pct: 65,
    pressure_hpa: 1013.25,
    forecast_horizon_h: null,
    model_run_ts: null,
    source: "OBSERVATION",
    ...overrides,
  };
}

function makeAmi(overrides: Partial<DbAmiIntervalInsert> = {}): DbAmiIntervalInsert {
  return {
    ts: NOW,
    tenant_id: TENANT_ID,
    meter_id: "METER-001",
    feeder_id: "FEEDER-A",
    substation_id: "SUB-1",
    zip_code: "02101",
    energy_kwh: 0.75,
    demand_kw: 3.0,
    voltage_v: 120.5,
    customer_type: "residential",
    ...overrides,
  };
}

// ── Mock Supabase client ──────────────────────────────────────────────────────

type ChainMock = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  _resolve: (data: unknown[], error?: { message: string }) => void;
};

function makeClient(
  initialData: unknown[] = [],
  errorMsg?: string
): { client: SupabaseClient; getChain: () => ChainMock } {
  let resolveData = initialData;
  let resolveError = errorMsg ? { message: errorMsg } : null;
  let latestInsertArg: unknown[] | null = null;
  let insertCallCount = 0;
  let deleteCallCount = 0;

  const chain: ChainMock = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockImplementation((rows: unknown[]) => {
      latestInsertArg = rows;
      insertCallCount++;
      return Promise.resolve({ error: resolveError });
    }),
    delete: vi.fn().mockImplementation(() => {
      deleteCallCount++;
      return chain;
    }),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockImplementation(() =>
      Promise.resolve({ data: resolveData, error: resolveError })
    ),
    _resolve: (data: unknown[], err?: { message: string }) => {
      resolveData = data;
      resolveError = err ? err : null;
    },
  } as unknown as ChainMock;

  // Make delete().eq().gte().lte() chain resolve
  chain.delete.mockReturnValue(chain);

  const client = {
    from: vi.fn().mockReturnValue(chain),
    _chain: chain,
    _getInsertArg: () => latestInsertArg,
    _insertCallCount: () => insertCallCount,
    _deleteCallCount: () => deleteCallCount,
  } as unknown as SupabaseClient;

  return { client, getChain: () => chain };
}

// ── SCADA insertScadaBatch ────────────────────────────────────────────────────

describe("TimeSeriesRepository.insertScadaBatch", () => {
  it("returns 0 for empty input", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    expect(await repo.insertScadaBatch([])).toBe(0);
  });

  it("validates all rows before inserting — throws on bad measurement_type", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    const bad = [makeScada({ measurement_type: "battery_soc" as never })];
    await expect(repo.insertScadaBatch(bad)).rejects.toThrow(
      TimeSeriesValidationError
    );
  });

  it("validates all rows — throws on non-finite value", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    const bad = [makeScada({ value: NaN })];
    await expect(repo.insertScadaBatch(bad)).rejects.toThrow(
      TimeSeriesValidationError
    );
  });

  it("validates all rows — throws when ts is missing", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    const bad = [makeScada({ ts: "" })];
    await expect(repo.insertScadaBatch(bad)).rejects.toThrow(
      TimeSeriesValidationError
    );
  });

  it("inserts valid rows and returns count", async () => {
    let insertArg: unknown[] = [];
    const mockChain = {
      insert: vi.fn().mockImplementation((rows: unknown[]) => {
        insertArg = rows;
        return Promise.resolve({ error: null });
      }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    const rows = [makeScada(), makeScada({ ts: "2025-06-15T12:05:00Z" })];
    const n = await repo.insertScadaBatch(rows);
    expect(n).toBe(2);
    expect(insertArg).toHaveLength(2);
  });

  it("chunks at BATCH_SIZE (500)", async () => {
    let callCount = 0;
    const mockChain = {
      insert: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({ error: null });
      }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    const rows = Array.from({ length: 1100 }, (_, i) =>
      makeScada({ ts: `2025-06-15T${String(i).padStart(6, "0")}` })
    );
    await repo.insertScadaBatch(rows);
    expect(callCount).toBe(3); // 500 + 500 + 100
  });

  it("throws repository error when Supabase insert fails", async () => {
    const mockChain = {
      insert: vi.fn().mockResolvedValue({ error: { message: "DB overloaded" } }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    await expect(repo.insertScadaBatch([makeScada()])).rejects.toThrow(
      "[TimeSeriesRepository.insertScadaBatch]"
    );
  });
});

// ── SCADA query methods ───────────────────────────────────────────────────────

describe("TimeSeriesRepository.queryScadaByBus", () => {
  it("passes tenant_id, bus_id, and range to query", async () => {
    const eqCalls: string[][] = [];
    const rangeCalls: string[][] = [];
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string) => {
        eqCalls.push([col]);
        return mockChain;
      }),
      gte: vi.fn().mockImplementation((col: string) => {
        rangeCalls.push(["gte", col]);
        return mockChain;
      }),
      lte: vi.fn().mockImplementation((col: string) => {
        rangeCalls.push(["lte", col]);
        return mockChain;
      }),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);

    await repo.queryScadaByBus(TENANT_ID, "bus-001", RANGE);

    const eqFields = eqCalls.map(([f]) => f);
    expect(eqFields).toContain("tenant_id");
    expect(eqFields).toContain("bus_id");
    expect(rangeCalls.some(([t, c]) => t === "gte" && c === "ts")).toBe(true);
    expect(rangeCalls.some(([t, c]) => t === "lte" && c === "ts")).toBe(true);
  });

  it("adds measurement_type filter when provided", async () => {
    const eqCalls: string[] = [];
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string) => {
        eqCalls.push(col);
        return mockChain;
      }),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);

    await repo.queryScadaByBus(TENANT_ID, "bus-001", RANGE, "voltage_mag_pu");

    expect(eqCalls).toContain("measurement_type");
  });

  it("returns mapped ScadaReading domain objects", async () => {
    const mockRow = {
      ts: NOW,
      tenant_id: TENANT_ID,
      model_id: null,
      bus_id: "bus-001",
      branch_id: null,
      measurement_type: "voltage_mag_pu",
      value: 1.02,
      quality: 0,
      source: "SCADA",
    };
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [mockRow], error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);

    const results = await repo.queryScadaByBus(TENANT_ID, "bus-001", RANGE);
    expect(results).toHaveLength(1);
    expect(results[0].ts).toBeInstanceOf(Date);
    expect(results[0].value).toBe(1.02);
    expect(results[0].measurementType).toBe("voltage_mag_pu");
  });
});

describe("TimeSeriesRepository.queryScadaByBranch", () => {
  it("passes branch_id in the eq filter", async () => {
    const eqCalls: string[] = [];
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string) => {
        eqCalls.push(col);
        return mockChain;
      }),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);

    await repo.queryScadaByBranch(TENANT_ID, "branch-001", RANGE);
    expect(eqCalls).toContain("branch_id");
    expect(eqCalls).toContain("tenant_id");
  });
});

describe("TimeSeriesRepository.deleteScadaRange", () => {
  it("calls delete with tenant_id and range filters", async () => {
    const eqArgs: string[] = [];
    const gteArgs: string[] = [];
    const lteArgs: string[] = [];
    const mockChain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string) => {
        eqArgs.push(col);
        return mockChain;
      }),
      gte: vi.fn().mockImplementation((col: string) => {
        gteArgs.push(col);
        return mockChain;
      }),
      lte: vi.fn().mockImplementation((col: string) => {
        lteArgs.push(col);
        return Promise.resolve({ error: null });
      }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);

    await repo.deleteScadaRange(TENANT_ID, RANGE);

    expect(eqArgs).toContain("tenant_id");
    expect(gteArgs).toContain("ts");
    expect(lteArgs).toContain("ts");
  });
});

// ── LMP tests ────────────────────────────────────────────────────────────────

describe("TimeSeriesRepository.insertLmpBatch", () => {
  it("returns 0 for empty input", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    expect(await repo.insertLmpBatch([])).toBe(0);
  });

  it("throws on missing pnode_id", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    await expect(
      repo.insertLmpBatch([makeLmp({ pnode_id: "" })])
    ).rejects.toThrow(TimeSeriesValidationError);
  });

  it("throws on non-finite lmp_total", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    await expect(
      repo.insertLmpBatch([makeLmp({ lmp_total: Infinity })])
    ).rejects.toThrow(TimeSeriesValidationError);
  });

  it("throws on invalid market_type", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    await expect(
      repo.insertLmpBatch([makeLmp({ market_type: "SPOT" as never })])
    ).rejects.toThrow(TimeSeriesValidationError);
  });

  it("inserts valid rows and returns count", async () => {
    const mockChain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    const n = await repo.insertLmpBatch([makeLmp(), makeLmp({ pnode_id: "NODE_B" })]);
    expect(n).toBe(2);
  });

  it("chunks at 500 rows", async () => {
    let callCount = 0;
    const mockChain = {
      insert: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({ error: null });
      }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    const rows = Array.from({ length: 600 }, (_, i) =>
      makeLmp({ pnode_id: `NODE_${i}` })
    );
    await repo.insertLmpBatch(rows);
    expect(callCount).toBe(2); // 500 + 100
  });
});

describe("TimeSeriesRepository.queryLmpByPnode", () => {
  it("maps returned rows via toLmpPrice (ts becomes Date)", async () => {
    const mockRow = {
      ts: NOW,
      tenant_id: TENANT_ID,
      iso_id: "ISNE",
      bus_id: null,
      pnode_id: ".H.INTERNALHUB",
      pnode_name: null,
      lmp_total: 35.50,
      lmp_energy: null,
      lmp_congestion: null,
      lmp_loss: null,
      market_type: "RT",
      interval_min: 5,
    };
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [mockRow], error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);

    const results = await repo.queryLmpByPnode(TENANT_ID, "ISNE", ".H.INTERNALHUB", RANGE);
    expect(results).toHaveLength(1);
    expect(results[0].ts).toBeInstanceOf(Date);
    expect(results[0].lmpTotal).toBe(35.50);
  });

  it("adds market_type filter when provided", async () => {
    const eqCalls: string[] = [];
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string) => {
        eqCalls.push(col);
        return mockChain;
      }),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);

    await repo.queryLmpByPnode(TENANT_ID, "ISNE", "NODE", RANGE, "DA");
    expect(eqCalls).toContain("market_type");
  });
});

describe("TimeSeriesRepository.queryLmpHourly", () => {
  it("queries from lmp_hourly view with bucket range filters", async () => {
    const fromArg: string[] = [];
    const gteCalls: string[] = [];
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockImplementation((col: string) => {
        gteCalls.push(col);
        return mockChain;
      }),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const client = {
      from: vi.fn().mockImplementation((table: string) => {
        fromArg.push(table);
        return mockChain;
      }),
    } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);

    await repo.queryLmpHourly(TENANT_ID, "ISNE", "NODE", RANGE);

    expect(fromArg[0]).toBe("lmp_hourly");
    expect(gteCalls).toContain("bucket");
  });
});

// ── Generator output tests ────────────────────────────────────────────────────

describe("TimeSeriesRepository.insertGeneratorOutputBatch", () => {
  it("returns 0 for empty input", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    expect(await repo.insertGeneratorOutputBatch([])).toBe(0);
  });

  it("throws on missing generator_id", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    await expect(
      repo.insertGeneratorOutputBatch([makeGenOut({ generator_id: "" })])
    ).rejects.toThrow(TimeSeriesValidationError);
  });

  it("throws on invalid fuel_type", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    await expect(
      repo.insertGeneratorOutputBatch([makeGenOut({ fuel_type: "fusion" as never })])
    ).rejects.toThrow(TimeSeriesValidationError);
  });

  it("throws on non-finite output_mw", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    await expect(
      repo.insertGeneratorOutputBatch([makeGenOut({ output_mw: NaN })])
    ).rejects.toThrow(TimeSeriesValidationError);
  });

  it("inserts valid rows", async () => {
    const mockChain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    expect(await repo.insertGeneratorOutputBatch([makeGenOut()])).toBe(1);
  });
});

describe("TimeSeriesRepository.queryGeneratorOutputByFuel", () => {
  it("includes fuel_type and tenant_id in eq filters", async () => {
    const eqCalls: string[] = [];
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string) => {
        eqCalls.push(col);
        return mockChain;
      }),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);

    await repo.queryGeneratorOutputByFuel(TENANT_ID, "ISNE", "wind", RANGE);

    expect(eqCalls).toContain("tenant_id");
    expect(eqCalls).toContain("fuel_type");
  });
});

// ── Weather observation tests ─────────────────────────────────────────────────

describe("TimeSeriesRepository.insertWeatherBatch", () => {
  it("returns 0 for empty input", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    expect(await repo.insertWeatherBatch([])).toBe(0);
  });

  it("throws on missing ts", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    await expect(
      repo.insertWeatherBatch([makeWeather({ ts: "" })])
    ).rejects.toThrow(TimeSeriesValidationError);
  });

  it("throws on missing station_id", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    await expect(
      repo.insertWeatherBatch([makeWeather({ station_id: "" })])
    ).rejects.toThrow(TimeSeriesValidationError);
  });

  it("throws on non-finite latitude", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    await expect(
      repo.insertWeatherBatch([makeWeather({ latitude: NaN })])
    ).rejects.toThrow(TimeSeriesValidationError);
  });

  it("throws on non-finite longitude", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    await expect(
      repo.insertWeatherBatch([makeWeather({ longitude: Infinity })])
    ).rejects.toThrow(TimeSeriesValidationError);
  });

  it("inserts valid observations", async () => {
    const mockChain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    expect(await repo.insertWeatherBatch([makeWeather()])).toBe(1);
  });
});

describe("TimeSeriesRepository.latestWeatherByStations", () => {
  it("returns empty array for empty stationIds", async () => {
    const client = { from: vi.fn() } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    expect(await repo.latestWeatherByStations(TENANT_ID, [])).toEqual([]);
  });

  it("deduplicates — keeps only the first (newest) row per station_id", async () => {
    const rows = [
      makeWeather({ station_id: "KBOS", ts: "2025-06-15T12:00:00Z" }),
      makeWeather({ station_id: "KBOS", ts: "2025-06-15T11:00:00Z" }), // older KBOS
      makeWeather({ station_id: "KORH", ts: "2025-06-15T12:00:00Z" }),
    ];
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);

    const result = await repo.latestWeatherByStations(TENANT_ID, ["KBOS", "KORH"]);
    expect(result).toHaveLength(2); // only 2 unique stations
    expect(result.map((r) => r.station_id)).toEqual(["KBOS", "KORH"]);
    expect(result[0].ts).toBe("2025-06-15T12:00:00Z"); // newest kept
  });
});

// ── AMI tests ─────────────────────────────────────────────────────────────────

describe("TimeSeriesRepository.insertAmiBatch", () => {
  it("returns 0 for empty input", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    expect(await repo.insertAmiBatch([])).toBe(0);
  });

  it("throws on missing meter_id", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    await expect(
      repo.insertAmiBatch([makeAmi({ meter_id: "" })])
    ).rejects.toThrow(TimeSeriesValidationError);
  });

  it("throws on negative energy_kwh", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    await expect(
      repo.insertAmiBatch([makeAmi({ energy_kwh: -5 })])
    ).rejects.toThrow(TimeSeriesValidationError);
  });

  it("throws on invalid customer_type", async () => {
    const { client } = makeClient();
    const repo = new TimeSeriesRepository(client);
    await expect(
      repo.insertAmiBatch([makeAmi({ customer_type: "utility" as never })])
    ).rejects.toThrow(TimeSeriesValidationError);
  });

  it("inserts valid AMI rows", async () => {
    const mockChain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    expect(await repo.insertAmiBatch([makeAmi()])).toBe(1);
  });

  it("chunks 600 rows into 2 batches", async () => {
    let callCount = 0;
    const mockChain = {
      insert: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({ error: null });
      }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    const rows = Array.from({ length: 600 }, (_, i) =>
      makeAmi({ meter_id: `M${i}` })
    );
    await repo.insertAmiBatch(rows);
    expect(callCount).toBe(2); // 500 + 100
  });
});

describe("TimeSeriesRepository.queryAmiByMeter", () => {
  it("includes meter_id and tenant_id in eq filters", async () => {
    const eqCalls: string[] = [];
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string) => {
        eqCalls.push(col);
        return mockChain;
      }),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    await repo.queryAmiByMeter(TENANT_ID, "METER-001", RANGE);
    expect(eqCalls).toContain("tenant_id");
    expect(eqCalls).toContain("meter_id");
  });
});

describe("TimeSeriesRepository.queryAmiByFeeder", () => {
  it("includes feeder_id in eq filter", async () => {
    const eqCalls: string[] = [];
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string) => {
        eqCalls.push(col);
        return mockChain;
      }),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(mockChain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    await repo.queryAmiByFeeder(TENANT_ID, "FEEDER-A", RANGE);
    expect(eqCalls).toContain("feeder_id");
  });
});

// ── Delete range methods ──────────────────────────────────────────────────────

describe("TimeSeriesRepository delete range methods", () => {
  function makeDeleteChain() {
    const eqCalls: string[] = [];
    const gteCalls: string[] = [];
    let lteResolved = false;
    const chain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string) => {
        eqCalls.push(col);
        return chain;
      }),
      gte: vi.fn().mockImplementation((col: string) => {
        gteCalls.push(col);
        return chain;
      }),
      lte: vi.fn().mockImplementation(() => {
        lteResolved = true;
        return Promise.resolve({ error: null });
      }),
    };
    return { chain, eqCalls, gteCalls, isResolved: () => lteResolved };
  }

  it("deleteLmpRange filters by tenant_id, iso_id, and ts range", async () => {
    const { chain, eqCalls, gteCalls } = makeDeleteChain();
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    await repo.deleteLmpRange(TENANT_ID, "ISNE", RANGE);
    expect(eqCalls).toContain("tenant_id");
    expect(eqCalls).toContain("iso_id");
    expect(gteCalls).toContain("ts");
  });

  it("deleteGeneratorOutputRange filters by tenant_id, iso_id, ts", async () => {
    const { chain, eqCalls } = makeDeleteChain();
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    await repo.deleteGeneratorOutputRange(TENANT_ID, "ISNE", RANGE);
    expect(eqCalls).toContain("tenant_id");
    expect(eqCalls).toContain("iso_id");
  });

  it("deleteWeatherRange filters by tenant_id and ts", async () => {
    const { chain, eqCalls } = makeDeleteChain();
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    await repo.deleteWeatherRange(TENANT_ID, RANGE);
    expect(eqCalls).toContain("tenant_id");
  });

  it("deleteAmiRange filters by tenant_id and ts", async () => {
    const { chain, eqCalls } = makeDeleteChain();
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;
    const repo = new TimeSeriesRepository(client);
    await repo.deleteAmiRange(TENANT_ID, RANGE);
    expect(eqCalls).toContain("tenant_id");
  });
});

// ── Integration tests ─────────────────────────────────────────────────────────

const INTEGRATION =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!INTEGRATION)("TimeSeriesRepository integration", () => {
  it("inserts and retrieves SCADA readings round-trip", async () => {
    const { createServerClient } = await import("@/lib/db/client");
    const db = createServerClient();
    const repo = new TimeSeriesRepository(db);

    const ts1 = "2025-06-15T10:00:00Z";
    const ts2 = "2025-06-15T10:01:00Z";
    const rows: DbScadaReadingInsert[] = [
      makeScada({ ts: ts1, value: 1.01 }),
      makeScada({ ts: ts2, value: 1.03 }),
    ];

    const n = await repo.insertScadaBatch(rows);
    expect(n).toBe(2);

    const results = await repo.queryScadaByBus(
      TENANT_ID,
      "bus-uuid-001",
      { from: ts1, to: ts2 }
    );
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => r.tenantId === TENANT_ID)).toBe(true);

    // Cleanup
    await repo.deleteScadaRange(TENANT_ID, { from: ts1, to: ts2 });
  });

  it("inserts 600 LMP rows in 2 chunks without error", async () => {
    const { createServerClient } = await import("@/lib/db/client");
    const db = createServerClient();
    const repo = new TimeSeriesRepository(db);

    const startTs = new Date("2025-06-15T00:00:00Z").getTime();
    const rows: DbLmpPriceInsert[] = Array.from({ length: 600 }, (_, i) =>
      makeLmp({
        ts: new Date(startTs + i * 300_000).toISOString(), // 5-min intervals
        pnode_id: "INFRA007-TEST-NODE",
        lmp_total: 30 + Math.random() * 20,
      })
    );

    const n = await repo.insertLmpBatch(rows);
    expect(n).toBe(600);

    // Cleanup
    await repo.deleteLmpRange(TENANT_ID, "ISNE", {
      from: "2025-06-15T00:00:00Z",
      to: "2025-06-15T23:59:59Z",
    });
  });
});

// ── Performance benchmarks ────────────────────────────────────────────────────

describe("TimeSeriesRepository performance", () => {
  it("validates 1,000 SCADA rows in under 10ms", () => {
    const rows = Array.from({ length: 1_000 }, () => makeScada());
    const start = performance.now();
    rows.forEach(validateScadaReading);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });

  it("validates 1,000 LMP rows in under 10ms", () => {
    const rows = Array.from({ length: 1_000 }, (_, i) =>
      makeLmp({ pnode_id: `NODE_${i}` })
    );
    const start = performance.now();
    rows.forEach(validateLmpPrice);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });
});
