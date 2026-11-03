# Pumpen-Analyse mit Empfehlungen: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Pumpen-Analyse rechnet deterministisch konkrete Vorschläge für Basal, KH-Faktor und Korrekturfaktor pro Tagesblock aus, begründet sie mit Zahlen und erklärt die Kennzahlen; dazu Fehlerbehebungen und Grafik-Verbesserungen.

**Architecture:** Reine Rechenmodule ohne DOM unter `lib/report_plugins/pump_analysis/` (Konstanten, Bolus-Klassifizierung, Basal- und Faktor-Empfehlungen, Engine). `prepareCgmData` ruft sie auf und legt das Ergebnis unter einem neuen Top-Level-Feld `pumpExtras` ab, das **nicht** in `cgmData` (KI-Payload) landet. Renderer und Charts lesen `pumpExtras`.

**Tech Stack:** Node.js (CommonJS, ES5-Stil), d3 ^7.9 (Browser), mocha + should, jsdom-Fixtures in `tests/fixtures/`.

**Spec:** `docs/plans/2026-11-03-pumpenanalyse-empfehlungen-design.md` (Abschnittsnummern unten verweisen darauf, z. B. "Spec 5.1").

## Global Constraints

- Code-Stil laut `CLAUDE.md`: 2 Spaces, Single Quotes, `function name (args)`, Komma-first, benannte Callbacks.
- Alle Grenzwerte als Konstanten aus `recommendation_rules.js` (Spec 3); keine Umgebungsvariablen.
- Intern alles in mg/dl; Umrechnung nur an den Rändern (Eingang `units === 'mmol'`, Anzeige).
- Neue Rechenergebnisse nie in `cgmData`, `periodStats` oder `dayStats` (gehen an die KI).
- Jeder sichtbare Text über `translate()`, Platzhalter `%1…%n`, Schlüssel in `translations/en/en.json` (Wert = Schlüssel), `translations/de_DE.json` (deutsch) und `translations/lt_LT.json` (englischer Wert, gleiche Platzhalter) im selben Commit wie der Code.
- Keine Gedankenstriche (—) in neuen deutschen Texten; Begriff "Ergebnisse", nicht "Treffer".
- Tests: `npm run test-local -- <dateien>`; Lint: `npm run lint`. Kein `git push`.
- Arbeit auf Branch `feat/pump-analysis-recommendations` (von `master`).

## Review Focus

1. **Einheit mmol/L:** Nutzer mit mmol bekommt korrekte Schwellen, GMI und Faktoren in seiner Einheit (Test in Task 10).
2. **Behandlungen nur mit `mills`, ohne `created_at`:** Klassifizierung darf sie nicht stillschweigend verlieren; Fallback auf `mills` (Test in Task 6).
3. **Gemischte Tage mit und ohne Pumpendaten:** Basal-Fälle nur aus Pumpentagen, Datenbasis nennt die Zahl (Test in Task 8).
4. **Profil mit `sens` in mmol/L:** wird für die Rechnung in mg/dl umgerechnet, Vorschlag in Profil-Einheit angezeigt (Test in Task 7 und 9).
5. **Leerer oder dünner Zeitraum (1 Tag, keine KH, keine Pumpe):** Seite zeigt "zu wenig Daten" statt Fehlerbox; KI-Payload bleibt ohne `pumpExtras` (Test in Task 10).

---

### Task 1: Test-Hygiene der Chart-Stubs

**Files:**
- Modify: `tests/pump_analysis.test.js:516-545`

- [ ] **Step 1:** Im Test "replaces remaining chart skeletons when chart rendering throws" die drei Originalfunktionen (`renderDiurnalChart`, `renderInsulinDistributionChart`, `renderDailyTirChart`) vor dem Überschreiben sichern und im bestehenden `finally` wiederherstellen.
- [ ] **Step 2:** Run `npm run test-local -- ./tests/pump_analysis.test.js`. Expected: PASS.
- [ ] **Step 3:** Commit `test(pump_analysis): restore chart stubs after throwing-render test`.

### Task 2: Profil für den Zeitraum richtig wählen (Spec 8.5)

**Files:**
- Modify: `lib/report_plugins/pump_analysis/data_processor.js:22-32`
- Test: `tests/pump_analysis.test.js` (describe `data_processor`)

**Interfaces:**
- Produces: `selectProfileForRange(profiles: object[], lastDayKey: string|null) -> object|null` (exportiert aus `data_processor.js`).

- [ ] **Step 1: Failing tests**
  - `selectProfileForRange([{startDate:'2026-11-10'}, {startDate:'2026-10-01'}], '2026-11-03')` liefert das Profil mit `startDate '2026-10-01'`.
  - Liegen alle Profile nach dem Enddatum, wird das mit dem frühesten `startDate` geliefert.
  - `[]` und `null` liefern `null`.
  - `prepareCgmData` mit Profilen `[nachEnde, gültig]` setzt `cgmData.raw_profile` auf das gültige Profil.
