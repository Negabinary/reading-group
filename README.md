# MPLSE Reading Group

A reading group board with a dark, moving paper collage. The next scheduled session comes first, followed by the paper pool. Built with React and TypeScript, hosted on GitHub Pages, with a Google Apps Script HTTP API backed by **one Google spreadsheet with one Papers tab**.

People can sign in using only a name, suggest papers through DBLP (with Crossref fallback) or a manual form, vote or withdraw a vote, search the pool, sort by votes, score, or newest, and browse past readings. The New view shows suggestions added since their last visit. Paper cards link directly to the paper when a URL is available. The organizer manages members, discussion dates, and attendance in the spreadsheet. There is no separate database, paid search API, or authentication service.

The interface uses CSS perspective, floating sheets, pointer and scroll parallax, and paper cards. The scene has a motion toggle and respects reduced-motion preferences. All papers scheduled for the next meeting appear together; later meetings appear below them. There are no category controls, landing page, or “How it works” section.

## Try it locally

Requires Node.js 22.12+ (tested with Node 26).

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Without `VITE_APPS_SCRIPT_URL`, local development runs in **demo mode** with sample papers and local browser storage. Set that variable in `.env.local` to use the real Apps Script API; see [deployment instructions](DEPLOYMENT.md). The demo supports sign-in, voting, custom suggestions, search, and persistence across reloads. Sample dates are relative to the first visit. Clear the `mplse.demo.v1` local-storage entry to reset it.

Paper searches are real network requests. DBLP is tried first, then Crossref if DBLP is unavailable, returns a bot-check page, or has no results. Result sources are labeled. Vite proxies both services in development, and production searches run server-side in Apps Script. Search by a title or author for best results; Crossref also covers fields outside computer science. If both services fail, the app shows an error and leaves manual entry available. No Google Scholar scraping is used.

## Deploy or migrate from Apps Script hosting

Follow [DEPLOYMENT.md](DEPLOYMENT.md) to deploy the API, configure the public endpoint, and enable the included GitHub Pages workflow. Keep the existing sheet, member columns, votes, attendance, and script property; no data migration is required. A separate API deployment can run alongside the old HTML deployment during the transition.

The frontend build is `dist/site/index.html`. The API package contains `dist/apps-script/Code.gs` and `appsscript.json`; it no longer includes Index.html. Frontend changes deploy through GitHub Actions, while API changes require updating the Apps Script deployment. Production builds require a valid endpoint and cannot silently become a demo.

## The single-sheet layout

Keep the first eleven columns in this order. Member columns follow Date; they can be renamed, reordered, added, or removed.

| Column   | Header        | Purpose                                                                                                    |
| -------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| A        | ID            | Stable paper identity. Generated for new rows with a title; leave blank when adding a paper manually.      |
| B        | Title         | Required paper title. A row without a title is ignored.                                                    |
| C        | Authors       | Author names.                                                                                              |
| D        | Year          | Publication year.                                                                                          |
| E        | Venue         | Conference, journal, or other source.                                                                      |
| F        | URL           | Complete HTTP/HTTPS link to the paper.                                                                     |
| G        | Topic         | Legacy column, unused by the interface. Keep its header for compatibility; new suggestions leave it blank. |
| H        | Notes         | Why someone suggested it.                                                                                  |
| I        | Suggested by  | Stable member ID, filled by the app. Can be blank on manual additions.                                     |
| J        | Added         | ISO creation timestamp, filled by the app.                                                                 |
| K        | Date          | Discussion date, formatted `YYYY-MM-DD`. Blank = in the voting pool.                                       |
| L onward | Person’s name | That person’s vote and attendance for each paper.                                                          |

Each member cell accepts:

| Value | Voted for the paper | Attended its discussion |
| ----- | ------------------- | ----------------------- |
| blank | No                  | No                      |
| V     | Yes                 | No                      |
| A     | No                  | Yes                     |
| VA    | Yes                 | Yes                     |

**Preserve votes when recording attendance:** change `V` to `VA` when a voter attends. Use `A` for an attendee who did not vote. Retain `V` for a voter who missed the meeting. The reader also understands `1`/`TRUE` as votes and `0`/`FALSE` as blank, though the app’s dropdowns use V/A/VA.

