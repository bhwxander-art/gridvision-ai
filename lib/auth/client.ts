import { createBrowserClient } from "@supabase/ssr";

/**
 * Returns a Supabase client that runs in the browser.
 * Uses the public anon key — safe to expose in client bundles.
 * Call once per component; the client is lightweight to create.
 */
export function getAuthClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
