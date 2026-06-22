import type { ForecastInputs } from "@/lib/forecast";

// Static application defaults — not fetched from any API.
// Change these when onboarding a new territory.
export const defaultForecastInputs: ForecastInputs = {
  cityName: "Boston",
  currentPeakLoad: 850,
  populationGrowthRate: 2.4,
  evGrowthRate: 18,
  dataCenterLoad: 120,
};
