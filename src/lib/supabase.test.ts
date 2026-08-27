import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable state for mock behavior
let mockAuthState: {
  getSessionResult: any;
  signInResult: any;
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(async () => mockAuthState.getSessionResult),
      signInAnonymously: vi.fn(async () => mockAuthState.signInResult),
    },
  })),
}));

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

describe('ensurePlayerId', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns existing session user id without calling signInAnonymously', async () => {
    const mockUserId = 'existing-user-123';
    mockAuthState = {
      getSessionResult: {
        data: {
          session: {
            user: { id: mockUserId },
          },
        },
      },
      signInResult: null,
    };

    const { ensurePlayerId } = await import('./supabase');
    const userId = await ensurePlayerId();

    expect(userId).toBe(mockUserId);
  });

  it('calls signInAnonymously and returns new user id when no session exists', async () => {
    const mockNewUserId = 'new-anon-user-456';
    mockAuthState = {
      getSessionResult: {
        data: { session: null },
      },
      signInResult: {
        data: { user: { id: mockNewUserId } },
        error: null,
      },
    };

    const { ensurePlayerId } = await import('./supabase');
    const userId = await ensurePlayerId();

    expect(userId).toBe(mockNewUserId);
  });

  it('throws clear error when signInAnonymously returns error', async () => {
    const errorMessage = 'Network error';
    mockAuthState = {
      getSessionResult: {
        data: { session: null },
      },
      signInResult: {
        data: { user: null },
        error: { message: errorMessage },
      },
    };

    const { ensurePlayerId } = await import('./supabase');

    await expect(ensurePlayerId()).rejects.toThrow(/Anonymous sign-in failed/);
    await expect(ensurePlayerId()).rejects.toThrow(errorMessage);
  });

  it('throws clear error when signInAnonymously returns no user without error', async () => {
    mockAuthState = {
      getSessionResult: {
        data: { session: null },
      },
      signInResult: {
        data: { user: null },
        error: null,
      },
    };

    const { ensurePlayerId } = await import('./supabase');

    await expect(ensurePlayerId()).rejects.toThrow(/Anonymous sign-in failed/);
    await expect(ensurePlayerId()).rejects.toThrow('unknown error');
  });
});
