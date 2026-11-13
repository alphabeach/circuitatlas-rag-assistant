import "server-only";

import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

/**
 * Request-scoped Supabase client for Server Components and Route Handlers.
 *
 * Uses the anon key and forwards the incoming cookies so RLS applies. For
 * privileged operations (ingestion, deletion) use `getAdminClient()`.
 */
export async function createServerClient() {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();

  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_ANON_KEY"),
    {
      global: {
        headers: { cookie: cookieStore.toString() },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
