// The main journey, in a real browser against the real API and database:
//   client admin creates an engagement from a published framework, assigns an item to a vendor and asks for evidence;
//   the vendor marks it implemented and uploads a file; the admin reviews and accepts it; the dashboard, items list and search all agree.
import { test, expect, Page } from '@playwright/test'; import fs from 'node:fs'; import path from 'node:path'; import { PASSWORD, USERS } from './env';
const seed = () => JSON.parse(fs.readFileSync(path.join(__dirname, '.run', 'seed.json'), 'utf8')) as { orgId: string };
async function login(page: Page, email: string) { await page.goto('/login'); await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(PASSWORD); await page.getByRole('button', { name: 'Sign in' }).click(); await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible(); }
const ENG = 'FY27 E2E assessment'; let engUrl = '';

test.describe.serial('main journey', () => {
  test('the client administrator creates an engagement from the published framework', async ({ page }) => {
    await login(page, USERS.admin); await page.goto(`/org/${seed().orgId}/engagements`); await page.getByRole('button', { name: 'New engagement' }).click();
    await page.getByLabel('Engagement name').fill(ENG); await page.getByLabel('Primary framework').selectOption({ label: /E2E Framework/ as any }).catch(async () => { const opt = page.getByLabel('Primary framework').locator('option', { hasText: 'E2E Framework' }); await page.getByLabel('Primary framework').selectOption(await opt.getAttribute('value') as string); });
    await page.getByRole('button', { name: 'Create engagement' }).click(); await expect(page.getByRole('heading', { name: ENG })).toBeVisible(); await expect(page.getByText('E2E-1', { exact: true })).toBeVisible(); await expect(page.getByText('3 item(s)')).toBeVisible(); engUrl = page.url();
  });
  test('they assign an item to the vendor and request evidence', async ({ page }) => {
    await login(page, USERS.admin); await page.goto(engUrl); await page.getByLabel('Accountable for E2E-1').selectOption({ label: 'Vera Vendor' });
    await page.getByLabel('Evidence for E2E-1').click(); await page.getByRole('button', { name: 'Request evidence' }).click(); await page.getByLabel('What is needed').fill('Latest quarterly access review sign-off'); await page.getByRole('button', { name: 'Create request' }).click();
    await expect(page.getByText('Latest quarterly access review sign-off')).toBeVisible();
  });
  test('the vendor sees only their own work, marks it implemented and uploads evidence', async ({ page }) => {
    await login(page, USERS.vendor); await page.goto('/my-work'); await expect(page.getByText('E2E-1').first()).toBeVisible(); await expect(page.getByText('E2E-2')).toHaveCount(0);
    await page.goto(engUrl); await expect(page.getByText('E2E-2')).toHaveCount(0, { timeout: 15_000 }); await page.getByLabel('Readiness of E2E-1').selectOption('implemented');
    await page.getByLabel('Evidence for E2E-1').click(); await page.locator('input[type=file]').setInputFiles({ name: 'access-review-q3.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% e2e evidence\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') });
    await page.getByRole('button', { name: 'Upload file' }).click(); await expect(page.getByText(/access-review-q3\.pdf/)).toBeVisible();
  });
  test('the iSecurify reviewer (not the customer) reviews and accepts it, and every view agrees', async ({ page }) => {
    await login(page, USERS.owner); await page.goto(engUrl); await page.getByRole('tab', { name: 'Evidence' }).click(); await page.getByRole('button', { name: 'Review' }).click();
    await page.getByLabel('Note (required)').fill('Signed off by the head of IT.'); await page.getByRole('button', { name: 'Accept evidence' }).click(); await expect(page.getByText('Accepted').first()).toBeVisible();
    await page.keyboard.press('Escape'); await page.goto(`/org/${seed().orgId}/engagements`); await expect(page.getByText('1/3').first()).toBeVisible({ timeout: 20_000 });
    await page.goto(`/org/${seed().orgId}/items`); await expect(page.getByText('E2E-1').first()).toBeVisible();
  });
  test('the customer administrator sees the accepted result but has no review button on their own evidence', async ({ page }) => {
    await login(page, USERS.admin); await page.goto(engUrl); await page.getByRole('tab', { name: 'Evidence' }).click(); await expect(page.getByText('Accepted').first()).toBeVisible(); await expect(page.getByRole('button', { name: 'Review' })).toHaveCount(0);
    await page.goto(`/org/${seed().orgId}/engagements`); await expect(page.getByText('1/3').first()).toBeVisible({ timeout: 20_000 });
  });
  test('search finds the engagement and the item; a vendor cannot find what is not theirs', async ({ page, browser }) => {
    await login(page, USERS.admin); await page.getByLabel('Global search').fill('access review'); await page.getByLabel('Global search').press('Enter'); await expect(page.getByText('E2E-1').first()).toBeVisible();
    const ctx = await browser.newContext(); const v = await ctx.newPage(); await login(v, USERS.vendor); await v.getByLabel('Global search').fill('policy is approved'); await v.getByLabel('Global search').press('Enter'); await expect(v.getByText('E2E-2')).toHaveCount(0); await ctx.close();
  });
  test('signing out ends the session', async ({ page }) => {
    await login(page, USERS.admin); await page.getByRole('button', { name: 'Sign out' }).click(); await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible(); await page.goto(engUrl); await expect(page).toHaveURL(/login/);
  });
});
