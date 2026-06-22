import type {
  DataCenterInterconnection,
  SubstationPlan,
} from "@/lib/planning-engine";

export const planningTerritory = {
  name: "Eastern Massachusetts",
  operatingCompany: "Eversource Energy",
  planningHorizonYears: 5 as const,
  lastModelRun: "2026-06-10T14:30:00Z",
  peakSystemLoadMW: 4820,
};

export const substationPortfolio: SubstationPlan[] = [
  {
    id: "ss-boston-north",
    name: "Boston North 115/13.8 kV",
    region: "North Shore",
    voltageKV: 115,
    nameplateMVA: 450,
    peakLoadMW: 342,
    n1CapacityMW: 405,
    annualGrowthPct: 3.2,
    latitude: 42.4671,
    longitude: -70.9437,
    transformers: [
      {
        id: "tx-bn-1",
        substationId: "ss-boston-north",
        name: "T1 150 MVA",
        ratedMVA: 150,
        peakLoadMVA: 118,
        loadFactor: 0.92,
        ageYears: 22,
        n1Compliant: true,
      },
      {
        id: "tx-bn-2",
        substationId: "ss-boston-north",
        name: "T2 150 MVA",
        ratedMVA: 150,
        peakLoadMVA: 112,
        loadFactor: 0.92,
        ageYears: 22,
        n1Compliant: true,
      },
    ],
    feeders: [
      {
        id: "fd-bn-12",
        substationId: "ss-boston-north",
        name: "Feeder 12 — Lynn",
        hostingCapacityMW: 45,
        committedLoadMW: 28,
        queuedLoadMW: 8,
      },
    ],
  },
  {
    id: "ss-cambridge-central",
    name: "Cambridge Central 115/27 kV",
    region: "Inner Metro",
    voltageKV: 115,
    nameplateMVA: 420,
    peakLoadMW: 398,
    n1CapacityMW: 378,
    annualGrowthPct: 4.8,
    latitude: 42.3626,
    longitude: -71.0857,
    transformers: [
      {
        id: "tx-cc-1",
        substationId: "ss-cambridge-central",
        name: "T1 100 MVA",
        ratedMVA: 100,
        peakLoadMVA: 94,
        loadFactor: 0.95,
        ageYears: 38,
        n1Compliant: false,
      },
      {
        id: "tx-cc-2",
        substationId: "ss-cambridge-central",
        name: "T2 100 MVA",
        ratedMVA: 100,
        peakLoadMVA: 88,
        loadFactor: 0.95,
        ageYears: 38,
        n1Compliant: false,
      },
    ],
    feeders: [
      {
        id: "fd-cc-7",
        substationId: "ss-cambridge-central",
        name: "Feeder 7 — Kendall Sq",
        hostingCapacityMW: 32,
        committedLoadMW: 30,
        queuedLoadMW: 12,
      },
    ],
  },
  {
    id: "ss-somerville-east",
    name: "Somerville East 27/13.8 kV",
    region: "Inner Metro",
    voltageKV: 27,
    nameplateMVA: 290,
    peakLoadMW: 287,
    n1CapacityMW: 261,
    annualGrowthPct: 5.6,
    latitude: 42.3898,
    longitude: -71.0747,
    transformers: [
      {
        id: "tx-se-1",
        substationId: "ss-somerville-east",
        name: "T1 75 MVA",
        ratedMVA: 75,
        peakLoadMVA: 74,
        loadFactor: 0.97,
        ageYears: 31,
        n1Compliant: true,
      },
    ],
    feeders: [
      {
        id: "fd-se-3",
        substationId: "ss-somerville-east",
        name: "Feeder 3 — Assembly Row",
        hostingCapacityMW: 18,
        committedLoadMW: 16,
        queuedLoadMW: 6,
      },
    ],
  },
  {
    id: "ss-waltham-west",
    name: "Waltham West 115/13.8 kV",
    region: "Route 128 Corridor",
    voltageKV: 115,
    nameplateMVA: 380,
    peakLoadMW: 215,
    n1CapacityMW: 342,
    annualGrowthPct: 6.2,
    latitude: 42.3765,
    longitude: -71.2356,
    transformers: [
      {
        id: "tx-ww-1",
        substationId: "ss-waltham-west",
        name: "T1 125 MVA",
        ratedMVA: 125,
        peakLoadMVA: 98,
        loadFactor: 0.9,
        ageYears: 18,
        n1Compliant: true,
      },
    ],
    feeders: [
      {
        id: "fd-ww-5",
        substationId: "ss-waltham-west",
        name: "Feeder 5 — Route 128 Tech",
        hostingCapacityMW: 55,
        committedLoadMW: 22,
        queuedLoadMW: 28,
      },
    ],
  },
];

export const dataCenterQueue: DataCenterInterconnection[] = [
  {
    id: "dc-001",
    projectName: "Project Helix — AI Training Campus",
    developer: "Undisclosed Hyperscaler",
    requestedMW: 180,
    loadFactor: 0.96,
    targetCOD: "2028-Q2",
    status: "study",
    affectedSubstationId: "ss-waltham-west",
    affectedFeederId: "fd-ww-5",
    rampMonths: 18,
  },
  {
    id: "dc-002",
    projectName: "Kendall Inference Hub",
    developer: "Cloud Provider JV",
    requestedMW: 45,
    loadFactor: 0.94,
    targetCOD: "2027-Q4",
    status: "ia-executed",
    affectedSubstationId: "ss-cambridge-central",
    affectedFeederId: "fd-cc-7",
    rampMonths: 12,
  },
  {
    id: "dc-003",
    projectName: "Assembly Edge DC",
    developer: "Regional Colo Operator",
    requestedMW: 22,
    loadFactor: 0.88,
    targetCOD: "2027-Q1",
    status: "construction",
    affectedSubstationId: "ss-somerville-east",
    affectedFeederId: "fd-se-3",
    rampMonths: 6,
  },
  {
    id: "dc-004",
    projectName: "North Shore Enterprise DC",
    developer: "Enterprise Tenant",
    requestedMW: 15,
    loadFactor: 0.85,
    targetCOD: "2026-Q4",
    status: "study",
    affectedSubstationId: "ss-boston-north",
    affectedFeederId: "fd-bn-12",
    rampMonths: 9,
  },
];

export const loadGrowthAssumptions = {
  evPenetrationGrowthPct: 18,
  populationGrowthPct: 2.4,
  commercialGrowthPct: 3.1,
  dataCenterQueueMW: dataCenterQueue.reduce((s, d) => s + d.requestedMW, 0),
};

export const transformerLoadingTrend = [
  { year: "2024", cambridge: 82, somerville: 88, waltham: 72, boston: 76 },
  { year: "2025", cambridge: 86, somerville: 91, waltham: 76, boston: 78 },
  { year: "2026", cambridge: 94, somerville: 99, waltham: 78, boston: 79 },
  { year: "2027", cambridge: 98, somerville: 102, waltham: 84, boston: 82 },
  { year: "2028", cambridge: 103, somerville: 108, waltham: 91, boston: 85 },
  { year: "2029", cambridge: 107, somerville: 112, waltham: 98, boston: 88 },
];

export function getSubstationById(id: string): SubstationPlan | undefined {
  return substationPortfolio.find((s) => s.id === id);
}

export function getFeederById(id: string) {
  for (const ss of substationPortfolio) {
    const feeder = ss.feeders.find((f) => f.id === id);
    if (feeder) return { feeder, substation: ss };
  }
  return undefined;
}
