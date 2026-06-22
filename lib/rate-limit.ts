import { NextResponse } from "next/server";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const LIMIT = 30;

// Keyed by user identifier → sorted array of hit timestamps within the window
const store = new Map<string, number[]>();

/**
 * Returns the rate-limit key for a request.
 * Authenticated users are keyed by their UUID.
 * Unauthenticated requests (dev / mock mode) fall back to the client IP.
 */
export function getRateLimitKey(userId: string | null, req: Request): string {
  if (userId) return `user:${userId}`;
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",")[0].trim()
    : (req.headers.get("x-real-ip") ?? "anonymous");
  return `ip:${ip}`;
}

/**
 * Sliding-window check. Mutates the store on every allowed request.
 * Returns true when the caller should be let through.
 */
export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const hits = (store.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= LIMIT) {
    store.set(key, hits); // keep the pruned list without adding a new hit
    return false;
  }
  hits.push(now);
  store.set(key, hits);
  return true;
}

export function rateLimitResponse(): NextResponse<{ error: string }> {
  return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
}
