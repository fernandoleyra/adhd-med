import { expect, test } from '@playwright/test';
import { dismissLeaflet, serviceWorkerReady } from './helpers.js';

test.describe('airplane mode', () => {
  test('the app boots and plays with the network off', async ({ page, context }) => {
    await page.goto('./');
    await dismissLeaflet(page);
    expect(await serviceWorkerReady(page)).toBe(true);

    // Give the worker a moment to finish precaching before cutting the wire.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const res = await fetch(`${location.pathname}precache.json`, { cache: 'no-store' }).catch(() => null);
            if (!res) return -1;
            const { files } = (await res.json()) as { files: string[] };
            const keys = await caches.keys();
            const name = keys.find((k) => k.startsWith('adhd-med-'));
            if (!name) return 0;
            const cache = await caches.open(name);
            let present = 0;
            for (const f of files) if (await cache.match(f, { ignoreVary: true })) present++;
            return present === files.length ? files.length : present;
          }),
        { timeout: 25_000, message: 'service worker should precache every file' },
      )
      .toBeGreaterThan(5);

    await context.setOffline(true);
    await page.reload();
    await dismissLeaflet(page);

    // The whole app is here: modes render and a session still plays, because
    // every tone is synthesised locally.
    await expect(page.getByRole('heading', { name: 'DJ' }).first()).toBeVisible();
    await page.goto('./#/codex');
    await expect(page.locator('.codex-row').first()).toBeVisible();

    await page.goto('./#/dj');
    await dismissLeaflet(page);
    await page.locator('.commit button.primary').click();
    const status = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 800));
      return window.adhdmed.engine.snapshot().status;
    });
    expect(status).toBe('playing');

    await context.setOffline(false);
  });

  test('the airplane panel reports the real cache', async ({ page }) => {
    await page.goto('./');
    await dismissLeaflet(page);
    expect(await serviceWorkerReady(page)).toBe(true);
    await page.getByRole('button', { name: 'Airplane mode' }).click();
    const sheet = page.getByRole('dialog', { name: 'Airplane mode' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('service worker: registered');
    await expect(sheet.getByText(/cached \d+ of \d+ files/)).toBeVisible();
    await expect.poll(async () => sheet.locator('.badge').first().textContent(), { timeout: 20_000 }).toMatch(
      /ready for offline/,
    );
  });

  test('the DJ says it is offline rather than failing', async ({ page, context }) => {
    await page.goto('./');
    await dismissLeaflet(page);
    expect(await serviceWorkerReady(page)).toBe(true);
    await context.setOffline(true);
    await page.goto('./#/dj');
    await dismissLeaflet(page);
    await page.getByRole('button', { name: 'AI set' }).click();
    await page.getByRole('textbox', { name: /where you are/i }).fill('cannot settle, need to read');
    await page.locator('.commit button.primary').click();
    await expect(page.locator('.badge').filter({ hasText: /offline/ }).first()).toBeVisible();
    await context.setOffline(false);
  });
});

test.describe('updating', () => {
  /**
   * The app ran a two-day-old build because the update offer was built as
   * `<div id="toast">`, and `toast()` finds that element by id and replaces its
   * contents — so the next ordinary message threw the Restart button away. This
   * is that bug, in a real browser.
   */
  test('an ordinary message cannot eat the update offer', async ({ page }) => {
    await page.goto('./#/dj');
    await dismissLeaflet(page);

    const offer = () =>
      page.evaluate(() => {
        const fake = { waiting: { postMessage: () => undefined } } as unknown as ServiceWorkerRegistration;
        window.adhdmed.offerUpdate(fake);
      });

    await offer();
    const update = page.locator('#update');
    await expect(update.getByRole('button', { name: 'Restart' })).toBeVisible();

    // The real toast from the real path: with no hosted route on a preview
    // build, asking for a set warns and falls back. This is the exact message
    // that used to arrive and take the Restart button with it.
    await page.getByRole('button', { name: 'AI set' }).click();
    await page.getByRole('textbox', { name: /where you are/i }).fill('wired, need to write');
    await page.locator('.commit button.primary').click();
    await expect(page.locator('#toast')).toContainText('scripted DJ instead');

    await expect(update, 'the offer outlives the message').toBeVisible();
    await expect(update.getByRole('button', { name: 'Restart' })).toBeVisible();

    // Offered twice, shown once.
    await offer();
    await expect(page.locator('#update')).toHaveCount(1);
  });
});

test.describe('sharing', () => {
  test('a link carries the whole session, with no server involved', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('./#/lab');
    await dismissLeaflet(page);

    // Make the session distinctive, then copy the link.
    await page.getByRole('textbox', { name: 'Session title' }).fill('Shared bench');
    await page.getByRole('button', { name: 'Copy link' }).click();
    // The link is compressed before it is written, so wait for the app to say
    // it happened rather than racing the clipboard.
    await expect(page.locator('#toast')).toContainText('Link copied');
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toContain('#/play?m=');
    expect(url.length).toBeLessThan(4000);

    // A fresh page with only that link gets the same session.
    const other = await context.newPage();
    await other.goto(url);
    await dismissLeaflet(other);
    await expect(other.getByRole('dialog', { name: 'Session' })).toBeVisible();
    await expect(other.getByRole('dialog', { name: 'Session' })).toContainText('Shared bench');
    // and the payload is cleaned out of the address bar
    expect(other.url()).not.toContain('m=');
    await other.close();
  });

  test('a hostile link is clamped rather than trusted', async ({ page }) => {
    await page.goto('./');
    await dismissLeaflet(page);
    const payload = await page.evaluate(() => {
      const hostile = { t: 'x'.repeat(300), x: 1, g: [{ d: 99999, y: [{ c: 1e9, b: 1e9, g: 99 }] }] };
      const json = JSON.stringify(hostile);
      const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return `0.${b64}`;
    });
    await page.goto(`./#/play?m=${payload}`);
    await dismissLeaflet(page);
    const limits = await page.evaluate(() => {
      const script = window.adhdmed.engine.snapshot().script!;
      const l = script.segments[0]!.layers[0]!;
      return { title: script.title.length, carrier: l.carrier, beat: l.beat, gain: l.gain, dur: script.segments[0]!.dur };
    });
    expect(limits.title).toBeLessThanOrEqual(64);
    expect(limits.carrier).toBeLessThanOrEqual(14000);
    expect(limits.beat).toBeLessThanOrEqual(400);
    expect(limits.gain).toBeLessThanOrEqual(1);
    expect(limits.dur).toBeLessThanOrEqual(14400);
  });
});
