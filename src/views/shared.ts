// Opening a share link (#/s/<id>): shows the shared session and downloads it to this device.
import { h, icon } from '../lib/dom';
import { downloadShared, fetchSharedManifest, findLocalCopy, ShareError, sharedSize, type DownloadProgress } from '../lib/share';
import type { Session, SharedManifest } from '../lib/types';
import { appVersion, fmtBytes, fmtDate } from '../lib/util';
import { CREST, go, warnUnplayable } from './actions';

export async function renderShared(root: HTMLElement, link: string): Promise<() => void> {
  const card = h('section', { class: 'shared-card', 'aria-live': 'polite' });
  let aborter: AbortController | null = null;
  let gone = false;

  root.append(
    h(
      'header',
      { class: 'topbar' },
      h(
        'div',
        { class: 'brand' },
        h('img', { class: 'brand-crest', src: CREST, alt: '' }),
        h(
          'span',
          { class: 'brand-text' },
          h('span', { class: 'brand-name' }, 'Killeshin FC'),
          h('span', { class: 'brand-sub' }, 'Match Analysis', h('span', { class: 'version-badge', title: 'App version' }, `v${appVersion()}`)),
        ),
      ),
      h('div', { class: 'topbar-actions' }, h('button', { class: 'btn', type: 'button', title: 'Your sessions', onclick: () => go('#/') }, icon('back'), h('span', { class: 'label' }, 'Your sessions'))),
    ),
    h('main', { class: 'shared-page' }, card),
  );

  const show = (...children: (Node | string)[]) => card.replaceChildren(...children);
  const kicker = (text: string) => h('span', { class: 'shared-kicker' }, text);

  async function load() {
    show(h('div', { class: 'shared-icon' }, icon('import')), kicker('Shared session'), h('p', { class: 'muted' }, 'Getting the session details…'));
    aborter = new AbortController();
    let manifest: SharedManifest;
    let local: Session | undefined;
    try {
      [manifest, local] = await Promise.all([fetchSharedManifest(link, aborter.signal), findLocalCopy(link)]);
    } catch (e) {
      if (gone) return;
      // Offline but already downloaded: just open it.
      const copy = await findLocalCopy(link).catch(() => undefined);
      if (copy && e instanceof ShareError && e.kind === 'offline') return showLocalOnly(copy);
      return showError(e as Error);
    }
    if (gone) return;
    showManifest(manifest, local);
  }

  function showError(e: Error) {
    const goneLink = e instanceof ShareError && e.kind === 'gone';
    show(
      h('div', { class: 'shared-icon warn' }, icon('close')),
      kicker(goneLink ? 'Link not working' : "Couldn't open the link"),
      h('p', null, e.message),
      h(
        'div',
        { class: 'shared-actions' },
        goneLink ? null : h('button', { class: 'btn primary', type: 'button', onclick: () => load() }, 'Try again'),
        h('button', { class: 'btn', type: 'button', onclick: () => go('#/') }, 'Your sessions'),
      ),
    );
  }

  function showLocalOnly(copy: Session) {
    show(
      h('div', { class: 'shared-icon' }, icon('check')),
      kicker('Shared session'),
      h('h1', { class: 'shared-title' }, copy.title),
      h('p', { class: 'muted' }, "You're offline, but this session is already on this device."),
      h('div', { class: 'shared-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => go(`#/session/${copy.id}`) }, 'Open session')),
    );
  }

  function summary(m: SharedManifest) {
    const clips = m.slides.filter((s) => s.video).length;
    const shortcuts = m.slides.reduce((n, s) => n + (s.shortcuts?.length ?? 0), 0);
    return [
      `${clips} clip${clips === 1 ? '' : 's'}`,
      shortcuts ? `${shortcuts} shortcut${shortcuts === 1 ? '' : 's'}` : null,
      fmtBytes(sharedSize(m)),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  async function showManifest(m: SharedManifest, local: Session | undefined) {
    const thumbs = m.slides.filter((s) => s.thumb).slice(0, 3);
    const status = h('div', { class: 'shared-status' });
    const actions = h('div', { class: 'shared-actions' });
    const newer = local && (local.shared?.revision ?? 0) < m.revision;

    if (!local) {
      actions.append(h('button', { class: 'btn primary big', type: 'button', onclick: () => start(m) }, icon('import'), 'Download to this device'));
      const need = sharedSize(m);
      const est = await navigator.storage?.estimate?.().catch(() => undefined);
      const free = est?.quota && est.usage !== undefined ? est.quota - est.usage : NaN;
      status.append(
        h('p', { class: 'muted small' }, `Needs ${fmtBytes(need)} of space. Works offline once downloaded.`),
        ...(free < need * 1.05 ? [h('p', { class: 'shared-warn' }, `This device may not have enough free space (about ${fmtBytes(free)} available).`)] : []),
      );
    } else if (newer) {
      status.append(
        h('p', null, `A newer version was shared on ${fmtDate(Date.parse(m.sharedAt))}. You have the one from ${fmtDate(Date.parse(local.shared!.sharedAt))}.`),
        h('p', { class: 'muted small' }, 'Updating replaces your copy, including any changes you made to it.'),
      );
      actions.append(
        h('button', { class: 'btn primary big', type: 'button', onclick: () => start(m, local) }, icon('import'), 'Update your copy'),
        h('button', { class: 'btn', type: 'button', onclick: () => go(`#/session/${local.id}`) }, 'Open your copy'),
      );
    } else {
      status.append(h('p', null, 'This session is already on this device and up to date.'));
      actions.append(h('button', { class: 'btn primary big', type: 'button', onclick: () => go(`#/session/${local.id}`) }, 'Open session'));
    }

    show(
      h('div', { class: 'shared-icon' }, icon('import')),
      kicker('Shared session'),
      h('h1', { class: 'shared-title' }, m.session.title || 'Shared session'),
      h('p', { class: 'muted' }, summary(m), h('br'), `Shared ${fmtDate(Date.parse(m.sharedAt))}`),
      ...(thumbs.length ? [h('div', { class: 'shared-thumbs' }, ...thumbs.map((s) => h('img', { src: s.thumb!, alt: '' })))] : []),
      status,
      actions,
    );
  }

  async function start(m: SharedManifest, replace?: Session) {
    const bar = h('div', { class: 'progress-bar' });
    const detail = h('p', { class: 'muted small' }, 'Starting…');
    aborter = new AbortController();
    show(
      h('div', { class: 'shared-icon' }, icon('import')),
      kicker(replace ? 'Updating' : 'Downloading'),
      h('h1', { class: 'shared-title' }, m.session.title || 'Shared session'),
      h('div', { class: 'progress' }, bar),
      detail,
      h('div', { class: 'shared-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => aborter?.abort() }, 'Cancel')),
    );
    const onProgress = (p: DownloadProgress) => {
      bar.style.width = `${Math.round((p.done / Math.max(1, p.total)) * 100)}%`;
      detail.textContent = `Clip ${p.clip} of ${p.clips} · ${fmtBytes(p.done)} of ${fmtBytes(p.total)}`;
    };
    try {
      const { session, unplayable } = await downloadShared(link, m, onProgress, replace, aborter.signal);
      if (gone) return;
      if (unplayable.length) await warnUnplayable(unplayable);
      go(`#/session/${session.id}`);
    } catch (e) {
      if (gone) return;
      if ((e as Error).name === 'AbortError') return showManifest(m, await findLocalCopy(link));
      showError(e as Error);
    }
  }

  load();
  return () => {
    gone = true;
    aborter?.abort();
  };
}
