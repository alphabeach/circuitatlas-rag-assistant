import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Browser Supabase client.
 *
 * Returns null when Supabase is not configured so the UI can degrade to a
 * clear "connect your keys" state instead of throwing during render.
 */
let client: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient | null {
  if (!publicEnv.supabaseUrl || !publicEnv.supabaseAnonKey) return null;
  if (!client) {
    client = createClient(
      publicEnv.supabaseUrl,
      publicEnv.supabaseAnonKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
  }
  return client;
}
