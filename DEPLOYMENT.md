# GitHub Pages + Apps Script

GitHub Pages serves the React site. The browser calls an Apps Script web app over HTTP; Apps Script reads and writes the existing Papers tab and searches DBLP/Crossref. No spreadsheet migration or new database is needed.

## 1. Deploy the API

```sh
npm ci
npm run build:api
```

The output is `dist/apps-script/Code.gs` and `dist/apps-script/appsscript.json`. **Index.html is no longer part of the Apps Script package.**

1. Open the existing spreadsheet → **Extensions → Apps Script**. Replace **Code.gs** with the generated file and save. Keep the current spreadsheet and the `SPREADSHEET_ID` script property. The existing manifest already has the required scopes; the generated manifest is included for new installations.
2. For a new installation only, paste the generated manifest (enable it under **Project Settings**) and run **setupMplse** from the bound script editor. Authorize it. Existing installations do not need setup again. Setup preserves a compatible Papers tab.
3. Use **Deploy → New deployment → Web app**, with **Execute as: Me** and **Who has access: Anyone**. A separate deployment lets the old, versioned HTML site keep working during the transition. Keep its old Index file in the editor until the old site is retired; the API deployment does not use it.
4. Copy the new **Web app URL**. It must have the form `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`, without `/u/1/`, query parameters, or a `/dev` suffix.
5. Open that URL signed out of Google. Expect `{"apiVersion":1,"ok":true,"data":{"service":"mplse-reading-group"}}`. Then append `?action=getState` and confirm `ok: true` and your group's data. Health checks do not access the sheet; getState checks the actual connection.

If you prefer to reuse the old URL, use **Deploy → Manage deployments → Edit → New version → Deploy** instead of creating a separate deployment. That URL will immediately become an API endpoint and stop displaying the old site. Saving the source alone does not update a versioned deployment.

Anonymous access is required for this browser client, which sends no Google cookies. If your Workspace administrator disables **Anyone**, this direct GitHub Pages setup needs a different API access arrangement before it can go live. Name-only sign-in retains the existing trust model: visitors can choose any member's name and read the group's papers, votes, and attendance. The API URL is public configuration, not a password. Google sharing permissions still control direct spreadsheet editing.

## 2. Preview the connected site

Copy `.env.example` to `.env.local` and set the URL from step 1:

```dotenv
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

```sh
npm run dev
```

With that variable present, local development uses the real sheet. Restart Vite after changing it. Without the variable, local development uses the sample-data demo.

Run `npm run check:api` to check the published API's health and spreadsheet connection without signing in, voting, or suggesting a paper. As with a normal refresh, getState assigns missing IDs to manually added rows or member columns.

For a production preview:

```sh
npm run build
npm run preview
```

This creates **`dist/site/index.html`** for Pages and the separate API package. Production builds fail if the endpoint is missing or malformed; they never publish demo data by accident. `npm run build:demo` creates an explicitly isolated demo in `dist/demo`, and `npm run preview:demo` previews it.

## 3. Enable GitHub Pages

1. Push this source project, including `.github/workflows/pages.yml` and `package-lock.json`, to the intended GitHub repository. The workflow deploys from `main`; change its branch filter if your publishing branch has another name. Build output, node_modules, and `.env.local` are ignored by Git.
2. Under **Settings → Secrets and variables → Actions → Variables**, add the repository variable **APPS_SCRIPT_URL**, with the public `/exec` URL from step 1. Use a variable rather than a secret: the address is included in the browser bundle.
3. Under **Settings → Pages → Build and deployment**, select **Source: GitHub Actions**.
4. Under **Actions**, run **Deploy reading group**, or push a change to `main`. It installs dependencies, runs tests and formatting checks, checks the deployed API, builds the live frontend, and uploads only `dist/site`. An inaccessible API or an old HTML deployment blocks publication. The deploy job reports the final Pages URL.

Relative asset URLs support both `https://OWNER.github.io/REPOSITORY/` and a custom domain. The Apps Script code and manifest are outside the Pages artifact.

## 4. Check the real connection before sharing

Open the Pages URL in a normal browser and a fresh private window:

- Your actual papers appear, with no demo banner. Refresh loads changes made directly in the sheet.
- Sign in using your existing name. Confirm it reuses your column; votes and attendance stay intact.
- Add and withdraw a vote on an unscheduled paper and check the sheet cell. Check that scheduled papers still cannot be voted on.
- Search for a paper, suggest it, and check the new row and initial vote. Open its direct card link.
- Check Newest sorting and, on a later visit after another suggestion, New since last visit.

Browser identity and visit history belong to the site origin. Moving to GitHub Pages means entering your name once again and establishing a fresh visit baseline. Your existing sheet data is preserved.

Local tests cover both HTTP handlers and the browser transport, but mocked tests cannot verify Google's live CORS responses or your deployment permissions. Complete this browser check before retiring the old HTML deployment.

## Future updates

- **Frontend changes:** push to `main`; GitHub Actions updates Pages automatically. No HTML paste in Apps Script is needed.
- **API changes:** run `npm run build:api`, replace Code.gs in the editor, then update the **API** deployment with **New version → Deploy**. Its URL stays the same.
- **API URL changes:** update `APPS_SCRIPT_URL` in GitHub and run the workflow again. Update `.env.local` for local development.

## Troubleshooting

- **The API returns HTML or a Google sign-in page:** check the clean `/macros/s/.../exec` URL, anonymous access, and that the API version has actually been deployed. The frontend reports this as a connection error and never switches to the demo.
- **Health works but getState fails:** the JSON `error` describes the sheet or setup problem. Check that this is the same bound project and its `SPREADSHEET_ID` property is present. Inspect **Executions** in Apps Script for service failures.
- **The site loads but requests fail:** check the browser Network panel and the Apps Script deployment's access setting. Requests follow Google's redirect to `script.googleusercontent.com`. POST bodies use JSON with a `text/plain` content type to avoid an OPTIONS preflight. Do not change this to `application/json`, add an Authorization header, or use `no-cors`; opaque responses cannot confirm saved votes.
- **A write times out:** refresh and inspect its result before retrying. The server may have saved it even when the browser did not receive the response. The client does not automatically retry writes.
- **GitHub authentication fails locally:** run `gh auth login --hostname github.com`, or push using your usual Git client. Pages also needs to be enabled with GitHub Actions as its source.

References: [Apps Script Content Service and redirects](https://developers.google.com/apps-script/guides/content), [web app deployment settings](https://developers.google.com/apps-script/guides/web), [simple CORS requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#simple_requests), and [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
