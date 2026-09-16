# MPLSE Reading Group

A reading group board with a dark, moving paper collage. The next scheduled session comes first, followed by the paper pool. Built with React and TypeScript, hosted with its API on Cloudflare Workers and deployed from GitHub, backed by **one Google spreadsheet with one Papers tab**.

People can sign in using only a name, suggest papers through DBLP (with Crossref fallback) or a manual form, vote or withdraw a vote, search the pool, sort by votes, score, or newest, and browse past readings. The New view shows suggestions added since their last visit. Paper cards link directly to the paper when a URL is available and show a four-line preview of its Notes description, with the full text available in the details view. The organizer manages members, discussion dates, and attendance in the spreadsheet. There is no separate database, paid search API, or authentication service.

The interface uses CSS perspective, floating sheets, pointer and scroll parallax, and paper cards. The scene has a motion toggle and respects reduced-motion preferences. All papers scheduled for the next meeting appear together; later meetings appear below them. There are no category controls, landing page, or “How it works” section.

## Try it locally

Requires Node.js 22.12+ (tested with Node 26).

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. This command explicitly runs in **demo mode** with sample papers and local browser storage. Use `npm run preview` with local service-account credentials to run the production site and API against the real sheet; see [deployment instructions](DEPLOYMENT.md). The demo supports sign-in, voting, custom suggestions, search, and persistence across reloads. Sample dates are relative to the first visit. Clear the `mplse.demo.v1` local-storage entry to reset it.

Paper searches are real network requests. DBLP is tried first, then Crossref if DBLP is unavailable, returns a bot-check page, or has no results. Result sources are labeled. Vite proxies both services in development, and production searches run server-side in the Cloudflare Worker. Search by a title or author for best results; Crossref also covers fields outside computer science. If both services fail, the app shows an error and leaves manual entry available. No Google Scholar scraping is used.

## Deploy with Google Sheets and Cloudflare

Follow [DEPLOYMENT.md](DEPLOYMENT.md) to create the free accounts, share the existing sheet with a service account, test locally, and configure GitHub deployment. No manual spreadsheet migration or Apps Script setup run is needed. The backend adds missing Time and Location columns on the first successful sheet request.

Cloudflare serves the frontend in dist/site and a same-origin /api endpoint. The Worker talks directly to the Google Sheets API, avoiding Apps Script's ContentService redirects and browser Google-account sessions. A free-tier Durable Object coordinates concurrent sheet operations; application data stays in the sheet. Google credentials live in encrypted Worker secrets and never enter the browser bundle.

GitHub Actions deploys frontend and API changes together. Until credentials are configured, CI runs checks and skips deployment. Live builds always call /api and cannot silently become a demo. The old Apps Script source is retained for reference; see [the previous failure investigation](APPS_SCRIPT_HISTORY.md).

## The single-sheet layout

Keep the first eleven columns in this order. After Date, the Time and Location columns can appear among the member columns. Member columns can be renamed, reordered, added, or removed.

| Column  | Header        | Purpose                                                                                                    |
| ------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| A       | ID            | Stable paper identity. Generated for new rows with a title; leave blank when adding a paper manually.      |
| B       | Title         | Required paper title. A row without a title is ignored.                                                    |
| C       | Authors       | Author names.                                                                                              |
| D       | Year          | Publication year.                                                                                          |
| E       | Venue         | Conference, journal, or other source.                                                                      |
| F       | URL           | Complete HTTP/HTTPS link to the paper.                                                                     |
| G       | Topic         | Legacy column, unused by the interface. Keep its header for compatibility; new suggestions leave it blank. |
| H       | Notes         | Why someone suggested it.                                                                                  |
| I       | Suggested by  | Stable member ID, filled by the app. Can be blank on manual additions.                                     |
| J       | Added         | ISO creation timestamp, filled by the app.                                                                 |
| K       | Date          | Discussion date, formatted `YYYY-MM-DD`. Blank = in the voting pool.                                       |
| After K | Time          | Optional start time, such as `14:30` or `2:30 PM`, in the spreadsheet time zone.                           |
| After K | Location      | Optional room/building or meeting location.                                                                |
| After K | Person’s name | That person’s vote and attendance for each paper.                                                          |

The app adds missing Time and Location headers at the right edge of the used sheet, without moving or overwriting existing columns. You can move these entire columns beside Date if you prefer; keep their headers and notes. The Time column is formatted as a time. Existing member columns with identity notes remain members even if someone is named Time or Location. For new member headers, use a distinct name rather than these reserved scheduling labels.

Each member cell accepts:

| Value | Voted for the paper | Attended its discussion |
| ----- | ------------------- | ----------------------- |
| blank | No                  | No                      |
| V     | Yes                 | No                      |
| A     | No                  | Yes                     |
| VA    | Yes                 | Yes                     |

**Preserve votes when recording attendance:** change `V` to `VA` when a voter attends. Use `A` for an attendee who did not vote. Retain `V` for a voter who missed the meeting. The reader also understands `1`/`TRUE` as votes and `0`/`FALSE` as blank, though the app’s dropdowns use V/A/VA.

