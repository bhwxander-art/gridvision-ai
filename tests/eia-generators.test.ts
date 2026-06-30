/**
 * INFRA-006: EIA Generator Inventory tests
 *
 * Unit tests:
 *   - Type validators (validateEiaGeneratorInsert)
 *   - Mapper (toEiaGenerator snake_case → camelCase)
 *   - Normalizer (mapFuelType, mapGeneratorStatus, parseCapacityMw, etc.)
 *   - Fetcher (mock HTTP → parsed rows, pagination, auth check)
 *   - Repository methods (mock Supabase client)
 *   - Pipeline orchestrator (mock fetcher, mock DB)
 *
 * Integration tests (skipped without SUPABASE_URL):
 *   - Full round-trip upsert + query + cleanup
 *
 * Performance benchmarks:
 *   - Mapper: 10,000 rows < 50 ms
 *   - Normalizer: 10,000 fuel-type lookups < 10 ms
 */

import { describe, it, expect, vi } from "vitest";
import {
  toEiaGenerator,
  validateEiaGeneratorInsert,
  EiaGeneratorValidationError,
  GENERATOR_FUEL_TYPES,
  GENERATOR_STATUSES,
  isValidGeneratorFuelType,
  isValidGeneratorStatus,
} from "@/lib/db/types-eia-generators";
import type {
  DbEiaGenerator,
  DbEiaGeneratorInsert,
} from "@/lib/db/types-eia-generators";
import {
  mapFuelType,
  mapGeneratorStatus,
  parseCapacityMw,
  parseNullableFloat,
  parseYear,
  parseMonth,
} from "@/lib/ingestion/eia-generators/normalizer";
import { fetchEiaGenerators } from "@/lib/ingestion/eia-generators/fetcher";
import { runEiaGeneratorPipeline } from "@/lib/ingestion/eia-generators/pipeline";
import { EiaGeneratorRepository } from "@/lib/db/repositories/eia-generator.repository";

