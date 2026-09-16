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

1. [Create a Cloudflare account](https://dash.cloudflare.com/sign-up), sign in, and verify your email if prompted. Open the account you want to use for the reading group.
2. **Leave the Workers plan at its default.** New accounts already have access to **Workers Free**, the $0 plan; there is no separate “activate Free” step. “Keep Workers Free” just means skip any offer to upgrade to **Workers Paid**, which starts at $5/month. This refers to the Workers subscription, not a domain's Free/Pro/Business plan. See [Cloudflare's Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
3. Open **Workers & Pages** in the dashboard. We use the included **workers.dev** address, so you do not need to buy a domain, add a website/domain to Cloudflare, or change DNS settings.
4. Look for **Your subdomain**. If Cloudflare asks you to choose one, enter an available name and confirm it. If a name is already assigned, you can keep it or select **Change** beside it. This is the account's part of the website address: choosing `mplse` (if available) would give this app **https://mplse-reading-group.mplse.workers.dev**. The `mplse-reading-group` part is already set in this repository. See [Cloudflare's subdomain instructions](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).
5. In **Workers & Pages → Account Details**, copy **Account ID**. Alternatively, press **Cmd+K** on Mac or **Ctrl+K** on Windows/Linux, search for **Copy account ID**, and select that result. Save this 32-character hexadecimal value for section 3 below. See [Cloudflare's Account ID instructions](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/).

That is all “initial Workers setup” means here: an account, its workers.dev subdomain, and its Account ID. **The GitHub Actions workflow in section 3 creates the actual Worker and uploads the app.** You can leave the application list empty for now; you do not need to create a sample Worker, create a Pages project, or import the repository through Cloudflare's dashboard.

## 2. Connect and test locally

Requires Node.js 22.12+ and npm. From this repository:

```sh
npm ci
npm run setup:local -- '/path/to/downloaded-service-account.json' 'https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit'
npm run preview
```

Run the setup command as **one line**, with both arguments after the `--`. Replace `/path/to/downloaded-service-account.json` with the full path to the JSON key you downloaded (for example, `/Users/matt/Downloads/reading-group-key.json`). Replace the entire example sheet URL with the actual URL copied from your browser. Keep quotes around both values so spaces in filenames and special characters in URLs are handled correctly. Running just `npm run setup:local` prints usage instructions; it does not prompt for the missing values.

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

### 3a. Create the Cloudflare deployment token

This token lets GitHub upload the website and API to your Cloudflare account.

1. Open [Cloudflare → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens) while signed in. Click **Create Token**.
2. Find **Edit Cloudflare Workers** in the template list and click **Use template** beside it. This pre-fills the permissions; it does not create or deploy a Worker yet.
3. Fill in the token form as follows:

| Field                       | What to enter/select                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token name                  | `MPLSE GitHub deployment` — a label to help you recognize it later.                                                                                            |
| Permissions                 | Keep the template's **Account** and **User** permissions. Remove its **Zone → Workers Routes → Edit** row for this workers.dev-only deployment.                |
| Account Resources           | Select **Include → Specific account → your Cloudflare account's name**. This is the account you opened in section 1; it may be named after your email address. |
| Zone Resources              | No zone is needed after removing the Zone permission. A zone means a custom domain managed in Cloudflare; workers.dev is provided by Cloudflare.               |
| Client IP Address Filtering | Leave blank. GitHub's deployment runs on GitHub's servers, not your laptop's IP address.                                                                       |
| TTL / expiration            | Leave the optional dates blank for ongoing deployments. If you choose an expiration date, replace the GitHub secret before it expires.                         |

4. Click **Continue to summary**, check that only your intended account is included, then click **Create Token**.
5. Copy the generated token value. Cloudflare shows it only once; keep this page open until you have saved it in GitHub below. Copy the token itself, not its name or the example curl command.

The template grants permissions to act on Workers; **Account Resources** limits which account those permissions apply to. See Cloudflare's [token creation instructions](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), [template permissions](https://developers.cloudflare.com/fundamentals/api/reference/template/), and [Workers route permissions](https://developers.cloudflare.com/workers/authorization/workers/#routes-and-custom-domains).

### 3b. Save that token in GitHub

1. Open [this repository's Actions secrets settings](https://github.com/Negabinary/reading-group/settings/secrets/actions). The navigation path is **reading-group → Settings → Secrets and variables → Actions**.
2. On the **Secrets** tab, click **New repository secret**.
3. In **Name**, enter exactly `CLOUDFLARE_API_TOKEN`.
4. In **Secret**, paste the token value you just copied from Cloudflare, without quotation marks or an `Authorization: Bearer` prefix.
5. Click **Add secret**. You should now see `CLOUDFLARE_API_TOKEN` in the repository secrets list. The value stays hidden. If that name already exists, use its edit button to replace the value.

Choose a **repository secret**, not a repository variable or an environment secret. This is where our setup helper and workflow expect the token. [GitHub's secret instructions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#creating-secrets-for-a-repository) show the same fields.

If you prefer the terminal, the equivalent command is `gh secret set CLOUDFLARE_API_TOKEN` from this repository. Paste the token at its prompt, then press Enter. Use either the browser or terminal method once.

### 3c. Upload the Google settings and enable deployment

First finish **section 2**: `npm run setup:local -- ...` must have succeeded and created `secrets.local.json`. That file supplies the Google credentials automatically; this step does not ask you to paste the private key again.

1. Open a terminal in this repository. If the preview server is still running, open a second terminal. Run:

```sh
cd /Users/matt/git/reading-group
gh auth status
```

If GitHub CLI reports that you are not logged in, run `gh auth login` and sign in to **GitHub.com** using the browser, with an account that can manage this repository's settings.

2. Copy your **Cloudflare Account ID** from **Workers & Pages → Account Details**. This is the 32-character ID from section 1, not the API token, email address, or workers.dev subdomain.
3. Run this as one command, replacing `YOUR_CLOUDFLARE_ACCOUNT_ID` with that ID:

```sh
npm run setup:github -- YOUR_CLOUDFLARE_ACCOUNT_ID
```

The helper checks that the Cloudflare token was saved, uploads the two Google settings from `secrets.local.json`, then sets the account ID to enable future deployments. It uses your existing gh login and does not print credential values. Success prints **GitHub secrets and account ID configured. No credential values were printed.** It does not start a deployment by itself.

4. To check the result in GitHub, the **Secrets** tab should contain these three secret names, and the **Variables** tab should contain the account ID:

| GitHub setting              | Kind                | Value                              |
| --------------------------- | ------------------- | ---------------------------------- |
| CLOUDFLARE_ACCOUNT_ID       | Repository variable | Cloudflare account ID              |
| CLOUDFLARE_API_TOKEN        | Repository secret   | Scoped Cloudflare deployment token |
| GOOGLE_SHEET_ID             | Repository secret   | Spreadsheet ID                     |
| GOOGLE_SERVICE_ACCOUNT_JSON | Repository secret   | Service account JSON key           |

If you prefer to configure everything through GitHub's UI, add the two Google settings using **Secrets → New repository secret**, then add the account ID using **Variables → New repository variable**. For `GOOGLE_SERVICE_ACCOUNT_JSON`, paste the full contents of the original downloaded Google JSON key file, including its outer braces. For `GOOGLE_SHEET_ID`, use the part of the sheet URL between `/d/` and `/edit`. Add `CLOUDFLARE_ACCOUNT_ID` last. This replaces running `setup:github`.

### 3d. Start the first deployment

Once the settings above are saved, run this from the repository:

```sh
gh workflow run cloudflare.yml --ref main
```

Or use the browser: open [Actions → Test and deploy reading group](https://github.com/Negabinary/reading-group/actions/workflows/cloudflare.yml), click **Run workflow**, select branch **main**, and click the green **Run workflow** button. [GitHub's manual workflow instructions](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) show this flow.

Open the new run. The **check** job runs first, followed by **deploy**. Deployment uploads the website and Worker, configures encrypted Worker secrets, and checks the deployed API against the real sheet. The **cloudflare** environment links to the new site. If **deploy** is skipped, check that `CLOUDFLARE_ACCOUNT_ID` exists under repository **Variables** and that you ran the workflow on **main**.

Subsequent pushes to main update the website and API together. No Apps Script copy/paste is needed.

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