- [ ] **Step 2:** Run tests, expect FAIL (`selectProfileForRange is not a function`).
- [ ] **Step 3:** Implementieren. Vergleich: `Date.parse(startDate) <= Date.parse(lastDayKey + 'T23:59:59.999Z')` über die nicht sortierte Liste; späteste passende `startDate` gewinnt. Profilwahl in `prepareCgmData` nach dem Sortieren der Tage durchführen (`lastDayKey` = letzter sortierter Tag).
- [ ] **Step 4:** Run tests, expect PASS (auch der bestehende `raw_profile`-Test).
- [ ] **Step 5:** Commit `fix(pump_analysis): use profile valid at report end instead of profiles[0]`.

### Task 3: Legende "U/Tag" korrigieren (Spec 7)

**Files:**
- Modify: `lib/report_plugins/pump_analysis/stats_renderer.js:306-350`
- Test: `tests/pump_analysis.test.js` (describe `stats_renderer`)

- [ ] **Step 1: Failing tests** über `renderStats(...)` mit `pumpActionStats` aus 14 Pumpentagen von 14:
  - `basal_source: 'pump'`, `basal_actual.total: 19.3`, `bolus_distribution.user_total: 23.1`, `auto_total_by_bucket: {near_meal: 0.8, intermediate: 0.4, far_from_meal: 0.2}` → HTML enthält `19.30`, `23.10`, `1.40`.
  - `basal_source: 'profile_fallback'`, `basal_scheduled.total: 17.5`, `coverage.pump_days: 0` → HTML enthält `17.50`.
- [ ] **Step 2:** Run, expect FAIL (zeigt `1.38` etc.).
- [ ] **Step 3:** Alle vier Divisionen entfernen; die Totale sind bereits Tagesmittel.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `fix(pump_analysis): insulin legend shows per-day totals without double division`.

### Task 4: Gemeinsame Glukose-Hilfen und erklärte Perioden-Statistik (Spec 6.3, 8.4)

**Files:**
- Create: `lib/report_plugins/pump_analysis/glucose_units.js`
- Modify: `lib/report_plugins/pump_analysis/render_utils.js` (neue Tabellenvariante)
- Modify: `lib/report_plugins/pump_analysis/stats_renderer.js:41-57, 69`
- Modify: `translations/en/en.json`, `translations/de_DE.json`, `translations/lt_LT.json`
- Test: `tests/pump_analysis.test.js`

**Interfaces:**
- Produces (`glucose_units.js`):
  - `MGDL_PER_MMOL` (Wert wie in `lib/report_plugins/glucosedistribution.js:443-445`)
  - `toMgdl(value: number, units: string) -> number` (`units` `'mmol'` oder `'mmol/L'` → umrechnen, sonst unverändert)
  - `fromMgdl(value: number, units: string) -> number`
  - `computeGmi(meanMgdl: number|null) -> number|null` = `3.31 + 0.02392 * meanMgdl`, auf 1 Nachkommastelle
- Produces (`render_utils.js`): `tableCells({ head: string[], rows: Array<Array<string|{text: string, cls: string}>> }) -> string`; escaped Text, `cls` nur aus einer Whitelist `['cgm-ok', 'cgm-warn']`.
- Produces (`stats_renderer.js`): `renderPeriodSummary(periodStats, meta, opts?)`; ohne `opts.explained` unverändert 8 Zeilen, 2 Spalten (KI-Tab).

- [ ] **Step 1: Failing tests**
  - `computeGmi(153.6)` → `7.0`; `computeGmi(null)` → `null`; `toMgdl(8.5, 'mmol')` ≈ `153.1` (±0.2).
  - `tableCells` escaped `<b>` im Text und ignoriert `cls: 'evil'`.
  - `renderPeriodSummary(p, meta)` hat weiter 8 `<tr>` im `tbody` (bestehender Test bleibt).
  - `renderPeriodSummary(p, meta, { explained: true })` hat 9 `<tr>`, Kopf `Metric | Value | Target | Meaning`, eine GMI-Zeile, `cgm-ok` bei `tir_pct: 72`, `cgm-warn` bei `cv: 40`, keine Status-Klasse in den Zeilen MAGE und SD.
  - `renderStats` nutzt die erklärte Variante (enthält `Meaning`).
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implementieren. Ziele und Texte (englische Schlüssel, deutsche Werte aus Spec 6.3 und Mockup Abschnitt 2):
  - TIR `> 70 %` ok wenn > 70; TBR `< 4 %`; TAR `< 25 %`; CV `≤ 36 %`; GMI `< 7 %`; MAGE `< 60 (rough)`, SD `< 50 (rough)` ohne Färbung; Durchschnitt und Median ohne Ziel (`-`).
  - Erklärungen als Schlüssel, z. B. `'Coefficient of variation: how much glucose varies relative to the mean. Below 36 % is considered stable.'` → `"Variationskoeffizient: wie stark der BZ im Verhältnis zum Mittelwert schwankt. Unter 36 % gilt als stabil."`; analog für alle Zeilen (Texte aus Mockup Abschnitt 2 übernehmen). Bereichsgrenzen in den Erklärungen über `%1`/`%2` aus `meta.target_low/high`.
  - GMI aus `toMgdl(periodStats.average, meta.units)`.
  - CSS für `.cgm-ok` (grün) und `.cgm-warn` (gelb/dunkelorange, AA-Kontrast) in `styles.js`.
