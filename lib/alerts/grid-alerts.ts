/**
 * Rule-based grid alert engine.
 *
 * Pure function — no network I/O, no LLM, no side effects.
 * Input: current reading + recent history array (chronological, oldest first).
 * Output: sorted array of active alerts (critical first).
 */

export type AlertSeverity = "critical" | "warning" | "info";

export type AlertCode =
  | "CAPACITY_RISK"
  | "HIGH_DEMAND"
  | "RAPID_RAMP"
  | "FORECAST_DEVIATION";

export interface GridAlert {
  code: AlertCode;
  severity: AlertSeverity;
  title: string;
  message: string;
}

interface LoadPoint {
  timestamp: string;
  currentLoadMW: number;
}

const THRESHOLDS = {
  /** Above this → possible capacity risk (critical) */
  CAPACITY_RISK_MW: 24_000,
  /** Above this → high demand (warning) */
  HIGH_DEMAND_MW: 22_000,
  /** Net MW rise within 2 hours → rapid ramp (warning) */
  RAPID_RAMP_MW_PER_2H: 2_000,
  /** Percent above 24h rolling average → forecast deviation (info) */
  DEVIATION_PCT: 0.15,
} as const;

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function generateAlerts(
  current: LoadPoint | null,
  history: LoadPoint[]
): GridAlert[] {
  if (!current) return [];

  const alerts: GridAlert[] = [];
  const mw = current.currentLoadMW;

  // ── Rule 1 & 2: Demand level ──────────────────────────────────────────────
  if (mw >= THRESHOLDS.CAPACITY_RISK_MW) {
    alerts.push({
      code: "CAPACITY_RISK",
      severity: "critical",
      title: "Possible Capacity Risk",
      message: `System load ${mw.toLocaleString()} MW is within 10% of ISO-NE peak capacity. Reserve margins may be insufficient.`,
    });
  } else if (mw >= THRESHOLDS.HIGH_DEMAND_MW) {
    alerts.push({
      code: "HIGH_DEMAND",
      severity: "warning",
      title: "High Demand",
      message: `System load ${mw.toLocaleString()} MW exceeds the ${THRESHOLDS.HIGH_DEMAND_MW.toLocaleString()} MW high-demand threshold.`,
    });
  }

  // ── Rule 3: Rapid Ramp ────────────────────────────────────────────────────
  // Find the most-recent history reading that is >= 2 hours before current.
  if (history.length >= 2) {
    const twoHoursAgo =
      new Date(current.timestamp).getTime() - 2 * 60 * 60 * 1_000;
    const baseline = history
      .filter((r) => new Date(r.timestamp).getTime() <= twoHoursAgo)
      .at(-1); // history is ascending → last filtered = closest to 2h ago

    if (baseline) {
      const ramp = mw - baseline.currentLoadMW;
      if (ramp > THRESHOLDS.RAPID_RAMP_MW_PER_2H) {
        alerts.push({
          code: "RAPID_RAMP",
          severity: "warning",
          title: "Rapid Ramp",
          message: `Load rose ${ramp.toLocaleString()} MW in 2 hours. Rapid demand growth may stress distribution assets.`,
        });
      }
    }
  }

  // ── Rule 4: Forecast Deviation (vs 24h rolling average) ──────────────────
  // Requires at least 12 hourly readings for a meaningful average.
  if (history.length >= 12) {
    const avg =
      history.reduce((s, r) => s + r.currentLoadMW, 0) / history.length;
    const deviation = (mw - avg) / avg;
    if (deviation > THRESHOLDS.DEVIATION_PCT) {
      alerts.push({
        code: "FORECAST_DEVIATION",
        severity: "info",
        title: "Above Normal Demand",
        message: `Load is ${Math.round(deviation * 100)}% above the 24-hour average of ${Math.round(avg).toLocaleString()} MW.`,
      });
    }
  }

  return alerts.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
}
