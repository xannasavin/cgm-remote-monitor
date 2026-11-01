# Pump Analysis Tab Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the current "AI Evaluation" report tab into an always-visible "Pump Analysis" tab (local statistics and pump charts, no LLM) and an "AI Evaluation" tab that stays gated behind `AI_LLM_KEY`.

**Architecture:** The report client loads the period data once and calls `report(datastorage, sorteddaystoshow, options)` on every report plugin with the same objects. The deterministic part (data preparation, statistics rendering, charts) moves into its own folder `lib/report_plugins/pump_analysis/`; `lib/report_plugins/ai_eval/` keeps only the LLM part and depends on `pump_analysis/`, never the other way round. A single-slot cache runs `prepareCgmData` once per report and hands the result to both tabs. Server-side AI routes and admin plugins stay gated exactly as today.

**Tech Stack:** Node.js, jQuery, D3 (existing charts), mocha + should, jsdom (`tests/fixtures/secure-jsdom`, `tests/fixtures/dom-globals`), webpack.

**Spec:** Decisions from the conversation of 2026-11-01 (no separate spec file):
- Two tabs. "Pump Analysis" (de: "Pumpen-Analyse") is always registered. "AI Evaluation" (de: "KI-Auswertung") is only registered when `AI_LLM_KEY` is set.
- Without a key the Pump Analysis tab shows an info hint (not an error) that AI evaluation needs `AI_LLM_KEY`.
- One `prepareCgmData` run per report, shared by both tabs.
- Code split now: `pump_analysis/` owns data preparation, statistics renderer, charts, cache, styles; `ai_eval/` owns payload building, LLM rendering, client, prompts, schemas, cost tracking, and the 14-day limit.
- Pump Analysis always computes on "Show" (no skip list entry, no lazy loading); lazy computation is a possible later follow-up.
- The AI tab shows a compact period KPI table above the LLM answer, rendered by the same function as the period table in Pump Analysis.
- The 14-day limit applies only to AI Evaluation.
- Pump Analysis is placed after Loopalyzer.
- Future topics (Anthropic rework, pump analysis extensions, Garmin data) are out of scope; see `2026-11-01-ideen-pumpenanalyse-ki-garmin.md`.

## Global Constraints

- Code style per `CLAUDE.md`: 2-space indent, single quotes, `function name (args)`, comma-first multi-line objects/arrays.
- Dependency direction: files under `lib/report_plugins/pump_analysis/` and `lib/report_plugins/pump_analysis.js` must not `require` anything from `ai_eval`.
- Server-side gating stays unchanged: `lib/api/index.js:159` and `lib/admin_plugins/index.js:16`.
- Every new translation key goes into `translations/en/en.json`, `translations/de_DE.json` and `translations/lt_LT.json` (`tests/language.test.js:113` requires `lt_LT.json` to have exactly the keys and `%N` placeholders of `en.json`; an English value is acceptable for Lithuanian).
- All dynamic HTML goes through `escapeHtml`.
- Chart container ids (`aiPumpActionHotspot`, `aiBasalDeltaChart`, `aiInsulinDistributionChart`, `aiEpisodeTimingChart`, `aiDiurnalChart`, `aiDailyTirChart`) stay unchanged; after this change only Pump Analysis emits them.
- Test commands: run in Git Bash as `TEST=<name> npm run test-single` (needs `my.test.env`, see `CLAUDE.md`). `$TEST` does not expand under cmd.exe/PowerShell; there use `npx env-cmd -f ./my.test.env mocha --timeout 5000 --require ./tests/hooks.js --exit ./tests/<name>.test.js`.
- jsdom tests follow the setup/teardown pattern of `tests/report-sgv-pipeline.test.js:13-62` (`createSecureDOM`, `installDomGlobals`, `restoreDomGlobals`, clearing `lib/report_plugins/` from `require.cache`).

## Review Focus

