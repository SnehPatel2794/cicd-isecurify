# Browser end-to-end run

`e2e/` drives the real web app in Chromium against the real API and a real MySQL/MariaDB database, using Playwright.

**What it does:** `api/scripts/e2e-prepare.ts` creates a brand-new database, applies every migration and the least-privilege grants (the API connects as a limited account, never root). `e2e/seed.ts` then uses the public API to create the first administrator, an organization, a published framework, a client admin and a vendor, and assigns one iSecurify reviewer. The journey (`e2e/journey.spec.ts`) is then done through the screens:

1. Client admin signs in, creates an engagement from the framework.
2. Assigns an item to the vendor and requests evidence.
3. Vendor sees only their own work, marks it implemented, uploads a file.
4. The iSecurify reviewer accepts it.
5. The customer admin sees the result and has no Review button on their own evidence; the engagement shows 1/3 effective.
6. Search finds the item; the vendor cannot find items that are not theirs.
7. Sign out ends the session.

**Run it:** start MySQL, then `cd e2e && npm install && npx playwright install chromium && E2E_ADMIN_URL=mysql://root:root@127.0.0.1:3306/ npx playwright test`. It uses ports 4100 (API) and 5100 (web) and the database `grc_e2e`, which it drops and recreates. A failure leaves a screenshot and trace in `e2e/test-results`.

**In CI:** the `e2e` job in `ci.yml`.

**First result:** the run found a real defect: after "Sign out" the screen stayed on the signed-in page (the session was ended on the server, but the screen did not leave). Fixed in `web/src/auth.tsx` with a regression test (`auth.test.tsx`).
