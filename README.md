# AI Chat — Claude & Gemini

A static web app (no build step, no server). Pick **Claude** or **Gemini**, paste your own API key in **Settings**, and chat.

Features: streaming replies, multiple saved chats, markdown + code highlighting with copy buttons, system prompt, temperature / max tokens, stop & regenerate, export to `.md`, light/dark theme. Styled with Inter (UI) and Source Serif 4 (replies).

## Run it from GitHub (GitHub Pages)

1. Create a new repo on github.com and upload everything in this folder (`index.html`, `style.css`, `app.js`, `.nojekyll`, ...).
2. Repo **Settings → Pages**.
3. Under **Build and deployment**, set **Source: Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute your app is live at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

Run it locally instead: `python3 -m http.server 8000` in this folder, then open http://localhost:8000

## API keys
- Claude: https://console.anthropic.com
- Gemini: https://aistudio.google.com/apikey

Keys live only in your browser's localStorage and go straight to Anthropic / Google. Don't paste a key into a shared computer, and don't hard-code a key into the files you push to GitHub.

## Optional: accounts with free daily tokens
Want people to try the app without their own key? Follow **SETUP-SUPABASE.md** to add sign-in and a
free daily token allowance on Gemini 3.8 Flash and 3.5 Flash-Lite (everything else still needs the user's own key).
