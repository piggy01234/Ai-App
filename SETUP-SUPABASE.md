# Turning on accounts + free daily tokens

Everything here is optional. Until you fill in `config.js`, the app works exactly as before
(everyone pastes their own API key).

**What users get**
- Not signed in: paste your own key for every model.
- Signed in (email confirmed): a free daily token allowance on **Gemini 3.8 Flash** and
  **Gemini 3.5 Flash-Lite**, paid for by *your* Gemini key.
- Claude models and Gemini 3.1 Pro always need the user's own key.
- When the daily allowance runs out, the app asks for their own Gemini key to keep going.

## 1. Create the project
1. Go to https://supabase.com, create a free project.

## 2. Create the tables and rules
1. Open **SQL Editor -> New query**.
2. Paste the whole of `supabase/schema.sql` and press **Run**.
3. Check **Table Editor**: you should see `app_settings`, `profiles`, `usage_daily`, `rate_window`.

## 3. Require email confirmation
1. **Authentication -> Providers -> Email**: make sure **Confirm email** is ON (it is by default).
2. **Authentication -> URL Configuration**: set **Site URL** to your GitHub Pages address
   (e.g. `https://YOUR-USERNAME.github.io/YOUR-REPO/`) and add the same address under **Redirect URLs**.
   Without this, the confirmation link in the email goes to the wrong place.
3. **Important:** Supabase's built-in email sender only sends a few emails per hour. Before sharing the
   app, connect a real sender under **Authentication -> SMTP Settings** (Resend has a free plan).

## 4. Get a free Gemini key
1. Go to https://aistudio.google.com/apikey and create a key.
2. Keep it secret. It only ever goes into Supabase's secrets (next step), never into GitHub.

## 5. Deploy the Edge Function (no command line needed)
1. **Edge Functions -> Deploy a new function -> Via Editor**. Name it exactly `gemini-chat`.
2. Replace the starter code with the contents of `supabase/functions/gemini-chat/index.ts` and **Deploy**.
3. Open the function's settings and turn **OFF** "Verify JWT" / "Enforce JWT verification".
   (The function checks the user's login itself, which works with all Supabase key types.)
4. **Edge Functions -> Secrets**: add `GEMINI_API_KEY` = your key from step 4.
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.)

## 6. Connect the website
1. **Project Settings -> API**: copy the **Project URL** and the **anon public** key.
2. Paste them into `config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) and push to GitHub.
3. Never paste the `service_role` key anywhere in the website files.

## Changing the limits later (Table Editor)
| What | Where |
| --- | --- |
| Free tokens per day for everyone | `app_settings` -> `daily_tokens` (default 50000) |
| One person gets more or less | `profiles` -> that person's row -> `daily_tokens_override` |
| Requests per minute per user | `app_settings` -> `requests_per_minute` (default 10) |
| See who used what | `usage_daily` |

Tokens count input + output + thinking, as reported by Gemini. The day resets at midnight UTC.
Changing which models are free: edit `FREE_MODELS` at the top of the Edge Function **and** in `config.js`.

## Good to know
- Google's free tier has its own rate limits, shared by everyone using your one key. If many people
  chat at once, some will see a "busy" message. Their own key avoids that.
- Google says free-tier prompts and replies may be used to improve its products. The sign-up screen
  tells users this; they can tick "Use my own Gemini key" in Settings to avoid it (if their own key is on a paid plan).
- Chats are stored only in each person's browser. Supabase stores just the account email and daily usage.
- No password-reset screen yet. You can reset a password from Authentication -> Users in the dashboard.
