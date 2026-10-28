// Sessions list.
import { confirmDialog, promptDialog, toast } from '../lib/dialogs';
import { h, icon, iconBtn } from '../lib/dom';
import { storageInfo } from '../lib/files';
import { createSession, deleteSession, getSlide, listSessions } from '../lib/store';
import type { Session } from '../lib/types';
import { appVersion, fmtBytes, fmtDate } from '../lib/util';
import { CREST, go, pickAndImport, runExport, startPresenting } from './actions';
import { openTour, tourSeen } from './tour';

export async function renderHome(root: HTMLElement): Promise<() => void> {
  const list = h('div', { class: 'session-grid' });
  const footer = h('footer', { class: 'storage-line muted small' });

  const newSession = async () => {
    const title = await promptDialog('New session', '', 'Create', 'e.g. vs Rovers – 2nd half');
    if (title === null) return;
    const s = await createSession(title);
    go(`#/session/${s.id}`);
  };

  const importSession = async () => {
    const s = await pickAndImport();
    if (s) go(`#/session/${s.id}`);
  };

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
      h(
        'div',
        { class: 'topbar-actions' },
        h('button', { class: 'btn', type: 'button', title: 'How it works', onclick: () => openTour() }, icon('help'), h('span', { class: 'label' }, 'How it works')),
      ),
    ),
    h(
      'main',
      { class: 'home' },
      h(
        'section',
        { class: 'hero' },
        h('img', { class: 'hero-crest', src: CREST, alt: 'Killeshin F.C. crest' }),
        h(
          'div',
          { class: 'hero-text' },
          h('span', { class: 'hero-kicker' }, 'Killeshin F.C. · Est 1983'),
          h('h1', null, 'Match analysis'),
          h('p', null, 'Add your match clips, mark the key moments, then present them to the squad.'),
          h(
            'div',
            { class: 'hero-actions' },
            h('button', { class: 'btn white', type: 'button', onclick: newSession }, icon('plus'), 'New session'),
            h('button', { class: 'btn', type: 'button', onclick: importSession }, icon('import'), 'Import session'),
          ),
        ),
      ),
      h('h2', { class: 'page-title' }, 'Sessions'),
      list,
      footer,
    ),
  );

  async function refresh() {
    const sessions = await listSessions();
    list.replaceChildren();
    if (!sessions.length) {
      list.append(
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'empty-icon' }, icon('film')),
          h('h2', null, 'No sessions yet'),
          h('p', { class: 'muted' }, 'Start with a new session for your latest match, or import one shared from another device.'),
          h('button', { class: 'btn primary', type: 'button', onclick: newSession }, icon('plus'), 'New session'),
          h('button', { class: 'btn tour-link', type: 'button', onclick: () => openTour() }, 'New here? See how it works'),
        ),
      );
    }
    for (const s of sessions) list.append(await card(s));

    const info = await storageInfo();
    footer.replaceChildren(
      `Stored on this device: ${fmtBytes(info.usage)}${isFinite(info.quota) ? ` of ~${fmtBytes(info.quota)} available` : ''}`,
      info.persisted ? ' · protected from automatic clean-up' : '',
    );
    return sessions.length;
  }

  async function card(s: Session): Promise<HTMLElement> {
    const first = s.slideIds[0] ? await getSlide(s.slideIds[0]) : undefined;
    const n = s.slideIds.length;
    return h(
      'article',
      { class: 'session-card' },
      h(
        'button',
        { class: 'session-open', type: 'button', onclick: () => go(`#/session/${s.id}`), 'aria-label': `Open ${s.title}` },
        h('div', { class: 'thumb' }, first?.thumb ? h('img', { src: first.thumb, alt: '' }) : h('img', { class: 'thumb-crest', src: CREST, alt: '' })),
        h('div', { class: 'session-meta' }, h('h3', null, s.title), h('p', { class: 'muted small' }, `${n} clip${n === 1 ? '' : 's'} · ${fmtDate(s.updatedAt)}`)),
      ),
      h(
        'div',
        { class: 'card-actions' },
        iconBtn('present', 'Present', () => (n ? startPresenting(s.id) : toast('Add clips before presenting'))),
        iconBtn('export', 'Export', () => runExport(s)),
        iconBtn('trash', 'Delete', async () => {
          if (await confirmDialog('Delete session?', `“${s.title}” and its ${n} clip${n === 1 ? '' : 's'} will be removed from this device.`, 'Delete', true)) {
            await deleteSession(s.id);
            toast('Session deleted');
            refresh();
          }
        }),
      ),
    );
  }

  const count = await refresh();
  // First visit: no sessions yet and the tour hasn't been seen.
  if (!count && !tourSeen()) openTour();
  return () => {};
}
