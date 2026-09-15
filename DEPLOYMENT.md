# Google Sheets + Cloudflare + GitHub

Cloudflare Workers serves both the website and its same-origin /api endpoint. It calls the Google Sheets API directly using a service account. GitHub stores the source and deploys both parts together. Visitors do not authenticate with Google, and Apps Script is no longer in the request path.

The existing **Papers** tab is used as-is. Keep its column order, member header notes, votes, attendance, and paper IDs. **Do not re-run setupMplse or replace the spreadsheet.**

## 1. Create the two free accounts/project connections

### Google

1. Open [Google Cloud Console](https://console.cloud.google.com/projectcreate) and create a project such as **MPLSE Reading Group**. This setup needs the Sheets API, not Cloud Run or a billing account.
2. With that project selected, [enable the Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com).
3. Open [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts), choose **Create service account**, and name it **reading-group**. Skip granting project roles and skip granting users access to the service account. Sheet access is granted by sharing the document in the next step.
4. Open the service account → **Keys → Add key → Create new key → JSON**. Keep the downloaded file outside this repository. Do not paste the private key into chat, the frontend, or an Apps Script file.
5. In the **existing Google Sheet**, click **Share** and add the service account's email as **Editor**. Keep the sheet's general access restricted. The API can read the group's data without making the document itself publicly editable.
6. Copy the sheet's URL. Its spreadsheet ID is between /d/ and /edit; the gid is a tab ID and is not the spreadsheet ID.

If an institution-managed Google project prohibits service-account keys or external sharing, that restriction needs resolving with its administrator or an appropriate independent project. Do not enable domain-wide delegation.

### Cloudflare

1. [Create a Cloudflare account](https://dash.cloudflare.com/sign-up) and keep **Workers Free**. No domain purchase is needed: the app gets a workers.dev address.
2. In **Workers & Pages**, complete the initial Workers setup and choose a workers.dev subdomain if prompted.
3. Copy the **Account ID** from the dashboard. It is a 32-character hexadecimal value. Do not create a separate Pages project or enable a paid Workers subscription.

## 2. Connect and test locally

Requires Node.js 22.12+ and npm. From this repository:

```sh
npm ci
npm run setup:local -- /path/to/downloaded-service-account.json 'https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit'
npm run preview
```

The helper creates ignored, private-permission files:

- **.dev.vars**: credentials used by local Wrangler.
- **secrets.local.json**: the same values in Wrangler's secret-upload format.

Open **http://127.0.0.1:8787**. This is the real Cloudflare runtime serving the production frontend locally, connected to the real sheet. Changes made here affect that sheet. Until credentials are configured, it shows a connection/setup error rather than demo data.

In another terminal:

```sh
npm run check:api
```

This checks health and the actual sheet connection, reports timings and counts, and makes no votes or suggestions. Like a normal refresh, it assigns stable IDs to manually added rows or member headers that lack them.

For frontend work with automatic reload, run **npm run dev:api** and **npm run dev:live** in separate terminals. Plain **npm run dev** explicitly starts the isolated sample-data demo.

Old VITE_APPS_SCRIPT_URL settings and .env.local do not affect the new live frontend.

## 3. Connect GitHub deployment

The workflow is **.github/workflows/cloudflare.yml**. Push it with the source and lockfile. Every pull request and push to main runs tests, type checks, formatting, and a deployment dry run. Production deployment remains skipped until CLOUDFLARE_ACCOUNT_ID is set.

1. In Cloudflare, open [My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens) and create a token using **Edit Cloudflare Workers**. Limit its account resources to this reading group's Cloudflare account. For this workers.dev deployment, no custom domain or DNS-edit setup is needed.
2. In [GitHub repository Actions secrets](https://github.com/Negabinary/reading-group/settings/secrets/actions), add **CLOUDFLARE_API_TOKEN**. Alternatively run **gh secret set CLOUDFLARE_API_TOKEN** and enter the token at its prompt.
3. After running setup:local, upload the two Google settings and enable the deployment:

```sh
npm run setup:github -- YOUR_CLOUDFLARE_ACCOUNT_ID
gh workflow run cloudflare.yml --ref main
```

The helper uses your existing gh login, sends secrets through standard input, and does not print credential values. It configures:

| GitHub setting              | Kind                | Value                              |
| --------------------------- | ------------------- | ---------------------------------- |
| CLOUDFLARE_ACCOUNT_ID       | Repository variable | Cloudflare account ID              |
| CLOUDFLARE_API_TOKEN        | Repository secret   | Scoped Cloudflare deployment token |
| GOOGLE_SHEET_ID             | Repository secret   | Spreadsheet ID                     |
| GOOGLE_SERVICE_ACCOUNT_JSON | Repository secret   | Service account JSON key           |

You can also enter these settings through GitHub's UI. GOOGLE_SERVICE_ACCOUNT_JSON must be the JSON object from the downloaded file, not its filename or just its private_key field.

4. Watch **Actions → Test and deploy reading group**. After checks pass, it uploads the website and Worker, configures encrypted Worker secrets, and checks the deployed API against the real sheet. The **cloudflare** environment links to the new site.
5. Subsequent pushes to main update the website and API together. No Apps Script copy/paste is needed.

Do not upload secrets.local.json, .dev.vars, or the downloaded key as GitHub source files or build artifacts. Credentials are used only by the Worker; the browser bundle contains no Google credentials.

### Optional first deployment from your terminal

GitHub Actions is the normal deployment path. To deploy locally instead:

```sh
npx wrangler login
npm run deploy
npx wrangler secret bulk secrets.local.json
npm run check:api -- https://mplse-reading-group.YOUR_SUBDOMAIN.workers.dev
```

The first deploy creates the Worker; it reports that the sheet connection is awaiting setup until secret upload finishes. Configure the GitHub settings above for later automatic updates.

## 4. Verify and switch the group's link

Before retiring the old deployment, check the new Cloudflare URL in a normal browser with multiple Google accounts and in a private window:

- Actual papers appear, with no demo banner. Direct sheet edits appear after Refresh.
- Signing in with your existing name reuses your member column.
- Adding/withdrawing a vote preserves attendance; dated papers cannot be voted on.
- Search, suggestions, the initial suggestion vote, and direct paper links work.
- Newest and New since last visit behave as expected.

Browser sign-in and visit history are tied to the website origin. People enter their existing name once on the new site, and their first visit establishes a new visit baseline. Their sheet data and identity remain intact.

The old GitHub Pages workflow has been removed so a Cloudflare /api build cannot accidentally be published there. The already-published Pages site remains available until you replace it or disable Pages. Share the new workers.dev URL after verification. Then archive the old Apps Script web-app deployments under **Deploy → Manage deployments** and retire or redirect the old Pages site.

Avoid running both backends for ongoing writes: Apps Script's lock and Cloudflare's coordinator cannot lock each other. Direct structural edits in Sheets also bypass the coordinator; avoid rearranging rows/columns during active app writes.

## What can the API do?

Public actions remain deliberately limited:

| Action       | Access                                                                  |
| ------------ | ----------------------------------------------------------------------- |
| health       | Service check; no sheet access                                          |
| getState     | Read Papers; assign missing paper IDs/member identity notes             |
| searchPapers | Search DBLP, then Crossref                                              |
| signIn       | Reuse or create a member column                                         |
| setVote      | Change one member's vote on an unscheduled paper, preserving attendance |
| suggestPaper | Append a validated, nonduplicate paper and its initial vote             |

There is no public action to delete rows, change discussion dates, change attendance, execute arbitrary Sheets requests, or run setup. Text writes use explicit string values, so a submitted title beginning with = is not a formula.

Name-only identity is still a trust-based system: a visitor can choose somebody else's name. Public API responses include member names, papers, votes and attendance. Registration and suggestions remain open; same-origin JSON checks stop unrelated browser forms but do not authenticate users or stop a custom bot. Input size limits, duplicate validation, and platform quotas remain in place.

The service-account credential itself is more powerful than the API: Editor sharing grants it editing access to the shared spreadsheet. Share only the intended sheet with that account. Organizers can revoke access by removing that sharing entry or disabling its key.

## Cost and reliability

Use **Workers Free**. Static assets are free; Worker and Durable Object requests have free daily allowances. The included SQLite-backed Durable Object is only a coordinator for concurrent Sheets operations: it stores no papers, votes, members, or SQL rows. There is no database to administer. Free-plan limits reject excess requests rather than automatically upgrading the account. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

The [Sheets API's standard quota](https://developers.google.com/workspace/sheets/api/limits) is free: normally 60 reads and 60 writes per minute for this one service account. Each refresh uses one read; each mutation uses one read and one atomic batch write. A refresh that repairs missing IDs also uses one write. With 30-second polling, roughly 30 continuously visible tabs would use the read allowance before manual actions, so leave headroom. Google currently notes plans for paid above-quota usage later in 2026; this setup does not request higher quotas or attach billing.

All app reads and writes pass through one named coordinator per spreadsheet. This prevents concurrent member-column allocation and duplicate suggestions. Sheet responses are not cached. Only the short-lived Google OAuth token is cached to avoid signing in to Google for every refresh. Writes are never automatically retried after an uncertain response.

Direct Sheets access removes the observed Apps Script ContentService redirect failure. It still depends on Google Sheets availability and quotas; production latency and account permissions must be checked with the real deployment. [The previous investigation](APPS_SCRIPT_HISTORY.md) records why we moved.

## Troubleshooting and rollback

- **Awaiting its Google Sheets connection:** set both Worker secrets and redeploy/re-run the GitHub workflow.
- **Service account cannot access the sheet:** check the spreadsheet ID, Editor sharing to the exact service-account email, and Sheets API enablement.
- **Authentication error:** check that the key belongs to that account and has not been deleted. Rotate it by generating a new key, rerunning setup:local/setup:github, and redeploying before deleting the old key.
- **HTTP 429:** wait a minute; close unused tabs. Avoid immediate repeated refreshes.
- **Uncertain write:** Refresh and inspect the sheet before repeating the action. A lost response can happen after a committed write.
- **Health succeeds but state fails:** health checks only the Worker. The getState error identifies connection or sheet-layout issues.
- **GitHub checks pass but deploy is skipped:** set repository variable CLOUDFLARE_ACCOUNT_ID after the secrets are ready.
- **GitHub deploy succeeds but its connection check fails:** the site is deployed, but the sheet setup still needs correcting; check the error before sharing the URL.
- **Rollback:** Cloudflare's deployment history can restore a previous compatible Worker version. Sheets version history handles data restoration separately. Restoring a Worker does not roll back sheet changes. The legacy Apps Script source remains under apps-script/ for reference and can be rebuilt with npm run build:legacy.