1. **Second report with a different date range.** `datastorage` (`lib/report/reportclient.js:36`) is long-lived and keeps every loaded day plus metadata keys; `prepareCgmData` iterates all its day keys today. Showing 14 days and then 3 days must yield statistics for 3 days. Pinned in Task 2.
2. **Report rerun with identical dates.** Each "Show" creates a new `sorteddaystoshow` array (`reportclient.js:417`); the cache must recompute for a new array reference. Pinned in Task 2.
3. **No key configured.** Pump Analysis must not call any `/api/v1/ai_*` endpoint and must render fully. Pinned in Task 3 (jsdom test with `$.ajax`/`fetch` spies, source-level dependency test) and Task 5 (network check).
4. **Pump Analysis throws on unusual data.** Its `report()` runs synchronously inside `eachPlugin` (`reportclient.js:541-566`); an exception would abort the loop and leave the "Show" button hidden for every user. `report()` must catch, show an error box in its own tab, and let the loop continue. Pinned in Task 3. Note: `tests/reports.test.js` is `describe.skip` (`:328`) and `tests/report-sgv-pipeline.test.js` overrides `eachPlugin` (`:132-154`), so neither exercises the new plugin; only `tests/report-reconnect.test.js:99-128` runs its `html()`. Task 3 adds its own jsdom tests.
5. **CSS leaking or shifting.** The shared stylesheet now loads on every report page. The unscoped `ul { ... }` rule from the old `unifiedCss` (`ai_eval.js:28`) becomes `.cgm-wrap ul { ... }`; `.ai-section-error` is defined once (the variant at `ai_eval.js:36`, which wins today because it is injected inline after the head styles). Pinned in Tasks 3 and 4.

## Known issues, out of scope

- `datastorage.profiles[0]` (future `raw_profile`) can be a profile valid after the selected end date, because `loadProfilesRangeNext` inserts with `unshift` (`reportclient.js:804`). This already affects Basal Delta today and is not changed here.

---

### Task 1: Extract `pump_analysis/` modules (move only, no behavior change)

**Files:**
- Move: `lib/report_plugins/ai_eval/charts.js` to `lib/report_plugins/pump_analysis/charts.js` (`git mv`), then modify it
- Create: `lib/report_plugins/pump_analysis/render_utils.js`
- Create: `lib/report_plugins/pump_analysis/stats_renderer.js`
- Create: `lib/report_plugins/pump_analysis/data_processor.js`
- Modify: `lib/report_plugins/ai_eval/renderer.js`
- Modify: `lib/report_plugins/ai_eval/data_processor.js`
- Modify: `lib/report_plugins/ai_eval.js` (requires and the translate call at `:86` only)
- Test: `tests/ai_eval.test.js`, new `tests/pump_analysis.test.js`

**Interfaces:**
- Produces:
  - `pump_analysis/render_utils.js`, moved from `ai_eval/renderer.js`: `TRANSLATE_STORE_KEY` + `translateHost` + `setTranslate(fn)` + `translate(key)` (`:13-23`, keep the key value `'__aiEvalTranslate'`), `escapeHtml(s)` (`:27-34`), `formatDate(str)` (`:85-90`), `fmt(val, unit, decimals)` (`:92-97`), `list(items)` (`:99-102`), `table({ head, rows })` (`:142-150`). Exports all of them except the two store internals.
  - `sanitizeEvidenceText`, `sanitizeAnalysisStrings`, `coerceText`, `renderInsightItem`, `renderInsightList` stay in `ai_eval/renderer.js`.
  - `pump_analysis/charts.js`: line 4 `require('./renderer')` becomes `require('./render_utils')` (used for `formatDate` at `:162`); its private translate store (`:278-288`) is replaced by `render_utils.translate`, and its exported `setTranslate` delegates to `render_utils.setTranslate`.
  - `pump_analysis/stats_renderer.js`: `renderStats(periodStats, dayStats, meta, dayDates, pumpActionStats, episodeTiming)` plus private helpers `coverageBadge`, `sectionSubtitle`, `chartPlaceholder`, `renderInsulinLegend`, moved from `ai_eval/renderer.js:152-485`.
  - `pump_analysis/data_processor.js`: `prepareCgmData(datastorage, settings, options)`. Profile handling changes: no call to `prompts.formatProfileJSON`; `cgmData.profile` and the top-level `cgmProfile` field are replaced by `cgmData.raw_profile` (= `datastorage.profiles[0]` or `null`). Everything else in the return shape is unchanged (including `exceedsLimit` for now; Task 4 removes it).
  - `ai_eval/data_processor.js`: only `buildSinglePayload(cgmData, promptData, settings, language)`; `profileJson` = `JSON.stringify(prompts.formatProfileJSON(cgmData.raw_profile))`, or `'{}'` when that returns null.
  - `ai_eval/renderer.js` exports: `escapeHtml`, `formatDate` (re-exported from `render_utils`, used by `ai_eval.js`), `renderAnalysis`, `renderDaily`, `renderMultiDay`, `renderCgmReport`, `sanitizeEvidenceText`, `sanitizeAnalysisStrings`. No longer exported: `renderStats`, `fmt`, `list`, `table`, `setTranslate`.
  - `ai_eval.js:86`: `renderer.setTranslate(...)` becomes `renderUtils.setTranslate(...)` with `var renderUtils = require('./pump_analysis/render_utils')`.

