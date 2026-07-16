// ULTRALEAD submit endpoint.
//
// Point this at the Cloudflare Worker once it is deployed — `wrangler deploy`
// prints the URL, e.g. https://ultralead-submit.<your-subdomain>.workers.dev
// Then set it here and commit. Until then, the quiz still completes fully
// client-side (graceful degrade) — the Slack notify just doesn't fire.
window.ULTRALEAD_SUBMIT_URL = "https://ultralead-submit.codetonight.workers.dev/submit";
