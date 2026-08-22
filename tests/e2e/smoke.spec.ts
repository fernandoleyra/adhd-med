import { expect, test } from '@playwright/test';
import { dismissLeaflet, gotoRoute } from './helpers.js';

test.describe('the app works on a phone', () => {
  test('the first run leads with the disclaimer and asks one question', async ({ page }) => {
    await page.goto('./');
    const sheet = page.getByRole('dialog', { name: /Before you start/i });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Not a medical device');
    await expect(sheet).toContainText('Evidence');
    // The long version is there, folded away rather than shouted.
    await expect(sheet.getByText('the long version')).toBeVisible();
    await expect(sheet).not.toContainText('frequency-following');
    await sheet.getByText('the long version').click();
    await expect(sheet).toContainText('ADHD trials are the weak spot');

    await page.getByRole('button', { name: 'Begin', exact: true }).click();
    await expect(sheet).toBeHidden();
    await page.reload();
    await expect(page.getByRole('dialog', { name: /Before you start/i })).toBeHidden();
  });

  /**
   * The regression test for a blank white page in production: the build was
   * fine, the tests were fine, and every asset URL pointed at a path the host
   * did not serve. Nothing threw — the page just rendered its static header in
   * Times New Roman with no styles and no app.
   */
  test('the shipped build boots at the path it is served from', async ({ page }) => {
    const missing: string[] = [];
    page.on('response', (res) => {
      if (res.status() === 404) missing.push(new URL(res.url()).pathname);
    });

    await page.goto('./');
    await dismissLeaflet(page);

    // The stylesheet arrived: only app.css makes the dock stick and the tabs a
    // grid. A 404'd stylesheet fails here rather than looking merely ugly.
    await expect(page.locator('#dock')).toHaveCSS('position', 'sticky');
    await expect(page.locator('#tabs')).toHaveCSS('display', 'grid');
    const grad = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--grad').trim(),
    );
    expect(grad).toContain('gradient');

    // And the module ran: no bundle, no engine, no app.
    expect(await page.evaluate(() => typeof window.adhdmed?.engine?.snapshot)).toBe('function');
    await expect(page.locator('#tabs a')).toHaveCount(4);

    // Nothing the page asked for was absent, whatever the mount point.
    expect(missing).toEqual([]);
  });

  test('every mode renders', async ({ page }) => {
    await page.goto('./');
    await dismissLeaflet(page);

    for (const [route, heading] of [
      ['/dj', 'DJ'],
      ['/lab', 'Lab'],
      ['/codex', 'Codex'],
      ['/logos', 'Logos'],
      ['/about', 'ADHD MED'],
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
    await expect(foot).toContainText(/Library \d+/);
    await expect(foot).toContainText('Not a medical device');
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
    // One tap makes sound: the card below is what is already playing.
    await page.getByRole('button', { name: 'Play something' }).click();
    await expect(page.locator('#mini')).toHaveClass(/is-on/);

    const card = page.locator('.card').first();
    await expect(card).toContainText('Focus');
    await expect(card).toContainText('onset');
    await expect(card).toContainText('pre-task exposure');
    await expect(card).toContainText('headphones');
    await expect(card.getByRole('button', { name: 'Restart' })).toBeVisible();

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
    const field = page.getByRole('textbox', { name: /Tell the DJ/i });
    await field.fill('wired from coffee, need to write for an hour');
    // Typing turns the same button into the conversational one.
    await page.getByRole('button', { name: 'Ask the DJ' }).click();
    await expect(page.locator('.badge').filter({ hasText: /^scripted/ }).first()).toBeVisible();
    await expect(page.locator('.card').first()).toContainText(/Deep Work|Deep work/i);
  });

  test('the codex is a scannable list, with the arithmetic one tap in', async ({ page }) => {
    await gotoRoute(page, '/codex');
    const search = page.getByRole('searchbox', { name: /Search the catalogue/i });
    await search.fill('schumann');

    // The row itself is a line: mark, name, numbers, tier.
    const row = page.locator('.codex-row').first();
    await expect(row).toContainText('Schumann resonance');
    await expect(row).toContainText('250.6 Hz');
    await expect(row.locator('canvas')).toBeVisible();
    await expect(row.locator('.tier')).toHaveText('meas');

    // Everything else is behind it.
    await row.click();
    const sheet = page.getByRole('dialog', { name: /Schumann/i });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('×2^5');
    await expect(sheet).toContainText('Earth');
    await expect(sheet).toContainText('source:');

    await page.keyboard.press('Escape');
    await search.fill('solfeggio');
    await expect(page.locator('.codex-row').first().locator('.tier')).toHaveText('lore');
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
    await page.getByRole('button', { name: 'Play something' }).click();
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

  test('every control has a name and a big enough target', async ({ page }) => {
    await page.goto('./');
    await dismissLeaflet(page);
    const problems: string[] = [];
    for (const route of ['dj', 'lab', 'codex', 'logos', 'about']) {
      await page.goto(`./#/${route}`);
      await page.waitForTimeout(250);
      // Open the Lab's folds so the controls inside them are audited too.
      if (route === 'lab') {
        for (const fold of ['layers', 'grid', 'numbers', 'dice', 'envelope']) {
          await page.locator(`details[data-fold="${fold}"] > summary`).click();
        }
      }
      const found = await page.evaluate(() => {
        const out: string[] = [];
        const name = (el: Element) =>
          (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim();
        const selector = 'button, a, input, select, textarea, [role="slider"], [role="application"]';
        for (const el of Array.from(document.querySelectorAll(selector))) {
          if (el.closest('[aria-hidden="true"]')) continue;
          if (!name(el)) out.push(`unnamed ${el.tagName.toLowerCase()} in .${String(el.parentElement?.className).split(' ')[0]}`);
          const rect = el.getBoundingClientRect();
          // WCAG 2.5.8 asks for 24px; inputs are excluded because the switch
          // input is deliberately hidden behind its 44px label.
          if (rect.height > 0 && rect.height < 24 && el.tagName !== 'A' && el.tagName !== 'INPUT') {
            out.push(`${Math.round(rect.height)}px target: ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
          }
        }
        return [...new Set(out)];
      });
      if (found.length) problems.push(`${route}: ${found.join(' | ')}`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
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
