/**
 * Provider abstraction for grid load data.
 *
 * Swapping the underlying data source (EIA → ISO-NE → any other RTO feed)
 * requires only a new class that implements LoadProvider. The sync route,
 * repository, API read path, and dashboard all remain unchanged.
 */

export type ProviderName = "eia" | "iso-ne";

export interface LoadReading {
  /** ISO 8601 UTC timestamp of the load measurement */
  timestamp: string;
  /** Actual system load in MW */
  actualLoadMW: number;
  /** Which provider supplied this reading */
  source: ProviderName;
}

export interface LoadProvider {
  /** Identifier written to logs and API responses */
  readonly name: ProviderName;
  /** Fetch the single most-recent available reading */
  fetchCurrent(): Promise<LoadReading>;
  /** Fetch all readings for a calendar day (UTC date) */
  fetchDay(date: Date): Promise<LoadReading[]>;
}