- **Schedule a discussion:** enter a date in K. The paper leaves the pool immediately and voting closes, preserving its selection history. Multiple papers can share one date.
- **Record attendance:** mark A or VA on the dated row. For several papers discussed in one meeting, attendance on any one of their rows counts for that date.
- **Reopen voting:** clear the date. A past or scheduled date can be changed directly in the sheet.
- **Rename a person:** edit their column header and keep the header note. The note holds a stable ID so their votes and browser sign-in survive renames.
- **Add a person:** type their name in an unused column header after Date. The app assigns an identity note on its next refresh. To copy an existing member column for a new person, clear the copied header note and all copied votes/attendance.
- **Remove a person:** delete their entire column. Their votes no longer count. A returning visitor can rejoin under a new identity because registration is intentionally open.
- **Remove or edit a paper:** edit or delete its row. Removing a past paper also removes its contribution to scoring history. Archive it by preserving the row and date if you want that history retained.
- **Direct sheet edits:** the app refreshes every 30 seconds while visible, on returning to the tab, or when Refresh is pressed. Google Apps Script locks serialize app writes. Direct edits in Google Sheets do not acquire those locks; avoid rearranging rows or columns in the middle of active app writes.

Votes and scores are calculated from the sheet on each refresh. They are displayed on the site; there are no computed total columns to maintain in the sheet.

## Scoring

The default policy is explicit and adjustable in `src/domain.ts`:

1. Consider the **last six distinct discussion dates before today** in the sheet’s timezone. Today’s and future meetings do not affect weights yet.
2. Weight those meetings `1, 0.75, 0.75², …`, newest first.
3. For each current member, calculate their weighted **attendance rate** and **selection rate**. A selection means they voted for at least one paper discussed that date, whether or not they attended.
4. Their vote weight is:

   ```text
   (1 + 3 × attendance_rate) / (1 + 2 × selection_rate)
   ```

5. A paper’s score is the sum of the weights of its current voters. With no past meetings, everyone has weight 1.

A regular attendee whose choices have not been selected gets more weight. Someone whose choices were often selected gets less. Attendance and selections on several papers discussed on the same date count once. Removed members are excluded. New members start with no recorded attendance or selections and therefore weight 1.

**The pool defaults to raw vote count, descending.** The Sort dropdown switches between Votes, Score, and Newest, including in My votes. Votes and Score use older suggestions first for ties; score sorting uses full precision even though displayed scores are rounded. Newest sorts by the Added timestamp, with undated suggestions last. The archive stays sorted by discussion date.

**New since last visit:** pool cards added after the previous visit receive a New badge. The New tab filters to those papers and initially sorts newest first; voting and search still work there. The cutoff is captured when the page opens and stays fixed while browsing, including during votes and refreshes. Only a successful refresh while the page is visible saves a timestamp for the next visit, using the request's start time so arrivals during loading aren't skipped. First visits establish a baseline without marking the existing backlog as new. This browser history is independent of sign-in and does not sync across devices or browser profiles; private browsing or clearing site storage resets it. Demo and live history are stored separately. Missing or invalid Added timestamps are never marked new.

## Development and verification

```sh
npm test             # Domain, Apps Script handler, and React interaction tests
npm run build        # Type-check + live site + API bundle (requires .env.local)
npm run build:api    # API package only; no frontend URL required
npm run build:demo   # Explicit standalone demo in dist/demo
npm run format       # Format source files
npm run format:check # Check formatting
npm run check:search # Optional real-network search smoke check
```

Tests cover the HTTP action allowlist, request validation, cross-origin request options, API and connection errors, the score policy, sorting modes, returning visits, direct paper links, next-session grouping, empty schedules, motion preferences, date boundaries, data validation, DBLP response shapes, idempotent votes, attendance preservation, scheduled-vote protection, renamed/moved/removed members, duplicate suggestions, name persistence, error recovery, and both suggestion flows. Apps Script service calls are tested with an in-memory sheet double, and React interactions run in jsdom. These checks do not substitute for a final browser layout review and a real Google deployment check.

Key files:

- `src/App.tsx`: pages, dialogs, and interactions.
- `src/PaperScene.tsx`: the next session and its moving paper scene.
- `src/styles.css`: responsive visual design, reduced-motion support, and focus styles.
- `src/api.ts`: live API and explicit local demo adapter.
- `src/http-api.ts`: HTTP transport with readable JSON responses and connection errors.
- `src/domain.ts`: shared validation, votes, DBLP normalization, and scoring.
- `src/catalogs.ts`: paper-search providers and Crossref normalization.
- `apps-script/server.ts`: sheet-backed API; app writes use script locks and escape spreadsheet formulas.
- `apps-script/http.ts`: JSON GET/POST entry points with an explicit action allowlist.
- `scripts/build-apps-script.mjs`: bundles the API into Code.gs and its manifest.
- `.github/workflows/pages.yml`: verifies, builds, and deploys the frontend to GitHub Pages.
- `ARTWORK.md`: generated artwork provenance and full prompt.

Architecture references: [Google Apps Script web apps](https://developers.google.com/apps-script/guides/web), [Content Service](https://developers.google.com/apps-script/guides/content), [script locks](https://developers.google.com/apps-script/reference/lock/lock-service), [DBLP search API](https://dblp.org/faq/How+to+use+the+dblp+search+API.html), and [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/).
