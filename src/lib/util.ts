/** Random id. Works outside secure contexts too (e.g. testing over plain http on a LAN). */
export function uid(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function fmtTime(sec: number, withTenths = true): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const whole = Math.floor(s);
  const base = `${m}:${String(whole).padStart(2, '0')}`;
  return withTenths ? `${base}.${Math.floor((s - whole) * 10)}` : base;
}

export function fmtBytes(n: number): string {
  if (!isFinite(n)) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export function slug(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .slice(0, 60) || 'session'
  );
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: number | undefined;
  let pending: A | null = null;
  const wrapped = (...a: A) => {
    pending = a;
    clearTimeout(t);
    t = window.setTimeout(() => {
      pending = null;
      fn(...a);
    }, ms);
  };
  /** Run now if a call is waiting; otherwise do nothing. */
  wrapped.flush = () => {
    clearTimeout(t);
    if (pending) {
      const a = pending;
      pending = null;
      fn(...a);
    }
  };
  /** Drop any waiting call. */
  wrapped.cancel = () => {
    clearTimeout(t);
    pending = null;
  };
  return wrapped;
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

/** The app's version from package.json, set in index.html at build time. */
export function appVersion(): string {
  return (window as unknown as { APP_VERSION?: string }).APP_VERSION ?? '';
}
