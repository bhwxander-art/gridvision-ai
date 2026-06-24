export type UpgradeType =
  | "transformer-replacement"
  | "substation-expansion"
  | "feeder-reconductor"
  | "new-substation"
  | "cable-replacement";

export interface UpgradeProject {
  id: string;
  substationId: string;
  projectName: string;
  upgradeType: UpgradeType;
  /** Total installed cost in USD */
  estimatedCostUSD: number;
  /** Net new dispatchable capacity after upgrade */
  addedCapacityMW: number;
  /** Months from NTP to energization */
  implementationMonths: number;
  /** 0–100 composite risk-reduction score (higher = more risk eliminated) */
  riskReduction: number;
  /** 0–100 base priority score before urgency adjustment */
  priorityScore: number;
}

export const capitalProjects: UpgradeProject[] = [
  // ── Cambridge Central (most constrained — N-1 violations today) ─────────────
  {
    id:                  "cp-001",
    substationId:        "ss-cambridge-central",
    projectName:         "Cambridge Central T1/T2 Transformer Replacement",
    upgradeType:         "transformer-replacement",
    estimatedCostUSD:    8_500_000,
    addedCapacityMW:     60,
    implementationMonths: 18,
    riskReduction:       38,
    priorityScore:       92,
  },
  {
    id:                  "cp-002",
    substationId:        "ss-cambridge-central",
    projectName:         "Cambridge Central Third Transformer Bank",
    upgradeType:         "substation-expansion",
    estimatedCostUSD:    22_000_000,
    addedCapacityMW:     150,
    implementationMonths: 36,
    riskReduction:       55,
    priorityScore:       84,
  },
  {
    id:                  "cp-007",
    substationId:        "ss-cambridge-central",
    projectName:         "Cambridge–Waltham 115 kV Cable Upgrade",
    upgradeType:         "cable-replacement",
    estimatedCostUSD:    12_000_000,
    addedCapacityMW:     80,
    implementationMonths: 24,
    riskReduction:       28,
    priorityScore:       68,
  },

  // ── Somerville East (transformer at 97% loading) ────────────────────────────
  {
    id:                  "cp-003",
    substationId:        "ss-somerville-east",
    projectName:         "Somerville East T1 Emergency Replacement",
    upgradeType:         "transformer-replacement",
    estimatedCostUSD:    5_200_000,
    addedCapacityMW:     40,
    implementationMonths: 12,
    riskReduction:       32,
    priorityScore:       88,
  },
  {
    id:                  "cp-004",
    substationId:        "ss-somerville-east",
    projectName:         "Assembly Row Feeder 3 Reconductor",
    upgradeType:         "feeder-reconductor",
    estimatedCostUSD:    3_100_000,
    addedCapacityMW:     25,
    implementationMonths: 6,
    riskReduction:       18,
    priorityScore:       72,
  },

  // ── Boston North (moderate risk, aging assets) ──────────────────────────────
  {
    id:                  "cp-005",
    substationId:        "ss-boston-north",
    projectName:         "Lynn Feeder 12 Reconductor & Protection Upgrade",
    upgradeType:         "feeder-reconductor",
    estimatedCostUSD:    2_400_000,
    addedCapacityMW:     20,
    implementationMonths: 9,
    riskReduction:       12,
    priorityScore:       58,
  },
  {
    id:                  "cp-008",
    substationId:        "ss-boston-north",
    projectName:         "North Shore New 115/13.8 kV Substation",
    upgradeType:         "new-substation",
    estimatedCostUSD:    45_000_000,
    addedCapacityMW:     250,
    implementationMonths: 48,
    riskReduction:       62,
    priorityScore:       65,
  },

  // ── Waltham West (data center growth corridor) ──────────────────────────────
  {
    id:                  "cp-006",
    substationId:        "ss-waltham-west",
    projectName:         "Route 128 Corridor Substation Expansion",
    upgradeType:         "substation-expansion",
    estimatedCostUSD:    18_000_000,
    addedCapacityMW:     150,
    implementationMonths: 30,
    riskReduction:       45,
    priorityScore:       76,
  },
];