- [ ] **Step 1: Move and adapt the tests first**

Into `tests/pump_analysis.test.js`, requiring the new paths:
- `escapeHtml`, `fmt`, `list`, `table`, `renderStats` blocks from `tests/ai_eval.test.js:60-161`;
- the `prepareCgmData` block starting at `:418` (to the end of that `describe`);
- `describe('renderStats with dayDates')` from `:1077-1105`;
- a new `it('exports prepareCgmData')` for `pump_analysis/data_processor`.

In `tests/ai_eval.test.js`:
- `:413-416`: assert only `buildSinglePayload` on `ai_eval/data_processor`.
- `:216-222`: assert only `renderAnalysis` in the `renderCgmReport` export test.
- `makeCgmData()` at `:545`: rename `profile:` to `raw_profile:` and give it a store-shaped profile (`{ defaultProfile: 'D', store: { D: { basal: [...] } } }`).
- New `it('formats the profile from cgmData.raw_profile')`: the built user/system prompt contains `JSON.stringify(prompts.formatProfileJSON(raw_profile))` where `{{PROFILE_JSON}}` stood.

- [ ] **Step 2: Run tests to verify they fail**

Run: `TEST=pump_analysis npm run test-single`
Expected: FAIL with `Cannot find module '../lib/report_plugins/pump_analysis/render_utils'`.

- [ ] **Step 3: Implement the move** as listed under Interfaces. `ai_eval.js` keeps calling `renderStats` and `charts` from their new locations for now (Task 4 removes that).

- [ ] **Step 4: Run tests to verify they pass**

Run: `TEST=pump_analysis`, `TEST=ai_eval`, `TEST=statistics` (each with `npm run test-single`)
Expected: PASS all three.

- [ ] **Step 5: Commit**

```bash
git add -A lib/report_plugins tests/ai_eval.test.js tests/pump_analysis.test.js
git commit -m "refactor(reports): extract pump_analysis modules from ai_eval"
```

---

### Task 2: Day filter for `prepareCgmData` and shared analysis cache

**Files:**
- Modify: `lib/report_plugins/pump_analysis/data_processor.js`
- Create: `lib/report_plugins/pump_analysis/analysis_cache.js`
- Test: `tests/pump_analysis.test.js`

**Interfaces:**
- Consumes: `prepareCgmData` (Task 1).
- Produces:
  - `prepareCgmData(datastorage, settings, options, dayKeys)`: optional 4th parameter, array of `'YYYY-MM-DD'`. When it is an array, only those keys that exist as own properties of the day map are processed; otherwise all day keys as today. Return shape unchanged.
  - `analysisCache.getAnalysis(datastorage, settings, options, dayKeys)`: returns the `prepareCgmData` result; single-slot memo keyed on the `dayKeys` array reference. Not an array: always recompute, store nothing. It must call `dataProcessor.prepareCgmData(...)` through the module object (not a destructured reference) so tests can count calls.
  - `analysisCache.clear()`.

- [ ] **Step 1: Write the failing tests**

