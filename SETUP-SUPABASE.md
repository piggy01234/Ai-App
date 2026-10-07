# Setup guide: accounts + free daily tokens

This turns on sign-in and a free daily token allowance for **Gemini 3.8 Flash** and **Gemini 3.5 Flash-Lite**.
Allow about 45 minutes the first time. Do the parts in order: each one depends on the one before.

Menu names in Supabase, Brevo and Google change from time to time. If a button isn't where this guide says,
look for the closest match, or use the search box at the top of the Supabase dashboard.

---

## The big picture (read this once)

```
 Browser (your GitHub Pages site)
   |  1. sign up / sign in ........................ Supabase Auth (stores accounts, sends the confirmation email)
   |  2. "how many tokens do I have left?" ........ Supabase database (get_quota)
   |  3. chat message + login token ............... Supabase Edge Function "gemini-chat"
   |                                                   |  checks login, email confirmed, model allowed, tokens left
   |                                                   |  calls Google with YOUR secret Gemini key
   |  <---- streamed reply -----------------------------+  then subtracts the tokens used
```

- **Your Gemini key never reaches the browser.** It lives only as a secret inside Supabase.
- **People can't give themselves tokens.** The browser can only *read* its own balance; the Edge Function changes it.
- **Own-key chats skip all of this.** If someone pastes their own key, their messages go straight to Google/Anthropic.

Words you'll see:

| Word | Meaning |
| --- | --- |
| Supabase | The service that stores accounts and usage and runs the server code |
| Edge Function | A small piece of server code (`gemini-chat`) that talks to Google for the user |
| SMTP | The way Supabase hands emails to an email-sending company (Brevo) |
| anon key | A public key the website uses to talk to Supabase. Safe to put on GitHub |
| service_role key | A powerful secret key. **Never** put it in the website files |
| Secret | A private setting stored in Supabase (your Gemini key goes here) |

---

## What you need before starting

- A GitHub repo with the website already on GitHub Pages (you have this)
- A Supabase account (free): https://supabase.com
- A Google account for a Gemini key (free): https://aistudio.google.com
- A Brevo account for sending emails (free): https://www.brevo.com
- A real email address you can check (to receive test emails)

---

## Part 1: Create the Supabase project (5 min)

1. Sign in to Supabase and click **New project**.
2. Pick a name (e.g. `ai-chat`), choose a **database password** and **save it somewhere**, pick the region closest to you, and keep the **Free** plan.
3. Click **Create new project** and wait about a minute for it to finish setting up.

---

## Part 2: Create the database tables (5 min)

1. In the left sidebar open **SQL Editor** and click **New query**.
2. Open `supabase/schema.sql` (from this folder) in any text editor, select **all** the text, copy it.
3. Paste it into the query box and click **Run**.
4. You should see **Success. No rows returned**.
5. Open **Table Editor** in the sidebar. You should now see four tables: `app_settings`, `profiles`, `usage_daily`, `rate_window`.
6. Click `app_settings`. There is one row with `daily_tokens` = 50000 and `requests_per_minute` = 10. This is where you change the limits later.

If you see an error: copy the whole error message and send it to me. Running the file twice is safe.

---

## Part 3: Require email confirmation and set your website address (5 min)

1. Go to **Authentication** (left sidebar).
2. Find the **Email** sign-in provider (under **Sign In / Providers** or **Providers**). Make sure **Enable Email provider** is on and **Confirm email** is **ON**.
   This is what stops people making endless accounts: nobody can sign in until they click the link in their inbox.
3. Open **URL Configuration**:
   - **Site URL**: your GitHub Pages address, e.g. `https://your-username.github.io/your-repo/`
     (copy it exactly from your browser, including the trailing `/`).
   - **Redirect URLs** → **Add URL**: add the same address again.
   - Optional, for testing on your own computer: also add `http://localhost:8000`
4. Save.

If you skip step 3, the confirmation link in the email will send people to the wrong page.