const TENANT_ID = "00000000-0000-0000-0000-000000000002";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDbRow(overrides: Partial<DbEiaGenerator> = {}): DbEiaGenerator {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tenant_id: TENANT_ID,
    plant_id: "10750",
    generator_id: "GEN1",
    plant_name: "Brockton Power",
    data_year: 2023,
    state_abbr: "MA",
    county: "Plymouth",
    latitude: 42.09,
    longitude: -71.02,
    balancing_authority: "ISNE",
    nameplate_mw: 350.0,
    summer_mw: 335.0,
    winter_mw: 360.0,
    fuel_type: "natural_gas",
    prime_mover: "CC",
    energy_source_code: "NG",
    technology: "Natural Gas Fired Combined Cycle",
    operational_status: "operating",
    operating_year: 1995,
    operating_month: 6,
    retirement_year: null,
    retirement_month: null,
    utility_id: "56789",
    utility_name: "Brockton Power Company LLC",
    fetched_at: "2024-01-01T00:00:00Z",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeInsert(
  overrides: Partial<DbEiaGeneratorInsert> = {}
): DbEiaGeneratorInsert {
  return {
    tenant_id: TENANT_ID,
    plant_id: "10750",
    generator_id: "GEN1",
    plant_name: "Brockton Power",
    data_year: 2023,
    state_abbr: "MA",
    county: "Plymouth",
    latitude: 42.09,
    longitude: -71.02,
    balancing_authority: "ISNE",
    nameplate_mw: 350.0,
    summer_mw: 335.0,
    winter_mw: 360.0,
    fuel_type: "natural_gas",
    prime_mover: "CC",
    energy_source_code: "NG",
    technology: "Natural Gas Fired Combined Cycle",
    operational_status: "operating",
    operating_year: 1995,
    operating_month: 6,
    retirement_year: null,
    retirement_month: null,
    utility_id: "56789",
    utility_name: "Brockton Power Company LLC",
    fetched_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── toEiaGenerator mapper ─────────────────────────────────────────────────────

describe("toEiaGenerator", () => {
  it("maps snake_case DB row to camelCase domain object", () => {
    const row = makeDbRow();
    const domain = toEiaGenerator(row);

    expect(domain.id).toBe(row.id);
    expect(domain.tenantId).toBe(TENANT_ID);
    expect(domain.plantId).toBe("10750");
    expect(domain.generatorId).toBe("GEN1");
    expect(domain.plantName).toBe("Brockton Power");
    expect(domain.dataYear).toBe(2023);
    expect(domain.stateAbbr).toBe("MA");
    expect(domain.latitude).toBe(42.09);
    expect(domain.longitude).toBe(-71.02);
    expect(domain.balancingAuthority).toBe("ISNE");
    expect(domain.nameplateMw).toBe(350.0);
    expect(domain.summerMw).toBe(335.0);
    expect(domain.winterMw).toBe(360.0);
    expect(domain.fuelType).toBe("natural_gas");
    expect(domain.primeMover).toBe("CC");
    expect(domain.energySourceCode).toBe("NG");
    expect(domain.operationalStatus).toBe("operating");
    expect(domain.operatingYear).toBe(1995);
    expect(domain.operatingMonth).toBe(6);
  });

  it("maps null optional fields to null", () => {
    const domain = toEiaGenerator(
      makeDbRow({
        latitude: null,
        longitude: null,
        county: null,
        retirement_year: null,
        retirement_month: null,
        utility_id: null,
        utility_name: null,
      })
    );
    expect(domain.latitude).toBeNull();
    expect(domain.longitude).toBeNull();
    expect(domain.county).toBeNull();
    expect(domain.retirementYear).toBeNull();
    expect(domain.retirementMonth).toBeNull();
    expect(domain.utilityId).toBeNull();
    expect(domain.utilityName).toBeNull();
  });

  it("coerces numeric strings from Postgres to JS numbers", () => {
    const domain = toEiaGenerator(
      makeDbRow({
        nameplate_mw: "350.00" as unknown as number,
        data_year: "2023" as unknown as number,
      })
    );
    expect(typeof domain.nameplateMw).toBe("number");
    expect(typeof domain.dataYear).toBe("number");
    expect(domain.nameplateMw).toBe(350.0);
    expect(domain.dataYear).toBe(2023);
  });
});

// ── ENUM type sets ────────────────────────────────────────────────────────────

describe("ENUM validators", () => {
  it("GENERATOR_FUEL_TYPES contains the expected values", () => {
    expect(GENERATOR_FUEL_TYPES).toContain("natural_gas");
    expect(GENERATOR_FUEL_TYPES).toContain("solar");
    expect(GENERATOR_FUEL_TYPES).toContain("wind");
    expect(GENERATOR_FUEL_TYPES).toContain("nuclear");
    expect(GENERATOR_FUEL_TYPES).toContain("coal");
    expect(GENERATOR_FUEL_TYPES).toContain("other");
    expect(GENERATOR_FUEL_TYPES.length).toBe(11);
  });

  it("GENERATOR_STATUSES contains the expected values", () => {
    expect(GENERATOR_STATUSES).toContain("operating");
    expect(GENERATOR_STATUSES).toContain("retired");
    expect(GENERATOR_STATUSES).toContain("proposed");
    expect(GENERATOR_STATUSES.length).toBe(7);
  });

  it("isValidGeneratorFuelType returns true for known values", () => {
    expect(isValidGeneratorFuelType("solar")).toBe(true);
    expect(isValidGeneratorFuelType("wind")).toBe(true);
    expect(isValidGeneratorFuelType("unknown_fuel")).toBe(false);
    expect(isValidGeneratorFuelType(null)).toBe(false);
  });

  it("isValidGeneratorStatus returns true for known values", () => {
    expect(isValidGeneratorStatus("operating")).toBe(true);
    expect(isValidGeneratorStatus("retired")).toBe(true);
    expect(isValidGeneratorStatus("active")).toBe(false); // not a known status
  });
});

// ── validateEiaGeneratorInsert ────────────────────────────────────────────────

describe("validateEiaGeneratorInsert", () => {
  it("accepts a valid insert", () => {
    expect(() => validateEiaGeneratorInsert(makeInsert())).not.toThrow();
  });

  it("throws on empty plant_id", () => {
    expect(() =>
      validateEiaGeneratorInsert(makeInsert({ plant_id: "" }))
    ).toThrow(EiaGeneratorValidationError);
  });

  it("throws on empty generator_id", () => {
    expect(() =>
      validateEiaGeneratorInsert(makeInsert({ generator_id: "" }))
    ).toThrow(EiaGeneratorValidationError);
  });

  it("throws on empty plant_name", () => {
    expect(() =>
      validateEiaGeneratorInsert(makeInsert({ plant_name: "   " }))
    ).toThrow(EiaGeneratorValidationError);
  });

  it("throws on data_year outside plausible range", () => {
    expect(() =>
      validateEiaGeneratorInsert(makeInsert({ data_year: 1800 }))
    ).toThrow(EiaGeneratorValidationError);
    expect(() =>
      validateEiaGeneratorInsert(makeInsert({ data_year: 2200 }))
    ).toThrow(EiaGeneratorValidationError);
  });

  it("throws on invalid fuel_type", () => {
    expect(() =>
      validateEiaGeneratorInsert(
        makeInsert({ fuel_type: "fusion" as never })
      )
    ).toThrow(EiaGeneratorValidationError);
  });

  it("throws on invalid operational_status", () => {
    expect(() =>
      validateEiaGeneratorInsert(
        makeInsert({ operational_status: "active" as never })
      )
    ).toThrow(EiaGeneratorValidationError);
  });

  it("throws on negative nameplate_mw", () => {
    expect(() =>
      validateEiaGeneratorInsert(makeInsert({ nameplate_mw: -50 }))
    ).toThrow(EiaGeneratorValidationError);
  });

  it("accepts nameplate_mw = 0 (storage or export-only units)", () => {
    expect(() =>
      validateEiaGeneratorInsert(makeInsert({ nameplate_mw: 0 }))
    ).not.toThrow();
  });

  it("throws on operating_month outside 1–12", () => {
    expect(() =>
      validateEiaGeneratorInsert(makeInsert({ operating_month: 0 }))
    ).toThrow(EiaGeneratorValidationError);
    expect(() =>
      validateEiaGeneratorInsert(makeInsert({ operating_month: 13 }))
    ).toThrow(EiaGeneratorValidationError);
  });

  it("throws on retirement_month outside 1–12", () => {
    expect(() =>
      validateEiaGeneratorInsert(makeInsert({ retirement_month: 13 }))
    ).toThrow(EiaGeneratorValidationError);
  });

  it("EiaGeneratorValidationError carries the field name", () => {
    let caught: EiaGeneratorValidationError | null = null;
    try {
      validateEiaGeneratorInsert(makeInsert({ plant_id: "" }));
    } catch (err) {
      caught = err as EiaGeneratorValidationError;
    }
    expect(caught).toBeInstanceOf(EiaGeneratorValidationError);
    expect(caught?.field).toBe("plant_id");
    expect(caught?.name).toBe("EiaGeneratorValidationError");
  });
});

// ── Normalizer: mapFuelType ───────────────────────────────────────────────────

describe("mapFuelType", () => {
  it("maps natural gas energy source codes", () => {
    expect(mapFuelType("NG", null)).toBe("natural_gas");
    expect(mapFuelType("LFG", null)).toBe("natural_gas");
    expect(mapFuelType("OG", null)).toBe("natural_gas");
  });

  it("maps coal energy source codes", () => {
    expect(mapFuelType("BIT", null)).toBe("coal");
    expect(mapFuelType("SUB", null)).toBe("coal");
    expect(mapFuelType("LIG", null)).toBe("coal");
  });

  it("maps solar, wind, hydro", () => {
    expect(mapFuelType("SUN", null)).toBe("solar");
    expect(mapFuelType("WND", null)).toBe("wind");
    expect(mapFuelType("WAT", null)).toBe("hydro");
  });

  it("maps nuclear", () => {
    expect(mapFuelType("NUC", null)).toBe("nuclear");
  });

  it("maps petroleum codes", () => {
    expect(mapFuelType("DFO", null)).toBe("oil");
    expect(mapFuelType("RFO", null)).toBe("oil");
  });

  it("maps geothermal", () => {
    expect(mapFuelType("GEO", null)).toBe("geothermal");
  });

  it("maps biomass codes", () => {
    expect(mapFuelType("WDS", null)).toBe("biomass");
    expect(mapFuelType("AB", null)).toBe("biomass");
  });

  it("falls back to technology text when energy source code is absent", () => {
    expect(mapFuelType(null, "Natural Gas Fired Combined Cycle")).toBe("natural_gas");
    expect(mapFuelType(null, "Onshore Wind Turbine")).toBe("wind");
    expect(mapFuelType(null, "Solar Photovoltaic")).toBe("solar");
    expect(mapFuelType(null, "Conventional Hydroelectric")).toBe("hydro");
    expect(mapFuelType(null, "Nuclear")).toBe("nuclear");
    expect(mapFuelType(null, "Conventional Steam Coal")).toBe("coal");
    expect(mapFuelType(null, "Petroleum Liquids")).toBe("oil");
    expect(mapFuelType(null, "Landfill Gas")).toBe("biomass");
    expect(mapFuelType(null, "Battery Storage")).toBe("other_renewable");
  });

  it("returns 'other' when both code and technology are absent", () => {
    expect(mapFuelType(null, null)).toBe("other");
    expect(mapFuelType("", "")).toBe("other");
    expect(mapFuelType(null, "Unknown Experimental Technology")).toBe("other");
  });

  it("is case-insensitive on energy source code", () => {
    expect(mapFuelType("ng", null)).toBe("natural_gas");
    expect(mapFuelType("Ng", null)).toBe("natural_gas");
  });
});

// ── Normalizer: mapGeneratorStatus ───────────────────────────────────────────

describe("mapGeneratorStatus", () => {
  it("maps operating", () => {
    expect(mapGeneratorStatus("OP")).toBe("operating");
    expect(mapGeneratorStatus("op")).toBe("operating");
  });

  it("maps standby", () => {
    expect(mapGeneratorStatus("SB")).toBe("standby");
  });

  it("maps out of service variants", () => {
    expect(mapGeneratorStatus("OA")).toBe("out_of_service");
    expect(mapGeneratorStatus("OS")).toBe("out_of_service");
  });

  it("maps retired", () => {
    expect(mapGeneratorStatus("RE")).toBe("retired");
  });

  it("maps proposed variants", () => {
    expect(mapGeneratorStatus("IP")).toBe("proposed");
    expect(mapGeneratorStatus("P")).toBe("proposed");
    expect(mapGeneratorStatus("T")).toBe("proposed");
    expect(mapGeneratorStatus("V")).toBe("proposed");
    expect(mapGeneratorStatus("L")).toBe("proposed");
    expect(mapGeneratorStatus("U")).toBe("proposed");
  });

  it("maps canceled", () => {
    expect(mapGeneratorStatus("CN")).toBe("canceled");
  });

  it("returns 'other' for unknown codes and null", () => {
    expect(mapGeneratorStatus("XX")).toBe("other");
    expect(mapGeneratorStatus(null)).toBe("other");
    expect(mapGeneratorStatus(undefined)).toBe("other");
    expect(mapGeneratorStatus("")).toBe("other");
  });
});

// ── Normalizer: numeric parsers ───────────────────────────────────────────────

describe("parseCapacityMw", () => {
  it("parses numeric string", () => {
    expect(parseCapacityMw("350.0")).toBe(350.0);
    expect(parseCapacityMw("1.23456")).toBeCloseTo(1.23); // 2dp rounding
  });

  it("parses number directly", () => {
    expect(parseCapacityMw(500)).toBe(500);
  });

  it("returns null for null, undefined, empty string", () => {
    expect(parseCapacityMw(null)).toBeNull();
    expect(parseCapacityMw(undefined)).toBeNull();
    expect(parseCapacityMw("")).toBeNull();
  });

  it("returns null for negative values", () => {
    expect(parseCapacityMw("-10")).toBeNull();
  });

  it("returns null for Infinity / NaN", () => {
    expect(parseCapacityMw("Infinity")).toBeNull();
    expect(parseCapacityMw("not-a-number")).toBeNull();
  });

  it("strips commas from formatted numbers", () => {
    expect(parseCapacityMw("1,200.5")).toBe(1200.5);
  });
});

describe("parseYear", () => {
  it("parses valid years", () => {
    expect(parseYear("2023")).toBe(2023);
    expect(parseYear(1995)).toBe(1995);
  });

  it("returns null for out-of-range years", () => {
    expect(parseYear("1850")).toBeNull();
    expect(parseYear("2150")).toBeNull();
  });

  it("returns null for null/empty", () => {
    expect(parseYear(null)).toBeNull();
    expect(parseYear("")).toBeNull();
  });
});

describe("parseMonth", () => {
  it("parses valid months", () => {
    expect(parseMonth("6")).toBe(6);
    expect(parseMonth(12)).toBe(12);
    expect(parseMonth(1)).toBe(1);
  });

  it("returns null for out-of-range", () => {
    expect(parseMonth(0)).toBeNull();
    expect(parseMonth(13)).toBeNull();
  });

  it("returns null for null/empty", () => {
    expect(parseMonth(null)).toBeNull();
    expect(parseMonth("")).toBeNull();
  });
});

describe("parseNullableFloat", () => {
  it("parses positive values", () => {
    expect(parseNullableFloat("42.09")).toBeCloseTo(42.09);
    expect(parseNullableFloat(42.09)).toBeCloseTo(42.09);
  });

  it("parses negative values (critical for US longitudes)", () => {
    expect(parseNullableFloat("-71.02")).toBeCloseTo(-71.02);
    expect(parseNullableFloat(-71.02)).toBeCloseTo(-71.02);
  });

  it("returns null for null, undefined, empty string", () => {
    expect(parseNullableFloat(null)).toBeNull();
    expect(parseNullableFloat(undefined)).toBeNull();
    expect(parseNullableFloat("")).toBeNull();
  });

  it("returns null for non-finite values", () => {
    expect(parseNullableFloat("Infinity")).toBeNull();
    expect(parseNullableFloat("NaN")).toBeNull();
    expect(parseNullableFloat("not-a-number")).toBeNull();
  });

  it("rounds to 6 decimal places", () => {
    expect(parseNullableFloat("42.123456789")).toBe(42.123457);
  });
});

// ── fetchEiaGenerators ────────────────────────────────────────────────────────

const SAMPLE_EIA_RESPONSE = {
  response: {
    total: 2,
    data: [
      {
        period: "2023",
        stateid: "MA",
        county: "Plymouth",
        latitude: "42.09",
        longitude: "-71.02",
        balancingAuthorityCode: "ISNE",
        entityid: "56789",
        entityName: "Brockton Power Company LLC",
        plantCode: "10750",
        generatorId: "GEN1",
        plantName: "Brockton Power",
        technology: "Natural Gas Fired Combined Cycle",
        primeMoverCode: "CC",
        "energy-source-code": "NG",
        statusCode: "OP",
        "nameplate-capacity-mw": "350.0",
        "summer-capacity-mw": "335.0",
        "winter-capacity-mw": "360.0",
        operatingYear: "1995",
        operatingMonth: "6",
      },
      {
        period: "2023",
        stateid: "MA",
        county: "Barnstable",
        latitude: "41.7",
        longitude: "-70.3",
        balancingAuthorityCode: "ISNE",
        entityid: "99001",
        entityName: "Vineyard Wind",
        plantCode: "65432",
        generatorId: "WND1",
        plantName: "Vineyard Wind 1",
        technology: "Offshore Wind Turbine",
        primeMoverCode: "WT",
        "energy-source-code": "WND",
        statusCode: "OP",
        "nameplate-capacity-mw": "800.0",
        "summer-capacity-mw": "800.0",
        "winter-capacity-mw": "800.0",
        operatingYear: "2024",
        operatingMonth: "1",
      },
    ],
  },
};

function makeMockFetch(
  body: unknown,
  status = 200
): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: () => "application/json" },
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

describe("fetchEiaGenerators", () => {
  it("parses valid EIA API response into insert rows", async () => {
    const mockFetch = makeMockFetch(SAMPLE_EIA_RESPONSE);
    process.env.EIA_API_KEY = "test_key";

    const result = await fetchEiaGenerators(mockFetch, TENANT_ID, {
      baCodes: ["ISNE"],
      dataYear: 2023,
      url: "https://test.eia.gov/v2/electricity/operating-generator-capacity/data/",
    });

    expect(result.rows).toHaveLength(2);
    expect(result.fetchedCount).toBe(2);
    expect(result.parseErrors).toHaveLength(0);

    const gas = result.rows.find((r) => r.plant_id === "10750");
    expect(gas?.generator_id).toBe("GEN1");
    expect(gas?.fuel_type).toBe("natural_gas");
    expect(gas?.operational_status).toBe("operating");
    expect(gas?.nameplate_mw).toBe(350.0);
    expect(gas?.summer_mw).toBe(335.0);
    expect(gas?.winter_mw).toBe(360.0);
    expect(gas?.balancing_authority).toBe("ISNE");
    expect(gas?.state_abbr).toBe("MA");
    expect(gas?.operating_year).toBe(1995);
    expect(gas?.operating_month).toBe(6);
    expect(gas?.tenant_id).toBe(TENANT_ID);
    expect(gas?.data_year).toBe(2023);
    // C2 fix: negative longitude must not be silently nulled
    expect(gas?.latitude).toBeCloseTo(42.09);
    expect(gas?.longitude).toBeCloseTo(-71.02);

    const wind = result.rows.find((r) => r.plant_id === "65432");
    expect(wind?.fuel_type).toBe("wind");
    expect(wind?.technology).toBe("Offshore Wind Turbine");
  });

  it("skips rows missing plantCode, generatorId, or plantName", async () => {
    const badResponse = {
      response: {
        total: 2,
        data: [
          { period: "2023", plantCode: "", generatorId: "GEN1", plantName: "Test" }, // missing plantCode
          { period: "2023", plantCode: "123", generatorId: "", plantName: "Test" },  // missing generatorId
        ],
      },
    };
    const mockFetch = makeMockFetch(badResponse);
    process.env.EIA_API_KEY = "test_key";

    const result = await fetchEiaGenerators(mockFetch, TENANT_ID, {
      url: "https://test.eia.gov/test",
    });

    expect(result.rows).toHaveLength(0);
    expect(result.parseErrors).toHaveLength(2);
  });

  it("throws on HTTP error response", async () => {
    const mockFetch = makeMockFetch({ error: "Forbidden" }, 403);
    process.env.EIA_API_KEY = "test_key";

    await expect(
      fetchEiaGenerators(mockFetch, TENANT_ID, {
        url: "https://test.eia.gov/test",
      })
    ).rejects.toThrow("HTTP 403");
  });

  it("throws when EIA_API_KEY is not set", async () => {
    const saved = process.env.EIA_API_KEY;
    delete process.env.EIA_API_KEY;

    await expect(
      fetchEiaGenerators(vi.fn() as unknown as typeof globalThis.fetch, TENANT_ID)
    ).rejects.toThrow("EIA_API_KEY");

    process.env.EIA_API_KEY = saved;
  });

  it("paginates when total > page size", async () => {
    // First page returns 5000 rows (EIA_PAGE_SIZE), second returns 3
    const page1 = {
      response: {
        total: 5003,
        data: Array.from({ length: 5000 }, (_, i) => ({
          period: "2023",
          plantCode: `PLANT${i}`,
          generatorId: "GEN1",
          plantName: `Plant ${i}`,
          "energy-source-code": "NG",
          statusCode: "OP",
          "nameplate-capacity-mw": "100",
        })),
      },
    };

    const page2 = {
      response: {
        total: 5003,
        data: Array.from({ length: 3 }, (_, i) => ({
          period: "2023",
          plantCode: `PLANT${5000 + i}`,
          generatorId: "GEN1",
          plantName: `Plant ${5000 + i}`,
          "energy-source-code": "NG",
          statusCode: "OP",
          "nameplate-capacity-mw": "100",
        })),
      },
    };

    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      const body = callCount === 0 ? page1 : page2;
      callCount++;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as unknown as Response);
    });

    process.env.EIA_API_KEY = "test_key";

    const result = await fetchEiaGenerators(mockFetch, TENANT_ID, {
      baCodes: ["ISNE"],
      dataYear: 2023,
      url: "https://test.eia.gov/test",
    });

    expect(callCount).toBe(2); // two pages fetched
    expect(result.rows).toHaveLength(5003);
    expect(result.fetchedCount).toBe(5003);
  });
});

