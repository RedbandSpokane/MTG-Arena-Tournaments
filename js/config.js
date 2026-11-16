// Public connection settings. The publishable key is safe to share: the
// database only allows the PIN- and passphrase-checked functions.
export const SUPABASE_URL = 'https://muscawsjkwbdkynyzuxe.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_h-dtEQizZZGPXoDv5oGMcw_AVp6PtES';

// Availability grid: one-hour blocks starting at FIRST_HOUR through LAST_HOUR
// (24-hour clock, Pacific Time). 8 means 8 am, 22 means the 10-11 pm block.
export const FIRST_HOUR = 8;
export const LAST_HOUR = 22;
export const TIME_ZONE = 'America/Los_Angeles';
