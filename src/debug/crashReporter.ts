/**
 * On-screen crash reporter — captures uncaught errors (including anything thrown inside Phaser's
 * frame loop) and surfaces them as a copyable overlay ON THE DEVICE, because this game is usually
 * played/tested on a phone where the JS console is out of reach (see CLAUDE.md cross-device rule).
 *
 * Three parts:
 *  - {@link breadcrumb} — a bounded ring buffer game systems push to (`breadcrumb('node', 'chop …')`),
 *    so an *intermittent* crash's report includes the sequence of events that led up to it, not just
 *    the final stack.
 *  - {@link setCrashContext} — the game registers a provider returning a live state snapshot (current
 *    action, player tile, node counts …), sampled at crash time.
 *  - {@link installCrashReporter} — installs the global `error` / `unhandledrejection` listeners and,
 *    on the first crash, builds a full-screen overlay with the error + stack + breadcrumbs + snapshot
 *    + env and a "Copy report" button.
 *
 * Everything here is wrapped so the reporter can NEVER itself throw (a reporter that crashes while
 * reporting a crash is useless). Always-on (not dev-gated): the whole point is to catch it in the
 * deployed build on Matt's phone.
 */

type Breadcrumb = { t: number; cat: string; msg: string; data?: unknown };

const MAX_CRUMBS = 60;
const crumbs: Breadcrumb[] = [];
let contextProvider: (() => Record<string, unknown>) | null = null;
let installed = false;
/** Signatures already shown, so a loop that throws the same error every frame reports ONCE. */
const seenSignatures = new Set<string>();
let overlay: HTMLElement | null = null;

/** Push a lightweight event onto the breadcrumb trail (kept to the last {@link MAX_CRUMBS}). Cheap and
 *  always-on; `data` is shallow — pass ids/tiles/flags, not whole sprites. Never throws. */
export function breadcrumb(cat: string, msg: string, data?: unknown): void {
  try {
    crumbs.push({ t: now(), cat, msg, data });
    if (crumbs.length > MAX_CRUMBS) crumbs.shift();
  } catch {
    /* ignore — a breadcrumb must never break the caller */
  }
}

/** Register a provider sampled at crash time for a live game-state snapshot in the report. The provider
 *  is called inside a try/catch, so it may read live scene state without extra guarding of its own. */
export function setCrashContext(provider: () => Record<string, unknown>): void {
  contextProvider = provider;
}

/** Install the global handlers (idempotent). Call once, before the game boots. */
export function installCrashReporter(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e: ErrorEvent) => {
    // Ignore resource-load errors (img/script 404s dispatch 'error' on window with no `.error`/message
    // and a non-window target) — we only want real script exceptions.
    if (!e.error && !e.message) return;
    report(e.error ?? e.message, 'error');
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    report(e.reason, 'unhandledrejection');
  });
  breadcrumb('boot', 'crash reporter installed');
}

// --- internals -----------------------------------------------------------------

function now(): number {
  try {
    return Math.round(performance.now());
  } catch {
    return 0;
  }
}

function normalize(err: unknown): { name: string; message: string; stack: string } {
  if (err instanceof Error) {
    return { name: err.name || 'Error', message: err.message || '', stack: err.stack || '(no stack)' };
  }
  return { name: 'NonError', message: safeString(err), stack: '(no stack — thrown value was not an Error)' };
}

function safeString(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function report(err: unknown, kind: string): void {
  try {
    const { name, message, stack } = normalize(err);
    const sig = `${name}|${message}|${(stack.split('\n')[1] ?? '').trim()}`;
    breadcrumb('crash', `${kind}: ${name}: ${message}`);
    if (seenSignatures.has(sig)) return; // same crash already reported (e.g. thrown every frame)
    seenSignatures.add(sig);

    const text = buildReport(kind, name, message, stack);
    console.error('[crash]\n' + text);
    pauseGameLoop();
    showOverlay(`${name}: ${message}`, text);
  } catch {
    /* the reporter must never throw */
  }
}

function buildReport(kind: string, name: string, message: string, stack: string): string {
  const lines: string[] = [];
  lines.push('=== Mostowo Survival crash report ===');
  lines.push(`when:   ${nowIso()}`);
  lines.push(`kind:   ${kind}`);
  lines.push(`build:  ${buildTag()}`);
  lines.push(`ua:     ${nav('userAgent')}`);
  lines.push(`screen: ${viewportInfo()}`);
  lines.push('');
  lines.push(`error:  ${name}: ${message}`);
  lines.push(stack.trim());
  lines.push('');
  lines.push('context:');
  lines.push(indent(snapshot()));
  lines.push('');
  lines.push(`breadcrumbs (oldest → newest, t = ms since load):`);
  if (crumbs.length === 0) lines.push('  (none)');
  for (const c of crumbs) {
    const data = c.data === undefined ? '' : ' ' + safeString(c.data);
    lines.push(`  [t=${c.t}] ${c.cat}: ${c.msg}${data}`);
  }
  return lines.join('\n');
}

function snapshot(): string {
  if (!contextProvider) return '  (no context provider registered)';
  try {
    return safeString(contextProvider());
  } catch (e) {
    return `  (context provider threw: ${normalize(e).message})`;
  }
}

function nowIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return '(unknown)';
  }
}

