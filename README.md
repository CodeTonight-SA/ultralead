# ultralead (GitHub Pages build)

The ULTRALEAD interactive funnel, hosted **free** on GitHub Pages under
CodeTonight-SA. Static frontend; the submit (the piece that posts to Slack) runs
in a tiny Cloudflare Worker so the Slack token never touches the browser.

- **Live:** https://codetonight-sa.github.io/ultralead/
- **Venture questionnaire:** https://codetonight-sa.github.io/ultralead/quiz?firm=venture_building

## How it fits together

```
GitHub Pages (this repo)                Cloudflare Worker (workers/submit-proxy)
  index.html            ── Start ──►      POST /submit
  quiz/  (funnel + IDR)  ── answers ──►      → validates email
  firms/*/questions.json                     → posts to Slack (#grip-updates or a
  config.js  (Worker URL)                       dedicated channel)
                                             → returns { ok, root_id }
```

Every answer is signed into a client-side IDR chain (`lib/idr.js`) for replay
continuity. The quiz **degrades gracefully**: if the Worker is unreachable, the
user still gets their confirmation + reference — only the Slack notify is skipped.

## Two-step deploy

**1. Frontend (this repo) — already on GitHub Pages.**
Push to `main` → Pages rebuilds. New questionnaires = a new `firms/<slug>/` folder
(a `questions.json` + `config.json`), reachable at `/ultralead/quiz?firm=<slug>`.

**2. The Slack Worker (once):**
```bash
cd workers/submit-proxy
npx wrangler deploy
npx wrangler secret put SLACK_BOT_TOKEN     # the CodeTonight Slack bot token
```
Copy the printed `https://ultralead-submit.<subdomain>.workers.dev` URL into
`config.js` and commit. To route to a dedicated Slack channel, set `SLACK_CHANNEL`
in `workers/submit-proxy/wrangler.toml` (create the channel, `/invite @grip`, copy
its `C…` ID).

Note: `.nojekyll` is required so GitHub Pages serves the `firms/_default/` folder
(Jekyll ignores `_`-prefixed paths otherwise).
