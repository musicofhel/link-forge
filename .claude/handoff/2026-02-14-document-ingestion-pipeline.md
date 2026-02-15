# Session Handoff — 2026-02-14 — Document Ingestion Pipeline

## Completed This Session

### Document Ingestion Pipeline (3 input channels)
- **Local inbox watcher** — polls `./data/inbox/` (configured to Desktop `LinkForgeInbox` folder via INBOX_DIR env). copyFile+unlink pattern for cross-filesystem (WSL↔Windows NTFS). Tested with 5 files, all processed.
- **Discord attachment handler** — drag & drop files in channel, downloads via fetch, hashes, saves to uploads, enqueues. 50MB limit. Supports PDF/DOCX/PPTX/XLSX/EPUB/TXT/MD/HTML.
- **Cloud share link detection** — Google Drive and Dropbox share URLs pasted in Discord are detected, the actual file is downloaded (not the HTML landing page), and processed through the file extraction pipeline.
- **Google Drive folder watcher** — service account polls shared folder subfolders (per-user). NOT configured (needs service account key + GDRIVE_ENABLED=true).

### File Text Extraction (`src/extractor/`)
- `officeparser` for PDF/DOCX/PPTX/XLSX (AST-based, `.toText()`)
- `epub2` for EPUB (chapter-by-chapter HTML→plaintext via jsdom)
- Raw `readFile` for TXT/MD
- Readability for HTML (same as URL scraper)
- Returns `ScrapedContent` interface — entire downstream pipeline unchanged

### Queue Schema Migrations
- 4 new columns: `source_type` (url|file), `file_name`, `file_path`, `file_hash`
- `enqueueFile()` function with synthetic `file:///<hash>/<filename>` URLs and `INSERT OR IGNORE` dedup
- Synthetic message IDs: `file:<hash>`, `gdrive:<hash>`, `inbox:<hash>` prefixes

### Document-Aware Categorization (MAJOR improvement)
- Separate `DOCUMENT_PROMPT` vs `URL_PROMPT` — documents get richer extraction
- 12k chars sent to Claude for documents (vs 4k for URLs), 10k stored in Neo4j (vs 5k)
- New fields: `key_concepts[]`, `authors[]`, `key_takeaways[]`, `difficulty` (beginner/intermediate/advanced/academic)
- Content types expanded: `research-paper`, `book`, `whitepaper`, `report`
- Key concepts merged into tags for graph discoverability
- Embeddings include key concepts for better vector search
- forge_score filter REMOVED — everything gets stored regardless of score

### User Interest Profiles
- `interests` property on User nodes in Neo4j
- Injected into categorization prompt: "this person cares about X, Y, Z"
- `/forge interests` Discord slash command for self-service
- `scripts/set-interests.ts` CLI for admin setup of others' profiles
- Aaron's interests set: AI, crypto, CBDC, psychology, ecommerce, advanced forecasting, stock market, ML, quant finance, topology
- Bortles' interests set: options trading, prediction markets, DeFi, volatility modeling, market microstructure, derivatives

### Reprocessing
- `scripts/reprocess-documents.ts` — re-categorizes all local-file docs using stored content in Neo4j
- Ran on all 4 docs: scores jumped from 0.15→0.88 (cohomology paper), 0.15→0.78 (Blitzscaling), etc.
- Before: "commentary" with no authors. After: "research-paper" with 3 authors, 10 key concepts, 4 takeaways

## Remaining Work
- **10.4171 math paper** — was filtered by old forge_score < 0.10 threshold (now removed). Queue item is reset to pending but original file was deleted. User needs to re-drop it in inbox.
- **Commit all changes** — 15 modified + 7 new files not yet committed
- **Link Forge not running** — killed for reprocessing. Restart with `cd ~/link-forge && npm run dev`
- **Test Discord attachment flow** — not tested live, only inbox watcher tested
- **Test cloud link detection** — Google Drive / Dropbox share link detection not tested live
- **Dashboard: file:/// URI display** — dashboard should show filename instead of clickable link for `file:///` URIs
- **User interest profiles for other group members** — only aaron and bortles configured. Run `set-interests.ts` for others.
- **URL prompt also updated** — broader domain coverage (not just "AI/dev tooling"), 10 tags instead of 5. Existing 564 URL-based links still have old metadata. Consider running a broader reprocess.

## Known Bugs / Blockers
- **EXDEV cross-device rename** — fixed by using `copyFile` + `unlink` instead of `rename` in inbox watcher. WSL/NTFS boundary can't atomic rename.
- **Inbox watcher reads file synchronously** (`readFileSync`) to hash before copy — large files (100MB+) could block the event loop. Consider streaming hash for very large documents.
- **OneDrive sync lag** — files deleted from inbox may briefly reappear in OneDrive cloud before sync catches up. Not a real bug, just visual confusion.
- **pino logs not captured in background** — `npm run dev > /tmp/link-forge.log 2>&1 &` only captured startup, not processing. pino may buffer or need explicit flush. Debug logs at `debug` level won't show at `info`.

## Approaches Tried & Failed
- **`officeparser.parseOfficeAsync`** — doesn't exist. The API changed: now it's `parseOffice()` returning `OfficeParserAST` with `.toText()`.
- **`import EPub from "epub2"`** — wrong. Must use named import `{ EPub }` from "epub2".
- **`fs.rename()` across WSL↔NTFS** — EXDEV error. Must copy+delete.
- **Background `npm run dev` with `&`** — output not reliably captured. Better to use tmux or run with explicit stderr redirect.
- **Running Link Forge with `NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`** — fails in zsh. Must use `source /home/musicofhel/.nvm/nvm.sh`.

## Key Files Modified
- `src/extractor/index.ts` (NEW) — file text extraction dispatcher, `isSupportedFile`, `fileHash`, `extractTextFromFile`
- `src/extractor/epub.ts` (NEW) — EPUB chapter extraction via epub2 + jsdom
- `src/inbox/watcher.ts` (NEW) — local folder poller with copyFile+unlink
- `src/gdrive/watcher.ts` (NEW) — Google Drive service account poller
- `src/gdrive/user-resolver.ts` (NEW) — map folder names to Neo4j users
- `src/processor/cloud-download.ts` (NEW) — Google Drive / Dropbox share link detection + download
- `src/processor/claude-cli.ts` — separate URL_PROMPT vs DOCUMENT_PROMPT, new schema fields, user interests injection
- `src/processor/index.ts` — file extraction branch, cloud link detection, user interest lookup, key concepts as tags, temp file cleanup
- `src/queue/schema.ts` — 4 new migration columns (source_type, file_name, file_path, file_hash)
- `src/queue/operations.ts` — `enqueueFile()` function with synthetic URLs
- `src/queue/client.ts` — auto-runs new migrations
- `src/bot/index.ts` — attachment handler, `/forge interests` command
- `src/config/index.ts` — inbox + gdrive config sections
- `src/index.ts` — inbox watcher + gdrive watcher startup/shutdown, uploads dir creation
- `src/graph/types.ts` — LinkNode: keyConcepts, authors, keyTakeaways, difficulty. UserNode: interests
- `src/graph/repositories/link.repository.ts` — stores new document fields
- `src/graph/repositories/user.repository.ts` — `getUserInterests`, `setUserInterests`
- `scripts/reprocess-documents.ts` (NEW) — re-categorize existing docs with new prompt
- `scripts/set-interests.ts` (NEW) — CLI to set user interest profiles