// ── EiaGeneratorRepository (mock client) ─────────────────────────────────────

function makeMockSupabase(returnData: unknown[] = [], error: string | null = null) {
  const mockChain = {
    upsert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: returnData[0] ?? null,
      error: error ? { message: error } : null,
    }),
  };

  // Make all chain methods except terminal ones return `this`
  // and resolve with data/error on terminal calls
  const terminalResult = {
    data: returnData,
    error: error ? { message: error } : null,
  };
  mockChain.upsert.mockReturnValue(Promise.resolve({ error: null }));
  mockChain.select.mockReturnThis();
  mockChain.eq.mockReturnThis();
  mockChain.not.mockReturnThis();
  mockChain.gte.mockReturnThis();
  mockChain.lte.mockReturnThis();
  mockChain.order.mockReturnThis();
  mockChain.limit.mockReturnThis();

  // Make the chain itself thenable so `await chain` works
  const thenableChain = Object.assign(mockChain, {
    then: (resolve: (v: typeof terminalResult) => void) => Promise.resolve(terminalResult).then(resolve),
    catch: (reject: (e: unknown) => void) => Promise.resolve(terminalResult).catch(reject),
  });

  return {
    from: vi.fn().mockReturnValue(thenableChain),
  };
}

describe("EiaGeneratorRepository.upsertBatch", () => {
  it("validates all rows before upserting", async () => {
    const client = makeMockSupabase() as unknown as import("@supabase/supabase-js").SupabaseClient;
    const repo = new EiaGeneratorRepository(client);

    const badRows = [makeInsert({ plant_id: "" })];
    await expect(repo.upsertBatch(badRows)).rejects.toThrow(EiaGeneratorValidationError);
  });

  it("returns 0 for empty input", async () => {
    const client = makeMockSupabase() as unknown as import("@supabase/supabase-js").SupabaseClient;
    const repo = new EiaGeneratorRepository(client);
    expect(await repo.upsertBatch([])).toBe(0);
  });

  it("chunks large batches correctly", async () => {
    let upsertCallCount = 0;
    const client = {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockImplementation(() => {
          upsertCallCount++;
          return Promise.resolve({ error: null });
        }),
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const repo = new EiaGeneratorRepository(client);
    // 1100 rows → ceil(1100 / 500) = 3 batches
    const rows = Array.from({ length: 1100 }, (_, i) =>
      makeInsert({ plant_id: `P${i}`, generator_id: `G${i}` })
    );

    const count = await repo.upsertBatch(rows);
    expect(upsertCallCount).toBe(3); // 500 + 500 + 100
    expect(count).toBe(1100);
  });
});

// ── Pipeline orchestrator ─────────────────────────────────────────────────────

describe("runEiaGeneratorPipeline", () => {
  it("fetches, validates, upserts and returns a report", async () => {
    process.env.EIA_API_KEY = "test_key";
    const mockFetch = makeMockFetch(SAMPLE_EIA_RESPONSE);

    let upsertedRows: unknown[] = [];
    const mockDb = {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockImplementation((rows: unknown[]) => {
          upsertedRows = rows;
          return Promise.resolve({ error: null });
        }),
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const report = await runEiaGeneratorPipeline({
      tenantId: TENANT_ID,
      db: mockDb,
      httpFetch: mockFetch,
      baCodes: ["ISNE"],
      dataYear: 2023,
      url: "https://test.eia.gov/test",
      retryBaseDelayMs: 0,
    });

    expect(report.runId).toBeTruthy();
    expect(report.tenantId).toBe(TENANT_ID);
    expect(report.dataYear).toBe(2023);
    expect(report.fetchedCount).toBe(2);
    expect(report.validatedCount).toBe(2);
    expect(report.upsertedCount).toBe(2);
    expect(report.parseErrors).toBe(0);
    expect(report.validationErrors).toBe(0);
    expect(report.fetchError).toBeUndefined();
    expect(upsertedRows).toHaveLength(2);
  });

  it("records fetchError when EIA API fails after retries", async () => {
    process.env.EIA_API_KEY = "test_key";
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network timeout"));

    const mockDb = {
      from: vi.fn(),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const report = await runEiaGeneratorPipeline({
      tenantId: TENANT_ID,
      db: mockDb,
      httpFetch: mockFetch,
      url: "https://test.eia.gov/test",
      retryBaseDelayMs: 0,
    });

    expect(report.fetchError).toContain("Network timeout");
    expect(report.upsertedCount).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(3); // 3 retry attempts
  });

  it("counts parse errors for rows missing required fields", async () => {
    process.env.EIA_API_KEY = "test_key";

    // The normalizer returns null (parse error) when plantCode/generatorId are
    // absent. These rows are skipped before validation, reported in parseErrors.
    const badResponse = {
      response: {
        total: 2,
        data: [
          {
            period: "2023",
            plantCode: "",      // empty → parse error
            generatorId: "G1",
            plantName: "Plant A",
            "energy-source-code": "NG",
            statusCode: "OP",
            "nameplate-capacity-mw": "100",
          },
          {
            period: "2023",
            plantCode: "P999",
            generatorId: "",   // empty → parse error
            plantName: "Plant B",
            "energy-source-code": "NG",
            statusCode: "OP",
            "nameplate-capacity-mw": "100",
          },
        ],
      },
    };
    const mockFetch = makeMockFetch(badResponse);

    let upsertCallCount = 0;
    const mockDb = {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockImplementation(() => {
          upsertCallCount++;
          return Promise.resolve({ error: null });
        }),
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const report = await runEiaGeneratorPipeline({
      tenantId: TENANT_ID,
      db: mockDb,
      httpFetch: mockFetch,
      url: "https://test.eia.gov/test",
      retryBaseDelayMs: 0,
    });

    // Both rows fail at parse time (missing required identifiers)
    expect(report.parseErrors).toBe(2);
    expect(report.validationErrors).toBe(0);
    expect(report.validatedCount).toBe(0);
    expect(upsertCallCount).toBe(0); // nothing to upsert
  });

  it("uses previous calendar year as default dataYear", async () => {
    process.env.EIA_API_KEY = "test_key";
    const currentYear = new Date().getFullYear();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          response: { total: 0, data: [] },
        }),
    } as unknown as Response);

    const mockDb = {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null }),
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const report = await runEiaGeneratorPipeline({
      tenantId: TENANT_ID,
      db: mockDb,
      httpFetch: mockFetch,
      url: "https://test.eia.gov/test",
      retryBaseDelayMs: 0,
    });

    expect(report.dataYear).toBe(currentYear - 1);
  });
});