- `it('only processes the day keys passed as dayKeys')`: datastorage shaped like production (days `2026-03-13`, `-14`, `-15` with one SGV each, plus `allstatsrecords: []`, `alldays: 3`, `treatments: []`, `devicestatus: []`, `profiles: []`), `dayKeys = ['2026-03-14', '2026-03-15']`; assert `dayCount === 2`, `cgmData.meta.from === '2026-03-14'`.
- `it('processes all day keys when dayKeys is omitted')`: same data; `dayCount === 3`.
- `describe('analysis_cache')` with `beforeEach(clear)`:
  - `it('returns the same object for the same dayKeys reference')`: `first === second`.
  - `it('recomputes for a new array with identical content')`: `keys.slice()`; `first !== second`, `second.dayCount === first.dayCount`.
  - `it('does not cache without dayKeys')`: results are different objects.

- [ ] **Step 2: Run tests to verify they fail**

Run: `TEST=pump_analysis npm run test-single`
Expected: FAIL (`dayCount` 3 instead of 2; missing module `analysis_cache`).

- [ ] **Step 3: Implement.** In `prepareCgmData` rename the local `dayKeys` (old line 63) to `dayKeyList` and derive it from the parameter. `analysis_cache.js`: module-level `var slot = null` holding `{ dayKeys, result }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `TEST=pump_analysis npm run test-single`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/report_plugins/pump_analysis tests/pump_analysis.test.js
git commit -m "feat(pump_analysis): shared analysis cache and day filter"
```

---

### Task 3: `pump_analysis` report plugin, always registered

**Files:**
- Create: `lib/report_plugins/pump_analysis/styles.js`
- Create: `lib/report_plugins/pump_analysis.js`
- Modify: `lib/report_plugins/pump_analysis/stats_renderer.js` (extract period table)
- Modify: `lib/report_plugins/index.js:11-28`
- Modify: `translations/en/en.json`, `translations/de_DE.json`, `translations/lt_LT.json`
- Test: `tests/pump_analysis.test.js`; run `tests/report-reconnect.test.js`

**Interfaces:**
- Consumes: `analysisCache.getAnalysis` (Task 2), `renderStats`, `render_utils.setTranslate`, `charts.render*` (Task 1).
- Produces:
  - `styles.REPORT_CSS`: CSS string (no `<style>` wrapper) = old `unifiedCss` content (`ai_eval.js:14-66`) with `ul {` scoped to `.cgm-wrap ul {`, plus `.pump-analysis-hint` with the same values as `.cgm-analysis-intro` (`ai_eval.js:58-59`). It keeps `.ai-section-error` from `ai_eval.js:36`.
  - `statsRenderer.renderPeriodSummary(periodStats, meta)`: returns the period `table(...)` HTML currently built at `ai_eval/renderer.js:192-204` (8 body rows: average, median, SD, CV, MAGE, TIR, TBR, TAR); `renderStats` calls it instead of building the table inline.
  - Plugin `require('./pump_analysis')(ctx)`: `{ name: 'pump_analysis', label: 'Pump Analysis', html(client), css, report(datastorage, sorteddaystoshow, options), renderCharts(result) }`.
  - DOM: `#pump-analysis-container`, `#pumpAnalysisStatsArea`, hint `<div id="pumpAnalysisAiHint" class="pump-analysis-hint" role="note">`.
  - Translation keys: `"Pump Analysis"` (de `"Pumpen-Analyse"`); `"AI evaluation is not available: the AI_LLM_KEY environment variable is not set. All statistics on this page are calculated locally."` (de `"KI-Auswertung nicht verfügbar: Die Umgebungsvariable AI_LLM_KEY ist nicht gesetzt. Alle Statistiken auf dieser Seite werden lokal berechnet."`); `"Pump analysis could not be computed for this period."` (de `"Die Pumpen-Analyse konnte für diesen Zeitraum nicht berechnet werden."`).

- [ ] **Step 1: Write the failing tests** (`tests/pump_analysis.test.js`)

