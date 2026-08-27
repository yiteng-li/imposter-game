import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.local.example to .env.local and fill them in.',
    );
  }
  client = createClient(url, anonKey);
  return client;
}

// Concurrent callers must share one in-flight sign-in, not race independent
// ones. Two overlapping calls each doing their own getSession-then-signIn can
// each see no session and each call signInAnonymously(), minting two
// different anonymous users — whichever response the client library applies
// last silently becomes "the" session, while an earlier caller may have
// already resolved with the other id. React 19 StrictMode's dev-only double
// effect invocation hits this on every first-ever page load; nothing stops
// two real call sites from doing the same in production. Memoizing the
// promise means every concurrent caller resolves to the exact same id.
let signInFlight: Promise<string> | null = null;

export async function ensurePlayerId(): Promise<string> {
  if (signInFlight) return signInFlight;

  signInFlight = (async () => {
    const supabase = getSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user) return session.user.id;

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      throw new Error(`Anonymous sign-in failed: ${error?.message ?? 'unknown error'}`);
    }
    return data.user.id;
  })();

  try {
    return await signInFlight;
  } finally {
    // Clear on both success and failure: success just means later calls take
    // the (now cheap) getSession() branch again; failure must not wedge every
    // future call behind a permanently-rejected promise.
    signInFlight = null;
  }
}
