# Session Handoff — 2026-02-15 — Security Hardening + Reprocessing

## Completed This Session

### Committed & Pushed (7 commits: 70b0dc7..ddd4cf7)
- **Document ingestion pipeline** (`70b0dc7`) — 4 input channels (Discord attachments, inbox watcher, cloud share links, Google Drive poller), file text extraction, document-aware categorization, user interest profiles, 22 files +2324 lines
- **Dashboard document support** (`e619967`) — file:/// URI display, new content type badges/filters/colors, authors+difficulty in table, search includes authors/concepts
- **CLAUDE.md updated** (`67ce901`) — full architecture docs reflecting document pipeline
- **URL reprocessing script** (`c878365`) — `scripts/reprocess-urls.ts` with --batch-size, --skip, --dry-run
- **Security hardening** (`ea94a79`) — 10 issues fixed:
  - SSRF protection (src/security/url-validator.ts — blocks private IPs, DNS resolution check)
  - XSS fix (renderMarkdown validates URL schemes, rel=noopener)
  - Dashboard API key auth (DASHBOARD_API_KEY env var, X-Api-Key header)
  - Rate limiting (express-rate-limit: 100/15min on /api/, 20/15min on /api/ask)
  - CORS (configurable DASHBOARD_CORS_ORIGIN)
  - Path traversal protection (src/security/path-validator.ts — all file ops validated)
  - Cloud download 50MB size limit
  - Prompt injection mitigation (interests sanitized to alphanumeric)
  - @mozilla/readability 0.5→0.6 (ReDoS fix)
  - undici override to 6.23.0 (decompression DoS fix)
- **Dashboard API key passthrough** (`4783378`) — apiFetch() wrapper, dashboard URL uses ?key= query param
- **Parallel reprocessing** (`ddd4cf7`) — --limit flag for splitting work across workers

### User Interest Profiles Set (10 users)
- aaron: AI, crypto, CBDC, psychology, ecommerce, advanced forecasting, stock market, ML, quant finance, topology
- Bortles: options trading, prediction markets, DeFi, volatility modeling, market microstructure, derivatives
- Acelogic_: AI video generation, anime AI, AI animation, Claude Code, LLMs, Anthropic, open-source AI
- glacier: market analysis, AI hardware, web design, GPU infrastructure, Anthropic, Claude Code, Google AI
- 时个中来说: AI safety, AI agents, open-source AI, privacy, age verification, Claude Code, Anthropic
- Gu✝s: AI infrastructure, data centers, automation, open models, medical imaging, speech recognition, big tech
- an Airdrop: macro economics, investing, fintech, market analysis, Warren Buffett, Berkshire Hathaway, value investing
- Mouthwash: Web3, Ethereum, DeFi, crypto trading, agent economy, autonomous agents, fee markets
- Suepaphly: AI video generation, text-to-video, generative AI, open-weight models, RLHF, jailbreaking
- Kawaii Kitten: cybersecurity, vulnerability tracking, infosec, CVE, surveillance, security research

### URL Reprocessing (running in background)
- 4 parallel workers processing 608 remaining URL links (6 already done previously)
- Workers: skip 6/158/310/462, limit 152 each, batch-size 5
- Logs: /tmp/reprocess-w1.log through /tmp/reprocess-w4.log
- ETA: ~25-30 minutes from 02:40 UTC (should complete ~03:10 UTC)
- Check progress: `grep -c "Reprocessed" /tmp/reprocess-w*.log`

## Remaining Work
- **Monitor reprocessing completion** — check logs, verify all 614 links updated
- **.github/workflows/** — committed locally but can't push (GitHub PAT lacks `workflow` scope). Either add scope to PAT or push manually via GitHub web UI
- **Live test Discord attachment flow** — drop a file in Discord channel to verify end-to-end
- **Live test cloud share links** — paste a Google Drive/Dropbox share URL in Discord
- **Dashboard API key distribution** — share the key + dashboard URL with trusted users: `http://localhost:3848/dashboard?key=JTaoGsCxuDgu2f1EAS-RU2LAoqko-gAJsdwUvF1Qk8g` (or via ngrok)
- **artvandelay, BitcoinMarty, Joe Datti** — 3 users with ≤1 link, no interest profiles set (too little data to infer)

## Known Bugs / Blockers
- **GitHub PAT lacks `workflow` scope** — can't push .github/workflows/ to remote. Need to regenerate PAT with workflow scope or push via GitHub web UI.
- **Readability 0.6 breaking change** — `article.textContent` is now nullable. Fixed with `?? ""` fallback in both scraper.ts and extractor/index.ts.
- **reprocess-urls.ts neo4j.int()** — SKIP param must be `neo4j.int()`, not bare JS number. Fixed.

## Approaches Tried & Failed
- **npm overrides for undici** — `devDependencies` override alone doesn't fix audit. Must use `overrides` field in package.json.
- **Pushing .github/workflows with current PAT** — rejected by GitHub ("refusing to allow a Personal Access Token to create or update workflow without `workflow` scope"). Used `git rebase --onto` to remove the workflow commit from push chain.

## Key Files Modified/Created
- `src/security/url-validator.ts` (NEW) — SSRF protection with DNS resolution
- `src/security/path-validator.ts` (NEW) — path traversal + filename sanitization
- `src/dashboard/server.ts` — auth middleware, rate limiting, CORS
- `src/dashboard/index.html` — apiFetch wrapper, XSS fix, document metadata display
- `src/processor/scraper.ts` — SSRF check, readability nullable fix
- `src/processor/cloud-download.ts` — SSRF check, size limit, path validation, filename sanitization
- `src/processor/claude-cli.ts` — prompt injection sanitization
- `src/extractor/index.ts` — path traversal check, readability nullable fix
- `src/inbox/watcher.ts` — filename sanitization, path validation
- `src/bot/index.ts` — interest input sanitization
- `scripts/reprocess-urls.ts` — neo4j.int fix, --limit flag for parallel workers
- `.env` — DASHBOARD_API_KEY added
- `.env.example` — DASHBOARD_API_KEY + DASHBOARD_CORS_ORIGIN documented
- `package.json` — undici override, readability upgrade, cors + express-rate-limit deps
