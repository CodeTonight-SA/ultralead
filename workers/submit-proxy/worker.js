// ULTRALEAD submit proxy — a tiny Cloudflare Worker.
//
// Receives a quiz submission from the static GitHub Pages funnel and posts it
// to Slack. The Slack bot token stays server-side (a Worker secret) and never
// touches the browser — which is the whole reason this Worker exists (GitHub
// Pages can't safely hold a secret).
//
// Deploy:
//   cd workers/submit-proxy
//   npx wrangler deploy
//   npx wrangler secret put SLACK_BOT_TOKEN     # paste the CodeTonight bot token
// Then copy the printed https://ultralead-submit.<subdomain>.workers.dev URL
// into ../../config.js and commit.
//
// Endpoint:  POST /submit  { firm_slug, answers, email, freetext, rating, chain }
// Returns:   { ok, root_id }

const DEFAULT_CHANNEL = "C0ALQ9C7NMA"; // #grip-updates

function corsHeaders(origin, allow) {
  const value = allow === "*" ? "*" : origin === allow ? origin : allow;
  return {
    "Access-Control-Allow-Origin": value,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

async function makeRootId(obj) {
  const data = new TextEncoder().encode(JSON.stringify(obj) + Date.now());
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
  return "vb-" + hex;
}

function buildBlocks({ title, firm_slug, email, rating, freetext, root_id, answers }) {
  const answerLines = Object.entries(answers || {}).map(([k, v]) => `${k}: ${v}`).join("  ·  ");
  const blocks = [
    { type: "header", text: { type: "plain_text", text: title, emoji: false } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Funnel*\n${firm_slug}` },
        { type: "mrkdwn", text: `*Email*\n${email}` },
        { type: "mrkdwn", text: `*Rating*\n${rating ?? "—"} / 10` },
        { type: "mrkdwn", text: `*Ref*\n${root_id}` },
      ],
    },
  ];
  if (answerLines) blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Answers*\n${answerLines}` } });
  if (freetext) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*In their words*\n>${String(freetext).slice(0, 400)}` } });
  }
  return blocks;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allow = env.ALLOW_ORIGIN || "*";
    const headers = { ...corsHeaders(origin, allow), "Content-Type": "application/json" };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, reason: "POST only" }), { status: 405, headers });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, reason: "invalid_json" }), { status: 400, headers });
    }

    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, reason: "invalid_email" }), { status: 400, headers });
    }

    const root_id = await makeRootId(body);
    const token = env.SLACK_BOT_TOKEN;

    // Slack notify — best-effort; a failure here never blocks the user's reference.
    if (token) {
      const blocks = buildBlocks({
        title: env.NOTIFY_TITLE || "Venture enquiry",
        firm_slug: body.firm_slug || "_default",
        email,
        rating: body.rating,
        freetext: body.freetext,
        root_id,
        answers: body.answers,
      });
      try {
        const res = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ channel: env.SLACK_CHANNEL || DEFAULT_CHANNEL, text: `Venture enquiry: ${email}`, blocks }),
        });
        const data = await res.json().catch(() => ({}));
        if (!data.ok) console.log("slack_error", data.error);
      } catch (err) {
        console.log("slack_transport_error", String(err));
      }
    }

    return new Response(JSON.stringify({ ok: true, root_id }), { status: 200, headers });
  },
};
