# GridVision AI — External Data Integration Report

**Phase 4 · June 2026**  
Territory: Eastern Massachusetts (Eversource Energy)

---

## 1. ISO New England (ISO-NE) — Grid Load & Forecasts

### Overview
ISO New England operates the bulk electric power system for Connecticut,
Maine, Massachusetts, New Hampshire, Rhode Island, and Vermont. Its public
web-services API is the primary source for real-time and forecasted grid load.

### Available Public Datasets

| Endpoint | Description | Format |
|---|---|---|
| `GET /fiveminutesystemload/current` | Most-recent 5-minute system load (MW) | JSON / XML |
| `GET /currenthourlyload` | Most-recent hourly load, including Actual Responsive Demand | JSON / XML |
| `GET /hourlylocalpeakforecast` | Day-ahead hourly local-peak forecast by area | JSON / XML |
| `GET /historicalhourlyloads/{year}/{month}` | Historical monthly hourly load archive | JSON / XML |
| `GET /sevendayforecast` | 7-day daily system load forecast | JSON / XML |

Full endpoint catalog: https://webservices.iso-ne.com/docs/

### Authentication
- **Type:** HTTP Basic Authentication  
- **Cost:** Free  
- **Registration:** https://www.iso-ne.com/participate/support/web-services-data  
- **Env vars required:** `ISONE_API_USER`, `ISONE_API_PASSWORD`

### Update Frequency
| Data | Cadence | Lag |
|---|---|---|
| 5-minute system load | Every 5 minutes | ~5 min |
| Hourly system load | Hourly | ~15 min |
| Day-ahead peak forecast | Daily (midnight) | Next day |
| Historical archive | Monthly | ~2 months |

### GridVision Mapping

| ISO-NE Field | GridVision Target | Transform |
|---|---|---|
| `FiveMinSystemLoad[0].Mw` | `GridLoad.currentLoad` | Direct (MW) |
| `HourlySystemLoad[0].NativeLoadMw` | `GridLoad.currentLoad` | Direct (MW, excludes ARD) |
| `HourlySystemLoad[0].BeginDate` | `GridLoad.timestamp` | ISO 8601 parse |
| `HourlyLclPkFcst[*]` (NEPOOL, area 4001) | `TerritoryLoadForecast.dataPoints[]` | max(hourlyArray) per day |

### Data Quality Limitations
- **Geographic resolution:** ISO-NE reports at the zone level (8 load zones
  for New England) — not at the individual substation level. Substation
  capacity data must come from the utility's own SCADA or GIS systems.
- **ARD ambiguity:** `LoadMw` includes Actual Responsive Demand (demand
  response) curtailment; `NativeLoadMw` does not. Planners should use
  `NativeLoadMw` for capacity planning.
- **Forecast horizon:** The public day-ahead forecast covers only 24 hours.
  Multi-year load forecasts (the IRP horizon) are published annually as PDFs
  in the "CELT Report" (Capacity, Energy, Loads, and Transmission); no
  machine-readable API is available for the multi-year series.
- **No distribution data:** ISO-NE data covers the bulk transmission system.
  Individual feeder loads require SCADA historian integration with the utility.

### Activation Instructions
```bash
# 1. Register at iso-ne.com/participate/support/web-services-data
# 2. Add to .env.local:
ISONE_API_USER=your_username
ISONE_API_PASSWORD=your_password
```

---

## 2. U.S. Energy Information Administration (EIA)

### Overview
The EIA collects and publishes electricity production, consumption, and retail
sales data for every US state and ISO/RTO region. The v2 API provides
structured JSON access to these datasets.

### Available Public Datasets

| Endpoint | Description | Format |
|---|---|---|
| `/electricity/rto/region-data/data/` | Hourly/monthly/annual demand by ISO/RTO respondent | JSON |
| `/electricity/rto/region-sub-ba-data/data/` | Sub-balancing authority data | JSON |
| `/electricity/retail-sales/data/` | Monthly retail sales (MWh), revenue, customers by sector | JSON |
| `/electricity/state-electricity-profiles/data/` | Annual state profiles (generation, consumption, price) | JSON |
| `/electricity/rto/fuel-type-data/data/` | Hourly generation by fuel type and region | JSON |

Full catalog: https://www.eia.gov/opendata/browser/

### Authentication
- **Type:** API key (query parameter `api_key` or header `X-Api-Key`)  
- **Cost:** Free  
- **Registration:** https://www.eia.gov/opendata/register.php  
- **Env var required:** `EIA_API_KEY`

### Update Frequency
| Dataset | Cadence | Lag |
|---|---|---|
| Regional RTO demand (`region-data`) | Hourly (published monthly summary) | ~1 month for monthly aggregates |
| State retail sales | Monthly | ~2 months |
| State electricity profiles | Annual | ~6 months |
| Fuel type by region | Hourly | ~1 hour |

