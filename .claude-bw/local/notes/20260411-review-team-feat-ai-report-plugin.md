# Team Review Report
**Date:** 2026-04-11
**Mode:** code
**Profile:** custom (backend-senior, devils-advocate, product-manager)
**Branch:** feat/ai-report-plugin
**Base:** 07ceccc0 (prior HEAD, this session's diff only)
**Files reviewed:** 7 (.eslintrc.js, package.json, package-lock.json, lib/report_plugins/ai_eval.js, lib/report_plugins/ai_eval/charts.js, lib/statistics.js, ai_evaluation.md)
**Scope:** Session-only — narrow review of R5-2/R5-3 fix work + ESLint cleanup side quest. Prior findings (20260410 report) not re-reviewed.
---

## Team Review: feat/ai-report-plugin — custom team (narrow session scope)

### Quick Reference
| Reviewer | Verdict | Critical | Warnings | Suggestions |
|----------|---------|----------|----------|-------------|
| R1 Backend Senior | concerns | 1 | 2 | 1 |
| R2 Devil's Advocate | concerns | 1 (filtered) | 3 | 2 |
| R3 Product Manager | concerns | 0 | 2 | 2 |

---

### Critical Findings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R1-1 | `lib/statistics.js` `computeDayStats` JSDoc `@example` uses wrong field names: says `{ avg: 125, readings: 3 }` but the actual return object uses `average` and `total_readings` (see lines 101, 112). Verified against code. Misleads any dev who copies the example. (also R2-5) **Fixed 2026-04-11: @example now uses `average` / `total_readings` to match the return object.** | R1 Backend Senior, R2 Devil's Advocate | FIX | DONE |

### Warnings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R1-2 | `ai_evaluation.md` Pump-Coverage section said "A day is counted as pump-covered when it contains at least one Temp Basal *or* Basal Suspension event." Actual code at `detectPumpCoverage` ALSO counts `Basal Resume` events and any event where `enteredBy.indexOf('Pump') !== -1`. (also R2-6) **Fixed 2026-04-11: pump-coverage section now lists all four criteria explicitly and explains the `enteredBy` fallback for pump-sync tooling.** | R1 Backend Senior, R2 Devil's Advocate | FIX | DONE |
| R1-3 | `ai_evaluation.md` data-flow diagram listed `Profile Switch scan` as the final pipeline step, but it actually runs inline in the early validation loop at lines ~1527-1535. **Fixed 2026-04-11: diagram moves Profile Switch scan to immediately after `validateProfileForBasal()`, marks it `(inline)`, and adds a note clarifying it runs in the validation loop alongside `validation_warnings` collection.** | R1 Backend Senior | FIX | DONE |
| R2-2 | `isAutoBolusEvent` and `isUserBolusEvent` JSDoc examples are both correct but pedagogically confusing: reader might infer a symmetric rule when the real invariant is asymmetric (positive-match). User chose to skip — examples are functionally correct. | R2 Devil's Advocate | SKIP | SKIPPED |
| R2-3 | `charts.js:140` `renderDailyTirChart` had a `_meta` parameter reserved "for future TIR band config" but never read, with caller at `ai_eval.js:454` passing `result.cgmData.meta`. YAGNI violation. **Fixed 2026-04-11: removed the `_meta` parameter from the function signature, JSDoc, and caller site. Re-add later if actually needed for TIR band config.** | R2 Devil's Advocate | FIX | DONE |
| R2-4 | `computePeriodStats` JSDoc `@example` showed specific output numbers (`average: 142, median: 138, sd: 34.2, ...`) without showing the inputs, potentially misleading readers into thinking those are guaranteed outputs for any input. **Fixed 2026-04-11: rewrote the @example to (a) explicitly mark it as a "shape-of-output example — concrete numbers are illustrative, not guaranteed", (b) annotate each numeric value with `// illustrative`, (c) show the nested shape of `episode_summary`, `diurnal_patterns`, and `treatment_summary` without making numeric claims.** | R2 Devil's Advocate | FIX | DONE |
| R3-1 | `profile_switch_detected` flag was implemented in `computePumpActionStats` but `tests/statistics.test.js` had zero assertions covering it. Silent regression risk. **Fixed 2026-04-11: added two new test cases in the `computePumpActionStats orchestrator` describe block — (1) flag is true when a Profile Switch treatment is present, (2) flag is false when no Profile Switch events are present. Test suite now at 97 passing (was 95).** | R3 Product Manager | FIX | DONE |
| R3-2 | ESLint plugin activation needs to be called out in the eventual commit message so reviewers understand the scope (disable-line comments were already referencing an unconfigured rule — installing the plugin makes lint coherent). **Action deferred to commit time:** when the user asks to commit, the commit message must include a rationale paragraph explaining the plugin install (disable comments referenced an unconfigured rule → install the plugin they reference → lint-rule-not-found errors drop from 10 to 0, overall lint error count drops from 54 to 43). | R3 Product Manager | FIX | DEFERRED — to commit time |

### Suggestions
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R2-7 | `argsIgnorePattern: '^_'` + `caughtErrorsIgnorePattern: '^_'` adds a convention-based silencing mechanism. Standard JS/TS convention; documented in CONTRIBUTING.md as part of R3-3 fix. | R2 Devil's Advocate | SKIP | SKIPPED — mitigated by R3-3 doc note |
| R3-3 | One-line note in CONTRIBUTING.md documenting the new `_` prefix convention so future contributors don't wonder why `_ctx` appears instead of `ctx`. **Fixed 2026-04-11: added a bullet to the Style Guide section of CONTRIBUTING.md describing the underscore-prefix convention for signature-required unused parameters and caught errors, with `init (_ctx)` as the canonical example.** | R3 Product Manager | FIX | DONE |

### Filtered
| ID | Details | Why filtered |
|----|---------|--------------|
| R2-1 | **[CRITICAL per reviewer] `ai_settings.js:34,111` have `innerHTML =` without disable comments — next full-repo lint will break CI.** | **FALSE POSITIVE.** Verified by running `npx eslint lib` at both 07ceccc0 (baseline, before session) and HEAD (after session): baseline = 71 problems (54 errors, 17 warnings); after session = 60 problems (43 errors, 17 warnings). Lint has been broken on master for a long time and CI clearly does not gate on it. The session's config change REDUCED the error count by 11, it did not introduce new failures. Additionally, the two `innerHTML` sites in `ai_settings.js` assign **static HTML string literals** — `plugin:no-unsanitized/DOM` only flags dynamic content assignments, so those sites would not be flagged even if lint were green. Follow-up work parked at `.claude-bw/local/notes/lint-cleanup-backlog.md` as a separate cleanup PR. |
| R3-4 | **[SUGGESTION per reviewer] Verify renderer integration of `profile_switch_detected` flag.** | **CONTRADICTED.** R2 Devil's Advocate independently grep'd the renderer and found the integration at `lib/report_plugins/ai_eval/renderer.js:214-216`: `if (pumpActionStats && pumpActionStats.profile_switch_detected) { pumpSectionsHtml += ' ' + escapeHtml(translate('Profile switch detected — basal delta may be approximate for this period.')); }`. The integration exists and matches the doc's claim. |
| R1-4 | **[SUGGESTION per reviewer] Run `npm run lint` in CI before merge to catch any untouched-file regressions from the new plugin.** | **SUPERSEDED.** Already verified above: lint was 71 problems before, 60 after. Running full lint in CI would not be blocked by this session's changes — CI has been tolerating these errors for a long time. The suggestion is still directionally fine (lint should be gated eventually) but is out of scope for this session. See `lint-cleanup-backlog.md`. |

---

### Recommendation

**All actionable findings resolved.** Top priorities (R1-1 critical, R3-1 test gap, R1-2/R1-3 doc accuracy) are DONE. Optional items addressed: R2-3 (param removed), R2-4 (example marked illustrative), R3-3 (CONTRIBUTING note). R2-2 skipped as benign confusion. R3-2 held for commit-time.

**Verification at 2026-04-11 after all fixes:**
- `npx env-cmd -f ./my.test.env mocha ./tests/statistics.test.js` — **97 passing, 152ms** (was 95).
- `npx eslint lib/statistics.js lib/report_plugins/ai_eval.js lib/report_plugins/ai_eval/charts.js` — **0 problems**.

**Remaining open work:**
- R3-2 — apply rationale paragraph when user requests commit.
- Pre-existing lint backlog (`lint-cleanup-backlog.md`) — separate follow-up PR, intentionally out of scope.
