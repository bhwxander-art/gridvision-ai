import "server-only";
import crypto from "crypto";

/**
 * OAuth State Parameter Management
 * Prevents CSRF and session fixation attacks
 */

// In-memory state store (production should use Redis with TTL)
const stateStore = new Map<string, { createdAt: number; tenantId?: string }>();

const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generate a cryptographically secure state parameter
 */
export function generateOAuthState(tenantId?: string): string {
  const randomBytes = crypto.randomBytes(32);
  const state = randomBytes.toString("hex");

  stateStore.set(state, {
    createdAt: Date.now(),
    tenantId,
  });

  // Clean up expired states
  cleanupExpiredStates();

  return state;
}

/**
 * Verify OAuth state parameter
 * Returns tenantId if valid, throws if invalid/expired
 */
export function verifyOAuthState(state: string, tenantId?: string): string | undefined {
  const stored = stateStore.get(state);

  if (!stored) {
    throw new Error("Invalid OAuth state - state not found");
  }

  // Check if state has expired
  const age = Date.now() - stored.createdAt;
  if (age > STATE_EXPIRY_MS) {
    stateStore.delete(state);
    throw new Error("Invalid OAuth state - state expired");
  }

  // Verify tenant match if provided
  if (tenantId && stored.tenantId && stored.tenantId !== tenantId) {
    throw new Error("Invalid OAuth state - tenant mismatch");
  }

  // Mark state as used (one-time use)
  stateStore.delete(state);

  return stored.tenantId;
}

/**
 * Clean up expired states from store
 */
function cleanupExpiredStates(): void {
  const now = Date.now();

  for (const [state, value] of stateStore.entries()) {
    if (now - value.createdAt > STATE_EXPIRY_MS) {
      stateStore.delete(state);
    }
  }
}

/**
 * Generate PKCE challenge for OAuth code flow
 * Prevents code interception attacks
 */
export function generatePKCEChallenge(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString("hex");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  return { codeVerifier, codeChallenge };
}

/**
 * Verify PKCE code verifier
 */
export function verifyPKCEChallenge(codeVerifier: string, codeChallenge: string): boolean {
  const computed = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  return computed === codeChallenge;
}
