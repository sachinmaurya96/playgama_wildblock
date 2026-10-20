import { test, expect, type Page, type Frame } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const gameFrame = (page: Page): Frame => page.frames().find((f) => f.url().includes('/nested/wildblocks/'))!;
async function mockHost(page: Page, scenario: Record<string, unknown> = {}) {
  await page.addInitScript((s) => { (window as any).__scenario = s; }, scenario);
  const script = await readFile('tests/playgama/host-stub.js', 'utf8');
  await page.route('**/playgama-bridge.js', (route) => route.fulfill({ contentType: 'text/javascript', body: script }));
}
async function boot(page: Page) {
  await page.goto('/iframe.html');
  const game = page.frameLocator('iframe'); await expect(game.getByRole('button', { name: /New World/ })).toBeVisible();
  await expect.poll(() => gameFrame(page).evaluate(() => (window as any).__host?.messages.filter((s: string) => s === 'game_ready').length ?? 1)).toBe(1);
  return game;
}
const emit = (page: Page, name: string, value: unknown) => gameFrame(page).evaluate(({ name, value }) => { (window as any).__host.emit(name, value); }, { name, value });
const readSave = (page: Page) => gameFrame(page).evaluate(() => JSON.parse(localStorage.getItem('test-host:wildblocks.bridge.v1') ?? '{}'));

