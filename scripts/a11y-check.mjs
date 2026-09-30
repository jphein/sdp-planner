#!/usr/bin/env node
// Accessibility check over CDP (headless Chrome, no dependencies).
//
//   node scripts/a11y-check.mjs [--root DIR | path/to/index.html | https://host/path/]
//
// Runs on the onboarding view and on the app in demo mode (?demo=1), in BOTH light and dark
// (prefers-color-scheme emulation), and asserts:
//   labels    every rendered input/select/textarea has an accessible name
//             (aria-label, aria-labelledby, <label for>, wrapping <label>, or title)
//   tables    every <table> has <th>, and every <th> has scope=col|row|colgroup|rowgroup
//   contrast  every visible text element (and form control) reaches WCAG AA against its composited
//             background: 4.5:1, or 3:1 for large text (>= 24px, or >= 18.66px bold). Colors are
//             the resolved computed styles, so the CSS custom properties are honoured.
//   tokens    text-ish :root custom properties (--ink*, --text*, --fg*, --muted*, status colors)
//             reach 4.5:1 on every paper/background token of the same theme
//   focus     Tab walks the page; every stop shows a visible indicator (outline, box-shadow,
//             border or background change) whose color reaches 3:1 against the background
//   page      <html lang>, <title>, an SVG favicon, an aria-live region
// Exits 1 on any failure. Disabled controls and near-invisible decorative text (opacity < 0.2)
// are exempt (WCAG 1.4.3 "incidental"); they are listed, not failed.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, pageUrl, withParam, runner, assert } from './lib/cdp.mjs';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const rootArg = args.includes('--root') ? args[args.indexOf('--root') + 1] : args.find(a => !a.startsWith('--')) || here;
const base = pageUrl(rootArg);
const verbose = args.includes('--verbose');

