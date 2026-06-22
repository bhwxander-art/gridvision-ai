/**
 * scripts/migrate-substations.ts
 *
 * Converts mock substation records from viewport-percentage coordinates
 * (x / y) to real WGS-84 geographic coordinates (latitude / longitude).
 *
 * Usage:
 *   npx tsx scripts/migrate-substations.ts
 *   npx tsx scripts/migrate-substations.ts --geojson   # emit GeoJSON only
 *
 * Output:
 *   1. A human-readable migration audit (old → new per record)
 *   2. A GeoJSON FeatureCollection ready for import into any GIS tool
 *      (QGIS, ArcGIS, Mapbox, PostGIS, etc.)
 */

// ── Legacy records (original viewport-percentage coordinates) ──────────────

interface LegacySubstation {
  id: string;
  name: string;
  region: string;
  voltageKV: number;
  nameplateMVA: number;
  peakLoadMW: number;
  /** Percentage from left edge of the SVG viewport (0–100) */
  x: number;
  /** Percentage from top edge of the SVG viewport (0–100) */
  y: number;
}

const LEGACY_SUBSTATIONS: LegacySubstation[] = [
  {
    id: "ss-boston-north",
    name: "Boston North 115/13.8 kV",
    region: "North Shore",
    voltageKV: 115,
    nameplateMVA: 450,
    peakLoadMW: 342,
    x: 72,
    y: 28,
  },
  {
    id: "ss-cambridge-central",
    name: "Cambridge Central 115/27 kV",
    region: "Inner Metro",
    voltageKV: 115,
    nameplateMVA: 420,
    peakLoadMW: 398,
    x: 48,
    y: 42,
  },
  {
    id: "ss-somerville-east",
    name: "Somerville East 27/13.8 kV",
    region: "Inner Metro",
    voltageKV: 27,
    nameplateMVA: 290,
    peakLoadMW: 287,
    x: 58,
    y: 22,
  },
  {
    id: "ss-waltham-west",
    name: "Waltham West 115/13.8 kV",
    region: "Route 128 Corridor",
    voltageKV: 115,
    nameplateMVA: 380,
    peakLoadMW: 215,
    x: 22,
    y: 55,
  },
];

// ── Migrated geospatial records (WGS-84) ──────────────────────────────────

interface GeoSubstation {
  id: string;
  name: string;
  region: string;
  voltageKV: number;
  nameplateMVA: number;
  peakLoadMW: number;
  /** WGS-84 decimal degrees north */
  latitude: number;
  /** WGS-84 decimal degrees east (negative = western hemisphere) */
  longitude: number;
  /** Source for the coordinate (replace "derived" once survey data is available) */
  coordinateSource: "derived" | "survey" | "gis-import";
}

const MIGRATED_SUBSTATIONS: GeoSubstation[] = [
  {
    id: "ss-boston-north",
    name: "Boston North 115/13.8 kV",
    region: "North Shore",
    voltageKV: 115,
    nameplateMVA: 450,
    peakLoadMW: 342,
    latitude: 42.4671,
    longitude: -70.9437,
    coordinateSource: "derived",
  },
  {
    id: "ss-cambridge-central",
    name: "Cambridge Central 115/27 kV",
    region: "Inner Metro",
    voltageKV: 115,
    nameplateMVA: 420,
    peakLoadMW: 398,
    latitude: 42.3626,
    longitude: -71.0857,
    coordinateSource: "derived",
  },
  {
    id: "ss-somerville-east",
    name: "Somerville East 27/13.8 kV",
    region: "Inner Metro",
    voltageKV: 27,
    nameplateMVA: 290,
    peakLoadMW: 287,
    latitude: 42.3898,
    longitude: -71.0747,
    coordinateSource: "derived",
  },
  {
    id: "ss-waltham-west",
    name: "Waltham West 115/13.8 kV",
    region: "Route 128 Corridor",
    voltageKV: 115,
    nameplateMVA: 380,
    peakLoadMW: 215,
    latitude: 42.3765,
    longitude: -71.2356,
    coordinateSource: "derived",
  },
];

// ── GeoJSON builder ────────────────────────────────────────────────────────

interface GeoJSONPoint {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude] — GeoJSON spec order
}

interface GeoJSONFeature {
  type: "Feature";
  geometry: GeoJSONPoint;
  properties: Omit<GeoSubstation, "latitude" | "longitude">;
}

interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

function toGeoJSON(substations: GeoSubstation[]): GeoJSONFeatureCollection {
  return {
    type: "FeatureCollection",
    features: substations.map((ss) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        // GeoJSON coordinates are [longitude, latitude] (x, y in cartesian)
        coordinates: [ss.longitude, ss.latitude],
      },
      properties: {
        id: ss.id,
        name: ss.name,
        region: ss.region,
        voltageKV: ss.voltageKV,
        nameplateMVA: ss.nameplateMVA,
        peakLoadMW: ss.peakLoadMW,
        coordinateSource: ss.coordinateSource,
      },
    })),
  };
}

// ── Audit table ────────────────────────────────────────────────────────────

function printAuditTable(): void {
  const COL = { id: 26, coord: 24, src: 12 };
  const hr = "-".repeat(COL.id + COL.coord * 2 + COL.src + 6);

  console.log("\n=== GridVision AI — Substation Coordinate Migration ===\n");
  console.log(
    `${"ID".padEnd(COL.id)} ${"Legacy (x%, y%)".padEnd(COL.coord)} ${"Geo (lat, lng)".padEnd(COL.coord)} ${"Source".padEnd(COL.src)}`
  );
  console.log(hr);

  for (const legacy of LEGACY_SUBSTATIONS) {
    const migrated = MIGRATED_SUBSTATIONS.find((m) => m.id === legacy.id);
    if (!migrated) continue;

    const legacyStr = `x=${legacy.x}%, y=${legacy.y}%`;
    const geoStr = `${migrated.latitude}°N, ${Math.abs(migrated.longitude)}°W`;

    console.log(
      `${legacy.id.padEnd(COL.id)} ${legacyStr.padEnd(COL.coord)} ${geoStr.padEnd(COL.coord)} ${migrated.coordinateSource}`
    );
  }

  console.log(hr);
  console.log(`\n${MIGRATED_SUBSTATIONS.length} records migrated.\n`);
  console.log(
    "NOTE: coordinateSource='derived' means coordinates were approximated\n" +
    "      from geographic knowledge of the territory.  Replace with 'survey'\n" +
    "      or 'gis-import' once real utility GIS data is available.\n"
  );
}

// ── Entry point ────────────────────────────────────────────────────────────

const geoJsonOnly = process.argv.includes("--geojson");

if (geoJsonOnly) {
  // Emit clean GeoJSON for piping to files or GIS tools:
  //   npx tsx scripts/migrate-substations.ts --geojson > substations.geojson
  console.log(JSON.stringify(toGeoJSON(MIGRATED_SUBSTATIONS), null, 2));
} else {
  printAuditTable();
  console.log("--- GeoJSON FeatureCollection ---\n");
  console.log(JSON.stringify(toGeoJSON(MIGRATED_SUBSTATIONS), null, 2));
}
