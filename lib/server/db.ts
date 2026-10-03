import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "./env";

let client: SupabaseClient | null = null;

/** secret key を使うサーバー専用クライアント。RLS を通らないので、呼び出し側で必ずロールを確認する */
export function db(): SupabaseClient {
  if (client) return client;
  const env = serverEnv();
  client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export const PDF_BUCKET = "problem-pdfs";
