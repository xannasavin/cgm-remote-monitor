'use strict';

/**
 * Prompt utilities: placeholder replacement and data formatting.
 * Fix #14: uses replaceAll() instead of replace() for all occurrences.
 */

function replacePlaceholders (template, replacements) {
  var result = template;
  var keys = Object.keys(replacements);
  for (var i = 0; i < keys.length; i++) {
    result = result.replaceAll(keys[i], replacements[keys[i]]);
  }
  return result;
}

function formatProfileMarkdown (profile) {
  var startDate = new Date(profile.startDate);
  var dateFormatted = String(startDate.getDate()).padStart(2, '0') + '.'
    + String(startDate.getMonth() + 1).padStart(2, '0') + '.'
    + startDate.getFullYear();
  var store = profile.store[profile.defaultProfile];

  function mdTable (header, rows) {
    return header + '\n' + rows.map(function (r) { return '| ' + r.join(' | ') + ' |'; }).join('\n');
  }

  function section (title, data) {
    var rows = data.map(function (entry) { return [entry.time, entry.value]; });
    return '## ' + title + '\n' + mdTable('| Uhrzeit | Wert |', rows) + '\n';
  }

  function rangeSection (title, lows, highs) {
    var rows = lows.map(function (low, i) {
      return [low.time, low.value, highs[i] ? highs[i].value : ''];
    });
    return '## ' + title + '\n' + mdTable('| Uhrzeit | Ziel niedrig | Ziel hoch |', rows) + '\n';
  }

  return [
    '# Profil aktiv ab: ' + dateFormatted + '\n'
    , '**Einheit f\u00fcr Blutzuckerwerte:** ' + profile.units + '\n'
    , section('Basalrate (IE/h)', store.basal)
    , section('Carbratio (g/IE)', store.carbratio)
    , section('Insulinempfindlichkeit (mg/dl pro IE)', store.sens)
    , rangeSection('Zielbereich', store.target_low, store.target_high)
  ].join('\n');
}

function generateMarkdownFromDay (day) {
  function pad (v) { return v == null ? '' : v; }

  var md = '# ' + day.date + '\n\n';

  md += '## Statistik\n';
  md += '- Total Carbs: ' + day.totalCarbs + '\n';
  md += '- Total Bolus: ' + day.totalBolus + '\n\n';

  md += '## Treatments\n';
  if (Array.isArray(day.treatments) && day.treatments.length > 0) {
    md += '| Zeit (mills) | Carbs | Insulin | Notes |\n';
    md += '|--------------|-------|---------|-------|\n';
    for (var t = 0; t < day.treatments.length; t++) {
      var tr = day.treatments[t];
      md += '| ' + pad(tr.mills) + ' | ' + pad(tr.carbs) + ' | ' + pad(tr.insulin) + ' | ' + pad(tr.notes) + ' |\n';
    }
  } else {
    md += '_keine Treatments_\n';
  }
  md += '\n';

  md += '## Blutzuckerwerte (entries)\n';
  if (Array.isArray(day.entries) && day.entries.length > 0) {
    md += '| Zeit (mills) | SGV |\n';
    md += '|--------------|-----|\n';
    for (var e = 0; e < day.entries.length; e++) {
      md += '| ' + day.entries[e].mills + ' | ' + day.entries[e].sgv + ' |\n';
    }
  } else {
    md += '_keine Eintr\u00e4ge_\n';
  }

  return md;
}

function generateMarkdownFromDays (days) {
  return days.map(function (day) {
    return generateMarkdownFromDay(day);
  }).join('\n\n---\n\n');
}

module.exports = {
  replacePlaceholders: replacePlaceholders
  , formatProfileMarkdown: formatProfileMarkdown
  , generateMarkdownFromDay: generateMarkdownFromDay
  , generateMarkdownFromDays: generateMarkdownFromDays
};
