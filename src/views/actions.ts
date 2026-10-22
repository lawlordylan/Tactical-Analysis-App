// Actions shared by several screens: export, import, start presenting.
import { alertDialog, choiceDialog, progressDialog, toast } from '../lib/dialogs';
import { canShareFile, downloadFile, exportSession, importSession, FILE_EXT } from '../lib/transfer';
import type { Session } from '../lib/types';
import { fmtBytes } from '../lib/util';

/** Club crest (Killeshin F.C.), served from public/. */
export const CREST = './brand-crest.png';

export function go(hash: string) {
  location.hash = hash;
}

export function startPresenting(sessionId: string, index = 0) {
  // Request fullscreen inside the click handler so the browser allows it.
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  go(`#/present/${sessionId}/${index}`);
}

export async function runExport(session: Session) {
  if (!session.slideIds.length) {
    await alertDialog('Nothing to export', 'Add at least one clip to this session first.');
    return;
  }
  const p = progressDialog(`Exporting “${session.title}”`);
  p.update(0, 'Preparing…');
  try {
    const res = await exportSession(session, (d, t) => p.update(d / t, `${fmtBytes(d)} of ${fmtBytes(t)}`));
    p.close();
    if (res.saved || !res.file) {
      toast('Session exported');
      return;
    }
    const file = res.file;
    const choices = [{ key: 'download', label: 'Download', primary: !canShareFile(file) }];
    if (canShareFile(file)) choices.push({ key: 'share', label: 'Share…', primary: true });
    const pick = await choiceDialog('Session ready', `${file.name} · ${fmtBytes(file.size)}`, choices);
    if (pick === 'download') downloadFile(file);
    if (pick === 'share') {
      await navigator.share({ files: [file], title: session.title }).catch((e: Error) => {
        if (e.name !== 'AbortError') downloadFile(file);
      });
    }
  } catch (e) {
    p.close();
    if ((e as Error).name === 'AbortError') return;
    await alertDialog('Export failed', (e as Error).message);
  }
}

/** Opens a file picker and imports the chosen session file. Resolves with the new session. */
export function pickAndImport(): Promise<Session | null> {
  return new Promise((resolve) => {
    // No `accept` filter: Android greys out unknown extensions like .analysis.
    const input = document.createElement('input');
    input.type = 'file';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve(await runImport(file));
    });
    input.click();
  });
}

export async function runImport(file: File): Promise<Session | null> {
  if (!file.name.endsWith(FILE_EXT) && !file.name.endsWith('.zip')) {
    const ok = await choiceDialog('Import this file?', `“${file.name}” doesn't look like a session file (${FILE_EXT}). Try anyway?`, [
      { key: 'go', label: 'Try anyway', primary: true },
    ]);
    if (!ok) return null;
  }
  const p = progressDialog('Importing session');
  p.update(0, 'Reading file…');
  try {
    const session = await importSession(file, (d, t) => p.update(t ? d / t : 1, `${fmtBytes(d)} of ${fmtBytes(t)}`));
    p.close();
    toast(`Imported “${session.title}”`);
    return session;
  } catch (e) {
    p.close();
    await alertDialog('Import failed', (e as Error).message);
    return null;
  }
}