// In-page library. Colors are normalized through a 1x1 canvas, so any CSS color syntax works.
const LIB = String.raw`window.__a11y = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  function rgba(c) {
    if (!c || c === 'transparent') return [0, 0, 0, 0];
    const m = /^rgba?\(([^)]+)\)$/.exec(c);
    if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
  }
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (!a) return [0, 0, 0, 0];
    return [0, 1, 2].map(i => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a); };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  function path(el) {
    const out = []; for (let e = el; e && e.nodeType === 1 && out.length < 4; e = e.parentElement) {
      let s = e.tagName.toLowerCase(); if (e.id) { out.unshift(s + '#' + e.id); break; }
      const cls = [...e.classList].slice(0, 2).join('.'); if (cls) s += '.' + cls;
      for (const a of ['data-k', 'data-auth', 'data-fill']) if (e.hasAttribute(a)) s += '[' + a + '="' + e.getAttribute(a) + '"]';
      out.unshift(s);
    } return out.join(' > ');
  }
  function rendered(el) {
    if (!el.getClientRects().length) return false;
    for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none') return false;
      if (s.clip === 'rect(0px, 0px, 0px, 0px)' || (s.position === 'absolute' && parseFloat(s.width) <= 1 && parseFloat(s.height) <= 1 && s.overflow === 'hidden')) return false; }
    return true;
  }
  // Composite the background under el by walking up the ancestors. null = an image/gradient is in the way.
  function background(el) {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = rgba(s.backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let bg = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg); return bg;
  }
  const opacityOf = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  function name(el) {
    const al = (el.getAttribute('aria-label') || '').trim(); if (al) return al;
    const lb = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => (document.getElementById(id) || {}).textContent || '').join(' ').trim(); if (lb) return lb;
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && l.textContent.trim()) return l.textContent.trim(); }
    const wrap = el.closest('label'); if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
    return (el.getAttribute('title') || '').trim();
  }
  function labels() {
    const bad = [];
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (el.type === 'hidden') continue;
      // an sr-only file input is still in the accessibility tree; only display:none/hidden is out
      if (!el.getClientRects().length && getComputedStyle(el).display === 'none') continue;
      if (el.closest('[hidden]')) continue;
      if (!name(el)) bad.push(path(el));
    }
    return bad;
  }
  function tables() {
    const bad = [];
    document.querySelectorAll('table').forEach((t, i) => {
      if (t.closest('[hidden]')) return;
      const ths = t.querySelectorAll('th');
      if (!ths.length && t.querySelector('td')) bad.push(path(t) + ' (table ' + (i + 1) + '): no <th>');
      ths.forEach(th => { if (!/^(col|row|colgroup|rowgroup)$/.test(th.getAttribute('scope') || '')) bad.push(path(th) + ' "' + th.textContent.trim().slice(0, 30) + '": no scope'); });
    });
    return bad;
  }
  function contrast() {
    const fails = [], exempt = [], unknown = []; let checked = 0;
    const els = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) if (n.textContent.trim() && n.parentElement) els.add(n.parentElement);
    document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea, button').forEach(e => els.add(e));
    for (const el of els) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'OPTION'].includes(el.tagName) || !rendered(el)) continue;
      const s = getComputedStyle(el);
      const op = opacityOf(el);
      if (el.disabled || el.closest('[disabled], [aria-disabled=true]')) { exempt.push(path(el) + ' (disabled)'); continue; }
      if (op < 0.2) { exempt.push(path(el) + ' (decorative, opacity ' + op.toFixed(2) + ')'); continue; }
      const bg = background(el); if (!bg) { unknown.push(path(el)); continue; }
      let fg = rgba(s.color); fg = [fg[0], fg[1], fg[2], fg[3] * op];
      const r = ratio(over(fg, bg), bg);
      const px = parseFloat(s.fontSize), bold = parseInt(s.fontWeight, 10) >= 700;
      const need = (px >= 24 || (bold && px >= 18.66)) ? 3 : 4.5;
      checked++;
      if (r + 1e-9 < need) fails.push({ el: path(el), text: (el.value || el.textContent).trim().slice(0, 40), ratio: +r.toFixed(2), need, fg: hex(over(fg, bg)), bg: hex(bg), px });
    }
    return { checked, fails, exempt, unknown };
  }
  function tokens() {
    const cs = getComputedStyle(document.documentElement), vars = [];
    // file:// stylesheets are opaque to cssRules, but the computed style enumerates custom properties
    for (const p of cs) if (p.startsWith('--')) vars.push(p);
    for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; }
      const walk = rs => { for (const r of rs) { if (r.style) for (const p of r.style) if (p.startsWith('--')) vars.push(p); if (r.cssRules) walk(r.cssRules); } }; walk(rules); }
    const val = {}; for (const v of new Set(vars)) { const x = cs.getPropertyValue(v).trim(); if (x && /^(#|rgb|hsl|oklch|oklab|lab|lch|color\()/.test(x)) val[v] = rgba(x); }
    const isBg = n => /paper|(^|-)bg|surface|canvas|-soft$/.test(n) && !/ink/.test(n);
    const isText = n => /ink|text|fg|muted|dim|(^--)(ok|warn|bad|good|danger|error|success|accent)$/.test(n) && !isBg(n) && !/rule|focus|border|grain|line/.test(n);
    const bgs = Object.keys(val).filter(n => isBg(n) && val[n][3] >= 1 && !/-soft$/.test(n));
    const fails = [], pairs = [];
    for (const t of Object.keys(val).filter(isText)) {
      // --accent-ink is text on --accent, not on paper
      const on = /^--(.+)-ink$/.test(t) && val['--' + t.match(/^--(.+)-ink$/)[1]] ? ['--' + t.match(/^--(.+)-ink$/)[1]] : bgs.concat(val[t + '-soft'] ? [t + '-soft'] : []);
      for (const b of on) { const r = ratio(over(val[t], val[b]), val[b]); pairs.push(t + ' on ' + b + ' ' + r.toFixed(2)); if (r < 4.5) fails.push(t + ' on ' + b + ': ' + r.toFixed(2) + ' (' + hex(val[t]) + ' / ' + hex(val[b]) + ')'); }
    }
    return { pairs, fails };
  }
  function focusables() {
    return [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter(e => e.tabIndex >= 0 && !e.disabled && rendered(e));
  }
  function ring(el) { const s = getComputedStyle(el); return { outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? s.outlineColor : null, shadow: s.boxShadow, border: s.borderTopColor + s.borderBottomColor + s.borderBottomWidth, bg: s.backgroundColor }; }
  function baseline() { const m = new Map(); document.activeElement && document.activeElement.blur && document.activeElement.blur(); focusables().forEach((e, i) => { e.dataset.qaF = i; m.set(e, ring(e)); }); window.__a11yBase = m; return m.size; }
  function focusState() {
    const el = document.activeElement; if (!el || el === document.body) return { none: true };
    const b = window.__a11yBase.get(el), f = ring(el), bg = background(el.parentElement || el) || [255, 255, 255, 1];
    const changed = !b ? ['(no baseline)'] : ['outline', 'shadow', 'border', 'bg'].filter(k => f[k] !== b[k]);
    let ringRatio = null; if (f.outline) ringRatio = +ratio(over(rgba(f.outline), bg), bg).toFixed(2);
    const visible = !!f.outline || changed.length > 0;
    return { id: el.dataset.qaF ?? ('x:' + path(el)), el: path(el), visible, changed, ringRatio, outline: f.outline && hex(rgba(f.outline)) };
  }
  function page() {
    const icon = document.querySelector('link[rel~="icon"]');
    return { lang: document.documentElement.lang, title: document.title, icon: icon && icon.getAttribute('href'), iconType: icon && icon.getAttribute('type'), live: document.querySelectorAll('[aria-live]').length };
  }
  // Measure the settled page: wait for every finite CSS animation/transition (entrance fades,
  // focus-ring transitions). Reading mid-fade reports false contrast failures.
  function settle(ms = 3000) {
    const fin = document.getAnimations().filter(a => { const t = a.effect && a.effect.getComputedTiming(); return t && t.iterations !== Infinity; });
    return Promise.race([Promise.all(fin.map(a => a.finished.catch(() => {}))), new Promise(r => setTimeout(r, ms))]).then(() => fin.length);
  }
  return { labels, tables, contrast, tokens, baseline, focusState, page, settle, focusables: () => focusables().length };
})();`;