### GridVision Mapping

| EIA Field | GridVision Target | Transform |
|---|---|---|
| `region-data.value` (annual, MWh) | `LoadGrowthDataPoint.load` | `MWh ÷ (8760 × 0.55) ÷ 1000` → peak MW |
| `region-data.period` | `LoadGrowthDataPoint.year` | `period.slice(0,4)` |
| `retail-sales[COM].sales` CAGR | `LoadGrowthAssumptions.commercialGrowthPct` | Compound annual growth rate |
| `retail-sales[ALL].customers` | `UtilityTerritory.customersCount` | Sum across sectors |

**Load factor assumption:** A system load factor of 0.55 is used to convert
annual energy (MWh) to approximate peak demand (MW). This is based on
ISO-NE's published 2024 CELT report value of 0.547 for the New England
region. Update annually from the CELT PDF.

### Data Quality Limitations
- **Monthly vs. annual granularity:** For regional RTO data, the API
  returns data at monthly frequency (not daily or hourly) in the aggregate
  `region-data` endpoint. Hourly data is available but requires individual
  period queries.
- **Conversion uncertainty:** The annual MWh → peak MW conversion
  introduces ±5% error depending on the actual system load factor for that
  year. Using ISO-NE's own forecast is preferable.
- **No EV-specific series:** EIA does not publish a dedicated EV charging
  load series. EV impact must be estimated from NHTSA vehicle registration
  data and average charging consumption models (see §5 below).
- **State minimum, not utility:** `retail-sales` data is aggregated at the
  state level. Eversource's share of Massachusetts retail sales must be
  estimated from EIA Form 861 (Annual Electric Power Industry Report), which
  is published with an ~18-month lag.

### Activation Instructions
```bash
# 1. Register at eia.gov/opendata/register.php
# 2. Add to .env.local:
EIA_API_KEY=your_key_here
```

---

## 3. U.S. Census Bureau — American Community Survey

### Overview
The Census Bureau's ACS 5-year estimates provide county-level demographic
data updated annually. Population growth and household income are primary
inputs to load forecasting models.

### Available Public Datasets

| Dataset | Endpoint | Description |
|---|---|---|
| ACS 5-Year (2023) | `/2023/acs/acs5` | 2019-2023 county-level estimates |
| ACS 5-Year (2022) | `/2022/acs/acs5` | 2018-2022 county-level estimates |
| ACS 1-Year (2023) | `/2023/acs/acs1` | Counties ≥65k population only |
| Decennial 2020 | `/2020/dec/dhc` | Full population redistribution data |
| Population Estimates | `/2023/pep/population` | Annual postcensal estimates |

Variables used by GridVision:

| Variable | Description |
|---|---|
| `B01003_001E` | Total population |
| `B25001_001E` | Total housing units |
| `B19013_001E` | Median household income (inflation-adjusted) |

Full variable catalog: https://api.census.gov/data/2023/acs/acs5/variables.json

### Authentication
- **Type:** Optional API key (query parameter `key`)  
- **Without key:** 500 requests/day (sufficient for scheduled batch runs)  
- **With free key:** Effectively unlimited  
- **Registration:** https://api.census.gov/data/key_signup.html  
- **Env var:** `CENSUS_API_KEY` (optional)

### Update Frequency
| Dataset | Release | Coverage |
|---|---|---|
| ACS 5-year | Each December | All counties, tracts, block groups |
| ACS 1-year | Each September | Counties/cities ≥65k population |
| Population estimates | Each December | All counties |

### GridVision Mapping

| Census Variable | GridVision Target | Transform |
|---|---|---|
| `B01003_001E` (current year) | `PopulationGrowthMetrics.currentPopulation` | Direct (integer) |
| `B01003_001E` (previous year) | `PopulationGrowthMetrics.previousPopulation` | Direct (integer) |
| CAGR of population | `LoadGrowthAssumptions.populationGrowthPct` | Pop-weighted county CAGR |
| `B19013_001E` weighted average | `evPenetrationGrowthPct` | Logistic income→EV model |
| `B25001_001E` | `PopulationGrowthMetrics.householdCount` | Direct (integer) |

**Counties in scope** (Eastern Massachusetts service territory):

| County | FIPS | Key Cities |
|---|---|---|
| Middlesex | 25017 | Cambridge, Somerville, Waltham, Lowell |
| Suffolk | 25025 | Boston |
| Essex | 25009 | Lynn, Peabody, Salem |

### Data Quality Limitations
- **5-year average lag:** ACS 5-year estimates represent a 5-year pooled
  sample, not a single-year snapshot. The "2023" ACS 5-year covers
  interviews from 2019–2023. Rapid demographic shifts (e.g., post-COVID
  urban migration) may not appear until the 1-year estimates.
