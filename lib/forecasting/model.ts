// lib/forecasting/model.ts
// Clean interface contract for load forecasting models.
// Implement this interface to add new models (XGBoost, Prophet, LSTM, etc.)
// without changing any call sites.

export interface LoadPoint {
  timestamp: Date;
  actualLoadMW: number;
}

export interface ForecastPoint {
  forecastFor: Date;
  predictedLoadMW: number;
  confidenceLowMW: number;
  confidenceHighMW: number;
  modelType: string;
  modelVersion: string;
}

export interface ForecastModel {
  readonly modelType: string;
  readonly modelVersion: string;
  generate(history: LoadPoint[], horizonHours: number): ForecastPoint[];
}
