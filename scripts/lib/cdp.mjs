// Minimal Chrome DevTools Protocol driver for the smoke and a11y scripts. No dependencies:
// Node 24's global WebSocket + fetch, plus a local headless `google-chrome`.
//
// launch({ url }) → { send, evaluate, on, errors, logs, close }
//   errors: Runtime.exceptionThrown texts (the smoke asserts this stays empty)
//   logs:   console errors + failed resource loads (a missing vendor/ file shows up here)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// A page to test: an http(s):// URL is used as-is (e.g. the live GitHub Pages copy); anything
// else is a local directory (→ its index.html) or .html file, opened over file://.
export function pageUrl(rootOrFile) {
  if (/^https?:\/\//i.test(rootOrFile)) return new URL(rootOrFile).href;
  const p = resolve(rootOrFile);
  return pathToFileURL(p.endsWith('.html') ? p : join(p, 'index.html')).href;
}

export async function launch({ chrome = process.env.CHROME || 'google-chrome', width = 1280, height = 900 } = {}) {
  // A throwaway profile per run. Port 0 lets Chrome pick a free port, so parallel runs don't collide.
  const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'sdp-cdp-'));
  const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  let procExit = null; proc.on('exit', c => { procExit = c; });

  let port;
  for (let i = 0; i < 80 && !port; i++) {
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) port = Number(readFileSync(f, 'utf8').split('\n')[0]) || undefined;
    if (!port) { if (procExit !== null) break; await sleep(100); }
  }
  if (!port) { cleanup(); throw new Error(`chrome did not start (exit ${procExit})`); }

  let targets;
  for (let i = 0; i < 40 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(100); }
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map(), listeners = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(`${p.method}: ${JSON.stringify(m.error)}`)) : p.res(m.result);
    } else if (m.method) for (const fn of listeners.get(m.method) || []) fn(m.params);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej, method }); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const on = (method, fn) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); };
  const once = method => new Promise(r => { const fn = p => { const l = listeners.get(method); l.splice(l.indexOf(fn), 1); r(p); }; on(method, fn); });

  const errors = [], logs = [];
  on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
  on('Runtime.consoleAPICalled', p => { if (p.type === 'error') logs.push('console.error: ' + p.args.map(a => a.value ?? a.description).join(' ')); });
  on('Log.entryAdded', p => { if (p.entry.level === 'error') logs.push(`log: ${p.entry.text} ${p.entry.url || ''}`); });
  on('Network.loadingFailed', p => { if (!p.canceled) logs.push(`loadingFailed: ${p.errorText} ${p.requestId}`); });
  await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable'), send('Network.enable'), send('DOM.enable')]);
  // Headless pages never have OS focus, so el.focus() fires no focus/focusin events and
  // :focus-visible never matches. Emulate a focused page so focus-driven code (undo snapshots,
  // focus rings) behaves as it does for a real user.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async function navigate(url, settleMs = 300) {
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url });
    await Promise.race([loaded, sleep(10000)]);
    await sleep(settleMs);
  }
  async function waitFor(expr, timeoutMs = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { try { if (await evaluate(expr)) return true; } catch {} await sleep(100); }
    return false;
  }
  function cleanup() { try { proc.kill('SIGTERM'); } catch {} setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 300).unref?.(); }
  async function close() { try { ws.close(); } catch {} cleanup(); await sleep(350); try { rmSync(profile, { recursive: true, force: true }); } catch {} }
  return { send, evaluate, navigate, waitFor, on, errors, logs, close };
}

// Tiny check runner: prints one line per check, returns the counts.
// url with one query parameter set, keeping any query/hash already on it.
export function withParam(url, key, value) { const u = new URL(url); u.searchParams.set(key, value); return u.href; }

export function runner(label) {
  const results = [];
  async function check(name, fn) {
    try {
      const detail = await fn();
      if (detail === false) throw new Error('returned false');
      results.push({ name, ok: true }); console.log(`  ok   ${name}${detail && detail !== true ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
      return true;
    } catch (e) {
      results.push({ name, ok: false, error: e.message }); console.log(`  FAIL ${name} — ${e.message}`);
      return false;
    }
  }
  function summary() {
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`${label}: ${pass} passed, ${fail} failed`);
    return { pass, fail, results };
  }
  return { check, summary };
}

export function assert(cond, msg) { if (!cond) throw new Error(msg); }
export const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