const T = runner('a11y-check');
const { check } = T;
const cdp = await launch();
const ev = cdp.evaluate;
let exitCode = 1;
const list = (arr, n = 8) => arr.slice(0, n).map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('\n        ') + (arr.length > n ? `\n        … +${arr.length - n} more` : '');

async function tab(shift = false) {
  const k = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}

try {
  for (const [view, url] of [['onboarding', base], ['app', withParam(base, 'demo', '1')]]) {
    for (const theme of ['light', 'dark']) {
      const tag = `${view}/${theme}`;
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      // fresh storage per view: the onboarding view only shows when nothing is saved
      await cdp.navigate(base); await ev(`try{localStorage.clear()}catch(e){}`);
      await cdp.navigate(url, 300); await ev(LIB); await ev(`__a11y.settle()`);
      if (view === 'app' && !(await check(`${tag}: demo view renders (?demo=1)`, async () =>
        assert(await cdp.waitFor(`document.querySelectorAll('#calcBody tr').length>0`, 3000), 'no #calcBody rows — is ?demo=1 supported?')))) continue;

      if (theme === 'light') {
        await check(`${tag}: page basics (lang, title, svg favicon, aria-live)`, async () => {
          const p = await ev(`__a11y.page()`);
          const miss = [!p.lang && 'html[lang]', !p.title && '<title>', !(p.icon && (/\.svg($|\?)/.test(p.icon) || /svg/.test(p.iconType || '') || /^data:image\/svg/.test(p.icon))) && 'SVG favicon', !p.live && '[aria-live]'].filter(Boolean);
          assert(!miss.length, 'missing ' + miss.join(', ')); return `lang=${p.lang}, ${p.live} live region(s)`;
        });
        await check(`${tag}: every input/select/textarea has an accessible name`, async () => {
          const bad = await ev(`__a11y.labels()`); assert(!bad.length, `${bad.length} unlabelled:\n        ${list(bad)}`);
          return `${await ev(`document.querySelectorAll('input:not([type=hidden]),select,textarea').length`)} controls`;
        });
        await check(`${tag}: every table has <th scope>`, async () => {
          const bad = await ev(`__a11y.tables()`); assert(!bad.length, `${bad.length} problem(s):\n        ${list(bad)}`);
          return `${await ev(`document.querySelectorAll('table').length`)} tables`;
        });
      }

      await check(`${tag}: text contrast ≥ 4.5:1 (3:1 large)`, async () => {
        await ev(`__a11y.settle()`);
        const c = await ev(`__a11y.contrast()`);
        if (verbose && c.exempt.length) console.log(`        exempt: ${list(c.exempt, 20)}`);
        if (c.unknown.length) console.log(`        (skipped ${c.unknown.length} over a background image: ${list(c.unknown, 3)})`);
        assert(!c.fails.length, `${c.fails.length} of ${c.checked} below AA:\n        ${list(c.fails)}`);
        return `${c.checked} elements, ${c.exempt.length} exempt`;
      });
      if (view === 'app') await check(`${tag}: text tokens ≥ 4.5:1 on every paper token`, async () => {
        const t = await ev(`__a11y.tokens()`);
        assert(t.pairs.length, 'no color tokens found on :root');
        if (verbose) console.log(`        ${list(t.pairs, 60)}`);
        assert(!t.fails.length, `${t.fails.length} of ${t.pairs.length} pairs below 4.5:\n        ${list(t.fails, 12)}`);
        return `${t.pairs.length} token pairs`;
      });

      await check(`${tag}: keyboard focus is always visible (ring ≥ 3:1)`, async () => {
        const n = await ev(`__a11y.baseline()`);
        assert(n > 0, 'no focusable elements');
        const seen = new Set(), bad = [], weak = []; let first = null;
        for (let i = 0; i < Math.min(n + 10, 400); i++) {
          await tab();
          const f = await ev(`__a11y.settle(1000).then(() => __a11y.focusState())`);
          if (f.none) continue;
          if (f.id === first) break; first = first ?? f.id;   // wrapped around
          if (seen.has(f.id)) continue; seen.add(f.id);
          if (!f.visible) bad.push(f.el);
          else if (f.ringRatio !== null && f.ringRatio < 3) weak.push(`${f.el} ring ${f.outline} ${f.ringRatio}:1`);
        }
        assert(seen.size > 0, 'Tab never moved focus');
        assert(!bad.length, `${bad.length} of ${seen.size} stops show no focus indicator:\n        ${list(bad)}`);
        assert(!weak.length, `${weak.length} focus ring(s) below 3:1:\n        ${list(weak)}`);
        const unreached = await ev(`[...document.querySelectorAll('[data-qa-f]')].filter(e => !${JSON.stringify([...seen])}.includes(e.dataset.qaF)).map(e => e.outerHTML.slice(0, 90))`);
        if (verbose && unreached.length) console.log(`        not reached by Tab: ${list(unreached, 20)}`);
        return `${seen.size} tab stops of ${n} focusables${unreached.length ? `, ${unreached.length} not reached` : ''}`;
      });
    }
  }
  await check('zero Runtime.exceptionThrown', () => assert(cdp.errors.length === 0, cdp.errors.join(' | ')));
  exitCode = T.summary().fail ? 1 : 0;
} catch (e) {
  console.error('A11Y ABORTED', e); T.summary();
} finally {
  await cdp.close();
}
process.exit(exitCode);
