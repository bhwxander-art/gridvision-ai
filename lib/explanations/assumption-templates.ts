/**
 * Centralized assumption/limitation template strings — INFRA-017
 *
 * Named constants only, per the approved specification's revision: the
 * engine (explanations-engine.ts) selects among these based on which
 * upstream analyses exist for a given ife_analyses row — it never embeds
 * template text inline. Keeping every string here means a future milestone
 * that actually implements Cox PH / a cost model only has to change the
 * engine's selection logic and add new constants, not hunt through inline
 * strings scattered across the codebase.
 */

export const ASSUMPTION_HOSTING_CAPACITY_DETERMINISTIC_ONLY =
  "Hosting capacity is a deterministic thermal-only estimate (N-0/N-1 contingency screening); Monte Carlo probabilistic hosting capacity and voltage headroom are not computed.";

export const ASSUMPTION_UPGRADE_ANALYSIS_NOT_YET_COMPUTED =
  "Hosting capacity alone is insufficient for the requested capacity, but upgrade analysis has not yet been computed for this analysis.";

export const ASSUMPTION_UPGRADE_COST_NOT_ESTIMATED =
  "Upgrade cost is not estimated — no cost model is implemented; only the physical upgrades required are identified.";

export const ASSUMPTION_TIME_TO_POWER_EMPIRICAL =
  "Time-to-power estimates are based on empirical historical percentiles, not a predictive model.";

export const ASSUMPTION_TIME_TO_POWER_NOT_COMPUTED =
  "Time-to-power has not been computed for this analysis.";

export const ASSUMPTION_CONFIDENCE_RISK_PARTIAL =
  "Confidence and risk scores exclude Monte Carlo convergence, historical model calibration, cost uncertainty, congestion trend, and withdrawal-risk components, since none of those are implemented yet.";

export const ASSUMPTION_CONFIDENCE_RISK_NOT_COMPUTED =
  "Confidence and risk scores have not been computed for this analysis.";

export const ASSUMPTION_WITHDRAWAL_PROBABILITY_NOT_MODELED =
  "Withdrawal probability is not modeled for this or any project — no historical survival (Cox PH) model exists yet.";