- [ ] **Step 4:** Run `npm run test-local -- ./tests/pump_analysis.test.js ./tests/language.test.js`, expect PASS.
- [ ] **Step 5:** Commit `feat(pump_analysis): explained period statistics with targets and GMI`.

### Task 5: Übersetzungs-Grundlage für bestehende Texte (Spec 8.3)

**Files:**
- Modify: `lib/report_plugins/pump_analysis/charts.js` (fest englische Strings: `'Hour of Day'`, `'Below Range'`, `'In Range'`, `'Above Range'`, aria-labels, `'Charts unavailable'`)
- Modify: `translations/en/en.json`, `translations/de_DE.json`, `translations/lt_LT.json`
- Test: `tests/pump_analysis.test.js` (neuer describe `translations`)

- [ ] **Step 1: Failing test** `every translate key used by pump_analysis has a German entry`: liest alle Dateien unter `lib/report_plugins/pump_analysis/` plus `pump_analysis.js`, sammelt Schlüssel per Regex `/translate\('((?:[^'\\]|\\.)*)'\)/g` (Escapes wie `—` auflösen via `JSON.parse('"' + key + '"')`), erwartet jeden Schlüssel in `de_DE.json` und `en.json`.
- [ ] **Step 2:** Run, expect FAIL mit Liste fehlender Schlüssel (u. a. die englischen Abschnitts-Untertitel aus dem Screenshot).
- [ ] **Step 3:** Fest englische Chart-Strings in `translate()` einpacken; fehlende Schlüssel in alle drei Dateien eintragen (de: deutsch, lt: englisch).
- [ ] **Step 4:** Run `npm run test-local -- ./tests/pump_analysis.test.js ./tests/language.test.js`, expect PASS.
- [ ] **Step 5:** Commit `i18n(pump_analysis): translate all pump analysis texts to German`.

Dieser Test sichert ab hier jeden weiteren Task: neue Schlüssel ohne Übersetzung lassen ihn fehlschlagen.

### Task 6: Konstanten und Bolus-Klassifizierung (Spec 3, 4)

**Files:**
- Create: `lib/report_plugins/pump_analysis/recommendation_rules.js`
- Create: `lib/report_plugins/pump_analysis/bolus_classifier.js`
- Test: Create `tests/pump_analysis_recommendations.test.js`

**Interfaces:**
- Produces (`recommendation_rules.js`), Werte aus Spec 3:
  `DAWN_WINDOW = { startHour: 4, endHour: 9 }`, `DAWN_MAX_U = 1.5`, `DAWN_MAX_CARBS_G = 10`, `CORRECTION_BG_MGDL = 240`, `FAST_RISE_MGDL_PER_5MIN = 8`, `CARB_MATCH_MIN = 30`, `MEAL_SLOTS = [{ key: 'breakfast', startHour: 5, endHour: 10 }, { key: 'lunch', startHour: 10, endHour: 15 }, { key: 'dinner', startHour: 17, endHour: 22 }]`, `HYPER_COUNTER_MGDL = 250`, `COUNTER_MIN_DURATION_MIN = 15`, `DIRECTION_THRESHOLD = 0.10`, `MAX_STEP = 0.20`, `ROUND_BASAL = 0.05`, `ROUND_CARB_RATIO = 0.5`, `ROUND_ISF = 1`, `MIN_CGM_COVERAGE = 0.8`, `FASTING_LOOKBACK_H = 4`, `MEAL_WINDOW_H = 4`, `CORRECTION_WINDOW_H = 3`, `MIN_CASES = 5`, `HIGH_CASES = 7`, `HIGH_SHARE = 0.75`, `MEDIUM_SHARE = 0.60`, `STRONG_COUNTER_DAYS = 3`, `LATE_BOLUS_RISE_MGDL = 80`, `LATE_BOLUS_PEAK_MIN = 90`, `LATE_BOLUS_SHARE = 0.60`.
