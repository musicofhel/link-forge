# Known Issues & QC Warnings

> **WARNING**: The features below have NOT been through quality control testing.
> They were implemented and committed but never verified end-to-end in a live environment.
> Errors may exist. Use at your own risk and test thoroughly before relying on them.

## Untested Features

### Document Ingestion Pipeline (Feb 15, 2026)
- **Discord file attachments**: Drag-and-drop PDF/DOCX/PPTX/XLSX/EPUB/TXT/MD/HTML into the Discord channel. Never tested with real files — only code-reviewed.
- **Cloud share links**: Google Drive / Dropbox share URLs auto-detected and downloaded. Never tested with real share links.
- **Local inbox watcher**: `INBOX_DIR` folder polling. Never tested with cross-filesystem (WSL↔NTFS) file moves.
- **Google Drive poller**: Service account watches per-user subfolders. Never tested — requires `GDRIVE_ENABLED=true` and service account credentials.
- **File text extraction**: officeparser (PDF/DOCX/PPTX/XLSX) and epub2 (EPUB). Extraction quality not validated on real documents.

### URL Reprocessing (Feb 15, 2026)
- 608 URLs reprocessed in parallel (4 workers × 152 each). All workers completed without errors in logs, but output quality (categories, scores, embeddings) was **not spot-checked**.
- User interest profiles were set based on inferred sharing patterns — personalization accuracy not validated.

### Security Hardening (Feb 15, 2026)
- SSRF protection (DNS resolution check) — not tested against actual SSRF payloads.
- XSS fix in dashboard `renderMarkdown()` — not tested with malicious markdown input.
- Dashboard API key auth — functional but no automated tests.
- Rate limiting (100/15min general, 20/15min for /api/ask) — not load-tested.
- Path traversal protection — not fuzz-tested.
- Prompt injection sanitization — basic alphanumeric filter only, not adversarially tested.

### Dashboard Enhancements (Feb 15, 2026)
- Document metadata display (authors, difficulty, content types) — only verified via code review.
- `file:///` URI rendering as filenames — not tested with actual document entries in the graph.
- API key passthrough via `?key=` URL param — works in code but not browser-tested.

## Known Blockers

### GitHub Actions Workflow
- `.github/workflows/test.yml` is committed locally but **cannot be pushed** — the GitHub PAT lacks the `workflow` scope.
- **Fix**: Regenerate the PAT with `workflow` scope, or copy-paste the file contents into GitHub's web UI at Settings → Actions → New workflow.

### 3 Inactive Users Without Interest Profiles
- `artvandelay` (1 link), `BitcoinMarty` (1 link), `Joe Datti` (0 links) — too few links to infer meaningful interests. Profiles were not set.

### Category Deduplication Needed
- 606 categories in Neo4j — many near-duplicates (e.g., "Web Development" vs "Web Dev"). No automated merge logic yet.

### Sync Engine (Feb 22, 2026)
- Failover client, health monitor, and sync engine committed but **never tested in multi-instance setup**. Config, scheduler, export/import logic is code-complete but unvalidated.

## Recommended QC Steps

If you want to validate everything works:

1. **Drop a PDF in Discord** — verify bot reacts with ⏳, processes it, and it appears in Neo4j + dashboard
2. **Paste a Google Drive share link** — verify cloud download + processing
3. **Check reprocessing quality** — `MATCH (l:Link) WHERE l.forgeScore IS NOT NULL RETURN l.title, l.forgeScore, l.contentType LIMIT 10` in Neo4j browser
4. **Test dashboard auth** — visit `http://localhost:3848/dashboard?key=<your-key>` and verify data loads
5. **Test rate limiting** — hit `/api/ask` >20 times in 15 minutes, verify 429 response
6. **Test academic DOI fallback** — queue a link like `https://doi.org/10.1145/...` that returns 403, verify Unpaywall/Semantic Scholar fallback fires
7. **Run test suite** — `npm test` (all tests should pass)
8. **Typecheck** — `npm run typecheck` (0 errors expected)
