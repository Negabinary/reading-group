# Previous Apps Script deployment

The active deployment instructions are in [DEPLOYMENT.md](DEPLOYMENT.md). Apps Script source and its tests remain for reference and rollback; the Cloudflare application does not call it. Build the old server with `npm run build:legacy`.

The old redirect probe is available as `npm run diagnose:api -- 3`. It reads the legacy `VITE_APPS_SCRIPT_URL` from `.env.local`, performs fresh health/getState requests without Google cookies, and reports sanitized redirect timings. It never signs in, votes, or suggests papers. A normal getState can assign missing stable IDs. Do not use this probe to check Cloudflare; use `npm run check:api -- SITE_URL` instead.

### Live investigation, September 15, 2026

The existing API was probed without changing or redeploying Apps Script. One representative pair from `diagnose:api` at 15:49 UTC produced:

| Request  | script.google.com | script.googleusercontent.com | Total  |
| -------- | ----------------- | ---------------------------- | ------ |
| health   | 302 redirect      | 200 JSON                     | 1.1 s  |
| getState | 302 redirect      | 404 HTML                     | 21.2 s |

Other getState requests succeeded with the same 683-byte response (one paper and one member). The owner reported completed doGet executions and confirmed that browser failures also occurred at `script.googleusercontent.com/macros/echo`.

Failures were reproduced using Node and curl without Google cookies, including requests without the cache-busting parameter. Both HTTP/1.1 and HTTP/2 delivered successful responses; a follow-up requesting HTTP/2 also timed out, so changing HTTP version was not a verified fix. In the curl probes, DNS, connection establishment, and TLS took milliseconds; the long delay occurred waiting for the response.

This isolates the observed failure to delivery of the redirected response, but does not establish the underlying cause or a fix. A [similar Google issue report](https://issuetracker.google.com/issues/406917898/resources), “Anonymous POST fails with 302 redirect and 404 error,” was indexed as **Won’t fix (Obsolete)** when checked. It is evidence of a previously reported symptom, not confirmation that this deployment has the same bug or that there is a current service-wide outage.

References: [Apps Script Content Service and redirects](https://developers.google.com/apps-script/guides/content), [web app deployment settings](https://developers.google.com/apps-script/guides/web), [simple CORS requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#simple_requests), and [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
