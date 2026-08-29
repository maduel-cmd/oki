import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type OkiClient = SupabaseClient;

export type CreateClientOptions = {
  url: string;
  anonKey: string;
  disableRealtime?: boolean;
};

export function createOkiClient(options: CreateClientOptions): OkiClient {
  return createClient(options.url, options.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: options.disableRealtime
      ? { timeout: 1_000 }
      : undefined,
  });
}

export async function invokeEdgeFunction<T>(
  client: OkiClient,
  name: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.functions.invoke(name, { body });
  if (error) throw error;
  return data as T;
}