- Produces (`bolus_classifier.js`):
  - `localTime(t: object) -> { mills, localHour, localMinute, dateKey } | null`: wie `parseTreatmentLocal` (`lib/statistics.js:683-695`), Fallback auf `t.mills` + `t.utcOffset` wenn `created_at` fehlt.
  - `classifyUserBoluses(treatments: object[], readings: Array<{mills, sgv}>) -> ClassifiedBolus[]` mit `ClassifiedBolus = { mills, localHour, dateKey, insulin, carbs, cls: 'dawn'|'meal'|'correction'|'unclear', bgAtBolus: number|null, fastRise: boolean, carbMills: number[] }`. `readings` in mg/dl, aufsteigend sortiert.
  - `carbEntries(treatments) -> Array<{ mills, carbs, consumedBy: number|null }>` (KH-Einträge; `consumedBy` = `mills` des Bolus, dem sie zugeordnet wurden).

- [ ] **Step 1: Failing tests** (Fixtures mit `created_at`, `utcOffset: 60`, `eventType`):
  - 1,2 U ohne KH um 06:30 → `dawn`; 1,2 U mit 6 g um 06:30 → `dawn`; 1,6 U ohne KH um 06:30 bei BG 150 → `unclear`; 1,2 U ohne KH um 10:00 bei BG 150 → `unclear`.
  - 4 U mit KH-Eintrag 48 g 20 min später → `meal`, `carbs: 48`; KH 40 min später → kein `meal`.
  - Ohne KH, BG 250 → `correction`; ohne KH, BG 180, letzte zwei Werte 170→180 in 5 min → `correction`, `fastRise: true`; 170→176 → `unclear`.
  - `notes: 'Automatic Bolus'` → nicht in der Liste; `eventType: 'Note'` mit `notes: 'Cannula Filled (0.7u primed)'` und `insulin: 0.7` → nicht in der Liste; `notes: 'UserAborted'` mit `insulin: 0` → nicht in der Liste.
  - Behandlung nur mit `mills`, ohne `created_at` → wird klassifiziert (Review Focus 2).
- [ ] **Step 2:** Run `npm run test-local -- ./tests/pump_analysis_recommendations.test.js`, expect FAIL.
- [ ] **Step 3:** Implementieren. Nutzer-Bolus = `statistics.isUserBolusEvent(t) && t.insulin > 0`. Reihenfolge Dawn → Meal → Correction → Unclear (Spec 4). `bgAtBolus` = letzter Wert ≤ Bolus-Zeit innerhalb 10 min. `fastRise` = Anstieg der letzten zwei Werte vor dem Bolus (≤ 10 min Abstand), normiert auf 5 min, ≥ 8.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(pump_analysis): bolus classification for recommendations`.

### Task 7: Generische Profil-Zeitplan-Suche (Spec 5.2)

**Files:**
- Modify: `lib/statistics.js:714-732` (+ Export)
- Test: `tests/statistics.test.js`

**Interfaces:**
- Produces: `buildProfileScheduleLookup(profileStore: object, key: 'basal'|'carbratio'|'sens') -> function(hour, minute) -> number|null` (null bei fehlendem Zeitplan). `buildProfileBasalLookup` delegiert darauf und behält sein Verhalten (0 statt null).
- Produces: `profileSensMgdl(profile: object, profileStore: object) -> function(hour, minute) -> number|null` in `bolus_classifier.js` (rechnet mit `glucose_units.toMgdl` um, wenn `profile.units` bzw. `profileStore.units` mmol ist).

- [ ] **Step 1: Failing tests:** `carbratio: [{time:'00:00', value:10}, {time:'11:00', value:8}]` → `lookup(12, 0) === 8`, `lookup(6, 0) === 10`; fehlender Schlüssel → `null`; bestehende `buildProfileBasalLookup`-Tests unverändert grün; `sens` 2,5 mmol/L/U → `profileSensMgdl` ≈ 45 (Review Focus 4).
- [ ] **Step 2:** Run `npm run test-local -- ./tests/statistics.test.js ./tests/pump_analysis_recommendations.test.js`, expect FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(statistics): generic profile schedule lookup for carbratio and sens`.

### Task 8: Basal-Fälle, Blöcke und Vorschläge (Spec 5.1)

**Files:**
- Create: `lib/report_plugins/pump_analysis/basal_recommendations.js`
- Test: `tests/pump_analysis_recommendations.test.js`

**Interfaces:**
- Consumes: `classifyUserBoluses`, `carbEntries`, `localTime` (Task 6); `buildProfileScheduleLookup`, `profileSensMgdl` (Task 7); `statistics.integrateActualBasalByHour`, `statistics.isAutoBolusEvent`.
- Produces:
  - `computeBasalCases(input) -> BasalCase[]`, `input = { treatments, readingsByDay: { [dateKey]: Array<{mills, sgv}> }, pumpDayKeys: string[], profile, profileStore, classified: ClassifiedBolus[] }`; `BasalCase = { dateKey, hour, d, deliveredU, scheduledU, autoU }`.
  - `buildBasalBlocks(cases: BasalCase[], profileStore) -> BasalBlock[]`, `BasalBlock = { state: 'up'|'down'|'ok'|'insufficient', startHour, endHour /* exklusiv, kann < startHour sein bei Mitternacht */, extendedFrom: number|null, caseCount, sameDirShare, medianD, rows: Array<{ from: 'HH:MM', to: 'HH:MM', oldRate, newRate }> }`.

