# ProTendr

## How it works

```
GitHub Actions (scheduled, every 6h)
  → scripts/fetch-tenders.mjs queries the TED Search API v3
    (public, no key needed: https://docs.ted.europa.eu/api/latest/)
  → filters to CPV codes + country in config/watch.json
  → writes data/tenders.json
  → commits it back to the repo
       ↓
GitHub Pages (static)
  → index.html/app.js fetch data/tenders.json client-side
  → search, sort, "new since last visit" — all in the browser
```

Nothing here has a running cost: GitHub Actions minutes and GitHub Pages hosting are both free for this workload, and there's no LLM call in this version — the PDF-extraction step that's the real differentiator for the full product ("Where the real work is" in the concepts doc) is deliberately deferred. This version only answers one question: is the raw feed, filtered to CPV codes I actually care about, worth looking at?

## Setup (one-time)

1. **Enable GitHub Pages** — repo Settings → Pages → Source: "Deploy from a branch" → Branch: `main`, folder `/ (root)`. This is a manual toggle; it isn't something a push can do.
2. **Run the poller once manually** — Actions tab → "Poll TED tenders" → Run workflow. This populates `data/tenders.json` for the first time instead of waiting for the next scheduled run.
3. Visit the Pages URL GitHub gives you (Settings → Pages, once step 1 is saved).

## Editing what it watches

Edit `config/watch.json` — CPV codes, buyer country, lookback window — and push. No code changes needed. Full CPV code list: https://simap.ted.europa.eu/web/simap/cpv

Current defaults watch Greek buyers for IT/software/data-services CPV codes, as a starting point for scouting projects rather than construction/trade work.

## Known limitations of this prototype

- **TED only.** TED covers EU-threshold notices. It does not include ΚΗΜΔΗΣ's smaller, purely-national tenders — that source needs an API access request (see the implementation-plan note in the Vault repo) and isn't wired in yet.
- **No document extraction.** Only notice-level metadata (title, buyer, CPV, value, deadline) is shown — not what's actually being asked for inside the tender documents. That's the moat for a real product, intentionally cut here.
- **Field names in `scripts/fetch-tenders.mjs` are best-effort.** They're based on published TED API examples, not a live test run (this environment's network policy blocks direct calls to `api.ted.europa.eu`, so the first real test happens when the Action runs on GitHub's infrastructure). If the first scheduled/manual run fails, check the Action log — the TED API returns a descriptive error naming any invalid field, which is a one-line fix in the `FIELDS` array.
- **Polling cadence is 6h**, not real-time — fine for browsing, not for competing on being first to see a notice.
