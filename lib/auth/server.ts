import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Returns a Supabase client bound to the current request's cookie store.
 * Use in Server Components and Route Handlers to read the authenticated user.
 *
 * Note: this is separate from lib/db/client.ts (service-role key for DB writes).
 * This client uses the anon key and respects Row-Level Security.
 */
export async function getAuthServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components cannot set cookies — middleware handles refresh.
          }
        },
      },
    }
  );
}
