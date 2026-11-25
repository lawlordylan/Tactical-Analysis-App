// The Share dialog (session header): shares a session as a link through Google Drive, shows
// the link to send or copy, updates the shared copy and stops sharing.
import { isHevc, readClipFormat } from '../lib/codec';
import { toast } from '../lib/dialogs';
import { h, icon } from '../lib/dom';
import { DriveError, loadSignIn, signIn } from '../lib/drive';
import { getVideo } from '../lib/files';
import { changedSinceShared, forgetShare, liveShare, publishSession, shareLink, stopSharing, type DownloadProgress } from '../lib/share';
import { getSlides } from '../lib/store';
import type { Session, Slide } from '../lib/types';
import { fmtBytes, fmtDate } from '../lib/util';

/** Opens the Share dialog for a session. `session` is the screen's own copy: share details are written into it. */
export async function openShareDialog(session: Session): Promise<void> {
  // Google's sign-in script loads while the dialog is open, so the Share click can open its pop-up.
  loadSignIn().catch(() => {});
  let slides: Slide[] = await getSlides(session);
  const body = h('div', { class: 'share-body', 'aria-live': 'polite' });
  const d = h('dialog', { class: 'dialog share-dialog', 'aria-labelledby': 'share-title' }, h('h2', { id: 'share-title' }, 'Share link'), body);
  let aborter: AbortController | null = null;
  let busy = false;
  /** Repeats the last action (from a click, so it can sign in again). */
  let retry = () => {};
  d.addEventListener('cancel', (e) => {
    if (busy) e.preventDefault(); // Esc doesn't drop an upload half-way; Cancel does
  });

  const clips = () => slides.filter((s) => s.video);
  const size = () => clips().reduce((n, s) => n + s.video!.size, 0);
  const summary = () => {
    const n = clips().length;
    const sh = liveShare(session);
    return [`${n} clip${n === 1 ? '' : 's'}`, fmtBytes(size()), sh ? `shared ${fmtDate(Date.parse(sh.sharedAt))}` : null].filter(Boolean).join(' · ');
  };

  // HEVC clips (iPhone format) won't play on every phone or PC: say so before and after sharing.
  let hevc = 0;
  const hevcNote = h('p', { class: 'shared-warn', hidden: true });
  (async () => {
    for (const s of clips()) {
      const format = await readClipFormat(await getVideo(s.video!)).catch(() => null);
      if (format && isHevc(format)) hevc++;
    }
    hevcNote.hidden = !hevc;
    hevcNote.textContent = `${hevc === 1 ? '1 clip is' : `${hevc} clips are`} HEVC (iPhone format). Some Android phones and PCs can't play ${hevc === 1 ? 'it' : 'them'}.`;
  })();

  const head = () => [h('p', { class: 'share-session' }, h('b', null, session.title), h('br'), h('span', { class: 'muted small' }, summary()))];
  const actions = (...buttons: (HTMLElement | null)[]) => h('div', { class: 'dialog-actions' }, ...buttons);
  const button = (label: string, onclick: () => void, cls = 'btn') => h('button', { class: cls, type: 'button', onclick }, label);
  const close = () => button('Close', () => d.close());
  const anyone = () => h('p', { class: 'muted small' }, "Anyone with the link can download their own copy, without signing in. Links don't expire.");

  function show() {
    if (liveShare(session)) showShared();
    else showStart();
  }

  function showStart() {
    const unfinished = session.shared?.role === 'out' && session.shared.revision === 0;
    body.replaceChildren(
      ...head(),
      h('p', null, "Uploads this session to the club's Google Drive and gives you a link to send to players or other coaches."),
      session.shared?.role === 'in' ? h('p', { class: 'muted small' }, "This session came from someone else's link. Sharing it makes a new link of your own.") : '',
      unfinished ? h('p', { class: 'muted small' }, "The last upload didn't finish. Sharing carries on where it stopped.") : '',
      hevcNote,
      anyone(),
      h('p', { class: 'muted small' }, 'You sign in to Google the first time you share.'),
      actions(
        close(),
        h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            disabled: !clips().length,
            onclick: () => run(signIn(), 'Uploading'),
          },
          icon('share'),
          unfinished ? 'Carry on sharing' : 'Share',
        ),
      ),
      clips().length ? '' : h('p', { class: 'muted small' }, 'Add clips to this session before sharing it.'),
    );
  }

  function showShared() {
    const sh = liveShare(session)!;
    const link = shareLink(sh.link);
    const input = h('input', { class: 'input share-link', type: 'text', readonly: true, value: link, 'aria-label': 'Share link', onfocus: () => input.select() });
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        input.select();
        document.execCommand('copy');
      }
      toast('Link copied');
    };
    const send = () =>
      navigator.share({ title: session.title, text: `${session.title} – match analysis`, url: link }).catch((e: Error) => {
        if (e.name !== 'AbortError') copy();
      });
    const changed = changedSinceShared(session, slides);
    body.replaceChildren(
      ...head(),
      h(
        'div',
        { class: 'share-link-row' },
        input,
        'share' in navigator ? h('button', { class: 'btn primary', type: 'button', onclick: send }, icon('share'), 'Send link') : '',
        h('button', { class: 'btn', type: 'button', onclick: copy }, 'Copy'),
      ),
      changed
        ? h('p', { class: 'shared-warn' }, "You've changed this session since you shared it. Update the copy to share your changes; the link stays the same.")
        : h('p', { class: 'muted small' }, 'The shared copy is up to date.'),
      hevcNote,
      anyone(),
      actions(
        button('Stop sharing', confirmStop, 'btn danger-text share-stop'),
        h('span', { class: 'spacer' }),
        close(),
        button('Update copy', () => run(signIn(), 'Updating'), changed ? 'btn primary' : 'btn'),
      ),
    );
  }

  function confirmStop() {
    body.replaceChildren(
      ...head(),
      h('p', null, 'Stop sharing this session?'),
      h('p', { class: 'muted small' }, 'The link stops working and the clips are deleted from Google Drive. Copies people already downloaded stay on their devices.'),
      actions(
        button('Keep sharing', show),
        button('Stop sharing', stopNow, 'btn danger'),
      ),
    );
  }

  function stopNow() {
    retry = stopNow;
    const token = signIn();
    busyView('Stopping sharing…');
    token
      .then((t) => stopSharing(session, t))
      .then(() => {
        busy = false;
        toast('Sharing stopped');
        show();
      })
      .catch(fail);
  }

  function busyView(text: string, progress?: HTMLElement, cancel?: HTMLElement) {
    busy = true;
    body.replaceChildren(...head(), progress ?? '', h('p', { class: 'muted small share-status' }, text), cancel ? actions(cancel) : '');
  }

  /** Shares or updates. `token` comes from signIn(), called in the click itself. */
  function run(token: Promise<string>, label: 'Uploading' | 'Updating') {
    retry = () => run(signIn(), label);
    const bar = h('div', { class: 'progress-bar' });
    aborter = new AbortController();
    const signal = aborter.signal;
    busyView('Signing in to Google…', h('div', { class: 'progress' }, bar), button('Cancel', () => aborter?.abort()));
    const status = body.querySelector('.share-status')!;
    const onProgress = (p: DownloadProgress) => {
      bar.style.width = `${Math.round((p.done / Math.max(1, p.total)) * 100)}%`;
      status.textContent = `${label} clip ${p.clip} of ${p.clips} · ${fmtBytes(p.done)} of ${fmtBytes(p.total)}`;
    };
    token
      .then((t) => {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        status.textContent = label === 'Uploading' ? 'Getting the Drive folder ready…' : 'Checking for changes…';
        return publishSession(session, t, onProgress, signal);
      })
      .then(async () => {
        busy = false;
        slides = await getSlides(session);
        toast(label === 'Uploading' ? 'Session shared' : 'Shared copy updated');
        show();
      })
      .catch(fail);
  }

  function fail(e: Error) {
    busy = false;
    if (e.name === 'AbortError') return show();
    if (e instanceof DriveError && e.kind === 'cancelled') return show();
    const missing = e instanceof DriveError && e.kind === 'missing' && session.shared?.role === 'out';
    body.replaceChildren(
      ...head(),
      h('div', { class: 'share-error' }, icon('close'), h('p', null, missing ? 'The shared copy has been deleted from Google Drive, so the old link no longer works.' : e.message)),
      actions(
        close(),
        missing
          ? button(
              'Share with a new link',
              () => {
                const token = signIn();
                forgetShare(session).then(() => run(token, 'Uploading'));
              },
              'btn primary',
            )
          : button('Try again', () => retry(), 'btn primary'),
      ),
    );
  }

  show();
  document.body.append(d);
  d.showModal();
  // Leaving the page (browser back) closes the dialog; an upload in progress is cancelled.
  const onNav = () => d.close();
  window.addEventListener('hashchange', onNav);
  return new Promise((resolve) =>
    d.addEventListener('close', () => {
      aborter?.abort();
      window.removeEventListener('hashchange', onNav);
      d.remove();
      resolve();
    }),
  );
}