- [ ] **Step 1: Failing tests** (synthetische 14 Tage, Profil 0,6 U/h 02-06, sonst 0,8; Temp Basal 0,9 U/h 02-06 an 12 Tagen; flache BG 130):
  - `computeBasalCases`: Fall für 03:00 hat `d` ≈ +0,5; Stunden mit Mahlzeiten-Bolus oder Korrektur in den 4 h davor fehlen; ein Dawn-Bolus um 06:00 entfernt **keine** Fälle; ein `unclear`-Bolus um 15:00 entfernt die Fälle 15-18 Uhr; Stunde mit 9 von 12 Werten fehlt; Tage ohne Pumpendaten liefern keine Fälle (Review Focus 3).
  - BG-Drift: Stunde mit +30 mg/dl und `sens` 30 erhöht `d` um `1 U / scheduledU`.
  - `buildBasalBlocks`: Block `up` 02-06 wird auf 01-06 verlängert (`extendedFrom: 1`), `rows` = `[{from:'01:00', to:'02:00', oldRate:0.8, newRate:0.95}, {from:'02:00', to:'06:00', oldRate:0.6, newRate:0.7}]` (Median +50 % → auf +20 % begrenzt; 0,6 × 1,2 = 0,72 → 0,70; 0,8 × 1,2 = 0,96 → 0,95).
  - Keine Verlängerung, wenn die Stunde davor `down` oder `insufficient` ist; Block ab 00:00 verlängert auf 23:00.
  - Median 9 % → `ok`; Median 10 % → `up`. Neutrale Fälle senken `sameDirShare`.
  - Stunde mit 4 Fällen → `insufficient`; Block-`caseCount` = Minimum über seine Stunden.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implementieren nach Spec 5.1. `deliveredU` pro Tag und Stunde aus `integrateActualBasalByHour(treatments, profileStore, [dateKey]).hourly[h]`; `scheduledU` = Mittel der Profilrate über die Stunde (5-min-Raster); Drift = letzter minus erster Wert der Stunde (je ±10 min). Rundung auf `ROUND_BASAL` mit `Math.round(x / step) * step` und 2 Nachkommastellen. Zusammenfassen benachbarter Stunden gleichen Zustands zirkulär über Mitternacht.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(pump_analysis): basal recommendation cases and blocks`.

### Task 9: KH-Faktor, Spritz-Ess-Abstand und Korrekturfaktor (Spec 5.2, 5.3)

**Files:**
- Create: `lib/report_plugins/pump_analysis/factor_recommendations.js`
- Test: `tests/pump_analysis_recommendations.test.js`

**Interfaces:**
- Consumes: Task 6, 7, `integrateActualBasalByHour`.
- Produces:
  - `computeMealCases(input) -> MealCase[]`, `MealCase = { slot, dateKey, mills, carbs, bolusU, startBg, peakBg, peakMin, bg2h, bg4h, effectiveRatio, profileRatio, d, curve: Array<{ min, sgv }> }` (curve 0-240 min, 5-min-Raster, für Task 11).
  - `summarizeMealSlot(cases: MealCase[]) -> { slot, state: 'up'|'down'|'ok'|'insufficient'|'timing', caseCount, sameDirShare, medianD, oldRatio, newRatio, latePattern: { share, count } }`.
  - `computeCorrectionCases(input) -> CorrectionCase[]`, `CorrectionCase = { dateKey, mills, bolusU, startBg, bg3h, measuredIsf, profileIsf, d }`.
  - `summarizeCorrections(cases) -> { state, caseCount, sameDirShare, medianD, oldIsf, newIsf }`.
  - `input` wie Task 8 plus `slots = MEAL_SLOTS`.

- [ ] **Step 1: Failing tests**
  - Mahlzeit 60 g, Bolus 6 U, Profil 10 g/U, keine weiteren Insuline, BG 120 → 120 → `effectiveRatio` 10, `d` 0. BG 120 → 210 nach 4 h, `sens` 45 → Restkorrektur +2 U → `effectiveRatio` 7,5, `d` ≈ +0,33.
  - Nenner ≤ 0 → Fall verworfen. Zweite Mahlzeit innerhalb 4 h → beide Fälle verworfen. CGM-Abdeckung < 80 % → verworfen.
  - Dawn-Bolus erscheint nie als Mahlzeit.
  - 6 Fälle mit Median +0,33 → `state 'up'`, `newRatio = 10 / 1.2 = 8.33 → 8.5`.
  - 6 Fälle mit Spitze +90 nach 60 min und 4-h-Wert unter Start (4 von 6) → `state 'timing'`.
  - Korrektur BG 260, 2 U, nach 3 h 170, Profil `sens` 60 → `measuredIsf` 45, `d` ≈ +0,33; `fastRise`-Korrektur und Korrektur mit KH innerhalb 3 h werden nicht gemessen; `sens` in mmol-Profil → `oldIsf`/`newIsf` in Profil-Einheit (Review Focus 4).
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implementieren nach Spec 5.2/5.3. Netto-Basalabweichung im Fenster aus Tages-`hourly` minus Profil, anteilig pro angeschnittener Stunde. `d` begrenzen auf ±`MAX_STEP`, neuer Wert = alter Wert / (1 + d), gerundet.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(pump_analysis): carb ratio and ISF recommendation cases`.

