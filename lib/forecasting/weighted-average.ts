// lib/forecasting/weighted-average.ts
// Exponentially Weighted Hour-of-Day Average forecasting model.
// Pure functions, no DB access, no side effects.

import type { ForecastModel, ForecastPoint, LoadPoint } from "./model";

const ALPHA = 0.85;
const MIN_SAME_HOUR_READINGS = 3;
const FALLBACK_READINGS = 48;
const CONFIDENCE_Z = 1.65; // 90% confidence interval
const CONFIDENCE_HIGH_CAP = 1.15; // cap at 115% of predicted

// ── Pure helpers ──────────────────────────────────────────────────────────────

function exponentialWeights(n: number, alpha: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.pow(alpha, i));
}

function weightedMean(values: number[], weights: number[]): number {
  const sumW = weights.reduce((s, w) => s + w, 0);
  if (sumW === 0) return 0;
  return values.reduce((s, v, i) => s + v * weights[i], 0) / sumW;
}

function weightedStd(values: number[], weights: number[], mean: number): number {
  const sumW = weights.reduce((s, w) => s + w, 0);
  if (sumW === 0 || values.length < 2) return 0;
  const variance =
    values.reduce((s, v, i) => s + weights[i] * Math.pow(v - mean, 2), 0) / sumW;
  return Math.sqrt(variance);
}

// ── Model implementation ──────────────────────────────────────────────────────

export class WeightedHourOfDayModel implements ForecastModel {
  readonly modelType = "weighted-hour-of-day";
  readonly modelVersion = "1.0";

  generate(history: LoadPoint[], horizonHours: number): ForecastPoint[] {
    if (history.length === 0) return [];

    // Sort history by timestamp descending (most recent first) once
    const sorted = [...history].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );

    const now = new Date();
    // Round now to nearest hour
    const baseHour = new Date(now);
    baseHour.setMinutes(0, 0, 0);

    const points: ForecastPoint[] = [];

    for (let t = 0; t < horizonHours; t++) {
      const forecastFor = new Date(baseHour.getTime() + t * 60 * 60 * 1000);
      const hourOfDay = forecastFor.getUTCHours();

      // Filter to same hour-of-day, sorted most recent first
      let candidates = sorted.filter(
        (p) => p.timestamp.getUTCHours() === hourOfDay
      );

      // Fall back to last N readings if not enough same-hour data
      if (candidates.length < MIN_SAME_HOUR_READINGS) {
        candidates = sorted.slice(0, FALLBACK_READINGS);
      }

      if (candidates.length === 0) continue;

      const values = candidates.map((c) => c.actualLoadMW);
      const weights = exponentialWeights(values.length, ALPHA);

      const predicted = weightedMean(values, weights);
      const std = weightedStd(values, weights, predicted);

      const confidenceLow = Math.max(0, predicted - CONFIDENCE_Z * std);
      const confidenceHighRaw = predicted + CONFIDENCE_Z * std;
      const confidenceHigh = Math.min(confidenceHighRaw, predicted * CONFIDENCE_HIGH_CAP);

      points.push({
        forecastFor,
        predictedLoadMW: Math.round(predicted * 10) / 10,
        confidenceLowMW: Math.round(confidenceLow * 10) / 10,
        confidenceHighMW: Math.round(confidenceHigh * 10) / 10,
        modelType: this.modelType,
        modelVersion: this.modelVersion,
      });
    }

    return points;
  }
}
