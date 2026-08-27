import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getSupabaseClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('throws a clear error when env vars are missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const { getSupabaseClient } = await import('./supabase');
    expect(() => getSupabaseClient()).toThrow(/VITE_SUPABASE_URL/);
  });

  it('returns a client when env vars are present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
    const { getSupabaseClient } = await import('./supabase');
    expect(getSupabaseClient()).toBeTruthy();
  });
});