### Task 10: Engine (Vertrauen, Gegensignale, Gründe) und Anbindung an `prepareCgmData` (Spec 5.4-5.6)

**Files:**
- Create: `lib/report_plugins/pump_analysis/recommendation_engine.js`
- Modify: `lib/report_plugins/pump_analysis/data_processor.js:193-200` (neues Feld `pumpExtras`)
- Modify: `translations/*` (Textbausteine)
- Test: `tests/pump_analysis_recommendations.test.js`, `tests/pump_analysis.test.js`, `tests/ai_eval.test.js`

**Interfaces:**
- Consumes: Task 6-9; `dayStats[i].hypo_episodes` (Start/Ende; Hypo-Definition der bestehenden Episodenerkennung, Spec 3).
- Produces:
  - `rateConfidence({ caseCount, sameDirShare, counterDays }) -> 'high'|'medium'|'low'|'insufficient'|'warning'` (Spec 5.4/5.5: < 5 → insufficient; ≥ 3 Gegensignal-Tage → warning; 1-2 → eine Stufe tiefer, low bleibt low).
  - `findHighEpisodes(readings, thresholdMgdl, minDurationMin) -> Array<{ start, end }>`.
  - `buildRecommendations(input) -> { cards: Card[], basis: { days, pumpDays, fastingWindows, mealsWithCarbs, unclearBoluses, dawnBoluses }, profileSwitch: boolean }`, `Card = { kind: 'basal'|'carbratio'|'isf'|'timing', state, confidence, timeLabel, rows, reasons: Array<{ key, args: string[] }>, basisLine: { key, args } }`. Reihenfolge: Warnungen und Vorschläge zuerst (nach Uhrzeit), dann `ok`, dann `insufficient`.
  - `prepareCgmData(...)` liefert zusätzlich `pumpExtras = { recommendations, readingsByDayMgdl, mealCases }` auf Top-Level, **nicht** in `cgmData`.

- [ ] **Step 1: Failing tests**
  - `rateConfidence`: (4, 1.0, 0) → insufficient; (7, 0.75, 0) → high; (7, 0.74, 0) → medium; (5, 0.60, 0) → medium; (5, 0.59, 0) → low; (7, 0.9, 1) → medium; (5, 0.5, 2) → low; (9, 0.9, 3) → warning.
  - Gegensignal Basal `up` 01-06 mit Hypo an 4/14 Tagen um 03:00 → Card `state 'warning'`, Grund-Schlüssel `'Pump often raises basal here, but hypo on %1/%2 days, clarify the cause first'`.
  - `down` mit Werten > 250 für 20 min an 1 Tag → eine Stufe tiefer; über 190, aber nie über 250 → kein Gegensignal.
  - Basal-Karte im Morgenfenster mit 9 Dawn-Boli → Grund `'Dawn bolus on %1/%2 days not counted, avg %3 U'` mit `['9', '14', '1.2']`.
  - `prepareCgmData` mit 1 Tag ohne Pumpe und ohne KH → `pumpExtras.recommendations.cards` nur `insufficient`, kein Fehler (Review Focus 5).
  - `units: 'mmol'`: BG-Werte werden für die Rechnung umgerechnet (BG 13,9 mmol zählt als > 240) (Review Focus 1).
  - `ai_eval`: `buildSinglePayload(...)`-Ergebnis enthält keinen Schlüssel `pumpExtras`, `recommendations` oder `mealCases` (JSON-String-Prüfung).
