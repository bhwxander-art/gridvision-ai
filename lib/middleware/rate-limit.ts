import "server-only";

/**
 * Simple in-memory rate limiter
 * For production, use Redis
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Rate limit check
 * Returns true if request is allowed, false if rate limited
 */
export function checkRateLimit(
  identifier: string,
  maxRequests: number = 100,
  windowMs: number = 60000 // 1 minute
): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (!entry || now > entry.resetAt) {
    // Reset window
    rateLimitStore.set(identifier, {
      count: 1,
      resetAt: now + windowMs,
    });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Get remaining requests
 */
export function getRemainingRequests(
  identifier: string,
  maxRequests: number = 100,
  windowMs: number = 60000
): { remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (!entry || now > entry.resetAt) {
    return {
      remaining: maxRequests,
      resetAt: now + windowMs,
    };
  }

  return {
    remaining: Math.max(0, maxRequests - entry.count),
    resetAt: entry.resetAt,
  };
}

/**
 * Cleanup old entries (call periodically)
 */
export function cleanupOldEntries(): void {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

// Cleanup old entries every 5 minutes
setInterval(cleanupOldEntries, 5 * 60 * 1000);

/**
 * Rate limit configs for different endpoints
 */
export const RATE_LIMIT_CONFIG = {
  // Public APIs
  default: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 1 minute
  },

  // Strict limits on sensitive endpoints
  auth: {
    maxRequests: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
  },

  // Demo/Public endpoints
  demo: {
    maxRequests: 50,
    windowMs: 60 * 1000, // 1 minute
  },

  // ROI Calculator (public)
  roiCalculator: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 1 minute
  },

  // Webhook endpoints
  webhook: {
    maxRequests: 1000,
    windowMs: 60 * 1000, // 1 minute (high volume expected)
  },

  // API endpoints (authenticated)
  api: {
    maxRequests: 500,
    windowMs: 60 * 1000, // 1 minute
  },
};
