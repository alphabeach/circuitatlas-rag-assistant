import { z } from "zod";

/**
 * Environment validation.
 *
 * Everything is read lazily through getters rather than at module scope so
 * that importing this file from a client component does not throw, and so a
 * missing variable produces an actionable error at the point of use instead
 * of an opaque crash during the build.
 */

const serverSchema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  EMBEDDING_FALLBACK_OPENAI: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("protocol-files"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (!cached) {
    cached = serverSchema.parse({
      SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      EMBEDDING_FALLBACK_OPENAI: process.env.EMBEDDING_FALLBACK_OPENAI,
      SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET,
    });
  }
  return cached;
}

export function requireEnv<K extends keyof ServerEnv>(
  key: K,
): NonNullable<ServerEnv[K]> {
  const value = env()[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        `See .env.example for the full list.`,
    );
  }
  return value as NonNullable<ServerEnv[K]>;
}

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
