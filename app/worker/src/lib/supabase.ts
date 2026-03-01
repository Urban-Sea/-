import { createClient } from '@supabase/supabase-js';
import type { Env } from '../env';

/** Supabase クライアントを生成 (service_role key でRLSバイパス) */
export function getSupabase(env: Env) {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Python の supabase.table() に合わせた互換エイリアス
  return Object.assign(client, {
    table: (name: string) => client.from(name),
  });
}

/** getSupabase の戻り値型エイリアス */
export type AppSupabase = ReturnType<typeof getSupabase>;