function buildTag(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
    return `${env.MODE ?? 'unknown'}${env.DEV ? ' (dev)' : ''}`;
  } catch {
    return 'unknown';
  }
}

function nav(key: 'userAgent'): string {
  try {
    return navigator[key];
  } catch {
    return '(unknown)';
  }
}

function viewportInfo(): string {
  try {
    return `${window.innerWidth}×${window.innerHeight} dpr ${window.devicePixelRatio}`;
  } catch {
    return '(unknown)';
  }
}

function indent(s: string): string {
  return s
    .split('\n')
    .map((l) => (l.startsWith('  ') ? l : '  ' + l))
    .join('\n');
}

/** Pause Phaser's frame loop so a per-frame throw doesn't keep firing behind the overlay. Best-effort;
 *  {@link dismiss} wakes it again in case the crash was recoverable. */
function pauseGameLoop(): void {
  try {
    (window as unknown as { game?: { loop?: { sleep?: () => void } } }).game?.loop?.sleep?.();
  } catch {
    /* ignore */
  }
}

function wakeGameLoop(): void {
  try {
    (window as unknown as { game?: { loop?: { wake?: () => void } } }).game?.loop?.wake?.();
  } catch {
    /* ignore */
  }
}

// --- overlay (plain DOM, sits above the Phaser canvas) -------------------------

function showOverlay(title: string, text: string): void {
  // If an overlay is already up (a second, distinct crash), just append the new report beneath it.
  if (overlay) {
    const pre = overlay.querySelector('pre');
    if (pre) pre.textContent += '\n\n' + text;
    return;
  }

  const root = document.createElement('div');
  root.setAttribute('data-crash-overlay', '');
  style(root, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    background: 'rgba(20,16,15,0.97)',
    color: '#f2e9e4',
    font: '13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    display: 'flex',
    flexDirection: 'column',
    padding: 'env(safe-area-inset-top,8px) 8px env(safe-area-inset-bottom,8px) 8px',
    boxSizing: 'border-box',
    userSelect: 'text',
    webkitUserSelect: 'text',
  });

  const header = document.createElement('div');
  style(header, { flex: '0 0 auto', padding: '4px 4px 8px' });
  const h = document.createElement('div');
  h.textContent = '⚠ Crash caught';
  style(h, { fontSize: '16px', fontWeight: '700', color: '#ff8a6b', marginBottom: '4px' });
  const sub = document.createElement('div');
  sub.textContent = title;
  style(sub, { color: '#ffb3a0', wordBreak: 'break-word' });
  header.appendChild(h);
  header.appendChild(sub);

  const pre = document.createElement('pre');
  pre.textContent = text;
  style(pre, {
    flex: '1 1 auto',
    overflow: 'auto',
    margin: '0',
    padding: '8px',
    background: 'rgba(0,0,0,0.35)',
    border: '1px solid #4a3f3a',
    borderRadius: '6px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    userSelect: 'text',
    webkitUserSelect: 'text',
  });

  const buttons = document.createElement('div');
  style(buttons, { flex: '0 0 auto', display: 'flex', gap: '8px', paddingTop: '8px' });
  buttons.appendChild(button('Copy report', '#3a5a3a', () => copyText(text, pre)));
  buttons.appendChild(button('Dismiss', '#5a3a3a', dismiss));

  root.appendChild(header);
  root.appendChild(pre);
  root.appendChild(buttons);
  document.body.appendChild(root);
  overlay = root;
}

function dismiss(): void {
  try {
    overlay?.remove();
  } finally {
    overlay = null;
    wakeGameLoop(); // resume in case the crash was recoverable
  }
}

function button(label: string, bg: string, onTap: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  style(b, {
    flex: '1 1 0',
    minHeight: '48px', // finger-sized tap target
    fontSize: '15px',
    fontWeight: '600',
    color: '#f2e9e4',
    background: bg,
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '8px',
    cursor: 'pointer',
  });
  b.addEventListener('click', (e) => {
    e.preventDefault();
    try {
      onTap();
    } catch {
      /* ignore */
    }
  });
  return b;
}

function copyText(text: string, pre: HTMLElement): void {
  const done = (ok: boolean): void => flashSelection(pre, ok);
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => done(true),
        () => done(fallbackCopy(text)),
      );
      return;
    }
  } catch {
    /* fall through */
  }
  done(fallbackCopy(text));
}

/** Clipboard-API-less copy (http localhost, older mobile browsers): stuff the text in a textarea,
 *  select, execCommand. Returns whether it worked. */
function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    style(ta, { position: 'fixed', top: '-1000px', left: '0', opacity: '0' });
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Visual confirmation of a copy: on success flash the panel border green; on failure select the text
 *  so the user can copy it by hand (the whole report is already user-selectable). */
function flashSelection(pre: HTMLElement, ok: boolean): void {
  try {
    if (ok) {
      const prev = pre.style.borderColor;
      pre.style.borderColor = '#5fd35f';
      window.setTimeout(() => (pre.style.borderColor = prev), 600);
    } else {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  } catch {
    /* ignore */
  }
}

/** Minimal typed inline-style setter (avoids fighting the strict CSSStyleDeclaration index type). */
function style(el: HTMLElement, props: Record<string, string>): void {
  const s = el.style as unknown as Record<string, string>;
  for (const k in props) s[k] = props[k];
}
