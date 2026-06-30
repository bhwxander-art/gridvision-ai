/**
 * INFRA-005: Queue ingestion pipeline tests
 *
 * Unit tests:
 *   - CSV parser (edge cases: quoted fields, embedded newlines, CRLF, empty fields)
 *   - Normalizer helpers (parseIsoDate, parseMw, mapProjectType, mapQueueStatus, parseCostMillions)
 *   - PJM fetcher (mock HTTP → JSON)
 *   - CAISO fetcher (mock HTTP → CSV)
 *   - ERCOT fetcher (mock HTTP → CSV)
 *   - MISO fetcher (mock HTTP → JSON and CSV fallback)
 *   - NYISO fetcher (mock HTTP → CSV)
 *   - ISO-NE fetcher (mock HTTP → CSV)
 *   - Pipeline orchestrator (mock fetchers → validate → upsert)
 *
 * Integration tests (skipped without SUPABASE_URL):
 *   - Full pipeline run with mock HTTP (real DB upserts)
 *
 * Performance benchmarks:
 *   - CSV parser: 10k rows < 50ms
 *   - Normalizer: 10k rows < 20ms
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseCsv } from "@/lib/ingestion/queue/csv";
import {
  parseIsoDate,
  parseMw,
  mapProjectType,
  mapQueueStatus,
  parseCostMillions,
} from "@/lib/ingestion/queue/normalizer";
import { pjmFetcher   } from "@/lib/ingestion/queue/fetchers/pjm";
import { caisoFetcher } from "@/lib/ingestion/queue/fetchers/caiso";
import { ercotFetcher } from "@/lib/ingestion/queue/fetchers/ercot";
import { misoFetcher  } from "@/lib/ingestion/queue/fetchers/miso";
import { nyisoFetcher } from "@/lib/ingestion/queue/fetchers/nyiso";
import { isoneFetcher } from "@/lib/ingestion/queue/fetchers/isone";
import {
  runQueueIngestionPipeline,
} from "@/lib/ingestion/queue/pipeline";
import type { IsoFetcher, FetchResult } from "@/lib/ingestion/queue/types";

const TENANT_ID = "00000000-0000-0000-0000-000000000002";

// ── CSV Parser ────────────────────────────────────────────────────────────────

describe("parseCsv", () => {
  it("parses a simple 2-column CSV with header", () => {
    const rows = parseCsv("name,value\nfoo,1\nbar,2");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "foo", value: "1" });
    expect(rows[1]).toEqual({ name: "bar", value: "2" });
  });

  it("handles CRLF line endings", () => {
    const rows = parseCsv("a,b\r\n1,2\r\n3,4");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ a: "1", b: "2" });
  });

  it("handles quoted fields with embedded commas", () => {
    const rows = parseCsv(`name,address\nAlice,"123 Main St, Suite 4"`);
    expect(rows[0]).toEqual({ name: "Alice", address: "123 Main St, Suite 4" });
  });

  it("handles quoted fields with escaped double quotes", () => {
    const rows = parseCsv(`name,desc\nFoo,"Say ""hello"""`);
    expect(rows[0]).toEqual({ name: "Foo", desc: 'Say "hello"' });
  });

  it("handles embedded newlines in quoted fields", () => {
    const rows = parseCsv(`name,note\nFoo,"line1\nline2"`);
    expect(rows[0]).toEqual({ name: "Foo", note: "line1\nline2" });
  });

  it("handles empty fields", () => {
    const rows = parseCsv("a,b,c\n1,,3");
    expect(rows[0]).toEqual({ a: "1", b: "", c: "3" });
  });

  it("skips blank rows when skipBlank=true (default)", () => {
    const rows = parseCsv("a,b\n1,2\n\n3,4");
    expect(rows).toHaveLength(2);
  });

  it("returns string arrays when hasHeader=false", () => {
    const rows = parseCsv("a,b\n1,2", { hasHeader: false });
    expect(rows[0]).toEqual(["a", "b"]);
    expect(rows[1]).toEqual(["1", "2"]);
  });

  it("respects maxRows", () => {
    const rows = parseCsv("a\n1\n2\n3\n4\n5", { maxRows: 2 });
    expect(rows).toHaveLength(2);
  });

  it("handles trailing commas (extra empty field)", () => {
    const rows = parseCsv("a,b,c\n1,2,");
    expect(rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });

  it("returns empty array for empty input", () => {
    expect(parseCsv("")).toHaveLength(0);
    expect(parseCsv("\n\n")).toHaveLength(0);
  });
});

// ── parseIsoDate ──────────────────────────────────────────────────────────────

describe("parseIsoDate", () => {
  it("returns YYYY-MM-DD unchanged", () => {
    expect(parseIsoDate("2025-06-15")).toBe("2025-06-15");
  });

  it("converts MM/DD/YYYY", () => {
    expect(parseIsoDate("06/15/2025")).toBe("2025-06-15");
  });

  it("converts M/D/YYYY", () => {
    expect(parseIsoDate("6/5/2025")).toBe("2025-06-05");
  });

  it("converts MM/DD/YY (2000s)", () => {
    expect(parseIsoDate("06/15/26")).toBe("2026-06-15");
  });

  it("converts YYYY/MM/DD", () => {
    expect(parseIsoDate("2025/06/15")).toBe("2025-06-15");
  });

  it("returns null for N/A", () => {
    expect(parseIsoDate("N/A")).toBeNull();
    expect(parseIsoDate("TBD")).toBeNull();
    expect(parseIsoDate("unknown")).toBeNull();
    expect(parseIsoDate("-")).toBeNull();
  });

  it("returns null for empty/null/undefined", () => {
    expect(parseIsoDate("")).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
    expect(parseIsoDate(undefined)).toBeNull();
  });

  it("returns null for garbage strings", () => {
    expect(parseIsoDate("not-a-date")).toBeNull();
    expect(parseIsoDate("12345")).toBeNull();
  });
});

// ── parseMw ───────────────────────────────────────────────────────────────────

describe("parseMw", () => {
  it("parses a plain number string", () => {
    expect(parseMw("100")).toBe(100);
    expect(parseMw("1.5")).toBe(1.5);
  });

  it("removes commas from large numbers", () => {
    expect(parseMw("1,200")).toBe(1200);
  });

  it("returns a number as-is when already numeric", () => {
    expect(parseMw(500)).toBe(500);
  });

  it("returns null for N/A, TBD, empty", () => {
    expect(parseMw("N/A")).toBeNull();
    expect(parseMw("TBD")).toBeNull();
    expect(parseMw("")).toBeNull();
    expect(parseMw(null)).toBeNull();
  });

  it("returns null for zero and negative values", () => {
    expect(parseMw("0")).toBeNull();
    expect(parseMw("-100")).toBeNull();
    expect(parseMw(0)).toBeNull();
  });
});

// ── mapProjectType ────────────────────────────────────────────────────────────

describe("mapProjectType", () => {
  it("maps solar variants", () => {
    expect(mapProjectType("Solar")).toBe("solar");
    expect(mapProjectType("PV")).toBe("solar");
    expect(mapProjectType("Photovoltaic")).toBe("solar");
  });

  it("maps wind variants", () => {
    expect(mapProjectType("Wind")).toBe("wind_onshore");
    expect(mapProjectType("Wind Generation")).toBe("wind_onshore");
    expect(mapProjectType("Onshore Wind")).toBe("wind_onshore");
  });

  it("maps offshore wind", () => {
    expect(mapProjectType("Offshore Wind")).toBe("wind_offshore");
    expect(mapProjectType("OFFSHORE WIND")).toBe("wind_offshore");
  });

  it("maps solar plus storage", () => {
    expect(mapProjectType("Solar + Storage")).toBe("solar_plus_storage");
    expect(mapProjectType("Solar with Battery")).toBe("solar_plus_storage");
    expect(mapProjectType("Storage + Solar")).toBe("solar_plus_storage");
  });

  it("maps battery storage", () => {
    expect(mapProjectType("Battery Storage")).toBe("battery_storage");
    expect(mapProjectType("BESS")).toBe("battery_storage");
    expect(mapProjectType("Energy Storage")).toBe("battery_storage");
  });

  it("maps natural gas", () => {
    expect(mapProjectType("Natural Gas")).toBe("natural_gas");
    expect(mapProjectType("Combustion Turbine")).toBe("natural_gas");
    expect(mapProjectType("Combined Cycle")).toBe("natural_gas");
    expect(mapProjectType("CCGT")).toBe("natural_gas");
  });

  it("maps hydro", () => {
    expect(mapProjectType("Hydro")).toBe("hydro");
    expect(mapProjectType("Hydroelectric")).toBe("hydro");
  });

  it("maps nuclear", () => {
    expect(mapProjectType("Nuclear")).toBe("nuclear");
  });

  it("maps load", () => {
    expect(mapProjectType("Load")).toBe("load");
    expect(mapProjectType("Demand Response")).toBe("load");
  });

  it("falls back to other_generation for unknown types", () => {
    expect(mapProjectType("Biomass")).toBe("other_generation");
    expect(mapProjectType("Waste-to-Energy")).toBe("other_generation");
    expect(mapProjectType("")).toBe("other_generation");
    expect(mapProjectType(null)).toBe("other_generation");
  });
});

// ── mapQueueStatus ────────────────────────────────────────────────────────────

describe("mapQueueStatus", () => {
  it("maps in-service variants", () => {
    expect(mapQueueStatus("In Service")).toBe("in_service");
    expect(mapQueueStatus("Operational")).toBe("in_service");
    expect(mapQueueStatus("Commercial Operation")).toBe("in_service");
    expect(mapQueueStatus("Online")).toBe("in_service");
  });

  it("maps withdrawn variants", () => {
    expect(mapQueueStatus("Withdrawn")).toBe("withdrawn");
    expect(mapQueueStatus("Cancelled")).toBe("withdrawn");
    expect(mapQueueStatus("Terminated")).toBe("withdrawn");
  });

  it("maps executed IA", () => {
    expect(mapQueueStatus("Executed IA")).toBe("executed_ia");
    expect(mapQueueStatus("IA Executed")).toBe("executed_ia");
    expect(mapQueueStatus("Active IA")).toBe("executed_ia");
  });

  it("maps phase 3 (facilities study)", () => {
    expect(mapQueueStatus("Phase 3")).toBe("study_phase_3");
    expect(mapQueueStatus("Facilities Study")).toBe("study_phase_3");
    expect(mapQueueStatus("3rd Study")).toBe("study_phase_3");
  });

  it("maps phase 2 (system impact)", () => {
    expect(mapQueueStatus("Phase 2")).toBe("study_phase_2");
    expect(mapQueueStatus("System Impact Study")).toBe("study_phase_2");
    expect(mapQueueStatus("2nd Study")).toBe("study_phase_2");
  });

  it("maps phase 1 (scoping/feasibility)", () => {
    expect(mapQueueStatus("Phase 1")).toBe("study_phase_1");
    expect(mapQueueStatus("Feasibility Study")).toBe("study_phase_1");
    expect(mapQueueStatus("Scoping Study")).toBe("study_phase_1");
  });

  it("maps active/submitted variants", () => {
    expect(mapQueueStatus("Active")).toBe("submitted");
    expect(mapQueueStatus("New")).toBe("submitted");
    expect(mapQueueStatus("Queued")).toBe("submitted");
    expect(mapQueueStatus("Pending")).toBe("submitted");
  });

  it("defaults unknown status to submitted", () => {
    expect(mapQueueStatus("")).toBe("submitted");
    expect(mapQueueStatus(null)).toBe("submitted");
    expect(mapQueueStatus("Under Review by Committee")).toBe("submitted");
  });
});

// ── parseCostMillions ─────────────────────────────────────────────────────────

describe("parseCostMillions", () => {
  it("parses plain number (already in millions)", () => {
    expect(parseCostMillions(24.5)).toBe(24.5);
    expect(parseCostMillions("24.5")).toBe(24.5);
  });

  it("parses string with M suffix", () => {
    expect(parseCostMillions("$24.5M")).toBe(24.5);
    expect(parseCostMillions("24.5M")).toBe(24.5);
  });

  it("parses string with B suffix (converts to millions)", () => {
    expect(parseCostMillions("1.5B")).toBe(1500);
  });

  it("converts raw dollar amounts (> 1,000,000) to millions", () => {
    expect(parseCostMillions("24500000")).toBe(24.5);
    expect(parseCostMillions("1,200,000")).toBe(1.2);
  });

  it("does NOT divide values <= 1,000,000 (already in millions)", () => {
    // $1,200M is a valid large network upgrade — should not be divided
    expect(parseCostMillions("1200")).toBe(1200);
    // $500M
    expect(parseCostMillions("500")).toBe(500);
  });

  it("returns null for N/A, empty, null", () => {
    expect(parseCostMillions("N/A")).toBeNull();
    expect(parseCostMillions("")).toBeNull();
    expect(parseCostMillions(null)).toBeNull();
    expect(parseCostMillions(undefined)).toBeNull();
  });
});

// ── Mock fetch helper ─────────────────────────────────────────────────────────

function makeMockFetch(
  body: string,
  contentType = "text/csv"
): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => contentType },
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  } as unknown as Response);
}

function makeMockFetchError(status: number): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: "Not Found",
    headers: { get: () => null },
  } as unknown as Response);
}

// ── PJM fetcher ───────────────────────────────────────────────────────────────

const PJM_JSON = JSON.stringify([
  {
    QUEUE_NUMBER: "J1234",
    NAME: "Bedington Solar 1",
    FUELD_TYPE: "Solar",
    STATUS: "Active",
    MEGAWATTS: "500",
    QUEUE_DATE: "2023-01-15",
    IN_SERVICE_DATE: "2027-06-01",
    COUNTY: "Berkeley",
    STATE_ABBREV: "WV",
    TRANSMISSION_OWNER: "APS",
    NETWORK_UPGRADE_COST: "12.5",
    PROJECT_COST_SHARE: "3.2",
  },
  {
    QUEUE_NUMBER: "J1235",
    NAME: "Mountain Wind Farm",
    FUELD_TYPE: "Wind",
    STATUS: "Withdrawn",
    MEGAWATTS: "300",
    QUEUE_DATE: "2022-06-01",
    IN_SERVICE_DATE: "",
    COUNTY: "Mineral",
    STATE_ABBREV: "WV",
    TRANSMISSION_OWNER: "APS",
    NETWORK_UPGRADE_COST: "",
    PROJECT_COST_SHARE: "",
  },
  {
    // Invalid — missing queue number
    QUEUE_NUMBER: "",
    NAME: "Bad Row",
    FUELD_TYPE: "Solar",
    STATUS: "Active",
    MEGAWATTS: "100",
    QUEUE_DATE: "2023-01-01",
  },
  {
    // Invalid — unparseable date
    QUEUE_NUMBER: "J1237",
    NAME: "Bad Date Project",
    FUELD_TYPE: "Solar",
    STATUS: "Active",
    MEGAWATTS: "100",
    QUEUE_DATE: "not-a-date",
  },
]);

describe("pjmFetcher", () => {
  it("parses valid rows and returns errors for invalid rows", async () => {
    const mockFetch = makeMockFetch(PJM_JSON, "application/json");
    const result = await pjmFetcher.fetch(mockFetch, TENANT_ID, {
      url: "https://test.pjm.com/feed",
    });

    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(2);

    const solar = result.rows.find((r) => r.project_number === "J1234");
    expect(solar?.project_type).toBe("solar");
    expect(solar?.capacity_mw).toBe(500);
    expect(solar?.current_status).toBe("submitted");
    expect(solar?.iso_id).toBe("PJM");
    expect(solar?.tenant_id).toBe(TENANT_ID);
    expect(solar?.network_upgrade_cost_m).toBe(12.5);
    expect(solar?.target_cod).toBe("2027-06-01");
    expect(solar?.queue_date).toBe("2023-01-15");

    const wind = result.rows.find((r) => r.project_number === "J1235");
    expect(wind?.current_status).toBe("withdrawn");
    expect(wind?.project_type).toBe("wind_onshore");
  });

  it("wraps JSON in items array correctly", async () => {
    const wrappedJson = JSON.stringify({ items: JSON.parse(PJM_JSON) });
    const mockFetch = makeMockFetch(wrappedJson, "application/json");
    const result = await pjmFetcher.fetch(mockFetch, TENANT_ID, {
      url: "https://test.pjm.com/feed",
    });
    expect(result.rows).toHaveLength(2);
  });

  it("throws on HTTP error", async () => {
    const mockFetch = makeMockFetchError(503);
    await expect(
      pjmFetcher.fetch(mockFetch, TENANT_ID, { url: "https://test.pjm.com/feed" })
    ).rejects.toThrow("HTTP 503");
  });
});

// ── CAISO fetcher ─────────────────────────────────────────────────────────────

const CAISO_CSV = `Queue Position,Application Received Date,Project Name,Technology Type,MW-AC,MW-DC,County,State,Proposed On-line Date,Interconnection Agreement Status,Feasibility Study Status,System Impact Study Status
100,01/15/2023,Desert Sun Solar,Solar,250,,San Bernardino,CA,06/01/2027,,,
200,06/01/2022,Tehachapi Wind,Wind,400,,Kern,CA,12/01/2026,Executed,Complete,Complete
300,,Missing Date Project,Solar,100,,Kern,CA,,,,
400,01/01/2023,No Capacity Project,Solar,0,,LA,CA,,,, `;

describe("caisoFetcher", () => {
  it("parses valid CAISO CSV rows", async () => {
    const mockFetch = makeMockFetch(CAISO_CSV, "text/csv");
    const result = await caisoFetcher.fetch(mockFetch, TENANT_ID, {
      url: "https://test.caiso.com/queue.csv",
    });

    expect(result.rows).toHaveLength(2); // 2 valid, 2 invalid
    expect(result.errors).toHaveLength(2);

    const solar = result.rows.find((r) => r.project_number === "100");
    expect(solar?.iso_id).toBe("CAISO");
    expect(solar?.project_type).toBe("solar");
    expect(solar?.capacity_mw).toBe(250);
    expect(solar?.queue_date).toBe("2023-01-15");
    expect(solar?.state_abbr).toBe("CA");

    const wind = result.rows.find((r) => r.project_number === "200");
    expect(wind?.current_status).toBe("executed_ia");
    expect(wind?.project_type).toBe("wind_onshore");
  });
});

// ── ERCOT fetcher ─────────────────────────────────────────────────────────────

const ERCOT_CSV = `INR Number,Request Received Date,Company Name,Technology Type,Net Electrical Output (MW),Estimated IN-Service Date,Status,County Name
INRQ-2023-001,01/15/2023,Texas Solar LLC,Solar Power,300,06/01/2027,Active,Travis
INRQ-2022-050,06/01/2022,West Texas Wind Inc,Wind Generation,600,12/01/2026,Phase 1,Ector
INRQ-2023-002,,Missing Date,Solar,100,,,Travis`;

describe("ercotFetcher", () => {
  it("parses valid ERCOT CSV rows", async () => {
    const mockFetch = makeMockFetch(ERCOT_CSV, "text/csv");
    const result = await ercotFetcher.fetch(mockFetch, TENANT_ID, {
      url: "https://test.ercot.com/queue.csv",
    });

    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(1);

    const solar = result.rows.find((r) => r.project_number === "INRQ-2023-001");
    expect(solar?.iso_id).toBe("ERCOT");
    expect(solar?.state_abbr).toBe("TX"); // always TX
    expect(solar?.project_type).toBe("solar");
    expect(solar?.current_status).toBe("submitted");

    const wind = result.rows.find((r) => r.project_number === "INRQ-2022-050");
    expect(wind?.current_status).toBe("study_phase_1");
    expect(wind?.capacity_mw).toBe(600);
  });
});

// ── MISO fetcher ──────────────────────────────────────────────────────────────

const MISO_JSON = JSON.stringify([
  {
    QUEUE_NBR: "G2023001",
    COMPANY_NAME: "Indiana Solar 1",
    FUEL_TYPE: "Solar",
    MW: "200",
    COUNTY: "Gibson",
    STATE: "IN",
    PROPOSED_IN_SVC_DATE: "06/01/2027",
    STATUS: "Active",
    SUBSTATION: "Patoka",
    QUEUE_DATE: "01/15/2023",
    NETWORK_UPGRADE_COST: "8.5",
  },
]);

const MISO_CSV = `Queue Number,Company Name,Type,MW-AC,County,State,Proposed In-Service,Status,Substation Name,Queue Date,Upgrade Cost ($M)
M2023001,Michigan Wind LLC,Wind,400,Kent,MI,12/01/2026,Phase 2,Consumers,06/01/2022,22.0`;

describe("misoFetcher", () => {
  it("parses MISO JSON response", async () => {
    const mockFetch = makeMockFetch(MISO_JSON, "application/json");
    const result = await misoFetcher.fetch(mockFetch, TENANT_ID, {
      url: "https://test.miso.com/queue",
    });

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.iso_id).toBe("MISO");
    expect(row.project_number).toBe("G2023001");
    expect(row.project_type).toBe("solar");
    expect(row.network_upgrade_cost_m).toBe(8.5);
    expect(row.queue_date).toBe("2023-01-15");
  });

  it("falls back to CSV parsing when response is not JSON", async () => {
    const mockFetch = makeMockFetch(MISO_CSV, "text/csv");
    const result = await misoFetcher.fetch(mockFetch, TENANT_ID, {
      url: "https://test.miso.com/queue.csv",
    });

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.iso_id).toBe("MISO");
    expect(row.project_number).toBe("M2023001");
    expect(row.project_type).toBe("wind_onshore");
    expect(row.current_status).toBe("study_phase_2");
  });
});

// ── NYISO fetcher ─────────────────────────────────────────────────────────────

const NYISO_CSV = `Queue #,Project Name,Owner,Type,MWac,Zone,County,State,Proposed In-Service Date,Status,Application Date
1000,Hudson Solar,Hudson Energy LLC,Solar,150,J,Westchester,NY,06/01/2027,Active,01/15/2023
2000,Long Island Wind,LI Offshore LLC,Offshore Wind,800,K,Suffolk,NY,12/01/2028,Phase 2,06/01/2022
3000,Missing Date Project,Owner Inc,Solar,100,A,Albany,NY,,,`;

describe("nyisoFetcher", () => {
  it("parses valid NYISO CSV rows", async () => {
    const mockFetch = makeMockFetch(NYISO_CSV, "text/csv");
    const result = await nyisoFetcher.fetch(mockFetch, TENANT_ID, {
      url: "https://test.nyiso.com/queue.csv",
    });

    expect(result.rows).toHaveLength(2);

    const solar = result.rows.find((r) => r.project_number === "1000");
    expect(solar?.iso_id).toBe("NYISO");
    expect(solar?.project_type).toBe("solar");
    expect(solar?.capacity_mw).toBe(150);
    expect(solar?.state_abbr).toBe("NY");

    const offshore = result.rows.find((r) => r.project_number === "2000");
    expect(offshore?.project_type).toBe("wind_offshore");
    expect(offshore?.current_status).toBe("study_phase_2");
  });
});

// ── ISO-NE fetcher ────────────────────────────────────────────────────────────

const ISONE_CSV = `Capacity Item #,Project Name,Owner,Technology,Summer Capacity (MW),State,Proposed Commercial Operation Date,Status,Date Submitted,Town/City,First Point of Interconnection
1234.01,Maine Wind,Avangrid,Wind,400,ME,12/01/2026,Phase 1,01/15/2022,Portland,Orrington
5678.02,Mass Solar,SunPower,Solar,200,MA,06/01/2027,Active,06/01/2023,Worcester,West Springfield`;

describe("isoneFetcher", () => {
  it("parses valid ISO-NE CSV rows", async () => {
    const mockFetch = makeMockFetch(ISONE_CSV, "text/csv");
    const result = await isoneFetcher.fetch(mockFetch, TENANT_ID, {
      url: "https://test.iso-ne.com/queue.csv",
    });

    expect(result.rows).toHaveLength(2);

    const wind = result.rows.find((r) => r.project_number === "1234.01");
    expect(wind?.iso_id).toBe("ISONE");
    expect(wind?.project_type).toBe("wind_onshore");
    expect(wind?.state_abbr).toBe("ME");
    expect(wind?.current_status).toBe("study_phase_1");

    const solar = result.rows.find((r) => r.project_number === "5678.02");
    expect(solar?.project_type).toBe("solar");
    expect(solar?.state_abbr).toBe("MA");
    expect(solar?.current_status).toBe("submitted");
  });

  it("strips metadata lines before the header", async () => {
    const csvWithPreamble =
      "Report Generated: 2025-01-01\nThis is internal ISO-NE data\n" +
      ISONE_CSV;
    const mockFetch = makeMockFetch(csvWithPreamble, "text/csv");
    const result = await isoneFetcher.fetch(mockFetch, TENANT_ID, {
      url: "https://test.iso-ne.com/queue.csv",
    });
    expect(result.rows).toHaveLength(2);
  });
});

// ── Pipeline orchestrator ─────────────────────────────────────────────────────

function makeMockFetcher(
  isoId: IsoFetcher["isoId"],
  result: FetchResult
): IsoFetcher {
  return {
    isoId,
    fetch: vi.fn().mockResolvedValue(result),
  };
}

function makeMockDb(upsertError?: string) {
  const upsertFn = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue(
      upsertError
        ? Promise.resolve({ data: null, error: { message: upsertError } })
        : Promise.resolve({ data: [{ id: "123" }], error: null })
    ),
  });
  return { from: vi.fn().mockReturnValue({ upsert: upsertFn }) };
}

describe("runQueueIngestionPipeline", () => {
  it("collects results from all ISOs and returns a report", async () => {
    const mockPjm = makeMockFetcher("PJM", {
      rows: [
        {
          tenant_id: TENANT_ID,
          iso_id: "PJM",
          project_number: "J1234",
          project_name: "Test Solar",
          capacity_mw: 500,
          queue_date: "2023-01-15",
          current_status: "submitted",
          project_type: "solar",
        },
      ],
      errors: [],
    });

    const mockCalso = makeMockFetcher("CAISO", {
      rows: [],
      errors: [{ rowIndex: 0, field: "Queue Position", reason: "missing" }],
    });

    const mockDb = makeMockDb();

    const report = await runQueueIngestionPipeline({
      tenantId: TENANT_ID,
      fetchers: [mockPjm, mockCalso],
      httpFetch: vi.fn() as unknown as typeof globalThis.fetch,
      db: mockDb as unknown as import("@supabase/supabase-js").SupabaseClient,
      retryBaseDelayMs: 0,
    });

    expect(report.runId).toBeTruthy();
    expect(report.tenantId).toBe(TENANT_ID);
    expect(report.isos).toHaveLength(2);

    const pjmResult = report.isos.find((r) => r.isoId === "PJM");
    expect(pjmResult?.upserted).toBe(1);
    expect(pjmResult?.parseErrors).toBe(0);

    const caisoResult = report.isos.find((r) => r.isoId === "CAISO");
    expect(caisoResult?.parseErrors).toBe(1);
    expect(caisoResult?.upserted).toBe(0);

    expect(report.total.upserted).toBe(1);
    expect(report.total.errors).toBe(1); // CAISO parse error
  });

  it("retries a transient fetch failure before marking as failed", async () => {
    let callCount = 0;
    const flakyFetcher: IsoFetcher = {
      isoId: "PJM",
      fetch: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) return Promise.reject(new Error("transient"));
        return Promise.resolve({ rows: [], errors: [] });
      }),
    };

    const mockDb = makeMockDb();
    const report = await runQueueIngestionPipeline({
      tenantId: TENANT_ID,
      fetchers: [flakyFetcher],
      httpFetch: vi.fn() as unknown as typeof globalThis.fetch,
      db: mockDb as unknown as import("@supabase/supabase-js").SupabaseClient,
      retryBaseDelayMs: 0, // no delay in tests
    });

    expect(callCount).toBe(3); // two failures then success
    const result = report.isos[0];
    expect(result.fetchError).toBeUndefined(); // succeeded on 3rd attempt
  });

  it("continues processing other ISOs when one ISO fetch fails", async () => {
    const mockPjm: IsoFetcher = {
      isoId: "PJM",
      fetch: vi.fn().mockRejectedValue(new Error("PJM API down")),
    };

    const mockNyiso = makeMockFetcher("NYISO", {
      rows: [
        {
          tenant_id: TENANT_ID,
          iso_id: "NYISO",
          project_number: "1000",
          project_name: "NY Solar",
          capacity_mw: 100,
          queue_date: "2023-01-15",
          current_status: "submitted",
          project_type: "solar",
        },
      ],
      errors: [],
    });

    const mockDb = makeMockDb();

    const report = await runQueueIngestionPipeline({
      tenantId: TENANT_ID,
      fetchers: [mockPjm, mockNyiso],
      httpFetch: vi.fn() as unknown as typeof globalThis.fetch,
      db: mockDb as unknown as import("@supabase/supabase-js").SupabaseClient,
      retryBaseDelayMs: 0,
    });

    const pjmResult = report.isos.find((r) => r.isoId === "PJM");
    expect(pjmResult?.fetchError).toBe("PJM API down");
    expect(pjmResult?.upserted).toBe(0);

    const nyisoResult = report.isos.find((r) => r.isoId === "NYISO");
    expect(nyisoResult?.upserted).toBe(1);
    expect(nyisoResult?.fetchError).toBeUndefined();

    expect(report.total.errors).toBeGreaterThan(0);
  });

  it("skips rows that fail validateQueueProjectInsert", async () => {
    const mockFetcher = makeMockFetcher("ERCOT", {
      rows: [
        {
          tenant_id: TENANT_ID,
          iso_id: "ERCOT",
          project_number: "",  // invalid — empty project number
          project_name: "Bad Row",
          capacity_mw: 100,
          queue_date: "2023-01-15",
          current_status: "submitted",
          project_type: "solar",
        },
      ],
      errors: [],
    });

    const mockDb = makeMockDb();

    const report = await runQueueIngestionPipeline({
      tenantId: TENANT_ID,
      fetchers: [mockFetcher],
      httpFetch: vi.fn() as unknown as typeof globalThis.fetch,
      db: mockDb as unknown as import("@supabase/supabase-js").SupabaseClient,
      retryBaseDelayMs: 0,
    });

    const ercotResult = report.isos[0];
    expect(ercotResult.upserted).toBe(0);
    expect(ercotResult.parseErrors).toBe(1); // validation error counted
  });

  it("batches large result sets correctly", async () => {
    // 450 rows → 3 batches of 200, 200, 50
    const rows = Array.from({ length: 450 }, (_, i) => ({
      tenant_id: TENANT_ID,
      iso_id: "PJM" as const,
      project_number: `J${String(i + 1).padStart(4, "0")}`,
      project_name: `Project ${i + 1}`,
      capacity_mw: 100,
      queue_date: "2023-01-15",
      current_status: "submitted" as const,
      project_type: "solar" as const,
    }));

    const mockFetcher = makeMockFetcher("PJM", { rows, errors: [] });

    let upsertCallCount = 0;
    const mockDb = {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockImplementation(() => {
          upsertCallCount++;
          return Promise.resolve({ error: null });
        }),
      }),
    };

    await runQueueIngestionPipeline({
      tenantId: TENANT_ID,
      fetchers: [mockFetcher],
      httpFetch: vi.fn() as unknown as typeof globalThis.fetch,
      db: mockDb as unknown as import("@supabase/supabase-js").SupabaseClient,
      retryBaseDelayMs: 0,
    });

    expect(upsertCallCount).toBe(3); // ceil(450 / 200) = 3 batches
  });
});

// ── Integration tests ─────────────────────────────────────────────────────────

const INTEGRATION =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!INTEGRATION)("Queue ingestion integration", () => {
  it("upserts rows into queue_projects via real DB", async () => {
    const { createServerClient } = await import("@/lib/db/client");
    const db = createServerClient();

    const mockFetcher = makeMockFetcher("PJM", {
      rows: [
        {
          tenant_id: TENANT_ID,
          iso_id: "PJM",
          project_number: "INFRA005-TEST-001",
          project_name: "INFRA-005 Integration Test Solar",
          capacity_mw: 100,
          queue_date: "2023-01-15",
          current_status: "submitted",
          project_type: "solar",
        },
      ],
      errors: [],
    });

    const report = await runQueueIngestionPipeline({
      tenantId: TENANT_ID,
      fetchers: [mockFetcher],
      httpFetch: vi.fn() as unknown as typeof globalThis.fetch,
      db,
    });

    expect(report.total.upserted).toBe(1);

    // Clean up
    await db
      .from("queue_projects")
      .delete()
      .eq("project_number", "INFRA005-TEST-001")
      .eq("tenant_id", TENANT_ID);
  });
});

// ── Performance benchmarks ────────────────────────────────────────────────────

describe("performance", () => {
  it("CSV parser handles 10k rows in under 50ms", () => {
    const header = "Queue #,Name,Type,MW,Status,Date\n";
    const dataRows = Array.from(
      { length: 10_000 },
      (_, i) => `${i},Project ${i},Solar,${100 + i},Active,01/15/2023`
    ).join("\n");

    const start = performance.now();
    const rows = parseCsv(header + dataRows);
    const elapsed = performance.now() - start;

    expect(rows).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(50);
  });

  it("normalizer handles 10k rows in under 20ms", () => {
    const rawDates = Array.from({ length: 2_500 }, () => "06/15/2025");
    const rawMws = Array.from({ length: 2_500 }, () => "1,200");
    const rawTypes = Array.from({ length: 2_500 }, () => "Solar");
    const rawStatuses = Array.from({ length: 2_500 }, () => "Phase 2");

    const start = performance.now();
    rawDates.forEach(parseIsoDate);
    rawMws.forEach(parseMw);
    rawTypes.forEach(mapProjectType);
    rawStatuses.forEach(mapQueueStatus);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(20);
  });
});
