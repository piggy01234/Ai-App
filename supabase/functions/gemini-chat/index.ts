// Supabase Edge Function: gemini-chat
// Lets signed-in, email-confirmed users chat with a few Gemini models using YOUR key
// (kept as the GEMINI_API_KEY secret), up to a daily token allowance.
import { createClient } from "npm:@supabase/supabase-js@2";

const FREE_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"]; // keep in sync with config.js
const MAX_OUTPUT_TOKENS = 16384;
const MAX_INPUT_CHARS = 200_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) return json({ error: "Server is missing its Gemini key.", code: "server" }, 500);

  // 1. Who is calling? Must be a signed-in user with a confirmed email.
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await createClient(url, anonKey).auth.getUser(token);
  const user = auth?.user;
  if (authErr || !user) return json({ error: "Please sign in again.", code: "auth" }, 401);
  if (!user.email_confirmed_at) return json({ error: "Please confirm your email first.", code: "unconfirmed" }, 403);

  // 2. Validate the request.
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request.", code: "bad" }, 400); }
  const { model, messages, system, thinking, temperature } = body || {};
  if (!FREE_MODELS.includes(model)) {
    return json({ error: "This model needs your own API key.", code: "model" }, 403);
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200) {
    return json({ error: "Bad request.", code: "bad" }, 400);
  }
  let inputChars = typeof system === "string" ? Math.min(system.length, 4000) : 0;
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return json({ error: "Bad request.", code: "bad" }, 400);
    }
    inputChars += m.content.length;
  }
  if (messages[messages.length - 1].role !== "user") return json({ error: "Bad request.", code: "bad" }, 400);
  if (inputChars > MAX_INPUT_CHARS) {
    return json({ error: "That chat is too long for free tokens. Start a new chat or use your own key.", code: "too_long" }, 413);
  }

  // 3. Quota + rate limit check (server-side, can't be bypassed from the browser).
  const admin = createClient(url, serviceKey);
  const { data: gate, error: gateErr } = await admin.rpc("begin_request", { p_user: user.id });
  if (gateErr || !gate) return json({ error: "Server error. Please try again.", code: "server" }, 500);
  if (!gate.allowed) {
    return json({
      error: gate.reason === "quota"
        ? "You've used today's free tokens."
        : "Slow down a little: too many requests in a minute.",
      code: gate.reason,
      remaining: gate.remaining,
    }, 429);
  }

  // 4. Call Gemini, stepping down if the model rejects an option.
  const contents = messages.map((m: any) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const attempts = [{ thoughts: !!thinking, cap: true }];
  if (thinking) attempts.push({ thoughts: false, cap: true });
  attempts.push({ thoughts: false, cap: false });

  let upstream: Response | null = null;
  for (let i = 0; i < attempts.length; i++) {
    const { thoughts, cap } = attempts[i];
    const generationConfig: Record<string, unknown> = {};
    if (typeof temperature === "number" && temperature !== 1) {
      generationConfig.temperature = Math.min(Math.max(temperature, 0), 1);
    }
    if (cap) generationConfig.maxOutputTokens = MAX_OUTPUT_TOKENS;
    if (thoughts) generationConfig.thinkingConfig = { includeThoughts: true };
    const payload: Record<string, unknown> = { contents, generationConfig };
    if (typeof system === "string" && system.trim()) {
      payload.systemInstruction = { parts: [{ text: system.slice(0, 4000) }] };
    }
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": geminiKey }, body: JSON.stringify(payload) },
    );
    if (r.ok) { upstream = r; break; }
    const text = await r.text();
    let msg = text;
    try { msg = JSON.parse(text)?.error?.message || text; } catch { /* keep raw text */ }
    if (r.status === 400 && i < attempts.length - 1 && /thinking|thought|output.?token/i.test(msg)) continue;
    if (r.status === 429) {
      return json({
        error: "The shared free key is busy right now. Try again in a moment, or add your own Gemini key.",
        code: "upstream_rate",
      }, 429);
    }
    return json({ error: "Gemini error: " + msg, code: "upstream" }, 502);
  }
  if (!upstream || !upstream.body) return json({ error: "No response from Gemini.", code: "upstream" }, 502);

  // 5. Stream the reply straight through, and charge the tokens Gemini reports at the end.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let total = 0;
  let recorded = false;

  const track = (chunk: Uint8Array) => {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const l of lines) {
      if (!l.startsWith("data:")) continue;
      try {
        const t = JSON.parse(l.slice(5))?.usageMetadata?.totalTokenCount;
        if (typeof t === "number" && t > total) total = t;
      } catch { /* partial or non-JSON line */ }
    }
  };
  const record = async () => {
    if (recorded) return;
    recorded = true;
    const tokens = total > 0 ? total : Math.ceil(inputChars / 4); // stopped early: still charge the input
    try { await admin.rpc("add_usage", { p_user: user.id, p_tokens: tokens }); }
    catch (e) { console.error("add_usage failed", e); }
  };

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { await record(); controller.close(); return; }
        track(value);
        controller.enqueue(value);
      } catch (e) { await record(); controller.error(e); }
    },
    async cancel() { await record(); try { await reader.cancel(); } catch { /* ignore */ } },
  });

  return new Response(stream, {
    headers: { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
});
