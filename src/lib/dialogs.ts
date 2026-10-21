// Promise-based dialogs built on <dialog>.
import { h } from './dom';

function open(content: HTMLElement[], opts: { dismissable?: boolean } = {}): HTMLDialogElement {
  const d = h('dialog', { class: 'dialog' }, ...content);
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  if (opts.dismissable === false) d.addEventListener('cancel', (e) => e.preventDefault());
  d.showModal();
  return d;
}

export function confirmDialog(title: string, message: string, okLabel = 'OK', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let ok = false;
    const d = open([
      h('h2', null, title),
      h('p', null, message),
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Cancel'),
        h('button', { class: danger ? 'btn danger' : 'btn primary', type: 'button', onclick: () => ((ok = true), d.close()) }, okLabel),
      ),
    ]);
    d.addEventListener('close', () => resolve(ok));
  });
}

export function promptDialog(title: string, initial = '', okLabel = 'Save', placeholder = ''): Promise<string | null> {
  return new Promise((resolve) => {
    let value: string | null = null;
    const input = h('input', { class: 'input', type: 'text', value: initial, placeholder, enterkeyhint: 'done' });
    const form = h(
      'form',
      {
        method: 'dialog',
        onsubmit: () => {
          value = input.value.trim();
        },
      },
      h('h2', null, title),
      input,
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'submit' }, okLabel),
      ),
    );
    const d = open([form]);
    input.select();
    d.addEventListener('close', () => resolve(value || null));
  });
}

export function alertDialog(title: string, message: string): Promise<void> {
  return new Promise((resolve) => {
    const d = open([
      h('h2', null, title),
      h('p', null, message),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => d.close() }, 'OK')),
    ]);
    d.addEventListener('close', () => resolve());
  });
}

/** Shows a choice of actions; resolves with the chosen key or null. */
export function choiceDialog(title: string, message: string, choices: { key: string; label: string; primary?: boolean }[]): Promise<string | null> {
  return new Promise((resolve) => {
    let picked: string | null = null;
    const d = open([
      h('h2', null, title),
      h('p', null, message),
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Close'),
        ...choices.map((c) => h('button', { class: c.primary ? 'btn primary' : 'btn', type: 'button', onclick: () => ((picked = c.key), d.close()) }, c.label)),
      ),
    ]);
    d.addEventListener('close', () => resolve(picked));
  });
}

export interface ProgressHandle {
  update(fraction: number, detail?: string): void;
  close(): void;
}

export function progressDialog(title: string): ProgressHandle {
  const bar = h('div', { class: 'progress-bar' });
  const detail = h('p', { class: 'muted small' }, '');
  const d = open([h('h2', null, title), h('div', { class: 'progress' }, bar), detail], { dismissable: false });
  return {
    update(fraction, text) {
      bar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
      if (text !== undefined) detail.textContent = text;
    },
    close: () => d.close(),
  };
}

let toastTimer: number | undefined;
export function toast(message: string) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 2600);
}