- **Schedule a discussion:** enter a date in K, plus optional Time and Location. The paper leaves the pool immediately and voting closes, preserving its selection history. Multiple papers share one session per date. Fill Time/Location on one of that day's paper rows, or repeat identical values on each; conflicting values stop the calendar feed with an explanatory error.
- **Record attendance:** mark A or VA on the dated row. For several papers discussed in one meeting, attendance on any one of their rows counts for that date.
- **Reopen voting:** clear the date. A past or scheduled date can be changed directly in the sheet.
- **Rename a person:** edit their column header and keep the header note. The note holds a stable ID so their votes and browser sign-in survive renames.
- **Add a person:** type their name in an unused column header after Date. The app assigns an identity note on its next refresh. To copy an existing member column for a new person, clear the copied header note and all copied votes/attendance.
- **Remove a person:** delete their entire column. Their votes no longer count. A returning visitor can rejoin under a new identity because registration is intentionally open.
- **Remove or edit a paper:** edit or delete its row. Removing a past paper also removes its contribution to scoring history. Archive it by preserving the row and date if you want that history retained.
- **Direct sheet edits:** the app refreshes every 30 seconds while visible, on returning to the tab, or when Refresh is pressed. One Cloudflare Durable Object serializes app reads and writes. Direct edits in Google Sheets do not acquire that lock; avoid rearranging rows or columns in the middle of active app writes.

Votes and scores are calculated from the sheet on each refresh. They are displayed on the site; there are no computed total columns to maintain in the sheet.

## Subscribe to sessions

The production site serves a public calendar at `/calendar.ics`. Click **Subscribe** beside Next session to copy its URL. In Google Calendar on a computer, choose **Other calendars → + → From URL**, paste it, then **Add calendar**. This is a subscription, so future sheet edits are picked up when Google refreshes the calendar; importing a downloaded file would only add a snapshot. [Google's subscription instructions](https://support.google.com/calendar/answer/37100?hl=en).

Every dated session includes all that day's papers and their links, the reading group website, room/location, and the group's Zoom link: <https://umich.zoom.us/j/93467587435>. Timed events last **60 minutes**. Times use **Google Sheets → File → Settings → Time zone** and account for daylight saving; subscribers see the corresponding time in their calendar's own time zone. A blank Time creates an all-day event. A blank Location uses the Zoom URL as the event location.

Past and future dated rows are included. Clearing every paper's date for a session removes it from the feed. The event identity stays the same when you edit its title, time, room, or papers; moving the date removes the old session and adds the new one. Calendar clients control refresh timing, so consult the website for last-minute changes. The local demo shows example times and rooms but does not offer a live subscription.

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

**The pool defaults to Newest.** The Sort dropdown switches between Newest, Votes, and Score, including in My votes. Votes and Score use older suggestions first for ties; score sorting uses full precision even though displayed scores are rounded. Newest sorts by the Added timestamp, with undated suggestions last. The archive stays sorted by discussion date.

**New since last visit:** pool cards added after the previous visit receive a New badge. The New tab filters to those papers and initially sorts newest first; voting and search still work there. The cutoff is captured when the page opens and stays fixed while browsing, including during votes and refreshes. Only a successful refresh while the page is visible saves a timestamp for the next visit, using the request's start time so arrivals during loading aren't skipped. First visits establish a baseline without marking the existing backlog as new. This browser history is independent of sign-in and does not sync across devices or browser profiles; private browsing or clearing site storage resets it. Demo and live history are stored separately. Missing or invalid Added timestamps are never marked new.

## Development and verification

```sh
npm test             # Domain, Sheets/OAuth, React, legacy API, and real Workers runtime tests
npm run build        # Type checks + production frontend + Wrangler deployment dry run
npm run preview      # Build and serve the connected app locally on port 8787
npm run build:demo   # Explicit standalone demo in dist/demo
npm run format       # Format source files
npm run format:check # Check formatting
npm run check:api    # Check local Worker health and real sheet connection
npm run check:search # Optional real-network search smoke check
```

Tests cover scoring, newest/visit behavior, card links, paper forms, action validation, OAuth signing, preserved spreadsheet identities, date/timezone conversion, literal text writes, attendance preservation, scheduled voting, and uncertain-write errors. A Miniflare integration test runs the real Workers runtime with simulated Google responses and concurrent sign-ins, votes and suggestions. It verifies asset/API routing and actual Durable Object serialization. Mocked Google tests cannot verify service-account sharing, live Google latency, or the final browser layout; check the real deployment before switching the group's link.

Key files:

- src/App.tsx, src/PaperScene.tsx, src/styles.css: interface and artwork.
- src/api.ts, src/http-api.ts: explicit demo and same-origin live transport.
- src/domain.ts, src/catalogs.ts: validation, scores, dates, paper search.
- worker/index.ts: HTTP routing and the sheet coordinator.
- worker/commands.ts: action allowlist, request limits and validation.
- worker/google.ts: service-account OAuth and authenticated Sheets requests.
- worker/sheets.ts: sheet decoding and atomic, narrow cell updates.
- wrangler.json: website assets, Worker entry point and free-tier coordinator.
- .github/workflows/cloudflare.yml: checks and automatic deployment.
- apps-script/: retained legacy server source, outside the Cloudflare runtime.
- ARTWORK.md: artwork provenance.

Architecture references: [Cloudflare static assets](https://developers.cloudflare.com/workers/static-assets/), [Durable Object concurrency](https://developers.cloudflare.com/durable-objects/api/state/), [Google Sheets API](https://developers.google.com/workspace/sheets/api/reference/rest), [service-account OAuth](https://developers.google.com/identity/protocols/oauth2/service-account), [DBLP](https://dblp.org/faq/How+to+use+the+dblp+search+API.html), and [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/).
