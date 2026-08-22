import { expect, test } from '@playwright/test';
import { dismissLeaflet, gotoRoute } from './helpers.js';

test.describe('the app works on a phone', () => {
  test('the first run shows the package insert before anything else', async ({ page }) => {
    await page.goto('./');
    const sheet = page.getByRole('dialog', { name: /Read before use/i });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('not a medical device');
    await expect(sheet).toContainText('Active ingredients');
    await page.getByRole('button', { name: /Understood/i }).click();
    await expect(sheet).toBeHidden();

    // and it does not come back
    await page.reload();
    await expect(page.getByRole('dialog', { name: /Read before use/i })).toBeHidden();
  });

  test('every mode renders', async ({ page }) => {
    await page.goto('./');
    await dismissLeaflet(page);

    for (const [route, heading] of [
      ['/dj', 'DJ'],
      ['/lab', 'Lab'],
      ['/codex', 'Codex'],
      ['/logos', 'Logos'],
      ['/about', 'What this is'],
    ] as const) {
      await page.goto(`./#${route}`);
      await expect(page.getByRole('heading', { name: heading, exact: false }).first()).toBeVisible();
      await expect(page.locator('#veil')).toBeVisible();
    }
  });

  test('the footer carries the library and the disclaimer', async ({ page }) => {
    await page.goto('./');
    await dismissLeaflet(page);
    const foot = page.locator('#foot');
    await expect(foot).toContainText(/Library · \d+ references/);
    await expect(foot).toContainText('not a medical device');
    await foot.getByRole('link', { name: /Library/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Library' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('García-Argibay');
    await expect(sheet).toContainText('Buzsáki');
    await expect(sheet.getByText(/Papers · \d+/)).toBeVisible();
    await expect(sheet.getByText(/Books · \d+/)).toBeVisible();
    // topic filter narrows it
    await sheet.getByRole('button', { name: /Attention, arousal/ }).click();
    await expect(sheet).toContainText('Söderlund');
  });

  test('the scripted DJ builds a session and plays it', async ({ page }) => {
    await gotoRoute(page, '/dj');
    await page.getByRole('button', { name: 'Focus', exact: true }).click();
    await page.getByRole('button', { name: '25 min' }).click();
    await page.getByRole('button', { name: 'Build it' }).click();

    const card = page.locator('.card').first();
    await expect(card).toContainText('Focus');
    await expect(card).toContainText('onset');
    await expect(card).toContainText('pre-task exposure');
    await expect(card).toContainText('headphones');

    await page.getByRole('button', { name: 'Begin' }).first().click();
    await expect(page.locator('#mini')).toHaveClass(/is-on/);

    const state = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 1200));
      const snap = window.adhdmed.engine.snapshot();
      const analyser = window.adhdmed.engine.analyserL!;
      const data = new Float32Array(analyser.fftSize);
      let energy = 0;
      for (let i = 0; i < 8; i++) {
        analyser.getFloatTimeDomainData(data);
        for (const v of data) energy = Math.max(energy, Math.abs(v));
        await new Promise((r) => setTimeout(r, 80));
      }
      return { status: snap.status, position: snap.position, duration: snap.duration, energy };
    });
    expect(state.status).toBe('playing');
    expect(state.duration).toBeGreaterThan(1400);
    expect(state.position).toBeGreaterThan(0);
    expect(state.energy).toBeGreaterThan(0.001);
  });

  test('the DJ falls back to the scripted generator with no key', async ({ page }) => {
    await gotoRoute(page, '/dj');
    await page.getByRole('textbox', { name: /Tell the DJ/i }).fill('wired from coffee, need to write for an hour');
    await page.getByRole('button', { name: 'Ask the DJ' }).click();
    await expect(page.locator('.badge').filter({ hasText: /scripted DJ/ }).first()).toBeVisible();
    await expect(page.locator('.card').first()).toContainText(/Deep Work|Deep work/i);
  });

  test('the codex shows its arithmetic and its evidence tier', async ({ page }) => {
    await gotoRoute(page, '/codex');
    await page.getByRole('textbox', { name: /Search the catalogue/i }).fill('schumann');
    const card = page.locator('.card').filter({ hasText: 'Schumann resonance' }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('.tier')).toHaveText('measured');
    await expect(card).toContainText('×2^5');
    await expect(card).toContainText('250.56 Hz');
    await expect(card.locator('canvas')).toBeVisible();

    // the lore tier is labelled, not hidden
    await page.getByRole('textbox', { name: /Search the catalogue/i }).fill('solfeggio');
    await expect(page.locator('.card').first().locator('.tier')).toHaveText('lore');
    await expect(page.locator('.card').first()).toContainText(/numerolog/i);
  });

  test('words become frequencies, with the derivation shown', async ({ page }) => {
    await gotoRoute(page, '/logos');
    const input = page.getByRole('textbox', { name: /Word or phrase/i });
    await input.fill('CALM');
    await expect(page.locator('.derive')).toContainText('Σ 29');
    await expect(page.locator('.derive')).toContainText('116.00 Hz');
    await expect(page.locator('.derive')).toContainText('beat 10 Hz');
    await page.getByRole('button', { name: 'Play the word' }).click();
    await expect(page.locator('#mini')).toContainText('CALM');
  });

  test('the lab exposes the whole synthesiser', async ({ page }) => {
    await gotoRoute(page, '/lab');
    await expect(page.getByText('beat × carrier')).toBeVisible();

    await page.locator('summary').filter({ hasText: 'layers' }).click();
    await expect(page.getByRole('button', { name: 'custom' })).toBeVisible();
    await page.getByRole('button', { name: 'custom' }).click();
    await expect(page.getByRole('group', { name: /Harmonic amplitudes/i })).toBeVisible();
    await expect(page.getByText('may not have a name')).toBeVisible();

    // modulators, filter, and equations are all reachable
    await expect(page.getByText('amplitude modulation')).toBeVisible();
    await expect(page.getByText('frequency modulation')).toBeVisible();
    await page.locator('summary').filter({ hasText: 'motion & equations' }).click();
    await expect(page.getByText(/variables: t u d b r/)).toBeVisible();
  });

  test('a session built by the DJ opens in the Lab intact', async ({ page }) => {
    await gotoRoute(page, '/dj');
    await page.getByRole('button', { name: 'Calm', exact: true }).click();
    await page.getByRole('button', { name: '15 min' }).click();
    await page.getByRole('button', { name: 'Build it' }).click();
    await page.getByRole('button', { name: 'Open in Lab' }).first().click();
    await expect(page.getByRole('textbox', { name: 'Session title' })).toHaveValue(/Calm/);
    await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  });

  test('experimental mode asks before it opens up', async ({ page }) => {
    await gotoRoute(page, '/lab');
    await page.locator('summary').filter({ hasText: 'envelope' }).click();
    await page.getByText('Experimental envelope').click();
    const dialog = page.getByRole('dialog', { name: /Leaving the tested range/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('limiter');
    await dialog.getByRole('button', { name: /I understand/i }).click();
    await expect(page.getByText('experimental', { exact: false }).first()).toBeVisible();
  });

  test('phone screenshots of every mode', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'screenshots come from the phone project');
    await page.goto('./');
    await dismissLeaflet(page);
    for (const route of ['dj', 'lab', 'codex', 'logos', 'about']) {
      await page.goto(`./#/${route}`);
      await page.waitForTimeout(400);
      await testInfo.attach(`${route}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    }
  });
});
