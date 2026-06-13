# GridVision AI — Enterprise Redesign Implementation Plan

**Prepared from:** Distribution & Transmission Planning perspective (Eversource-class utility)  
**Version:** 1.0 · June 2026  
**Status:** Phase 1 prototype delivered at `/enterprise`

---

## Executive Summary

The original GridVision AI demo is suitable for investor storytelling but **not procurement-ready** for a regulated utility. This plan repositions the product as a **planning operations platform** integrated with substation capacity, transformer thermal analysis, and interconnection queue workflows.

---

## Phase 1 — Foundation (Delivered)

| Deliverable | Status | Route / File |
|-------------|--------|--------------|
| Enterprise shell (sidebar + command bar) | ✅ | `components/enterprise/enterprise-shell.tsx` |
| Planning engine (N-1, thermal, hosting) | ✅ | `lib/planning-engine.ts` |
| Eversource-class sample portfolio | ✅ | `lib/enterprise-data.ts` |
| Substation capacity table | ✅ | `components/enterprise/substation-capacity-panel.tsx` |
| Transformer overload forecast | ✅ | `components/enterprise/transformer-overload-panel.tsx` |
| Data center interconnection queue | ✅ | `components/enterprise/datacenter-impact-panel.tsx` |
| Capital priority queue | ✅ | `components/enterprise/priority-actions-table.tsx` |
| Territory map with severity | ✅ | `components/enterprise/enterprise-territory-map.tsx` |
| Route separation (marketing vs platform) | ✅ | `app/(marketing)/`, `app/(platform)/` |

---

## Phase 2 — Data Integration (Months 1–4)

### 2.1 ADMS / SCADA Feed
- Ingest real-time MW, MVA, power factor from OSIsoft PI or GE ADMS
- Replace static `peakLoadMW` with rolling 8760-hour peak
- **Owner:** IT/OT integration team + vendor API contract

### 2.2 GIS / Asset Registry
- Import substation, transformer, feeder from Esri ArcGIS Utility Network
- Attach nameplate ratings, install dates, inspection records
- **Owner:** Asset management + GIS team

### 2.3 Interconnection Queue (ISO-NE / DPU)
- Sync IA queue from internal interconnection portal
- Map projects to feeders via study engineer assignment
- **Owner:** Interconnection services

### 2.4 Hosting Capacity Maps
- Replace manual feeder headroom with published HCA dataset
- Align with MA DPU Grid Modernization filing requirements

---

## Phase 3 — Planning Models (Months 4–8)

### 3.1 Substation Capacity
| Model Input | Source |
|-------------|--------|
| Nameplate MVA | Asset registry |
| N-1 rating | Power flow (PSS/E or CYME) |
| Growth rate | Internal forecast + census + EV registry |
| Years-to-constraint | Headroom ÷ annual MW growth |

**Enhancement:** Run CYME power flow on N-1 contingency set, not static nameplate ratios.

### 3.2 Transformer Overload
| Model Input | Source |
|-------------|--------|
| Ambient-adjusted rating | IEEE C57.91 thermal model |
| Load factor by customer class | AMI disaggregation |
| EV adder | Make-ready pipeline + DOT registration |
| DC adder | Interconnection queue |

**Enhancement:** 8760 thermal integration with ambient temperature curves.

### 3.3 Data Center Impact
| Model Input | Source |
|-------------|--------|
| Requested MW / load factor | IA application |
| Ramp profile | Developer study |
| Network upgrade cost | ISO-NE Schedule 23 estimate |

**Enhancement:** Probabilistic COD scenarios for queue projects.

---

## Phase 4 — Enterprise UI (Months 6–10)

### Layout Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ TOP BAR: OpCo · Territory · Horizon · Model Run · User      │
├────────────┬────────────────────────────────────────────────┤
│ SIDEBAR    │ KPI STRIP (5 tiles)                            │
│            ├────────────────────────────────────────────────┤
│ Command    │ PRIMARY WORKSPACE                              │
│ Substations│  - Tables with export to Excel                 │
│ Transformers│ - Drill-down to asset detail drawer           │
│ DC Queue   │  - Scenario comparison side panel                │
│ Map        │                                                │
│ Scenarios  │ SECONDARY: Capital Priority Queue              │
│ Reports    │                                                │
│ Admin      │                                                │
└────────────┴────────────────────────────────────────────────┘
```

### UI Requirements for Utility Buyers
- [ ] SSO / SAML (Okta, Azure AD)
- [ ] Role-based access (planner, interconnection, executive read-only)
- [ ] Audit log on assumption changes
- [ ] Export to PDF for DPU / IRP filings
- [ ] WCAG 2.1 AA compliance
- [ ] No external CDN for NERC CIP environments

---

## Phase 5 — Governance & Procurement (Months 8–12)

| Requirement | Approach |
|-------------|----------|
| SOC 2 Type II | Required for cloud deployment |
| On-prem option | Air-gapped for CIP assets |
| Data residency | US-only, no training on customer data |
| SLA | 99.9% for planning workspace |
| MSA / SOW | Per-opco license + professional services for integration |

---

## Success Metrics (Utility KPIs)

| Metric | Target |
|--------|--------|
| Time to produce capacity study | −40% vs. manual CYME workflow |
| Interconnection study cycle | −25% for projects with adequate headroom |
| Capital plan accuracy | ±10% on MW-at-risk forecast |
| Planner adoption | 80% of Eastern MA planning team within 6 months |

---

## What Stays from Original Demo

- Marketing site (`/`) for investor / conference use
- Simple forecast demo (`/dashboard`) for quick what-if
- Analytics charts as executive summary layer

## What Replaces It for Operations

- **`/enterprise`** — primary planning workspace
- Asset-level granularity (not city-level sliders)
- N-1 and hosting capacity logic (not arbitrary % thresholds)
- Capital priority queue tied to capex estimates

---

## Estimated Investment

| Phase | Effort | Cost Range |
|-------|--------|------------|
| Phase 2 — Data integration | 4 FTE × 4 mo | $800K–$1.2M |
| Phase 3 — Planning models | 3 planners + 2 engineers × 4 mo | $600K–$900K |
| Phase 4 — Enterprise UI | 2 designers + 4 engineers × 4 mo | $700K–$1M |
| Phase 5 — Compliance | Legal + security | $200K–$400K |
| **Total Year 1** | | **$2.3M–$3.5M** |

*Utility would expect co-development or outcome-based pricing given integration burden.*

---

## Recommendation

**Do not retire the demo** — it serves BD and regulator education.  
**Do lead with `/enterprise`** in utility sales cycles.  
**Gate purchase on Phase 2 data integration POC** — without ADMS/GIS feeds, planners will not adopt.
