export interface LoadGrowthDataPoint {
  year: string;
  load: number;
  baseline: number;
}

export interface ImpactDataPoint {
  category: string;
  impact: number;
  fill: string;
}

export interface Substation {
  id: string;
  name: string;
  status: "normal" | "warning" | "capacity-risk";
  load: number;
  capacity: number;
  x: number;
  y: number;
  region: string;
}

export const loadGrowthData: LoadGrowthDataPoint[] = [
  { year: "2024", load: 820, baseline: 820 },
  { year: "2025", load: 865, baseline: 835 },
  { year: "2026", load: 920, baseline: 850 },
  { year: "2027", load: 985, baseline: 868 },
  { year: "2028", load: 1060, baseline: 887 },
  { year: "2029", load: 1145, baseline: 906 },
  { year: "2030", load: 1240, baseline: 926 },
];

export const evImpactData: ImpactDataPoint[] = [
  { category: "Residential EV", impact: 145, fill: "#06b6d4" },
  { category: "Fleet Charging", impact: 88, fill: "#0891b2" },
  { category: "Public DC Fast", impact: 62, fill: "#0e7490" },
  { category: "Workplace", impact: 41, fill: "#155e75" },
];

export const dataCenterImpactData: ImpactDataPoint[] = [
  { category: "Hyperscale", impact: 210, fill: "#8b5cf6" },
  { category: "Colocation", impact: 95, fill: "#7c3aed" },
  { category: "Edge / AI", impact: 130, fill: "#6d28d9" },
  { category: "Enterprise", impact: 55, fill: "#5b21b6" },
];

export const substations: Substation[] = [
  {
    id: "boston-north",
    name: "Boston North",
    status: "normal",
    load: 342,
    capacity: 450,
    x: 72,
    y: 28,
    region: "North Shore",
  },
  {
    id: "cambridge-central",
    name: "Cambridge Central",
    status: "warning",
    load: 398,
    capacity: 420,
    x: 48,
    y: 42,
    region: "Metro West",
  },
  {
    id: "somerville-east",
    name: "Somerville East",
    status: "capacity-risk",
    load: 287,
    capacity: 290,
    x: 58,
    y: 22,
    region: "Inner Metro",
  },
  {
    id: "waltham-west",
    name: "Waltham West",
    status: "normal",
    load: 215,
    capacity: 380,
    x: 22,
    y: 55,
    region: "Route 128 Corridor",
  },
];

export const defaultForecastInputs = {
  cityName: "Boston",
  currentPeakLoad: 850,
  populationGrowthRate: 2.4,
  evGrowthRate: 18,
  dataCenterLoad: 120,
};

export const monthlyLoadTrend = [
  { month: "Jan", total: 720, ev: 45, datacenter: 85 },
  { month: "Feb", total: 735, ev: 52, datacenter: 88 },
  { month: "Mar", total: 758, ev: 61, datacenter: 92 },
  { month: "Apr", total: 782, ev: 74, datacenter: 98 },
  { month: "May", total: 810, ev: 88, datacenter: 105 },
  { month: "Jun", total: 845, ev: 102, datacenter: 112 },
  { month: "Jul", total: 892, ev: 118, datacenter: 118 },
  { month: "Aug", total: 918, ev: 125, datacenter: 120 },
  { month: "Sep", total: 875, ev: 115, datacenter: 115 },
  { month: "Oct", total: 840, ev: 98, datacenter: 110 },
  { month: "Nov", total: 798, ev: 82, datacenter: 102 },
  { month: "Dec", total: 765, ev: 68, datacenter: 95 },
];
