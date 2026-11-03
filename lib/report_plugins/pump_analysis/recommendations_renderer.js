'use strict';

var renderUtils = require('./render_utils');
var translate = renderUtils.translate;
var escapeHtml = renderUtils.escapeHtml;
var engine = require('./recommendation_engine');
var rules = require('./recommendation_rules');

/* ---------- Recommendation cards (spec 6.2) ---------- */
// The engine returns translation keys and string args; they are translated
// and escaped here. Values arrive as formatted strings and are shown as is.

// Fills %1..%n in one pass (substituted args are never re-scanned); every arg
// is escaped, the translated template is trusted.
function fill (key, args) {
  return escapeHtml(translate(key)).replace(/%(\d+)/g, function put (m, n) {
    var i = Number(n) - 1;
    return i >= 0 && i < (args || []).length ? escapeHtml(args[i]) : m;
  });
}

function kindName (kind) {
  if (kind === 'basal') return translate('Basal rate');
  if (kind === 'isf') return translate('Correction factor');
  return translate('Carb ratio');
}

function titleOf (card) {
  var state = card.state;
  if (state === 'warning') return translate('Check first: %1').replace('%1', kindName(card.kind));
  if (card.kind === 'timing') return translate('Check injection-meal interval');
  if (card.kind === 'basal') {
    if (state === 'up') return translate('Raise basal rate');
    if (state === 'down') return translate('Lower basal rate');
    if (state === 'ok') return translate('Basal rate fits');
  } else if (card.kind === 'isf') {
    if (state === 'up') return translate('Correction factor: stronger');
    if (state === 'down') return translate('Correction factor: weaker');
    if (state === 'ok') return translate('Correction factor fits');
  } else {
    if (state === 'up') return translate('Carb ratio: stronger');
    if (state === 'down') return translate('Carb ratio: weaker');
    if (state === 'ok') return translate('Carb ratio fits');
  }
  return kindName(card.kind);
}

function badgeOf (card) {
  if (card.state === 'warning') return { cls: 'rec-warning', text: translate('Check first') };
  if (card.state === 'insufficient' || card.confidence === 'insufficient') {
    return { cls: 'rec-none', text: translate('No recommendation') };
  }
  if (card.confidence === 'high') return { cls: 'rec-high', text: translate('Confidence high') };
  if (card.confidence === 'medium') return { cls: 'rec-mid', text: translate('Confidence medium') };
  return { cls: 'rec-low', text: translate('Confidence low') };
}

function rowRange (row) {
  return escapeHtml(row.from + '-' + row.to);
}

function rowText (row, showRange, withArrow) {
  var unit = row.unit ? ' ' + row.unit : '';
  var body;
  if (row.unchanged) {
    body = fill('%1 %2, no change possible within %3 %', [row.oldValue, row.unit || '', Math.round(rules.MAX_STEP * 100)]);
  } else if (withArrow && row.newValue !== null && row.newValue !== undefined) {
    body = escapeHtml(row.oldValue + ' → ' + row.newValue + unit);
  } else {
    body = escapeHtml(row.oldValue + unit);
  }
  return (showRange ? rowRange(row) + ': ' : '') + body;
}

function changeHtml (card) {
  var state = card.state;
  if (state === 'insufficient') return escapeHtml(translate('Not enough data'));
  if (state === 'ok') return escapeHtml(translate('No change'));
  if (state === 'timing') return escapeHtml(translate('No factor change'));
  var rows = card.rows || [];
  if (!rows.length) return '';
  var withArrow = (state === 'up' || state === 'down') && !card.allUnchanged;
  var many = rows.length > 1;
  if (state === 'warning') {
    return rows.map(function cur (r) {
      return '<span class="rec-change">' + rowText(r, many, false) + '</span>';
    }).join(' ');
  }
  return rows.map(function show (r) {
    return '<span class="rec-change">' + rowText(r, many, withArrow) + '</span>';
  }).join(' ');
}

function renderCard (card) {
  var badge = badgeOf(card);
  var cls = 'rec-card';
  if (card.state === 'warning') cls += ' rec-warning';
  else if (card.state === 'insufficient') cls += ' rec-insufficient';
  var reasons = (card.reasons || []).map(function item (r) {
    return '<li>' + fill(r.key, r.args) + '</li>';
  }).join('');
  var basis = card.basisLine
    ? '<div class="rec-basis">' + fill(card.basisLine.key, card.basisLine.args) + '</div>'
    : '';
  return '<div class="' + cls + '">'
    + '<div class="rec-head">'
    + '<span class="rec-time">' + escapeHtml(card.timeLabel || '') + '</span>'
    + '<span class="rec-what">' + escapeHtml(titleOf(card)) + '</span>'
    + changeHtml(card)
    + '<span class="rec-badge ' + badge.cls + '">' + escapeHtml(badge.text) + '</span>'
    + '</div>'
    + (reasons ? '<ul class="rec-reasons">' + reasons + '</ul>' : '')
    + basis
    + '</div>';
}

/**
 * @param {{cards: Array<object>, basis: object, profileSwitch: boolean}|null} rec
 * @returns {string} HTML of the recommendations section
 */
function renderRecommendations (rec) {
  var cards = rec && Array.isArray(rec.cards) ? rec.cards : [];
  var hints = '<p class="rec-hint">'
    + escapeHtml(translate('Calculation aid, not a therapy instruction. Change only one parameter at a time.'))
    + '</p>';
  if (rec && rec.profileSwitch) {
    hints += '<p class="rec-hint rec-hint-switch">' + escapeHtml(translate(engine.PROFILE_SWITCH_KEY)) + '</p>';
  }
  return '<section class="rec-section"><h2>' + escapeHtml(translate('Recommendations')) + '</h2>'
    + hints
    + cards.map(renderCard).join('')
    + '</section>';
}

module.exports = {
  renderRecommendations: renderRecommendations
};

