// Sharing a session as a link (the coach's side), with Google sign-in and Drive stood in for
// (fake-drive.ts), then opening that link on another device.
import { expect, test, type Page } from './test';
import { APP, BUILD_UP, COUNTER_PRESS, createSession } from './helpers';
import { FakeDrive } from './fake-drive';

const SHARED_FOLDER = 'Killeshin Match Analysis – shared sessions';
const dialog = (page: Page) => page.locator('dialog.share-dialog');

async function openShare(page: Page) {
  await page.locator('.topbar').getByRole('button', { name: 'Share' }).click();
  await expect(dialog(page)).toBeVisible();
}

/** Shares the open session from its Share dialog; returns the link. */
async function share(page: Page): Promise<string> {
  await openShare(page);
  await dialog(page).getByRole('button', { name: 'Share', exact: true }).click();
  const link = dialog(page).locator('input.share-link');
  await expect(link).toBeVisible({ timeout: 30_000 });
  return link.inputValue();
}

/** The Drive folder holding a shared session, and its files. */
function sessionFolder(drive: FakeDrive) {
  const [root] = drive.named(SHARED_FOLDER);
  const folders = root ? drive.children(root.id) : [];
  return { root, folders, files: folders[0] ? drive.children(folders[0].id) : [] };
}

test('share a session, open the link on another device, update it, stop sharing', async ({ page, newDevice }, testInfo) => {
  const drive = new FakeDrive();
  await drive.attach(page);
  await createSession(page, 'vs Rovers – 2nd half', [COUNTER_PRESS, BUILD_UP]);
  await page.locator('.fields textarea').fill('Press together.');

  // Before sharing: what it does, and no sign-in yet.
  await openShare(page);
  await expect(dialog(page)).toContainText('2 clips');
  await expect(dialog(page)).toContainText('Anyone with the link can download their own copy');
  expect(drive.signIns).toBe(0);
  for (const [w, h] of [[390, 844], [1366, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.screenshot({ path: testInfo.outputPath(`share-start-${w}x${h}.png`) });
  }
  await dialog(page).getByRole('button', { name: 'Share', exact: true }).click();
  const linkBox = dialog(page).locator('input.share-link');
  await expect(linkBox).toBeVisible({ timeout: 30_000 });
  const link = await linkBox.inputValue();
  expect(drive.signIns).toBe(1);
  await expect(dialog(page)).toContainText('The shared copy is up to date');
  for (const [w, h] of [[390, 844], [844, 390], [1366, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.screenshot({ path: testInfo.outputPath(`share-done-${w}x${h}.png`) });
  }

  // In Drive: the session's own folder, shared with anyone with the link, inside the app's folder.
  const { root, folders, files } = sessionFolder(drive);
  expect(root).toBeTruthy();
  expect(folders).toHaveLength(1);
  expect(folders[0].anyone).toBe(true);
  expect(files.map((f) => f.name).sort()).toEqual(['build-up.webm', 'counter-press.webm', 'session.json']);
  const manifestFile = files.find((f) => f.name === 'session.json')!;
  expect(link).toMatch(new RegExp(`#/s/${manifestFile.id}$`));
  const manifest = JSON.parse(manifestFile.data.toString());
  expect(manifest).toMatchObject({ format: 'tactical-analysis-share', revision: 1, session: { title: 'vs Rovers – 2nd half' } });
  expect(manifest.slides[0].notes).toBe('Press together.');
  expect(files.find((f) => f.name === 'build-up.webm')!.data.length).toBe(76021);
  await dialog(page).getByRole('button', { name: 'Close' }).click();

  // Another device opens the link: no sign-in, and it gets the whole session.
  const other = await (await newDevice()).newPage();
  await drive.attach(other);
  await other.goto(`${APP}#/s/${manifestFile.id}`);
  await other.getByRole('button', { name: 'Download to this device' }).click();
  await expect(other.locator('.slide-item')).toHaveCount(2, { timeout: 30_000 });
  await expect(other.locator('.fields textarea')).toHaveValue('Press together.');
  expect(drive.signIns).toBe(1);
  await other.goto(`${APP}#/`);
  await expect(other.locator('.session-card .session-badge')).toHaveText('From a link');

  // The coach changes the session: new title, one clip removed. Update copy keeps the link.
  await page.locator('.title-input').fill('vs Rovers – 2nd half (fixed)');
  await page.locator('.slide-item').nth(1).click();
  await page.getByRole('button', { name: 'Delete slide' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.slide-item')).toHaveCount(1);
  await openShare(page);
  await expect(dialog(page)).toContainText("You've changed this session since you shared it");
  await dialog(page).getByRole('button', { name: 'Update copy' }).click();
  await expect(dialog(page)).toContainText('The shared copy is up to date', { timeout: 30_000 });
  expect(await dialog(page).locator('input.share-link').inputValue()).toBe(link);
  const updated = sessionFolder(drive).files;
  expect(updated.map((f) => f.name).sort()).toEqual(['counter-press.webm', 'session.json']); // the removed clip is gone from Drive
  expect(JSON.parse(updated.find((f) => f.name === 'session.json')!.data.toString()).revision).toBe(2);
  expect(drive.log.filter((l) => l === 'POST /upload/drive/v3/files?uploadType=resumable')).toHaveLength(3); // nothing uploaded twice
  await dialog(page).getByRole('button', { name: 'Close' }).click();

  // The other device is offered the update.
  await other.goto(`${APP}#/s/${manifestFile.id}`);
  await other.getByRole('button', { name: 'Update your copy' }).click();
  await expect(other.locator('.title-input')).toHaveValue('vs Rovers – 2nd half (fixed)', { timeout: 30_000 });
  await expect(other.locator('.slide-item')).toHaveCount(1);

  // The coach's home page marks the session as shared.
  await page.goto(`${APP}#/`);
  await expect(page.locator('.session-card .session-badge')).toHaveText('Shared');
  await page.locator('.session-open').click();

  // Stop sharing: Drive files deleted, the link stops working, the other device keeps its copy.
  await openShare(page);
  await dialog(page).getByRole('button', { name: 'Stop sharing' }).click();
  await expect(dialog(page)).toContainText('The link stops working and the clips are deleted from Google Drive');
  await dialog(page).getByRole('button', { name: 'Stop sharing' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Share', exact: true })).toBeVisible({ timeout: 30_000 });
  expect(sessionFolder(drive).folders).toHaveLength(0);
  await other.goto(`${APP}#/s/${manifestFile.id}`);
  await expect(other.locator('.shared-card')).toContainText('Link not working');
  await other.goto(`${APP}#/`);
  await expect(other.locator('.session-card')).toHaveCount(1);
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await page.goto(`${APP}#/`);
  await expect(page.locator('.session-badge')).toHaveCount(0);
});

test('a dropped connection or a Google hiccup mid-upload carries on where it stopped', async ({ page }) => {
  const drive = new FakeDrive();
  await drive.attach(page);
  await createSession(page, 'Patchy wifi', [COUNTER_PRESS, BUILD_UP]);
  drive.dropPieces = 1;
  drive.failPieces = 1;
  await share(page);
  const { files } = sessionFolder(drive);
  expect(files.map((f) => f.name).sort()).toEqual(['build-up.webm', 'counter-press.webm', 'session.json']);
  expect(files.find((f) => f.name === 'counter-press.webm')!.data.length).toBe(597917);
  expect(drive.log.filter((l) => l.startsWith('POST /upload'))).toHaveLength(3); // carried on, didn't start again
});

test('a share that fails part-way says why, and sharing again carries on without re-uploading', async ({ page }) => {
  const drive = new FakeDrive();
  await drive.attach(page);
  await createSession(page, 'Big session', [COUNTER_PRESS, BUILD_UP]);
  await openShare(page);
  // The Drive fills up after the first clip.
  await page.route('https://www.googleapis.com/upload/**', async (route) => {
    if (drive.named('counter-press.webm').length) drive.full = true;
    await route.fallback();
  });
  await dialog(page).getByRole('button', { name: 'Share', exact: true }).click();
  await expect(dialog(page)).toContainText('The Google Drive is full', { timeout: 30_000 });

  // Closing and reopening: the share carries on rather than starting a new folder.
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await page.unroute('https://www.googleapis.com/upload/**');
  drive.full = false;
  await openShare(page);
  await expect(dialog(page)).toContainText("The last upload didn't finish");
  await dialog(page).getByRole('button', { name: 'Carry on sharing' }).click();
  await expect(dialog(page).locator('input.share-link')).toBeVisible({ timeout: 30_000 });
  expect(sessionFolder(drive).folders).toHaveLength(1);
  expect(sessionFolder(drive).files.map((f) => f.name).sort()).toEqual(['build-up.webm', 'counter-press.webm', 'session.json']);
  expect(drive.named('counter-press.webm')).toHaveLength(1);
});

test('closing Google sign-in goes back quietly; a share deleted in Drive can get a new link', async ({ page }) => {
  const drive = new FakeDrive();
  await drive.attach(page);
  await createSession(page, 'Training', [BUILD_UP]);
  await openShare(page);
  await page.evaluate(() => ((window as { __cancelSignIn?: boolean }).__cancelSignIn = true));
  await dialog(page).getByRole('button', { name: 'Share', exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: 'Share', exact: true })).toBeVisible();
  expect(drive.files.size).toBe(0);
  await dialog(page).getByRole('button', { name: 'Close' }).click();

  const first = await share(page);
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  // Someone deletes the session's folder in Google Drive itself.
  drive.delete(sessionFolder(drive).folders[0].id);
  await page.locator('.title-input').fill('Training (v2)');
  await openShare(page);
  await dialog(page).getByRole('button', { name: 'Update copy' }).click();
  await expect(dialog(page)).toContainText('deleted from Google Drive', { timeout: 30_000 });
  await dialog(page).getByRole('button', { name: 'Share with a new link' }).click();
  const second = dialog(page).locator('input.share-link');
  await expect(second).toBeVisible({ timeout: 30_000 });
  expect(await second.inputValue()).not.toBe(first);
});