test('actual packaged SDK cold boot and refresh inside nested iframe; no missing resources', async ({ page, request }) => {
  const errors: string[] = [], missing: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (r) => { if (r.url().includes('127.0.0.1:4178') && r.status() >= 400) missing.push(r.url()); });
  await page.addInitScript(() => {
    const metrics = (window as any).__metrics = { initialize: 0, ready: 0 }; let runtime: any;
    Object.defineProperty(window, 'bridge', { configurable: true, get: () => runtime, set: (value) => {
      runtime = value;
      const initialize = value.initialize.bind(value); value.initialize = (...args: unknown[]) => {
        metrics.initialize++;
        return initialize(...args).then((result: unknown) => {
          value.platform.on(value.EVENT_NAME.PLATFORM_MESSAGE_SENT, (message: string) => { if (message === 'game_ready') metrics.ready++; });
          return result;
        });
      };
    } });
  });
  await boot(page);
  await expect.poll(() => gameFrame(page).evaluate(() => (window as any).__metrics)).toEqual({ initialize: 1, ready: 1 });
  const resources = await gameFrame(page).evaluate(() => ([...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')] as PerformanceResourceTiming[]).map((r) => ({ name: new URL(r.name).pathname, decodedBodySize: r.decodedBodySize, transferSize: r.transferSize })));
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/playgama-transfer.json', JSON.stringify({ initialLoadTransferBytes: resources.reduce((n, r) => n + r.transferSize, 0), runtimeResources: resources }, null, 2));
  await page.reload(); await boot(page); // a new page session reinitializes exactly once
  await expect.poll(() => gameFrame(page).evaluate(() => (window as any).__metrics)).toEqual({ initialize: 1, ready: 1 });
  expect(errors).toEqual([]); expect(missing).toEqual([]);
  expect((await request.get('/nested/wildblocks/missing.js')).status()).toBe(404);
});

test('SDK failure and read failure offer retry; unknown remote save is never overwritten', async ({ page }) => {
  await mockHost(page, { initError: true }); await page.goto('/iframe.html');
  const game = page.frameLocator('iframe'); await expect(game.getByRole('button', { name: 'Retry loading' })).toBeVisible();
  await gameFrame(page).evaluate(() => { (window as any).__host.initError = false; (window as any).__host.loadError = true; });
  await game.getByRole('button', { name: 'Retry loading' }).click();
  await expect(game.getByRole('button', { name: 'Retry loading' })).toBeVisible();
  expect(await gameFrame(page).evaluate(() => (window as any).__host.writes)).toEqual([]);
  await gameFrame(page).evaluate(() => { (window as any).__host.loadError = false; });
  await game.getByRole('button', { name: 'Retry loading' }).click(); await expect(game.getByRole('button', { name: /New World/ })).toBeVisible();
  await expect.poll(() => gameFrame(page).evaluate(() => (window as any).__host.messages.length)).toBe(1);
});

test('malformed remote save is kept; readiness waits for successful loading', async ({ page }) => {
  await mockHost(page, { malformed: true }); await page.goto('/iframe.html');
  await expect(page.frameLocator('iframe').getByRole('button', { name: 'Retry loading' })).toBeVisible();
  expect(await gameFrame(page).evaluate(() => ({ writes: (window as any).__host.writes, messages: (window as any).__host.messages }))).toEqual({ writes: [], messages: [] });
});

test('a valid Bridge save does not depend on readable legacy IndexedDB', async ({ page }) => {
  await page.addInitScript(() => { indexedDB.databases = async () => { throw new Error('Legacy IndexedDB blocked'); }; });
  await mockHost(page, { saved: JSON.stringify({ schemaVersion: 1, preferences: {}, worlds: {}, states: {}, backups: {}, chunks: {}, maps: {}, blueprints: {} }) });
  await boot(page);
});

test('settings, English fallback and mute survive host events and refresh', async ({ page }) => {
  await mockHost(page, { language: 'ru-RU' }); const game = await boot(page);
  await game.getByRole('button', { name: /Settings/ }).click(); await game.getByRole('button', { name: 'Audio', exact: true }).click();
  const master = game.getByRole('slider').first(); await master.fill('0'); await master.dispatchEvent('change');
  await expect.poll(async () => (await readSave(page)).preferences?.['wildblocks.settings.v1'] && JSON.parse((await readSave(page)).preferences['wildblocks.settings.v1']).audio.master).toBe(0);
  await emit(page, 'audio_state_changed', false); await emit(page, 'audio_state_changed', true);
  await emit(page, 'pause_state_changed', true); await emit(page, 'pause_state_changed', false);
  await expect(master).toHaveValue('0');
  expect(await gameFrame(page).evaluate(() => document.documentElement.lang)).toBe('en');
  await page.reload(); await boot(page); await game.getByRole('button', { name: /Settings/ }).click(); await game.getByRole('button', { name: 'Audio', exact: true }).click(); await expect(master).toHaveValue('0');
});

test('survival start, user/host/hidden pauses, voluntary reward and world save restore', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => { if (message.type() === 'error' && /frame error|WebGLProgram|failed to load/i.test(message.text())) errors.push(message.text()); });
  await mockHost(page); const game = await boot(page);
  await game.getByRole('button', { name: /New World/ }).click(); await game.getByLabel('World name').fill('Release Survival'); await game.getByLabel(/Seed/).fill('release-42');
  await game.getByRole('button', { name: 'Peaceful', exact: false }).first().click(); await game.getByRole('button', { name: 'Generate World' }).click();
  await expect(game.locator('.hud')).toBeVisible({ timeout: 60000 }); await expect(game.locator('canvas').first()).toBeVisible();
  await page.keyboard.press('KeyE'); await expect(game.locator('.inventory-panel')).toBeVisible();
  const reward = game.getByRole('button', { name: 'Watch an ad to unlock the Starlight scarf' }); await reward.click();
  await expect(game.getByRole('button', { name: 'Waiting for the ad…' })).toBeDisabled();
  await emit(page, 'rewarded_state_changed', 'opened'); await emit(page, 'rewarded_state_changed', 'rewarded'); await emit(page, 'rewarded_state_changed', 'rewarded');
  await expect.poll(async () => (await readSave(page)).preferences?.['wildblocks.starlight-unlocked']).toBe('true');
  await emit(page, 'rewarded_state_changed', 'closed');
  await page.keyboard.press('KeyE'); await expect(game.locator('.inventory-panel')).not.toBeVisible();
  await page.keyboard.press('Escape'); await expect(game.getByRole('button', { name: 'Resume', exact: true }).last()).toBeVisible();
  await emit(page, 'pause_state_changed', true); await emit(page, 'pause_state_changed', false);
  await expect(game.getByRole('button', { name: 'Resume', exact: true }).last()).toBeVisible();
  // Synthetic hidden-tab event tests document visibility in the embedded game.
  await gameFrame(page).evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await emit(page, 'audio_state_changed', true);
  await expect.poll(() => gameFrame(page).evaluate(() => (window as any).__host.contexts.every((c: AudioContext) => c.state !== 'running'))).toBe(true);
  await gameFrame(page).evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await game.getByRole('button', { name: 'Save & Quit to Menu' }).click(); await expect(game.getByRole('button', { name: /Continue/ })).toBeVisible();
  await expect.poll(async () => Object.values((await readSave(page)).states ?? {}).length).toBe(1);
  // A saved elimination must survive reload; only the player's button may revive it.
  // Engine tests exercise actual damage/death and difficulty-specific drops.
  await gameFrame(page).evaluate(() => {
    const key = 'test-host:wildblocks.bridge.v1';
    const saved = JSON.parse(localStorage.getItem(key)!);
    (Object.values(saved.states)[0] as any).player.vitality = 0;
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload(); await boot(page); await game.getByRole('button', { name: /Continue/ }).click();
  const death = game.getByRole('dialog', { name: /overcome by the wilds/ });
  await expect(death).toBeVisible({ timeout: 60000 });
  await page.keyboard.press('Escape'); await page.keyboard.press('KeyE');
  await expect(death).toBeVisible();
  expect(Object.values((await readSave(page)).states).map((s: any) => s.player.vitality)).toEqual([0]);
  await death.getByRole('button', { name: 'Respawn at starting camp' }).click();
  await expect(death).not.toBeVisible();
  await expect(game.locator('.hud')).toBeVisible();
  await expect.poll(async () => Object.values((await readSave(page)).states).some((s: any) => s.player.vitality > 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('Build Home starts and saves; retained PvP and deathmatch lobby forms are reachable', async ({ page }) => {
  await mockHost(page); const game = await boot(page);
  for (const menu of [/PvP Mode/, /Deathmatch — Team Battle/, /Join Friend’s World/]) {
    await game.getByRole('button', { name: menu }).click(); await expect(game.locator('.panel').first()).toBeVisible(); await game.getByRole('button', { name: 'Back', exact: true }).first().click();
  }
  await game.getByRole('button', { name: /Build Home/ }).click(); await game.getByLabel('Project name').fill('Release Build'); await game.getByRole('button', { name: 'Start Building' }).click();
  await expect(game.locator('.build-hud')).toBeVisible({ timeout: 60000 });
  await expect.poll(async () => Object.values((await readSave(page)).worlds ?? {}).some((w: any) => w.name === 'Release Build' && w.mode === 'build')).toBe(true);
  // Make the product cooldown eligible without a 90-second test sleep.
  await gameFrame(page).evaluate(() => { const now = Date.now; Date.now = () => now() + 90001; });
  await game.getByTitle('Menu (Esc)', { exact: true }).click();
  await game.getByRole('button', { name: 'Save & Quit to Menu' }).click();
  await expect(game.getByRole('button', { name: /Continue/ })).toBeVisible();
  await expect.poll(() => gameFrame(page).evaluate(() => (window as any).__host.requests)).toEqual([['interstitial', 'return_to_menu']]);
  await emit(page, 'interstitial_state_changed', 'opened'); await emit(page, 'interstitial_state_changed', 'closed');
  await expect(game.getByRole('button', { name: /New World/ })).toBeEnabled();
});

for (const viewport of [{ width: 390, height: 844, touch: true }, { width: 844, height: 390, touch: true }, { width: 1024, height: 768, touch: true }, { width: 1440, height: 900, touch: false }]) {
  test(`layout ${viewport.width}x${viewport.height} ${viewport.touch ? 'touch' : 'mouse'}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, hasTouch: viewport.touch, isMobile: viewport.touch }); const page = await context.newPage(); await mockHost(page); await boot(page);
    const frame = gameFrame(page);
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    if (viewport.height > viewport.width) await expect(page.frameLocator('iframe').getByRole('dialog', { name: 'Rotate your device' })).toBeVisible();
    else {
      const button = page.frameLocator('iframe').getByRole('button', { name: /New World/ }); await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox(); expect(box).toBeTruthy(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    await context.close();
  });
}