- **Income to EV conversion:** The logistic model used in the Census
  adapter (`deriveEVPenetrationGrowthPct`) is a heuristic based on 2024
  AFDC/DOE data. Calibrate annually against NHTSA State EV Registration
  Counts (https://www.atlasevhub.com/materials/state-ev-registration-data/).
- **County-level minimum:** Census does not publish utility-territory-level
  data. County boundaries approximate, but do not match, utility service
  areas. Middlesex County includes both Eversource and National Grid
  customers; the overlap must be estimated from Form 861 customer data.
- **No real-time updates:** ACS data is updated once per year. For
  high-frequency load forecasting, Census data should be treated as a
  slow-moving baseline, not an operational input.

### Activation Instructions
```bash
# Optional — without key, 500 requests/day is sufficient for monthly batch
# 1. Register at api.census.gov/data/key_signup.html
# 2. Add to .env.local:
CENSUS_API_KEY=your_key_here
```

---

## 4. Adapter Integration Architecture

```
External APIs
    │
    ├── ISO-NE Webservices ──► isone.adapter.ts
    │     (authenticated)         ├── fetchISONeGridLoad()      → GridLoad
    │                             └── fetchISONeLoadForecast()  → TerritoryLoadForecast
    │
    ├── EIA Open Data API ───► eia.adapter.ts
    │     (API key)               ├── fetchRegionalLoadGrowth() → LoadGrowthDataPoint[]
    │                             └── fetchEIAAnalyticsData()   → AnalyticsData
    │
    └── Census Bureau API ───► census.adapter.ts
          (optional key)          ├── fetchCountyPopulation()   → PopulationGrowthMetrics[]
                                  └── fetchLoadGrowthAssumptionUpdates() → { populationGrowthPct, evPenetrationGrowthPct }

Adapters output domain models ──► lib/domain/models.ts
                                     (TerritoryLoadForecast, UtilityTerritory,
                                      PopulationGrowthMetrics, GridLoad)

Domain models feed into ──────► API Routes (app/api/*)
                                     │
                                     └── Services → Hooks → UI (unchanged)
```

### Enabling Live Data

To activate an adapter, set the required env vars and update the corresponding
API route to call the adapter:

```typescript
// Example: app/api/grid/route.ts
import { fetchISONeGridLoad } from "@/lib/adapters/isone.adapter";

export async function GET() {
  if (process.env.ISONE_API_USER && process.env.ISONE_API_PASSWORD) {
    const { currentLoad, timestamp, source } = await fetchISONeGridLoad();
    return NextResponse.json({ currentLoad, timestamp, source, ... });
  }
  // fall through to mock
}
```

All adapters return mock data automatically when credentials are absent or
the external API is unreachable — the UI remains functional in all cases.

---

## 5. Data Sources Not Yet Integrated (Paid or Restricted)

These sources provide higher-resolution data but require contracts or fees:

| Source | Data | Notes |
|---|---|---|
| **Utility SCADA Historian** | Per-substation real-time load (MW) | Requires Eversource IT integration |
| **Utility GIS (Esri/ArcGIS)** | Feeder routes, territory polygons | Restricted; utility must export |
| **ISO-NE CELT Report** | Multi-year load forecast (5-10 year) | Published as PDF; no API |
| **NHTSA EV Registrations** | State/county EV counts | Monthly, free; requires parsing |
| **ATLAS EV Hub** | County EV registration trends | Aggregated from state DMV data |
| **S&P Global / Wood Mackenzie** | Data center pipeline, announced projects | Paid subscription |
| **Rhodium Group / EPRI** | Electrification load curves | Research license |
| **FERC Form 714** | Annual electric balancing authority data | Free, annual, 18-month lag |
| **EIA Form 861** | Annual utility-level retail sales | Free, annual, 18-month lag |

---

## 6. Recommended Integration Sequence

| Priority | Source | Unlocks |
|---|---|---|
| **P1** | ISO-NE (free) | Real-time `GridLoad`; replaces hardcoded 16,842 MW |
| **P2** | EIA (free) | Historical load growth trend; replaces 2024-2030 mock series |
| **P3** | Census (free) | Live population growth rate; replaces 2.4% constant |
| **P4** | NHTSA EV registrations (free) | Evidence-based EV growth %; replaces 18% constant |
| **P5** | Utility SCADA (integration) | Per-substation real-time load; enables live map status |
| **P6** | Utility GIS (integration) | Territory polygons; enables Leaflet tile rendering |
| **P7** | S&P / Wood Mackenzie (paid) | Pipeline DC projects; replaces `dataCenterQueue` mock |
