import './styles.css';
import { renderEditor } from './views/editor';
import { renderHome } from './views/home';
import { renderPresent } from './views/present';
import { renderShared } from './views/shared';

const root = document.getElementById('app')!;
let cleanup: () => void = () => {};
let renderToken = 0;

// Routes:  #/  ·  #/session/:id[/:slideId]  ·  #/present/:id/:index  ·  #/s/:link (open a share link)
async function route() {
  const token = ++renderToken;
  cleanup();
  cleanup = () => {};
  // Each screen renders into its own container so a slow, superseded render can be thrown away cleanly.
  const view = document.createElement('div');
  view.className = 'view';
  root.replaceChildren(view);
  const [, page, id, extra] = location.hash.replace(/^#\/?/, '/').split('/');
  let done: () => void;
  try {
    if (page === 'session' && id) done = await renderEditor(view, id, extra);
    else if (page === 'present' && id) done = await renderPresent(view, id, Number(extra) || 0);
    else if (page === 's' && id) done = await renderShared(view, id);
    else done = await renderHome(view);
  } catch (e) {
    console.error(e);
    view.replaceChildren(Object.assign(document.createElement('pre'), { className: 'fatal', textContent: `Something went wrong:\n${(e as Error).message}` }));
    return;
  }
  if (token !== renderToken) {
    // A newer navigation started while this one was loading.
    done();
    view.remove();
    return;
  }
  cleanup = done;
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && !/[?&]nosw\b/.test(location.search)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
