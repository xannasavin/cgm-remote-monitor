'use strict';

/* ---------- i18n ---------- */
// Client-supplied translate function injected via setTranslate. Defaults to
// identity so the module renders plain English when not wired.
//
// R3-1 / R2-3: the translate reference lives on window instead of a
// module-level singleton so multiple concurrent AI eval instances
// (e.g. report opened in two tabs sharing the same bundle) share the same
// store. R3-4: translate() re-reads the function on every call and
// defensively checks it's still callable, so a stale reference or a
// disappeared client.translate cannot produce `'undefined'` in the UI.
var TRANSLATE_STORE_KEY = '__aiEvalTranslate';
var translateHost = (typeof window !== 'undefined')
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : {});
function setTranslate (fn) {
  if (typeof fn === 'function') translateHost[TRANSLATE_STORE_KEY] = fn;
}
function translate (key) {
  var fn = translateHost[TRANSLATE_STORE_KEY];
  return (typeof fn === 'function') ? fn(key) : key;
}

/* ---------- Utilities ---------- */

function escapeHtml (s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate (dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return String(dateStr || '');
  var parts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (parts) return parts[3] + '.' + parts[2] + '.' + parts[1];
  return dateStr;
}

function fmt (val, unit, decimals) {
  if (unit === undefined) unit = '';
  if (decimals === undefined) decimals = 1;
  if (val === null || val === undefined || Number.isNaN(val)) return '-';
  return Number(val).toFixed(decimals) + unit;
}

function list (items) {
  items = items || [];
  return '<ul>' + items.map(function (x) { return '<li>' + escapeHtml(x) + '</li>'; }).join('') + '</ul>';
}

function table (opts) {
  var head = opts.head;
  var rows = opts.rows;
  return '\n<table class="cgm-table" role="table">\n'
    + '<thead><tr>' + head.map(function (h) { return '<th scope="col">' + escapeHtml(h) + '</th>'; }).join('') + '</tr></thead>\n'
    + '<tbody>\n'
    + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + escapeHtml(c) + '</td>'; }).join('') + '</tr>'; }).join('\n')
    + '\n</tbody>\n</table>';
}

var CELL_CLASSES = ['cgm-ok', 'cgm-warn'];

// Table variant whose cells may be { text, cls }; cls must be whitelisted.
function tableCells (opts) {
  var head = opts.head;
  var rows = opts.rows;
  function cell (c) {
    if (c !== null && typeof c === 'object') {
      var cls = CELL_CLASSES.indexOf(c.cls) !== -1 ? ' class="' + c.cls + '"' : '';
      return '<td' + cls + '>' + escapeHtml(c.text) + '</td>';
    }
    return '<td>' + escapeHtml(c) + '</td>';
  }
  return '\n<table class="cgm-table" role="table">\n'
    + '<thead><tr>' + head.map(function (h) { return '<th scope="col">' + escapeHtml(h) + '</th>'; }).join('') + '</tr></thead>\n'
    + '<tbody>\n'
    + rows.map(function (r) { return '<tr>' + r.map(cell).join('') + '</tr>'; }).join('\n')
    + '\n</tbody>\n</table>';
}

module.exports = {
  escapeHtml: escapeHtml
  , tableCells: tableCells
  , formatDate: formatDate
  , fmt: fmt
  , list: list
  , table: table
  , translate: translate
  , setTranslate: setTranslate
};