Node-only:
- `it('exports name pump_analysis and label Pump Analysis')`.
- `it('css scopes list styles to .cgm-wrap')`: `plugin.css` contains `.cgm-wrap ul`; `/(^|\})\s*ul\s*\{/` does not match `styles.REPORT_CSS`.
- `it('shows an info hint when ai_llm_key_is_set is false')`: `html({ settings: { ai_llm_key_is_set: false }, translate: identity })` contains `pumpAnalysisAiHint`, `AI_LLM_KEY`, `role="note"`; does not contain `role="alert"` or `ai-section-error`.
- `it('has no AI hint when ai_llm_key_is_set is true')`.
- `it('html tolerates a client without settings')`: `html({ translate: identity })` does not throw and shows the hint.
- `it('never renders AI controls')`: no `sendToAiButton`, no `aiAnalysisArea`, for both settings.
- `it('does not depend on ai_eval')`: read every file in `lib/report_plugins/pump_analysis/` plus `pump_analysis.js` with `fs`; none contains a `require(` of a path with `ai_eval`, nor the string `/api/v1/ai_`.
- `it('report is a no-op without window')`: `plugin.report({}, [], {})` does not throw.
- `it('renderPeriodSummary renders the 8 period metrics')`: output contains `Time in Range` and `MAGE`; the `<tbody>` part contains exactly 8 `<tr>`.
- `it('renderStats embeds renderPeriodSummary')`: `renderStats(p, d, meta)` contains `renderPeriodSummary(p, meta)` as a substring.

jsdom (`describe('pump_analysis in the report page')`, setup per Global Constraints, no `requestAnimationFrame` on the window):
- `it('renders statistics into the tab without AI requests')`: spy on `$.ajax` and `window.fetch`; `plugin.html(client)` appended to `#pluginchartplaceholders`; `plugin.report(storage, days, options)` with a 2-day fixture; assert `#pumpAnalysisStatsArea` contains `Time in Range`; assert no spied call targets `/api/v1/ai_`.
- `it('shows an error box instead of throwing on malformed data')`: stub `analysisCache.getAnalysis` to throw; `report()` does not throw, `#pumpAnalysisStatsArea` contains `ai-section-error` and the translated error text.
- `it('registers pump_analysis after loopalyzer, ai_eval only with a key')`: init `require('../lib/report_plugins')` with `{ settings: { ai_llm_key_is_set: false }, language: { translate: identity } }`, collect names via `eachPlugin`; the list ends with `['loopalyzer', 'pump_analysis']`. With `ai_llm_key_is_set: true` it ends with `['loopalyzer', 'pump_analysis', 'ai_eval']`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `TEST=pump_analysis npm run test-single`
Expected: FAIL with `Cannot find module '../lib/report_plugins/pump_analysis'`.

- [ ] **Step 3: Implement**

- `pump_analysis.js`: module-level `var reportClient = null`.
  - `html(client)`: stores the client; `var settings = (client && client.settings) || {}`; wires `render_utils.setTranslate(client.translate)` when it is a function; returns the container with the hint (only when `!settings.ai_llm_key_is_set`) and an empty `#pumpAnalysisStatsArea`.
  - `css` = `styles.REPORT_CSS`.
  - `report(...)`: return when `typeof window === 'undefined'`. Inside `try`: `result = analysisCache.getAnalysis(datastorage, (reportClient && reportClient.settings) || {}, options, sorteddaystoshow)`, called through the module object so the jsdom test can stub it (same rule for `ai_eval` in Task 4); set `#pumpAnalysisStatsArea` to `'<div class="ai-section ai-section-stats">' + renderStats(...) + '</div>'` with the arguments used at `ai_eval.js:409-416`; schedule `renderCharts(result)` via `window.requestAnimationFrame` when it is a function, else `setTimeout(fn, 0)`. In `catch`: `console.error`, and set `#pumpAnalysisStatsArea` to a `.ai-section-error` box with the translated error text. No 14-day warning.
  - `renderCharts(result)`: the chart dispatch block moved from `ai_eval.js:424-493`, wrapped in its own `try/catch` with `console.error`.
