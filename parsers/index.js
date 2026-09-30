/* parsers/index.js — FMS parser registry: detect + dispatch.
 *
 * Contract for an FMS module (see docs/ADDING-AN-FMS.md):
 *   SDP.parsers.<id> = { id, label, detect(wb) -> 'plan'|'report'|null, plan(wb) -> Plan, report(wb) -> Report }
 * Load parsers/<id>.js with a <script> tag BEFORE this file. Every object on SDP.parsers that
 * has {id, detect} is registered automatically; SDP.parsers.register(mod) adds one later.
 * detect(wb) returns '<id>-plan' | '<id>-report' | null (e.g. 'ace-plan').
 */
(function (root, factory) {
  var existing = typeof window !== 'undefined' && window.SDP && window.SDP.parsers ? window.SDP.parsers : {};
  var mods = [];
  Object.keys(existing).forEach(function (k) { var m = existing[k]; if (m && m.id && typeof m.detect === 'function') mods.push(m); });
  if (!mods.length && typeof require === 'function') mods.push(require('./ace.js')); // node
  var api = factory(mods);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.SDP = window.SDP || {};
    var p = window.SDP.parsers = window.SDP.parsers || {};
    Object.keys(api).forEach(function (k) { p[k] = api[k]; });
  }
})(this, function (mods) {
  'use strict';
  var registry = [];

  function register(mod) {
    if (!mod || !mod.id || typeof mod.detect !== 'function' || typeof mod.plan !== 'function' || typeof mod.report !== 'function')
      throw new Error('parser module needs {id, label, detect, plan, report}');
    registry = registry.filter(function (m) { return m.id !== mod.id; }).concat([mod]);
    api[mod.id] = mod;
    return mod;
  }

  /** @returns {'<id>-plan'|'<id>-report'|null} */
  function detect(workbook) {
    if (!workbook || !workbook.SheetNames) return null;
    for (var i = 0; i < registry.length; i++) {
      var kind = registry[i].detect(workbook);
      if (kind === 'plan' || kind === 'report') return registry[i].id + '-' + kind;
    }
    return null;
  }

  /** @returns {{kind:string, fms:string, data:object}} — throws if no registered FMS recognizes the workbook. */
  function parse(workbook) {
    var kind = detect(workbook);
    if (!kind) throw new Error('Unrecognized workbook: no registered FMS parser (' + registry.map(function (m) { return m.label || m.id; }).join(', ') +
      ') recognizes it. Expected a spending plan or a year-to-date report.');
    var dash = kind.lastIndexOf('-'), id = kind.slice(0, dash), which = kind.slice(dash + 1);
    var mod = registry.filter(function (m) { return m.id === id; })[0];
    return { kind: kind, fms: id, data: mod[which](workbook) };
  }

  /** Convenience for the UI: ArrayBuffer (file.arrayBuffer()) → parse(). SheetJS defaults, no cellDates needed. */
  function fromArrayBuffer(buf, XLSX) {
    XLSX = XLSX || (typeof window !== 'undefined' ? window.XLSX : null);
    if (!XLSX) throw new Error('SheetJS (vendor/xlsx.full.min.js) is not loaded');
    return parse(XLSX.read(new Uint8Array(buf), { type: 'array' }));
  }

  var api = { register: register, detect: detect, parse: parse, fromArrayBuffer: fromArrayBuffer,
              list: function () { return registry.map(function (m) { return { id: m.id, label: m.label }; }); } };
  mods.forEach(register);
  return api;
});
