// Tiny DOM helper. Text is always set with textContent, so player names
// can never inject HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// Shows a message in a status area that screen readers announce.
export function say(el, msg, kind = 'info') {
  el.textContent = msg || '';
  el.dataset.kind = kind;
  el.hidden = !msg;
}

// Runs an async action with a busy button and a status message.
export async function busy(button, statusEl, fn, { done } = {}) {
  const label = button?.textContent;
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  if (statusEl) say(statusEl, 'Working…');
  try {
    const out = await fn();
    if (statusEl) say(statusEl, done || '', 'ok');
    return out;
  } catch (err) {
    if (statusEl) say(statusEl, err.message, 'error');
    throw err;
  } finally {
    if (button) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = label; }
  }
}