- `index.js`: append `, require('./pump_analysis')(ctx)` after `loopalyzer`. The `ai_eval` gate stays.
- Translations: the three keys in all three files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `TEST=pump_analysis`, `TEST=language`, `TEST=report-reconnect`, `TEST=report-sgv-pipeline` (each with `npm run test-single`)
Expected: PASS all four.

- [ ] **Step 5: Commit**

```bash
git add lib/report_plugins translations tests/pump_analysis.test.js
git commit -m "feat(reports): always-visible Pump Analysis tab with local statistics"
```

---

### Task 4: Slim `ai_eval` down to the LLM flow with KPI table

**Files:**
- Modify: `lib/report_plugins/ai_eval.js` (remove `unifiedCss` 14-66, the dead hint line 111, the stats and chart block 392-494; rework `initializeAiEvalTab` translate wiring 83-88, `processAiEvaluationData` 320-537, `html` 549-583, `css` 585-614, `report` 616-654)
- Modify: `lib/report_plugins/pump_analysis/data_processor.js` (remove `exceedsLimit`)
- Modify: `translations/en/en.json`, `translations/de_DE.json`, `translations/lt_LT.json`
- Test: `tests/ai_eval.test.js` (`:7-16`, `:446-453`, `:861-889`), `tests/pump_analysis.test.js`

**Interfaces:**
- Consumes: `analysisCache.getAnalysis` (Task 2), `statsRenderer.renderPeriodSummary`, `render_utils.setTranslate` (Tasks 1, 3).
- Produces:
  - Plugin name `ai_eval`, label `AI Evaluation` (unchanged), plus `exceedsDayLimit(dayCount)` on the plugin object (`dayCount > AI_MAX_DAYS`, module constant `AI_MAX_DAYS = 14`).
  - DOM id `aiKpiArea` for the KPI table.
  - Translation keys: `"AI Evaluation"` (de `"KI-Auswertung"`), `"Charts and the full statistics for this period are in the Pump Analysis tab."` (de `"Diagramme und die vollständige Statistik für diesen Zeitraum stehen im Tab Pumpen-Analyse."`).

- [ ] **Step 1: Write the failing tests**

Node-only, in `tests/ai_eval.test.js`:
- `it('css relies on pump_analysis for shared styles')`: `aiEval.css` does not contain `.cgm-wrap` or `.ai-section-error {`, and contains `#aiUsageStats ul`.
- `it('html has the KPI mount and no statistics mount')`: `aiEval.html({ settings: {} })` contains `aiKpiArea` and `sendToAiButton`, not `aiStatsArea`, and contains `Pump Analysis`.
- `it('ai_eval neither renders charts nor prepares data itself')`: `lib/report_plugins/ai_eval.js` source contains neither `charts.render` nor `prepareCgmData(`.
- `it('exceedsDayLimit is true above 14 days')`: `exceedsDayLimit(14) === false`, `exceedsDayLimit(15) === true`. Replaces `:446-453`; remove the `exceedsLimit` assertions from the moved `prepareCgmData` tests in `tests/pump_analysis.test.js`.
- Delete the four tautological isolation tests (`:865-883`); registration is covered by the jsdom test in Task 3.

jsdom, in `tests/ai_eval.test.js` (setup per Global Constraints, `$.ajax` stubbed to answer prompts and limit synchronously):
- `it('reuses the pump analysis result and fills the KPI table')`: wrap `pump_analysis/data_processor.prepareCgmData` with a counter; `pumpAnalysis.report(ds, days, opts)`; set `window.tempAiEvalReportData = { datastorage: ds, options: opts, sorteddaystoshow: days }` and call `window.processAiEvaluationData()` after `aiEval.html(client)`; assert counter `=== 1` and `#aiKpiArea` contains `Time in Range`.
- `it('report() clears the previous KPI table')`: put text into `#aiKpiArea`, call `aiEval.report(ds, newDays, opts)`; `#aiKpiArea` is empty before processing runs.
- `it('shows the 14-day warning and a neutral prompt status for long ranges')`: 15-day fixture; `#aiAnalysisArea` contains `role="alert"`, the send button stays disabled, `#ai-system-prompt-status` and `#ai-user-prompt-status` read `Skipped`, no `$.ajax` call happened.

