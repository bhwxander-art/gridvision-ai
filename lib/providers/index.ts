/**
 * Provider factory — selects the best available load data source at runtime.
 *
 * Priority order:
 *   1. ISO-NE Web Services  (ISONE_USERNAME + ISONE_PASSWORD set)
 *   2. EIA Open Data        (EIA_API_KEY set)
 *
 * To activate ISO-NE: add ISONE_USERNAME and ISONE_PASSWORD to Vercel env vars.
 * Nothing else in the codebase changes — the factory picks it up automatically.
 */

import { ISONeProvider } from "./isone.provider";
import { EIAProvider } from "./eia.provider";
import type { LoadProvider, ProviderName } from "./load-provider";

export type { LoadProvider, LoadReading, ProviderName } from "./load-provider";

/** Returns the provider whose credentials are present. Throws if none are. */
export function getLoadProvider(): LoadProvider {
  if (process.env.ISONE_USERNAME && process.env.ISONE_PASSWORD) {
    return new ISONeProvider();
  }
  if (process.env.EIA_API_KEY) {
    return new EIAProvider();
  }
  throw new Error(
    "No load data provider configured. " +
    "Set EIA_API_KEY (free at eia.gov/opendata) or " +
    "ISONE_USERNAME + ISONE_PASSWORD (free at iso-ne.com/isoexpress)."
  );
}

/** Returns the name of the active provider without instantiating it, or null if none. */
export function getActiveProviderName(): ProviderName | null {
  if (process.env.ISONE_USERNAME && process.env.ISONE_PASSWORD) return "iso-ne";
  if (process.env.EIA_API_KEY) return "eia";
  return null;
}