- [ ] **Step 2:** Run `npm run test-local -- ./tests/pump_analysis_recommendations.test.js ./tests/pump_analysis.test.js ./tests/ai_eval.test.js`, expect FAIL.
- [ ] **Step 3:** Implementieren. Textbausteine (englische Schlüssel, deutsche Werte nach Spec 5.6) für: Pumpe erhöht/senkt (`%1/%2` Tage, `%3` U/h, `%4` %), Korrektur im Zeitraum, Mahlzeiten nach 2 h über Ziel, Spitze/Zeit, keine Hypo, Hypo an Tagen, Werte über 250 an Tagen, Dawn nicht eingerechnet, Warnung, Datenbasis-Zeile(n), Profilwechsel-Hinweis. Zahlen in `args` als formatierte Strings (Dezimalkomma macht der Renderer nicht; Format `toFixed`).
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(pump_analysis): recommendation engine with confidence and counter-signals`.

### Task 11: Empfehlungs-Karten rendern (Spec 6.2)

**Files:**
- Create: `lib/report_plugins/pump_analysis/recommendations_renderer.js`
- Modify: `lib/report_plugins/pump_analysis/stats_renderer.js` (`renderStats` bekommt 7. Parameter `pumpExtras`, Karten nach Einleitung, vor Perioden-Statistik)
- Modify: `lib/report_plugins/pump_analysis.js:131-138` (übergibt `result.pumpExtras`)
- Modify: `lib/report_plugins/pump_analysis/styles.js` (Kartenstil nach Mockup Abschnitt 1)
- Test: `tests/pump_analysis.test.js`

**Interfaces:**
- Consumes: `Card` (Task 10).
- Produces: `renderRecommendations(rec: { cards, basis, profileSwitch } | null) -> string`.

- [ ] **Step 1: Failing tests**
  - Karte `basal/up/high` mit zwei `rows` → HTML enthält Zeitangabe, `0.60 → 0.70 U/h`, Badge-Klasse `rec-high`, alle Gründe als `<li>`, Datenbasis-Zeile.
  - `warning`-Karte hat Klasse `rec-warning` und keinen Pfeil-Vorschlag.
  - `insufficient` zeigt `translate('Not enough data')`.
  - Fester Hinweis (`'Calculation aid, not a therapy instruction. Change only one parameter at a time.'`) immer vorhanden; bei `profileSwitch` zusätzlicher Hinweis.
  - Gründe-Argumente werden escaped (`<script>` in einem Arg erscheint als `&lt;script&gt;`).
  - `renderStats(..., null)` funktioniert wie bisher (KI-Tab und alte Aufrufer).
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implementieren; Platzhalter mit `.replace('%1', …)` wie `stats_renderer.js:20-23`.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(pump_analysis): render recommendation cards`.

### Task 12: Basal-Fläche rot/blau und Hotspot-Menge (Spec 6.4, 6.5)

**Files:**
- Modify: `lib/report_plugins/pump_analysis/charts.js:285-295` (neue Farbe), `:324-450` (Hotspot), `:452-533` (Basal-Delta)
- Modify: `lib/report_plugins/pump_analysis.js:41-57`
- Test: `tests/pump_analysis.test.js`

**Interfaces:**
- Produces: `COLORS.basalBelow` (Blau, klar unterscheidbar von `#17a2b8`, z. B. `#1f6feb`); `renderPumpActionHotspot` akzeptiert `data.deltaUnitsPerHour: number[24]` und zeigt sie unter dem Tage-Zähler (Format `+0.30`).

- [ ] **Step 1: Failing tests** (jsdom + d3 wie bestehende Report-Tests): `renderBasalDeltaChart` mit actual > scheduled in Stunde 3 und actual < scheduled in Stunde 22 erzeugt einen Pfad mit `fill = COLORS.hyper` und einen mit `fill = COLORS.basalBelow`; Hotspot mit `deltaUnitsPerHour[3] = 0.3` enthält Text `+0.30`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Zwei Flächen über `.defined()` (nur Stunden der jeweiligen Richtung, Schnittpunkte linear interpolieren) oder zwei Clip-Pfade. `deltaUnitsPerHour[h] = basal_actual.hourly[h] - basal_scheduled.hourly[h]`, übergeben in `pump_analysis.js`.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(pump_analysis): directional basal delta fill and hotspot units`.

### Task 13: Mahlzeiten-Kurven (Spec 6.7)

**Files:**
- Modify: `lib/report_plugins/pump_analysis/charts.js` (neue Funktion)
- Modify: `lib/report_plugins/pump_analysis/stats_renderer.js` (Abschnitt mit drei Platzhaltern `aiMealCurve_breakfast|lunch|dinner` nach Insulinverteilung)
- Modify: `lib/report_plugins/pump_analysis.js` (`renderCharts`)
- Test: `tests/pump_analysis.test.js`, `tests/pump_analysis_recommendations.test.js`

**Interfaces:**
- Consumes: `MealCase.curve` (Task 9).
- Produces: `medianCurve(cases: MealCase[]) -> Array<{ min, sgv }>` in `factor_recommendations.js`; `renderMealCurveChart(containerId, { slot, cases, medianCurve, targetLow, targetHigh, units })` in `charts.js`.

- [ ] **Step 1: Failing tests:** `medianCurve` über 3 Kurven liefert pro Minute den Median; Chart mit 3 Fällen zeichnet 4 Pfade (3 dünn, 1 Median) und eine Zusammenfassung mit Median-Spitze, Zeit bis Spitze, 4-h-Wert vs. Start und Anzahl; 0 Fälle → `chartEmpty` mit `'Not enough data'`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implementieren; Werte für die Anzeige mit `fromMgdl` in `meta.units`.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(pump_analysis): meal response curves`.

