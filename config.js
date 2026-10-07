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
  SUPABASE_URL: 'https://zsdddkasvgknbntoefbs.supabase.co',        // e.g. https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzZGRka2FzdmdrbmJudG9lZmJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyOTg1MDcsImV4cCI6MjEwNjg3NDUwN30.fZunqBoMKQNBHbu7pS1xXSH8HfIKjpWaParNoF_stN8',   // "anon public" key from Project Settings -> API
  FUNCTION_NAME: 'gemini-chat',
  // Models that can use the free daily tokens (must match the Edge Function list)
  FREE_MODELS: ['gemini-3.8-flash', 'gemini-3.5-flash-lite']
};