- [ ] **Step 2: Run tests to verify they fail**

Run: `TEST=ai_eval npm run test-single`
Expected: FAIL on the css, html, source, `exceedsDayLimit` and jsdom assertions.

- [ ] **Step 3: Implement**

- `css`: the existing AI-specific rules (`ai_eval.js:586-614`) without the `.ai-section-error` rule at `:606` (the shared one from `REPORT_CSS` stays in effect, as today), plus `#aiUsageStats ul { padding-left: 1.2rem; margin: .2rem 0; }`. `REPORT_CSS` is not repeated here; `pump_analysis` is always registered when `ai_eval` is (pinned by the Task 3 registration test).
- `html`: drop `#aiStatsArea`; add `#aiKpiArea` above `#aiAnalysisArea`; under the disclaimer the pointer line, translated via `originalClient.translate` when it is a function; status box without the `AI_LLM_KEY` line.
- `initializeAiEvalTab`: replace the renderer/charts translate wiring at `:83-88` with a single `renderUtils.setTranslate(passedInClient.translate)`.
- `report()`: replace the `aiStatsArea` reset with emptying `#aiKpiArea`; keep the other resets, the generation counter and `window.tempAiEvalReportData`.
- `processAiEvaluationData`: compute `result = analysisCache.getAnalysis(reportData.datastorage, settings, reportData.options, reportData.sorteddaystoshow)` first; set `#aiKpiArea` to `renderPeriodSummary(result.periodStats, result.cgmData.meta)`; fill `window.aiEvalState` as today. If `exceedsDayLimit(result.dayCount)`: show the existing 14-day text in `#aiAnalysisArea` with `role="alert"` (reworded to point to the Pump Analysis tab instead of "Statistics are shown below"), keep the button disabled, set both prompt status spans to `Skipped`, skip the prompts request. Otherwise fetch prompts and the monthly limit as today and build the payload from `result.cgmData`.
- `pump_analysis/data_processor.js`: drop `exceedsLimit` from the return object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `TEST=ai_eval`, `TEST=pump_analysis`, `TEST=language` (each with `npm run test-single`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/report_plugins tests/ai_eval.test.js tests/pump_analysis.test.js translations
git commit -m "refactor(ai_eval): keep LLM flow only, add period KPI table"
```

---

### Task 5: Full verification

- [ ] **Step 1:** `npm run lint`. Expected: no errors beyond the baseline in `.claude-bw/local/notes/lint-final.txt`.
- [ ] **Step 2:** `npm test`. Expected: same pass/fail picture as on `master` before Task 1 (run once on `master` first and keep the summary).
- [ ] **Step 3:** `npm run bundle-dev`. Expected: webpack completes without errors.
- [ ] **Step 4: Manual, without key** (`npm run dev`, no `AI_LLM_KEY` in `my.env`), language German:
  - `/report`, load 7 days: tab "Pumpen-Analyse" after Loopalyzer with info hint, statistics and all charts; no "KI-Auswertung" tab; the network panel shows no `/api/v1/ai_` request.
  - Load 3 days: header and day table show 3 days.
  - Lists in other report tabs look unchanged.
  - `GET /api/v1/ai_settings/prompts` returns 404; the admin page shows no AI admin plugin.
  - Load 60 to 90 days: note the time until the report renders and compare with the same range on `master` (with a dummy key); no hard threshold, report the numbers.
- [ ] **Step 5: Manual, with key**:
  - Both tabs exist; Pumpen-Analyse without hint.
  - KI-Auswertung shows the KPI table, the pointer line, and the send button enables after load; error boxes and the usage list look as before.
  - A 20-day range shows the 14-day warning only in KI-Auswertung; Pumpen-Analyse renders normally.
- [ ] **Step 6: Commit/PR text** lists the behavior changes beyond the tab split: the day filter (stale days from earlier reports no longer enter statistics and the AI payload), the `raw_profile` shape change, removal of the dead `AI_LLM_KEY` status line, and replacement of the tautological isolation tests.
