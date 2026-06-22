// ── Types ──────────────────────────────────────────────────────────────────

/** Axis-aligned geographic bounding box for a map viewport. */
export interface ViewportBounds {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/** Point in SVG coordinate space. */
export interface SvgPoint {
  x: number;
  y: number;
}

/** Point as CSS percentage values (0–100). */
export interface CssPercent {
  xPct: number;
  yPct: number;
}

// ── Territory bounds ───────────────────────────────────────────────────────

/**
 * Bounding box for the Greater Boston / Eastern Massachusetts service
 * territory.  Update when the displayed region changes.
 *
 * Lat range  : 42.30 – 42.55  (south ↔ north)
 * Lng range  : -71.35 – -70.85 (west ↔ east)
 */
export const BOSTON_METRO_BOUNDS: ViewportBounds = {
  latMin: 42.30,
  latMax: 42.55,
  lngMin: -71.35,
  lngMax: -70.85,
};

// ── Projection functions ───────────────────────────────────────────────────

/**
 * Projects geographic coordinates into SVG coordinate space.
 *
 * Assumes a rectangular (plate carrée) projection — accurate enough for a
 * ~50 km territory.  For statewide or multi-state maps, substitute a proper
 * Mercator projection.
 *
 * @param lat       Decimal degrees north (WGS-84)
 * @param lng       Decimal degrees east (WGS-84, negative for western hemisphere)
 * @param bounds    Bounding box of the displayed viewport
 * @param viewWidth SVG viewBox width  (default 100)
 * @param viewHeight SVG viewBox height (default 70)
 */
export function geoToSVGPoint(
  lat: number,
  lng: number,
  bounds: ViewportBounds,
  viewWidth = 100,
  viewHeight = 70
): SvgPoint {
  const lngRange = bounds.lngMax - bounds.lngMin;
  const latRange = bounds.latMax - bounds.latMin;

  const x = ((lng - bounds.lngMin) / lngRange) * viewWidth;
  // Latitude increases northward but SVG y increases downward → invert
  const y = ((bounds.latMax - lat) / latRange) * viewHeight;

  return {
    x: clamp(x, 0, viewWidth),
    y: clamp(y, 0, viewHeight),
  };
}

/**
 * Returns CSS percentage values suitable for `left` / `top` absolute
 * positioning within a container.
 *
 * Derived from `geoToSVGPoint` using the default 100×70 viewBox so that
 * CSS percentages and SVG x-coordinates are consistent.
 */
export function geoToCssPercent(
  lat: number,
  lng: number,
  bounds: ViewportBounds
): CssPercent {
  const pt = geoToSVGPoint(lat, lng, bounds);
  return {
    xPct: pt.x,             // SVG x in [0,100] == CSS left %
    yPct: (pt.y / 70) * 100, // SVG y in [0,70] → CSS top % in [0,100]
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Formats a coordinate pair for display.
 * e.g.  42.4671°N, 70.9437°W
 */
export function formatCoordinates(lat: number, lng: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lng).toFixed(4)}°${lngDir}`;
}
