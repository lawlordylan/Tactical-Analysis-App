// Sessions list.
import { confirmDialog, promptDialog, toast } from '../lib/dialogs';
import { h, icon, iconBtn } from '../lib/dom';
import { storageInfo } from '../lib/files';
import { createSession, deleteSession, getSlide, listSessions } from '../lib/store';
import type { Session } from '../lib/types';
import { fmtBytes, fmtDate } from '../lib/util';
import { go, pickAndImport, runExport, startPresenting } from './actions';

export async function renderHome(root: HTMLElement): Promise<() => void> {
  const list = h('div', { class: 'session-grid' });
  const footer = h('footer', { class: 'storage-line muted small' });

  const newSession = async () => {
    const title = await promptDialog('New session', '', 'Create', 'e.g. vs Rovers – 2nd half');
    if (title === null) return;
    const s = await createSession(title);
    go(`#/session/${s.id}`);
  };

  root.append(
    h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('target')), h('span', null, 'Tactical Analysis')),
      h(
        'div',
        { class: 'topbar-actions' },
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: async () => {
              const s = await pickAndImport();
              if (s) go(`#/session/${s.id}`);
            },
          },
          icon('import'),
          h('span', { class: 'label' }, 'Import'),
        ),
        h('button', { class: 'btn primary', type: 'button', onclick: newSession }, icon('plus'), h('span', { class: 'label' }, 'New session')),
      ),
    ),
    h('main', { class: 'home' }, h('h1', { class: 'page-title' }, 'Sessions'), list, footer),
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
          h('p', { class: 'muted' }, 'Create a session, add your match clips, mark the key moments, then present it to the squad.'),
          h('button', { class: 'btn primary', type: 'button', onclick: newSession }, icon('plus'), 'New session'),
        ),
      );
    }
    for (const s of sessions) list.append(await card(s));

    const info = await storageInfo();
    footer.replaceChildren(
      `Stored on this device: ${fmtBytes(info.usage)}${isFinite(info.quota) ? ` of ~${fmtBytes(info.quota)} available` : ''}`,
      info.persisted ? ' · protected from automatic clean-up' : '',
    );
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
        h('div', { class: 'thumb' }, first?.thumb ? h('img', { src: first.thumb, alt: '' }) : icon('film')),
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

  await refresh();
  return () => {};
}
