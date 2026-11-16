import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Calls one of the database functions. Resolves to the function's JSON.
// Throws an Error with a friendly message on network or server problems,
// and on { error: '...' } answers from the database.
export async function rpc(fn, args = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
  } catch {
    throw new Error('Can’t reach the server. Check your internet connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const msg = data && (data.message || data.hint);
    throw new Error(msg ? `Something went wrong: ${msg}` : `Something went wrong (error ${res.status}).`);
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && data.error) {
    throw new Error(data.error);
  }
  return data;
}
