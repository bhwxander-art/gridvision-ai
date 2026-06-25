import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns true when both Supabase env vars required by the server client
 * are present.  Call this before instantiating the client to avoid
 * throwing in mock/dev environments.
 */
export function isDbConfigured(): boolean {
  const url = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const result = url && key;

  console.log("[isDbConfigured]", {
    NEXT_PUBLIC_SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: key,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    result,
  });

  return result;
}

/**
 * Creates a server-side Supabase client using the service-role key.
 * The service-role key bypasses Row Level Security — use only in
 * server-side code (API routes, server actions, scripts).
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL       — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY      — found in Supabase Dashboard → Settings → API
 *
 * @throws if env vars are missing
 */
export function createServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "[db/client] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
      "Add them to .env.local — see docs/integration-report.md §Supabase setup."
    );
  }

  return createClient(url, key, {
    auth: {
      // Server-side: never persist or auto-refresh sessions
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Module-level singleton — reused across requests in the same Node.js process.
// Wrapped in a lazy getter so the client is never created during the build
// phase when env vars are absent.
let _client: SupabaseClient | null = null;

export function getServerClient(): SupabaseClient {
  if (!_client) {
    _client = createServerClient();
  }
  return _client;
}
