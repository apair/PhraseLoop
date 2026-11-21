# PhraseLoop

Mobile-first, installable, offline-capable PWA for reviewing English corrections kept in a Google Sheet.
No account and no backend database: the sheet is the source of correction content, and review history lives
in the browser (IndexedDB). Full spec: the implementation handoff of 2026-11-20.

## Quick start

```bash
npm install
cp .env.example .env.local     # then set VITE_GOOGLE_SHEET_URL
npm run dev                    # http://localhost:5173
npm test                       # unit + persistence tests (Vitest, fake-indexeddb)
npm run build && npm run preview
```

No sheet yet? Use the local stand-in feed (200 generated rows, CORS enabled):

```bash
node scripts/dev-feed.mjs 200  # serves http://localhost:8787/sheet.csv
echo 'VITE_GOOGLE_SHEET_URL=http://localhost:8787/sheet.csv' > .env.local
```

## Configuring the sheet feed

The feed URL comes **only** from the build-time variable `VITE_GOOGLE_SHEET_URL` (read through
`import.meta.env`). There is deliberately no in-app URL setting; changing it means rebuilding and
redeploying. When it is missing, the app shows a clear configuration error and keeps working from cached data.

Spreadsheet `1VXM1taky7CuwwcHJxHaZ8pQOOXUEhFV0vLFkFaiQNXo`, worksheet `Sheet1`, columns A-E
(date, original, native alternatives, corrected sentence, explanation), headers in row 1.

> **Status: not yet verified against the real sheet.** At the time of writing,
> `https://docs.google.com/spreadsheets/d/<id>/export?format=csv` returns HTTP 401, i.e. the sheet is not
> publicly readable yet. To enable it:
> 1. In Google Sheets: *File > Share > Publish to web*, choose **Sheet1** only and format **CSV**, then publish.
> 2. Put the generated `.../pub?gid=...&single=true&output=csv` URL in `VITE_GOOGLE_SHEET_URL` and rebuild.
> 3. Open the app online once and confirm the sync shows your card count (this also confirms the feed is
>    CORS-readable from the browser). If it is not, use a read-only Apps Script web app returning CSV instead.
>
> Public read means anyone who has or discovers the published URL can view the corrections. Publishing gives
> **no edit access**. The app contains no credentials or API keys; never add any.

## Architecture

```
 Google Sheet (published CSV, read-only)
          |  fetch (network-first, no-store)
          v
  services/sync.ts --> lib/csv.ts (parse, NFC/lowercase -> SHA-256 id, dedupe)
          |  merge (never deletes history; missing rows are flagged)
          v
 +------------------------ IndexedDB (Dexie, data/db.ts) ------------------------+
 | corrections | reviewStates | reviewEvents | sessions (daily, frozen) | settings |
 +---------------------------------------------------------------------------------+
     ^  ^                        ^                         ^
     |  | lib/selection.ts       | lib/scheduling.ts       | services/backup.ts
     |  | (pure, seeded PRNG)    | (pure)                  | (export / validate / atomic import)
     |  +---- services/session.ts: getOrCreateSession, rateCard (one transaction)
     v
 React UI (ui/): Home - Review - Settings        Service worker (Workbox): app shell precache only
```

| Path | Responsibility |
| --- | --- |
| `src/types.ts` | Typed schema (`Correction`, `ReviewState`, `ReviewEvent`, `DailySession`) |
| `src/lib/` | Pure logic: dates, PRNG, identity hashing, CSV parsing, scheduling, daily selection |
| `src/data/` | Dexie database and settings (installation id, sync status) |
| `src/services/` | Sync, session/rating persistence, export/import |
| `src/ui/` | React screens |
| `tests/` | Scheduling, selection and persistence tests covering the spec's acceptance tests |

## Behaviour summary

- **Daily session** (created once per local day, then frozen): up to 90 unique cards = 30 newest (by sheet row
  order, shown every day regardless of rating) + up to 30 difficult + up to 30 older. Unused difficult slots go
  to older. Future-due cards are never forced in, so a session can be smaller than 90.
- **Difficult**: Again/Hard cards with `nextDueDate <= today`; weighted sampling without replacement with weight
  `(1 + overdueDays)^2` (`overdueWeight`), seeded by `date|installationId` so it is reproducible and testable.
- **Older**: due or never-reviewed cards ranked by days since last review with +/-20% jitter (never-reviewed
  cards count as stalest).
- **Ratings**: Again = tomorrow, Hard = 2 days, Easy = 7, 14, 30, 60, 120, 180 days (capped), on local calendar
  dates. State, event and session progress are saved in one IndexedDB transaction after every rating; reopening
  resumes at the next unanswered card.
- **Identity**: SHA-256 of the NFC-normalized, whitespace-collapsed, lowercased corrected sentence. Moving rows
  keep their history; editing a corrected sentence creates a new card; rows that disappear are flagged
  `removedFromSource` (kept for history, not scheduled) rather than deleted.
- **Sync safety**: HTTP errors, HTML responses (e.g. a login page), empty feeds, and offline failures never touch
  cached corrections; the error is shown and stored in sync status.
- **Backup**: JSON export (schema version, corrections, states, events, sessions). Import validates the schema,
  dates, ratings and that every correction id matches the hash of its sentence, shows counts, requires
  confirmation, and replaces everything in a single transaction (rolled back on failure).
- **Keyboard**: Space/Enter reveals; 1 / 2 / 3 = Again / Hard / Easy.

## Implementation defaults (not confirmed product decisions)

- Easy ladder `[7, 14, 30, 60, 120, 180]`.
- Overdue weight `(1 + overdueDays)^2`; never-reviewed older cards are treated as the stalest.
- Corrected sentence and explanation expand together.
- A previous day's unfinished session is not recoverable (a new session is generated each day).
- Session order is grouped: newest, then difficult, then older.
- Settings (installation id, sync status) are not part of the export; the imported daily session is restored.

## Deploying

`npm run build` outputs a static site in `dist/` (host over HTTPS: needed for the service worker and
`crypto.subtle`). Set `VITE_GOOGLE_SHEET_URL` in the build environment. Do not commit `.env.local`.

## Manual acceptance checklist

Run on a real phone and desktop: install the PWA, sync online once, go offline and reopen, rate 40 cards and
reopen to confirm card 41, export from one browser and import into another, and confirm an invalid file is
rejected without changing data.