### Task 14: Perzentil-Bänder und 5 Bereiche (Spec 6.10, 6.11)

**Files:**
- Create: `lib/report_plugins/pump_analysis/glucose_distribution.js`
- Modify: `lib/report_plugins/pump_analysis/data_processor.js` (`pumpExtras.diurnalPercentiles`, `pumpExtras.dailyRanges`)
- Modify: `lib/report_plugins/pump_analysis/charts.js:13-137` (Diurnal), `:139-268` (Daily TIR)
- Modify: `lib/report_plugins/pump_analysis.js:81-86`
- Test: `tests/pump_analysis_recommendations.test.js`, `tests/pump_analysis.test.js`

**Interfaces:**
- Produces:
  - `hourlyPercentiles(readingsByDay, utcOffsetMs) -> Array<{ hour, p10, p25, p50, p75, p90, n }>` (Display-Einheit; `d3.quantile` ist im Node-Test nicht garantiert, deshalb eigene sortierte Quantil-Funktion, lineare Interpolation wie d3).
  - `dailyRanges(readingsByDay, targetLowMgdl, targetHighMgdl) -> Array<{ dateKey, veryLow, low, inRange, high, veryHigh }>` (Prozent, Grenzen < 54, < targetLow, ≤ targetHigh, ≤ 250, > 250 in mg/dl).
  - `renderDiurnalChart(containerId, percentiles, meta)` und `renderDailyTirChart(containerId, ranges, dayDates)` bekommen die neuen Daten.

- [ ] **Step 1: Failing tests:** `hourlyPercentiles` mit Werten 100..190 in Stunde 8 → `p50` 145, `p10` 109; `dailyRanges` mit je einem Wert in jedem Bereich → je 20 %; Diurnal-Chart zeichnet zwei Band-Pfade und die Median-Linie; Daily-Chart zeichnet 5 Segmente pro Tag mit Legende in 5 Einträgen.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implementieren; die Stundentabelle unter "Hourly breakdown" zeigt P25/Median/P75 statt Avg/SD.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(pump_analysis): percentile bands and five-range daily breakdown`.

### Task 15: Seed-Daten und Prüfung im Browser (Spec 10)

**Files:**
- Create: `scripts/seed-pump-analysis-demo.js`

- [ ] **Step 1:** Skript schreibt über `MONGODB_URI` 21 Tage synthetische Daten: CGM alle 5 min, Profil (Basal 0,6 U/h 02-06, sonst 0,8; KH-Faktor 10; `sens` 45), Temp Basal 0,9 02-06 an 80 % der Tage, Dawn-Boli 1,2 U um 06:00, Mahlzeiten mit KH mittags und abends, Korrekturen bei > 240, Hypo-Abende 22-24 Uhr an 4 Tagen, `created_at` und `utcOffset` gesetzt.
- [ ] **Step 2:** Dev-Server gegen In-Memory-MongoDB starten, Skript laufen lassen, Report "Pumpen-Analyse" für den Zeitraum öffnen (Brave, Claude in Chrome).
- [ ] **Step 3:** Prüfen und Screenshots ablegen unter `.claude-bw/local/notes/`: Basal-Karte 01-06 mit Vorschlag, Warnkarte 22-24, mindestens eine "zu wenig Daten"-Karte, Statistik mit Ziel und Erklärung, Legende plausibel (ca. 20 U/Tag Basal), Basal-Fläche rot und blau, drei Mahlzeiten-Kurven, Perzentil-Bänder, 5 Bereiche, alle Texte deutsch, KI-Tab-Tabelle weiter kurz, keine Konsolenfehler.
- [ ] **Step 4:** `npm run lint` und `npm run test-local`. Expected: Lint ohne neue Fehler; Tests grün bis auf die bekannten Windows-only-Fehler (`dependency-brace-expansion`, `food-editor-touch-scroll`, `dependency-postcss`).
- [ ] **Step 5:** Commit `chore(pump_analysis): demo seed script for browser check`.
- [ ] **Step 6:** Nutzer öffnet den Report mit echten Daten (21.10.-03.11.) und vergleicht mit den Screenshots aus dem Brainstorming. Ergebnis abwarten, bevor gemergt wird.
