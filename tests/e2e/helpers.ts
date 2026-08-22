import type { Page } from '@playwright/test';

/** The first run shows the insert. Read it, then get out of the way. */
export async function dismissLeaflet(page: Page): Promise<void> {
  const sheet = page.getByRole('dialog', { name: /Before you start/i });
  if (!(await sheet.isVisible({ timeout: 4000 }).catch(() => false))) return;
  await sheet.getByRole('button', { name: 'Begin', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' }).catch(() => undefined);
}

export async function gotoRoute(page: Page, route: string): Promise<void> {
  await page.goto(`./#${route}`);
  await dismissLeaflet(page);
  await page.waitForTimeout(150);
}

/** True once the service worker has taken control of the page. */
export async function serviceWorkerReady(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    if (navigator.serviceWorker.controller) return true;
    await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      setTimeout(resolve, 5000);
    });
    return Boolean(navigator.serviceWorker.controller);
  });
}