// ── Integration test ──────────────────────────────────────────────────────────

const INTEGRATION =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!INTEGRATION)("EiaGeneratorRepository integration", () => {
  it("upserts generators and queries them back", async () => {
    const { createServerClient } = await import("@/lib/db/client");
    const db = createServerClient();
    const repo = new EiaGeneratorRepository(db);

    const testRows: DbEiaGeneratorInsert[] = [
      makeInsert({
        plant_id: "INFRA006-TEST-001",
        generator_id: "GEN1",
        plant_name: "INFRA-006 Integration Test Plant",
        balancing_authority: "ISNE",
        data_year: 2023,
        nameplate_mw: 100.0,
        summer_mw: 95.0,
        winter_mw: 105.0,
        fuel_type: "natural_gas",
        operational_status: "operating",
      }),
      makeInsert({
        plant_id: "INFRA006-TEST-001",
        generator_id: "GEN2",
        plant_name: "INFRA-006 Integration Test Plant",
        balancing_authority: "ISNE",
        data_year: 2023,
        nameplate_mw: 50.0,
        summer_mw: 48.0,
        winter_mw: 52.0,
        fuel_type: "solar",
        operational_status: "operating",
      }),
    ];

    const count = await repo.upsertBatch(testRows);
    expect(count).toBe(2);

    const generators = await repo.listByBalancingAuthority(
      TENANT_ID,
      "ISNE",
      2023,
      { fuelType: "natural_gas" }
    );
    const testGen = generators.find((g) => g.plantId === "INFRA006-TEST-001");
    expect(testGen).toBeTruthy();
    expect(testGen?.generatorId).toBe("GEN1");
    expect(testGen?.nameplateMw).toBe(100.0);

    // Upsert again (idempotency check: should not add duplicates)
    await repo.upsertBatch(testRows);
    const after = await repo.listByBalancingAuthority(TENANT_ID, "ISNE", 2023);
    const duplicates = after.filter((g) => g.plantId === "INFRA006-TEST-001");
    expect(duplicates).toHaveLength(2); // still 2, not 4

    // Capacity summary
    const summary = await repo.getCapacitySummary(TENANT_ID, "ISNE", 2023);
    expect(summary.balancingAuthority).toBe("ISNE");
    expect(summary.byFuelType["natural_gas"]).toBeGreaterThanOrEqual(95);

    // Clean up
    await repo.deleteByYear(TENANT_ID, 2023);
    const afterDelete = await repo.listByBalancingAuthority(
      TENANT_ID,
      "ISNE",
      2023
    );
    // Should be empty (or not contain test rows after cleanup)
    const testRowsAfterDelete = afterDelete.filter(
      (g) => g.plantId === "INFRA006-TEST-001"
    );
    expect(testRowsAfterDelete).toHaveLength(0);
  });
});

// ── Performance benchmarks ────────────────────────────────────────────────────

describe("EIA generator performance", () => {
  it("maps 10,000 DB rows in under 50ms", () => {
    const rows = Array.from({ length: 10_000 }, (_, i) =>
      makeDbRow({ plant_id: `P${i}`, generator_id: `G${i}` })
    );

    const start = performance.now();
    const mapped = rows.map(toEiaGenerator);
    const elapsed = performance.now() - start;

    expect(mapped).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(50);
  });

  it("validates 1,000 inserts in under 10ms", () => {
    const inserts = Array.from({ length: 1_000 }, (_, i) =>
      makeInsert({ plant_id: `P${i}`, generator_id: `G${i}` })
    );

    const start = performance.now();
    inserts.forEach(validateEiaGeneratorInsert);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
  });

  it("mapFuelType handles 10,000 lookups in under 10ms", () => {
    const codes = ["NG", "SUN", "WND", "NUC", "WAT", "BIT", "DFO", "GEO", "WDS", null];

    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      mapFuelType(codes[i % codes.length], null);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
  });
});
