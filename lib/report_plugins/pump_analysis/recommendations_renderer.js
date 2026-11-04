'use strict';

var renderUtils = require('./render_utils');
var translate = renderUtils.translate;
var escapeHtml = renderUtils.escapeHtml;
var rules = require('./recommendation_rules');

// Same key as recommendation_engine PROFILE_SWITCH_KEY (a test keeps them in
// sync); a literal here avoids loading the whole engine into the renderer.
var PROFILE_SWITCH_KEY = 'Profile switch in this period: suggestions refer to the latest profile and may be less accurate';

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
  if (row.unchanged && row.unit) {
    body = fill('%1 %2, no change possible within %3 %', [row.oldValue, row.unit, Math.round(rules.MAX_STEP * 100)]);
  } else if (row.unchanged) {
    body = fill('%1, no change possible within %2 %', [row.oldValue, Math.round(rules.MAX_STEP * 100)]);
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
  // Only up/down show an arrow; warning cards show the current values.
  var withArrow = (state === 'up' || state === 'down') && !card.allUnchanged;
  var many = rows.length > 1;
  return rows.map(function show (r) {
    return '<span class="rec-change">' + rowText(r, many, withArrow) + '</span>';
  }).join(' ');
}

// Cards below medium confidence (low, not enough data) are hidden until the
// viewer ticks the filter box. Warning cards always stay visible.
function isMinor (card) {
  if (card.state === 'warning') return false;
  if (card.state === 'insufficient') return true;
  return card.confidence !== 'high' && card.confidence !== 'medium';
}

// Each card is a collapsed <details>: the summary is the former head line
// (time, title, change, badge), the body holds reasons, the confidence note
// and the data basis.
function renderCard (card) {
  var badge = badgeOf(card);
  var cls = 'rec-card';
  if (card.state === 'warning') cls += ' rec-warning';
  else if (card.state === 'insufficient') cls += ' rec-insufficient';
  if (isMinor(card)) cls += ' rec-minor';
  var reasons = (card.reasons || []).map(function item (r) {
    return '<li>' + fill(r.key, r.args) + '</li>';
  }).join('');
  var note = card.confidenceNote
    ? '<div class="rec-confidence">' + fill(card.confidenceNote.key, card.confidenceNote.args) + '</div>'
    : '';
  var basis = card.basisLine
    ? '<div class="rec-basis">' + fill(card.basisLine.key, card.basisLine.args) + '</div>'
    : '';
  return '<details class="' + cls + '">'
    + '<summary class="rec-head">'
    + '<span class="rec-time">' + escapeHtml(card.timeLabel || '') + '</span>'
    + '<span class="rec-what">' + escapeHtml(titleOf(card)) + '</span>'
    + changeHtml(card)
    + '<span class="rec-badge ' + badge.cls + '">' + escapeHtml(badge.text) + '</span>'
    + '</summary>'
    + '<div class="rec-body">'
    + (reasons ? '<ul class="rec-reasons">' + reasons + '</ul>' : '')
    + note
    + basis
    + '</div>'
    + '</details>';
}

// CSS-only filter (the section is set via innerHTML, so no event handlers):
// an unchecked box hides .rec-minor cards in the following .rec-list.
function renderFilter (minorCount, majorCount) {
  if (minorCount === 0) return '';
  var empty = majorCount === 0
    ? '<p class="rec-empty">' + escapeHtml(translate('No recommendation with at least medium confidence.')) + '</p>'
    : '';
  return '<input type="checkbox" id="recShowAll" class="rec-toggle">'
    + '<label for="recShowAll" class="rec-toggle-label">'
    + fill('Also show cards with low confidence or not enough data (%1)', [minorCount])
    + '</label>'
    + empty;
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
    hints += '<p class="rec-hint rec-hint-switch">' + escapeHtml(translate(PROFILE_SWITCH_KEY)) + '</p>';
  }
  var minorCount = cards.filter(isMinor).length;
  return '<section class="rec-section"><h2>' + escapeHtml(translate('Recommendations')) + '</h2>'
    + hints
    + renderFilter(minorCount, cards.length - minorCount)
    + '<div class="rec-list">' + cards.map(renderCard).join('') + '</div>'
    + '</section>';
}

module.exports = {
  renderRecommendations: renderRecommendations
};

