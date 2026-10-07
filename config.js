// ---------------------------------------------------------------
// Optional: turn on accounts + free daily Gemini tokens.
// Leave SUPABASE_URL empty and the app works exactly as before
// (everyone pastes their own API key).
//
// Fill these in after following SETUP-SUPABASE.md.
// The anon key is meant to be public, so it is safe on GitHub.
// NEVER put your service_role key or your Gemini key in this file.
// ---------------------------------------------------------------
window.APP_CONFIG = {
  SUPABASE_URL: '',        // e.g. https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: '',   // "anon public" key from Project Settings -> API
  FUNCTION_NAME: 'gemini-chat',
  // Models that can use the free daily tokens (must match the Edge Function list)
  FREE_MODELS: ['gemini-3.8-flash', 'gemini-3.5-flash-lite']
};