---

## Part 4: Set up email sending with Brevo (15 min)

Supabase's built-in email sender only allows about **2 emails per hour** on the free plan, so it breaks as soon as
a few people sign up. Brevo's free plan allows 300 emails a day and doesn't require you to own a domain.
Supabase will hand every confirmation email to Brevo, and Brevo delivers it.

You'll collect four things from Brevo and type them into Supabase: a **verified sender address**, an **SMTP server + port**,
an **SMTP login**, and an **SMTP key**.

### 4a. Create the account
1. Go to https://www.brevo.com and sign up (free plan, no credit card).
2. Click the confirmation link Brevo emails you.
3. Brevo asks you to fill in a profile (name, what you'll use it for, and so on). Complete it. Pick something honest like
   a personal project sending sign-up confirmation emails.
4. New accounts are sometimes reviewed before sending is switched on. If Brevo says so, wait for it to finish before testing.

### 4b. Add and verify your sender address
This is the "From" address people will see on the confirmation emails.
1. Click your account name (top right) → **Settings** → **Senders, Domains, IPs** (the name may differ slightly).
2. Open the **Senders** tab and click **Add a sender**.
3. Enter a **From name** (your app's name, e.g. `AI Chat`) and the **email address** you can read (your own inbox).
4. Brevo sends a verification email to that address. Open it and click the link to confirm.
5. Back in Brevo, the sender should now show as verified. If it doesn't, refresh the page.

You do **not** need to verify a domain to start. The cost is that Brevo may swap in its own sender address and some emails
may go to spam (see "What to expect" below).

### 4c. Create an SMTP key
1. Account name (top right) → **Settings** → **SMTP & API** → the **SMTP** tab.
2. On this page Brevo shows the **SMTP server** (`smtp-relay.brevo.com`), the **port** (`587`) and your **SMTP login**.
   Write the login down exactly as shown. Depending on when your account was made, it is either your account email or an
   address ending in `@smtp-brevo.com`. Both are normal.
3. Click **Generate a new SMTP key**, name it `supabase`, and click **Generate**.
4. **Copy the key right away.** Brevo shows the full key only once. Brevo also emails you a security notice when you create
   a key; that's normal.

Don't mix up the three secrets Brevo has:

| Thing | Use it here? |
| --- | --- |
| Your Brevo **account password** | No |
| An **API key** (the other tab) | No |
| The **SMTP key** you just made | **Yes** |

### 4d. Give Supabase the details
1. In Supabase go to **Authentication** → **Emails** → **SMTP Settings** (on some versions: **Project Settings → Authentication**).
2. Switch on **Enable custom SMTP** and fill in:

| Field | What to enter |
| --- | --- |
| Sender email | The address you verified in 4b |
| Sender name | The same name you used in 4b |
| Host | `smtp-relay.brevo.com` |
| Port number | `587` |
| Username | The **SMTP login** from 4c |
| Password | The **SMTP key** from 4c |

3. Save. The key now lives only inside Supabase. Never put it in a file on GitHub.
4. Open **Authentication → Rate Limits** and raise the "emails per hour" limit if you expect lots of signups at once.

### 4e. Test it
1. Open your site in a private window, click **Sign in for free tokens → Create account**, and sign up with a **different**
   email address from your Brevo one, one you can open.
2. The confirmation email should arrive within a minute. **Check spam** too.
3. Didn't arrive? Look in Supabase **Logs → Auth** for an error, and in Brevo under **Transactional → Logs** to see whether Brevo
   received and sent it.

### What to expect from the emails
Because you're sending from a normal address and not your own domain, Brevo may replace the sender with its own
address. Some confirmation emails can land in **spam**. That's normal for this setup, and the sign-up screen already
tells people to check their spam folder. To improve it later, buy a domain (about $10 a year), add it under
**Senders, Domains, IPs → Domains** in Brevo, add the DNS records Brevo gives you at your domain registrar, and wait for
it to show as authenticated (it can take up to 24 to 48 hours). Then use an address on that domain as the sender.

### Brevo troubleshooting

| Problem | Likely cause and fix |
| --- | --- |
| Supabase says authentication failed (535) | You used your account password or an API key. Use the **SMTP login** and **SMTP key** from the SMTP tab |
| "Unverified sender" / sender rejected | The sender email in Supabase doesn't match a **verified** sender in Brevo. Fix the spelling or verify it |
| Sign-up works but nothing arrives | Check spam, then Brevo **Transactional → Logs**. Check the account isn't still waiting for activation |
| "Daily quota exceeded" | You hit 300 emails in a day. It resets the next day |
| Timeouts or connection errors | Check the port is `587` and the host is exactly `smtp-relay.brevo.com` |
| You accidentally shared the key | In Brevo **SMTP & API → SMTP**, deactivate or delete that key, make a new one, and update Supabase |

---

## Part 5: Get your free Gemini key (3 min)

1. Go to https://aistudio.google.com/apikey and click **Create API key**.
2. Copy it and keep it private. It goes into Supabase in Part 6, **never** into a file on GitHub.
3. Don't turn on billing for that Google project. Without billing it stays on the free tier and can't charge you.
   The downside: free-tier rate limits are shared by everyone using your one key, so very busy moments can show a "busy" message.

---

## Part 6: Deploy the Edge Function (10 min)

1. In Supabase open **Edge Functions** → **Deploy a new function** → **Via Editor** (or **Create function**).
2. Name it exactly **`gemini-chat`** (lowercase, with the hyphen).
3. Delete the example code. Open `supabase/functions/gemini-chat/index.ts` (it's also attached as `gemini-chat-function.ts`),
   copy **all** of it, and paste it in.
4. Click **Deploy**.
5. Open the function's **settings/details** and turn **OFF** "Enforce JWT verification" (also called "Verify JWT").
   The function checks the user's login itself, and this switch can wrongly reject valid users with newer Supabase keys.
6. Add your Gemini key as a secret: **Edge Functions → Secrets** (or **Manage secrets**) → **Add new secret**
   - Name: `GEMINI_API_KEY` (exactly, capital letters)
   - Value: the key from Part 5
7. If the function was deployed before you added the secret, click **Deploy** once more so it picks the secret up.

You don't need to add `SUPABASE_URL`, `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY`. Supabase supplies them automatically.

---

## Part 7: Connect the website and publish it (10 min)

### 7a. Find your two public values
In Supabase go to **Project Settings → API** (or **API Keys**) and copy:
- **Project URL**, e.g. `https://abcdefghij.supabase.co`
- The **anon** / **public** key (a long string). The "publishable" key works too.

Do **not** copy the `service_role` / secret key.

### 7b. Put them in `config.js`
Open `config.js` and fill in the two blanks:

```js
SUPABASE_URL: 'https://abcdefghij.supabase.co',
SUPABASE_ANON_KEY: 'your-anon-key-here',
```

Easiest way on GitHub: open the file in your repo → click the **pencil** icon → paste → **Commit changes**.

### 7c. Upload the other new files
In your repo click **Add file → Upload files** and drag in the new `index.html`, `style.css`, `app.js`, `config.js`,
`SETUP-SUPABASE.md` and the whole `supabase` folder. Commit. Wait a minute or two for GitHub Pages to update, then
**hard refresh** (Ctrl+Shift+R, or Cmd+Shift+R on Mac).

If the sidebar shows **Sign in for free tokens**, the website found your Supabase project.

---

## Part 8: Test everything (10 min)

Do these in order. Use a real email you can open.

1. **Sign up.** Click *Sign in for free tokens* → **Create account** → enter your email and a password (8+ characters).
   You should see "We sent a confirmation link".
2. **Confirm.** Open the email (check spam), click the link. You land back on your site and should be signed in.
   The sidebar now shows your email and a meter, "50,000 of 50,000 free tokens left today".
3. **Chat.** Pick **Gemini 3.8 Flash** (tagged *Free tokens*) and send a message. You should get a reply and the meter should drop.
4. **Check the server side.** In Supabase **Table Editor → `usage_daily`** you should see a row for you with `tokens_used` above 0.
5. **Check blocked models.** Pick **Gemini 3.1 Pro** or a Claude model without a key. You should be told you need your own key.
6. **Test the daily limit.** In **`app_settings`** change `daily_tokens` to `300`, chat once or twice, then try again.
   You should see "You've used today's free tokens" with an **Add my key** button. Paste any Gemini key in Settings and it carries on.
   Then **set `daily_tokens` back to `50000`.** Also reset your row's `tokens_used` to 0 in `usage_daily` if you want your tokens back.
7. **Check sign out / sign in** work, and that a second account gets its own separate meter.

---

## Running it day to day

| I want to... | Do this |
| --- | --- |
| Change the free amount for everyone | Table Editor → `app_settings` → `daily_tokens` |
| Give one person more or less | Table Editor → `profiles` → their row → `daily_tokens_override` (blank = default) |
| Slow down spammers | `app_settings` → `requests_per_minute` |
| See who has used how much | Table Editor → `usage_daily` |
| See all accounts | **Authentication → Users** |
| Reset someone's password / delete an account | **Authentication → Users** → the `...` menu next to them |
| Change which models are free | Edit `FREE_MODELS` at the top of the Edge Function (redeploy) **and** in `config.js` |

Tokens count input + output + thinking, as reported by Google. The day resets at midnight UTC.

---

## Troubleshooting

| What you see | Likely cause and fix |
| --- | --- |
| No "Sign in" button at all | `config.js` is empty, wasn't uploaded, or the page is cached. Check both values, then hard refresh |
| Confirmation email never arrives | Check spam. Check the Brevo sender is verified (4a) and the SMTP login/key are right (4c). If you skipped Part 4, you're on the 2-per-hour limit |
| Link in the email goes to the wrong page | **Site URL** / **Redirect URLs** in Part 3 are wrong or missing |
| "Email not confirmed" when signing in | They haven't clicked the link yet. They can sign up again to get a new email, or you can confirm them in **Authentication → Users** |
| "Please sign in again" on every message | The Edge Function's JWT switch is still on (Part 6, step 5), or the anon key in `config.js` is wrong |
| Network / CORS error in the browser | Function not deployed, or its name isn't exactly `gemini-chat` |
| "Server is missing its Gemini key" | The secret is named wrong or hasn't been added. Re-check Part 6 steps 6-7 |
| "The shared free key is busy" | Google's shared free-tier limit. Wait a moment, or use your own key |
| "permission denied for function" | The grants at the bottom of `schema.sql` didn't run. Run the whole file again |
| Meter shows nothing | `get_quota` failed: confirm Part 2 ran successfully |
| Changes to the site don't appear | GitHub Pages takes a minute or two. Then hard refresh |

Still stuck? Open the browser's developer tools (F12 → **Console**), copy any red error, and send it to me.
In Supabase, **Edge Functions → gemini-chat → Logs** shows what the server saw.

---

## Safety checklist

- [ ] `config.js` contains only the Project URL and the anon key
- [ ] The Gemini key exists only as a Supabase secret, not in any GitHub file
- [ ] The `service_role` key is nowhere in the website files
- [ ] Billing is not enabled on the Google project that owns your Gemini key
- [ ] Email confirmation is ON
- [ ] You tested the daily limit and set `daily_tokens` back to its real value

## Good to know

- Google says free-tier prompts and replies may be used to improve its products. The sign-up screen warns users, and
  they can tick **Use my own Gemini key** in Settings to avoid the free tier.
- Chats are stored only in each person's own browser. Supabase holds just the account email and daily usage counts.
- There's no "forgot password" screen yet. You can reset passwords from **Authentication → Users**.
