# Team Review Report
**Date:** 2026-04-10
**Mode:** plan
**Plan:** C:\Users\thomas\.claude\plans\melodic-painting-milner.md
**Status:** Draft -- reviewed, revised
**Sources:** docs/plans/2026-02-28-ai-plugin-fixes-enhancements-design.md (original plan)
---

## Plan Review: AI Plugin -- Fixes, Refactoring & Redesign

### Quick Reference
| Reviewer | Verdict | Critical | Warnings | Suggestions |
|----------|---------|----------|----------|-------------|
| Technical Feasibility | concerns | 2 | 5 | 2 |
| Architecture | concerns | 1 | 5 | 2 |
| Devil's Advocate | risks | 2 | 5 | 0 |
| Completeness | critical gaps | 1 | 3 | 1 |
| Scope Guardian | concerns | 1 | 4 | 3 |

---

### Critical Findings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R2-1 | **No testing strategy.** -- Added TDD strategy section with per-module test requirements, regression baseline, integration tests, provider adapter tests. Mocha+should.js framework, jsdom for DOM tests. | R2, R4, R1, R5 | FIX | DONE |
| R2-2 | **No deployment, migration, or rollback strategy.** -- Added deployment section. Staging server context. Backup branch exists. Plugin disable = zero footprint. MongoDB data preserved on disable. No merge to master until all phases reviewed. | R2, R4, R1 | FIX | DONE |
| R2-10 | **MAGE algorithm complexity underestimated.** -- Added detailed algorithm spec (8 steps) with citation (Service & Nelson 1980, International Consensus 2017). 15+ test cases specified including edge cases. TDD approach: tests first. | R2, R3, R1 | FIX | DONE |
| R3-2 | **Single LLM call has no fallback on failure.** -- Added Step 2.4 (failure handling): client-side stats always available regardless of LLM, JSON repair carries forward, timeout shows stats + retry option. No localStorage needed since stats computation is instant. | R3 | FIX | DONE |
| R5-1 | **Phase 3 is scope creep.** -- Intentionally in scope (user decision). Phase 1 now builds adapter-aware (dependency graph shows llm_client.js -> lib/ai/index.js path). | R5 | FIX | DONE -- user confirmed Phase 3 in scope |

---

### Warnings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R1-7 | **Rate limiting unspecified.** -- Nightscout is single-user. Added: simple in-memory counter, max 10 req/min, 429 on exceed, resets on restart. Monthly limit enforced by UI (existing button disable). | R1, R2, R3 | FIX | DONE |
| R1-8 | **Window.* "elimination" impossible in browser.** -- Plan updated: "consolidate into window.aiEvalState namespace" not "module-scoped aiState." Explicit that this is namespace consolidation in browser context. | R1, R2 | FIX | DONE |
| R2-6 | **Plugin isolation edge cases.** -- Added 3 plugin states (not configured / partially configured / fully configured). Env var changes require restart (documented). MongoDB data preserved on disable. Missing keys shown in UI status. | R2, R3, R5 | FIX | DONE |
| R1-5 | **Prompt injection mitigation insufficient.** -- Changed from delimiter approach to structured encoding: treatment notes as JSON-escaped strings in JSON array, never raw text interpolation. Language setting validated against whitelist. | R1, R3 | FIX | DONE |
| R1-10 | **"~40% token savings" unvalidated.** -- Added Step 2.0: token validation gate. Measure baseline, prototype compact format, compare. Gate: if savings < 25%, reconsider approach. | R1, R3 | FIX | DONE |
| R3-4 | **JSON repair missing for single-call.** -- Explicitly stated: repair mechanism carries forward from Phase 1 llm_client.js. Strip fences, attempt parse, retry with repair prompt (max 2). | R3 | FIX | DONE |
| R3-11 | **Cost formula hardcoded for OpenAI.** -- Added Step 2.8: per-provider cost calculation. Anthropic normalizes input_tokens to prompt_tokens. Configurable per-model rates in settings. | R3, R4 | FIX | DONE |
| R5-2 | **Review checkpoints have no acceptance criteria.** -- Added specific acceptance criteria for each checkpoint: measurable conditions, what to test, what happens if review fails. | R5 | FIX | DONE |
| R5-8 | **No effort estimates.** -- Skipped: AI does the coding, not human developers. Effort estimates not applicable. | R5, R1 | FIX | SKIPPED -- not applicable (AI-driven development) |
| R1-6 | **MongoDB indexes: create programmatically.** -- Changed from "document" to ensureIndex at startup in bootevent.js or plugin init. Unique index on exchange_rates currency pair. | R1, R4 | FIX | DONE |
| R5-3 | **Finding #9 deferred but new code created.** -- Plan updated: Phase 3 adapters use Node.js built-in https, NOT deprecated request. Only existing code retains request. | R5, R1 | DEFER | DONE -- new code avoids request |
| R1-3 | **Multi-provider needs API validation.** -- Added Step 3.0: provider validation with required test env vars (TEST_OPENAI_KEY, TEST_ANTHROPIC_KEY, TEST_GEMINI_KEY). Tests skip gracefully if keys not present. Field whitelist becomes provider-aware in Step 3.2. | R1, R2 | DEFER | DONE -- validation step added to Phase 3 |

---

### Suggestions
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R2-3 | **Create shared lib/statistics.js.** -- Promoted to Phase 2. New shared module used by AI plugin and available to existing report plugins. | R2 | DEFER | DONE -- incorporated in Phase 2 |
| R2-4 | **Document module dependency graph.** -- Added to plan under Phase 1. | R2 | FIX | DONE |
| R4-6 | **Language support edge cases.** No fallback for unsupported languages. No RTL. | R4 | DEFER | OPEN |
| R5-10 | **Move documentation earlier.** | R5 | SKIP | OPEN |
| R5-7 | **Commit strategy needs clarification.** | R5 | SKIP | OPEN |
| R5-12 | **Quick win: extract ai_eval_api.js first as pilot.** | R5 | SKIP | OPEN |

---

### Filtered
| ID | Details | Reviewer | Evidence |
|----|---------|----------|---------|
| R1-1 | "Plan misaligns with actual codebase state" | R1 | [LOW CONFIDENCE -- plan clearly describes extraction FROM monolith TO modules as target state] |
| R1-13 | "Plugin isolation flag never computed" | R1 | [LOW CONFIDENCE -- Plan Step 3.4 explicitly says "Set env.settings.ai_llm_key_is_set = !!env.ai_llm_key"] |
| R2-9, R3-9 | "Streaming concerns" | R2, R3 | [LOW CONFIDENCE -- streaming intentionally removed from this plan] |

---

### Recommendation
**Ready to implement** (all critical findings resolved, 1 suggestion deferred as OPEN)

Remaining OPEN items (non-blocking):
- R4-6: Language edge cases (RTL, unsupported languages) -- defer to future
- R5-10, R5-7, R5-12: Suggestions -- skipped by user decision

---
**2026-04-10 -- Code Review (Phase 1 + Phase 2 implementation)**

# Team Review Report
**Date:** 2026-04-10
**Mode:** code
**Branch:** feat/ai-report-plugin
**Base:** master
**Files reviewed:** 24 (22 changed + 2 untracked new)
---

## Team Review: feat/ai-report-plugin (Phase 1 + Phase 2 Code)

### Quick Reference
| Reviewer | Verdict | Critical | Warnings | Suggestions |
|----------|---------|----------|----------|-------------|
| Frontend/UX | issues | 1 | 5 | 7 |
| Architecture | issues | 2 | 4 | 2 |
| Devil's Advocate | issues | 2 | 5 | 8 |
| End User | issues | 2 | 3 | 5 |
| Product Manager | concerns | 0 | 3 | 3 |

---

### Critical Findings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R1-1 | **Inline onclick handler violates CSP.** Replaced with programmatic addEventListener via DOM element creation. | R1-Frontend | FIX | DONE |
| R2-1 | **Permission on `/ai_usage/record` is too weak.** Changed to `admin:api:ai_usage:edit`. | R2-Architecture | FIX | DONE |
| R3-1 | **MAGE algorithm creates artificial excursions at data gaps.** Removed boundary point insertion at gaps; now resets `prevDirection` only. | R3-Advocate | FIX | DONE |
| R3-3 | **`response_format` forwarded verbatim to LLM API.** Removed from whitelist. Server now sets response_format from schemas.js when client requests json_schema type. | R3-Advocate | FIX | DONE |
| R4-1 | **14-day limit hides already-computed statistics.** Now shows stats with warning banner; only disables the AI button. | R4-EndUser | FIX | DONE |

---

### Warnings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R1-2 | **XSS risk in admin usage viewer.** Added `esc()` helper; currency and rate values now escaped in template literals. | R1-Frontend | FIX | DONE |
| R1-3 | **No accessibility.** Added `aria-busy` on button, `aria-live="polite"` on stats/analysis/status areas. | R1-Frontend, R4-EndUser | FIX | DONE |
| R1-4 | **Color contrast failures.** Changed to #047857 (green) and #dc2626 (red) with font-weight 600. | R1-Frontend | FIX | DONE |
| R1-5 | **No loading spinner.** Added CSS spinner animation on button via `[aria-busy="true"]::before`. | R1-Frontend, R4-EndUser | FIX | DONE |
| R2-3 | **Deprecated `request` package in new code.** Plan defers to Phase 3 for adapter rewrite. | R2-Architecture | DEFER | OPEN |
| R2-4 | **Exchange rate save silently resolves on error.** Added `persistenceError` flag and warning log. Rate still returned (valid fetch), but persistence failure is now visible. | R2-Architecture | FIX | DONE |
| R3-4 | **Period stats weighted by reading count, not time.** Changed to weight by `valid_hours`. | R3-Advocate | FIX | DONE |
| R3-5 | **Async usage recording fire-and-forget.** Added retry (up to 3 attempts, 2s delay). | R3-Advocate | FIX | DONE |
| R3-6 | **Double JSON.stringify on treatment notes.** Removed inner `JSON.stringify(String(...))`, now passes plain string. Outer stringify handles encoding. | R3-Advocate | FIX | DONE |
| R4-2 | **Medical disclaimer buried at bottom.** Moved to top of plugin with yellow warning banner styling and `role="alert"`. | R4-EndUser | FIX | DONE |
| R4-3 | **No confirmation before sending health data to external LLM.** | R4-EndUser | DEFER | OPEN |
| R3-7 | **`exchangeRateInfo` never populated.** Removed dead reference. Cost display now uses direct rate params without exchange conversion (exchange rate integration deferred to Phase 3 provider work). | R3-Advocate, R5-PM | FIX | DONE |
| R5-1 | **`ui.js` not extracted as separate module.** Deliberate: 420 lines is reasonable after extracting 6 modules from 2260-line monolith. Further extraction would add coupling complexity without functional benefit. | R5-PM | DEFER | SKIPPED -- reasonable size after extraction |
| R5-3 | **Regression baseline test fixtures missing.** Pre-refactor code no longer exists on this branch. 94 tests validate current behavior. Baseline comparison would need DOM environment (jsdom). | R5-PM | DEFER | SKIPPED -- 94 unit tests cover current behavior |

---

### Suggestions
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R1-6 | **Table overflow on mobile.** | R1-Frontend | DEFER | OPEN |
| R1-7 | **Responsive breakpoint too large (900px).** | R1-Frontend | SKIP | OPEN |
| R3-8 | **No SGV bounds validation.** Added 40-600 range filter with configurable `options.sgvMin`/`sgvMax`. 2 new tests added. | R3-Advocate | FIX | DONE |
| R3-9 | **MAGE returns null too often for stable patients.** | R3-Advocate | SKIP | OPEN |
| R3-10 | **HTTP status codes all 500.** Changed: timeout=504, ECONNREFUSED/ENOTFOUND=502, other=500. | R3-Advocate | FIX | DONE |
| R3-11 | **Timeout env var not bounds-checked.** | R3-Advocate | SKIP | OPEN |
| R3-12 | **Episode merge gap hardcoded at 15min.** | R3-Advocate | DEFER | OPEN |
| R3-13 | **Database index creation fire-and-forget.** | R3-Advocate | SKIP | OPEN |
| R3-14 | **No integration tests.** | R3-Advocate | DEFER | OPEN |
| R3-15 | **`valid_hours` semantics unclear.** | R3-Advocate | SKIP | OPEN |
| R4-4 | **Admin prompt config not discoverable.** | R4-EndUser | DEFER | OPEN |
| R4-5 | **No estimated cost before "Send to AI".** | R4-EndUser | DEFER | OPEN |
| R1-8 | **Debug mode leaks raw data to DOM.** | R1-Frontend, R3-Advocate | SKIP | OPEN |
| R2-5 | **Hardcoded exchange rate API endpoint.** | R2-Architecture | SKIP | OPEN |
| R4-6 | **No session recovery after page refresh.** | R4-EndUser | SKIP | OPEN |
| R5-4 | **Token savings validation not documented.** | R5-PM | SKIP | OPEN |

---

### Filtered
| ID | Details | Reviewer | Evidence |
|----|---------|----------|---------|
| R3-2 | "Rate limiter process-local, lost on restart" | R3-Advocate | [LOW CONFIDENCE -- deliberate design decision, single-user context] |
| R2-6 | "No numeric env var validation for cost limits" | R2-Architecture | [LOW CONFIDENCE -- already handles NaN/<=0 with fallback] |
| R1-9 | "Component structure not reusable (420 lines)" | R1-Frontend | [LOW CONFIDENCE -- reasonable after 6-module extraction] |
| R5-5 | "Plugin isolation not gated (always loads)" | R5-PM | [LOW CONFIDENCE -- Phase 3 scope] |

---

### Recommendation
**Ready to proceed** (all 5 critical findings resolved, 18/20 actionable findings fixed)

Remaining OPEN items (non-blocking, deferred to Phase 3/4):
- R2-3: deprecated `request` package (Phase 3 replaces)
- R4-3: privacy confirmation dialog
- R1-6, R3-12, R3-14, R4-4, R4-5: UX polish items

---
**2026-04-10 -- Code Review (Phase 3 implementation)**

# Team Review Report
**Date:** 2026-04-10
**Mode:** code
**Profile:** default-code
**Branch:** feat/ai-report-plugin
**Base:** master
**Files reviewed:** 9 (6 modified + 3 new)
---

## Team Review: feat/ai-report-plugin (Phase 3 Code) -- profile `default-code`

### Quick Reference
| Reviewer | Verdict | Critical | Warnings | Suggestions |
|----------|---------|----------|----------|-------------|
| Frontend Senior | issues | 1 | 4 | 5 |
| Backend Senior | issues | 1 | 3 | 4 |
| Devil's Advocate | issues | 2 | 3 | 5 |
| End User | concerns | 0 | 3 | 4 |
| Product Manager | concerns | 0 | 1 | 1 |

---

### Critical Findings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R3-1 | **Missing schema validation in Anthropic adapter.** Added null checks for `json_schema` and `schema` properties before `JSON.stringify`. `anthropic.js:69-70`. | R3-Advocate, R2-Backend | FIX | DONE |
| R3-2 | **`AI_LLM_TIMEOUT` env var never read.** Added `parseInt(readENV('AI_LLM_TIMEOUT', 120), 10)` to `env.js:64`. | R3-Advocate, R5-PM, R2-Backend | FIX | DONE |
| R2-1 | **Error details may leak LLM API info to client.** Removed `details: error.message` from client error response. Error logged server-side only. `ai_eval_api.js:112`. | R2-Backend | FIX | DONE |

### Warnings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R2-2 | **No response size limit on adapter buffering.** Added 10MB cap with `MAX_RESPONSE_SIZE` in both adapters. Destroys request on exceed. | R2-Backend, R3-Advocate | FIX | DONE |
| R2-3 | **No validation of `messages` field structure.** Added `Array.isArray` + non-empty check, returns 400 on invalid. `ai_eval_api.js:58-60`. | R2-Backend, R3-Advocate | FIX | DONE |
| R3-3 | **Response structure not validated/logged.** Added `console.warn` with truncated JSON when expected response fields missing in both adapters. | R3-Advocate, R2-Backend | FIX | DONE |
| R1-1 | **Admin usage table color contrast failures.** `ai_usage_viewer.js:174-186`: coral on black (~4.8:1), lightskyblue on black (~5.5:1 marginal). WCAG AA minimum is 4.5:1 for normal text. | R1-Frontend | DEFER | OPEN |
| R1-2 | **Inline `color: red` for errors across admin views.** Scattered `style="color: red"` in 5+ locations. Not accessible for color-blind users, not maintainable. `ai_usage_viewer.js:159, 218, 264, 291, 314`. | R1-Frontend | DEFER | OPEN |
| R4-1 | **14-day limit message appears too late.** User selects date range, opens AI tab, then learns the constraint. Should show before/during date selection, not after. | R4-EndUser | DEFER | OPEN |
| R4-2 | **Monthly spending limit message not actionable.** Non-admin user sees "Monthly limit of $X reached" but no guidance on who to contact or when it resets. | R4-EndUser | DEFER | OPEN |
| R1-3 | **Admin table not responsive (16+ columns, min-width:80px).** Mobile/tablet requires extensive horizontal scrolling. No @media breakpoints. `ai_usage_viewer.js:30`. | R1-Frontend | DEFER | OPEN |
| R4-3 | **"Computing statistics..." placeholder misleading.** Text suggests computation is happening but user must click "Send to AI" first. Should say "Ready" or auto-display stats. | R4-EndUser | DEFER | OPEN |

### Suggestions
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R3-4 | **Dynamic `require()` in provider factory.** `lib/ai/index.js:35-41` uses if/else with `require()`. Could use a map for safety. | R3-Advocate | SKIP | OPEN |
| R2-4 | **Provider detection URL-string based (fragile).** `indexOf('anthropic')` on full URL could false-match on proxy names. | R2-Backend | SKIP | OPEN |
| R3-5 | **Anthropic adapter concatenates multiple system messages.** Joins with `\n\n` without warning. | R3-Advocate | SKIP | OPEN |
| R2-5 | **Anthropic API version hardcoded.** `anthropic-version: '2023-06-01'` at `anthropic.js:86`. | R2-Backend | SKIP | OPEN |
| R3-6 | **Whitelist allows unbounded `max_tokens` from client.** No server-side cap. `ai_eval_api.js:21`. | R3-Advocate, R2-Backend | SKIP | OPEN |
| R1-4 | **`role="alert"` on disclaimer fires on page load.** Should use `<aside>` not `role="alert"`. | R1-Frontend | SKIP | OPEN |
| R1-5 | **Spinner invisible to screen readers.** CSS `::before` pseudo-element not exposed to assistive tech. | R1-Frontend | SKIP | OPEN |
| R4-4 | **No pre-click cost estimate.** | R4-EndUser | DEFER | OPEN |
| R3-7 | **No retry logic for transient LLM failures.** Server-side returns 502/504 immediately. | R3-Advocate | SKIP | OPEN |
| R5-1 | **Anthropic system message merging behavior undocumented.** | R5-PM | SKIP | OPEN |
| R2-6 | **Provider selection only logged in debug mode.** | R2-Backend | SKIP | OPEN |
| R1-6 | **Native `confirm()` dialog in admin delete.** Not mobile-friendly. | R1-Frontend | DEFER | OPEN |

### Filtered
| ID | Details | Reviewer | Evidence |
|----|---------|----------|---------|
| R2-7 | "Race condition in rate limiter" | R2-Backend, R3-Advocate | [LOW CONFIDENCE -- Node.js single-threaded; atomic in practice] |
| R3-8 | "Dynamic require() is security risk" | R3-Advocate | [LOW CONFIDENCE -- providerName from env var only, not client input] |
| R1-7 | "Missing focus indicator on button" | R1-Frontend | [LOW CONFIDENCE -- browser default focus ring applies] |
| R4-5 | "Admin textarea sizes may truncate" | R4-EndUser | [LOW CONFIDENCE -- textarea scrolls; no data loss] |

---

### Recommendation
**Ready to proceed** (all 3 critical findings resolved, all 3 FIX warnings resolved, 6/6 FIX items DONE)

Remaining OPEN items (non-blocking, deferred/skipped):
- R1-1, R1-2, R1-3: Admin table accessibility/contrast/responsive (Phase 4 polish)
- R4-1, R4-2, R4-3: UX messaging improvements (Phase 4 polish)
- R3-4 through R3-7, R2-4 through R2-6, R1-4 through R1-6, R4-4, R5-1: Suggestions (skipped/deferred)

---
**2026-04-10 -- Plan Review (Phase 5: UX Improvements)**

# Team Review Report
**Date:** 2026-04-10
**Mode:** plan
**Plan:** C:\Users\thomas\.claude\plans\compiled-doodling-aurora.md
**Status:** Active
**Sources:** none (user requirements from conversation)
---

## Plan Review: AI Report Plugin UX Improvements (Phase 5)

### Quick Reference
| Reviewer | Verdict | Critical | Warnings | Suggestions |
|----------|---------|----------|----------|-------------|
| Technical Feasibility | concerns | 2 | 4 | 3 |
| Architecture | sound | 0 | 3 | 4 |
| Devil's Advocate | concerns | 1 | 4 | 3 |
| Completeness | gaps | 0 | 3 | 3 |
| Scope Guardian | ready | 0 | 1 | 2 |

---

### Critical Findings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R1-1 | **LLM prompt update not in plan.** Plan adds `treatment_insights` to schema and rendering, but never mentions updating system/user prompts to instruct the LLM to return this field. Without prompt changes, LLM will not include treatment_insights and the section will never display. Added Step 3e with prompt update instructions + TREATMENT_SUMMARY placeholder. | R1-Feasibility, R3-Advocate | FIX | DONE |
| R1-2 | **charts.js require() not specified.** Plan creates `charts.js` but does not mention adding `var charts = require('./ai_eval/charts')` to `ai_eval.js` imports (currently lines 8-11). Without this, webpack will not bundle charts.js and D3 chart code will not load. Added to Step 5a. | R1-Feasibility | FIX | DONE |

---

### Warnings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R1-3 | **D3 availability guard needed.** Added D3 existence check + "Charts unavailable" fallback text to Step 5a. | R1-Feasibility, R2-Architecture | FIX | DONE |
| R1-4 | **Chart DOM timing race.** Added `requestAnimationFrame()` wrapper to Step 5b. | R1-Feasibility, R2-Architecture, R5-Scope | FIX | DONE |
| R1-5 | **Treatment stats edge cases unspecified.** Added edge case specification to Step 1b: null/empty guards, `|| 0` for missing fields, zero-treatment days included in averages. | R1-Feasibility, R2-Architecture, R3-Advocate | FIX | DONE |
| R2-1 | **DOM reorder changes screen reader order.** Moving aiAnalysisArea before aiStatsArea in DOM changes tab order and screen reader reading order. Analysis section is empty until "Send to AI" is clicked, so keyboard users tab through an empty div. Both divs have aria-live which could cause double announcements. | R1-Feasibility, R2-Architecture | DEFER | OPEN |
| R3-1 | **Scroll/flash animation sequencing unclear.** Added explicit 4-step sequence to Step 2b: scroll in try block, flash class with setTimeout removal, success flag for finally block button state. | R3-Advocate, R2-Architecture | FIX | DONE |
| R4-1 | **No new unit tests specified.** Added Step 6 with specific test cases for formatDate, computeTreatmentStats, emptyStats, renderAnalysis with treatment_insights, renderStats with dayDates. | R4-Completeness, R2-Architecture | FIX | DONE |
| R4-2 | **Basal rate analysis partially missing.** User confirmed: basal insights required. Added `basal_observations` field to schema (Step 1c), 4-column grid in renderer (Step 3b), prompt instructions for basal analysis (Step 3e). | R4-Completeness | FIX | DONE |
| R5-1 | **renderStats() signature change needs default.** Added `dayDates = dayDates || []` guard and day-index fallback to Step 3a. | R5-Scope, R2-Architecture | FIX | DONE |

---

### Suggestions
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R1-6 | **DATEFORMAT placeholder may be dead code.** `{{DATEFORMAT}}` is added to replacements but unless prompt templates explicitly reference it, the value goes unused. Either confirm prompts use it, or remove placeholder and add date format instruction directly to system prompt. | R1-Feasibility, R3-Advocate | SKIP | OPEN |
| R1-7 | **emptyStats() needs treatment fields.** Added to Step 1b: update emptyStats() with treatment field zeros. | R2-Architecture | FIX | DONE |
| R1-8 | **treatment_insights null check in renderer.** Added to Step 3b: `if (d.treatment_insights)` guard before accessing sub-properties. | R2-Architecture, R3-Advocate | FIX | DONE |
| R2-2 | **CSS scoping for new classes.** New .ai-trend-card, .ai-flash, .ai-severity-badge classes could conflict with global styles. Scope under `#ai-eval-container .ai-trend-card` to prevent collisions. | R1-Feasibility | SKIP | OPEN |
| R4-3 | **Chart responsive sizing on mobile.** SVG viewBox handles scaling but no consideration for label density or touch targets on mobile. Diurnal chart labels (24 hours) may overlap on small screens. | R4-Completeness | DEFER | OPEN |
| R4-4 | **No feature flag for chart rendering.** If D3 charts cause layout issues in production, there is no way to disable them without a code revert. Consider ai_llm_charts setting. | R4-Completeness | SKIP | OPEN |

---

### Filtered
| ID | Details | Reviewer | Evidence |
|----|---------|----------|---------|
| R1-F1 | "D3 version mismatch / will not resolve properly in browser" | R1-Feasibility | [LOW CONFIDENCE -- `(global && global.d3) or require('d3')` is the exact pattern used successfully by daytoday.js:6, calibrations.js:3. D3 v5 is bundled by webpack.] |
| R1-F2 | "Missing DOM container setup in renderStats()" | R1-Feasibility | [LOW CONFIDENCE -- Plan Step 3a explicitly says "Add container div elements for charts"] |
| R3-F1 | "Charts.js does not exist / date format not implemented" | R3-Advocate | [LOW CONFIDENCE -- this is a plan review, not code review. Plan describes creating these items.] |
| R3-F2 | "Treatment data flow incomplete" | R3-Advocate | [LOW CONFIDENCE -- Plan Step 1b explicitly describes wiring treatments into computeDayStats. Data already passed at data_processor.js:84.] |

---

### Recommendation
**Ready to implement** (all 2 critical + 7 FIX warnings + 2 FIX suggestions resolved)

Remaining OPEN items (non-blocking):
- R2-1: DOM reorder accessibility (DEFER -- intentional design, low impact for single-user app)
- R1-6, R2-2, R4-4: Suggestions (SKIP)
- R4-3: Chart responsive sizing (DEFER)

---
**2026-04-10 -- Code Review (Phase 5: UX Improvements)**

# Team Review Report
**Date:** 2026-04-10
**Mode:** code
**Branch:** feat/ai-report-plugin
**Base:** master
**Files reviewed:** 8 (7 modified + 1 new)
---

## Team Review: feat/ai-report-plugin (Phase 5 Code)

### Quick Reference
| Reviewer | Verdict | Critical | Warnings | Suggestions |
|----------|---------|----------|----------|-------------|
| Frontend/UX | concerns | 0 | 4 | 5 |
| Architecture | pass | 0 | 1 | 3 |
| Devil's Advocate | concerns | 0 | 2 | 5 |
| End User | concerns | 0 | 3 | 4 |
| Product Manager | pass | 0 | 1 | 2 |

---

### Critical Findings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| (none) | No critical findings in Phase 5 code. | | | |

---

### Warnings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R1-1 | **"Report Ready" button state vanishes after 3s.** Button now stays permanently disabled with "Report Ready" text after success. Resets only when user regenerates report data. | R1-Frontend, R4-EndUser | FIX | DONE |
| R1-2 | **Daily breakdown table now has 13 columns -- overflows on mobile.** No `overflow-x: auto` wrapper. Columns: Date, Avg, SD, CV, MAGE, TIR, TBR, TAR, Carbs, Insulin, Hypo, Hyper, Readings. `renderer.js:126`. | R1-Frontend | DEFER | OPEN |
| R1-3 | **No `prefers-reduced-motion` support for scroll + flash animation.** `scrollIntoView({ behavior: 'smooth' })` and `.ai-flash` 2s animation may be jarring for motion-sensitive users. `ai_eval.js:128-130`. | R1-Frontend, R4-EndUser | DEFER | OPEN |
| R3-1 | **Empty period stats return missing `treatment_summary` field.** Added `treatment_summary` with zeros to empty return in `computePeriodStats`. Data shape now consistent. | R3-Advocate, R2-Architecture | FIX | DONE |
| R4-1 | **Charts render into empty divs with no loading placeholder.** Added "Loading chart..." placeholder text in chart containers. Charts clear placeholder before rendering SVG. | R4-EndUser | FIX | DONE |
| R5-1 | **LLM prompts must be updated for treatment_insights to work.** Added default prompts in `ai_settings_api.js` that instruct LLM to return treatment_insights, use dd.mm.yyyy dates, and analyze basal profiles. Returned automatically when no custom prompts configured. | R5-PM, R2-Architecture | FIX | DONE |

---

### Suggestions
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R1-4 | **Chart SVG labels may overlap on mobile.** Diurnal chart renders 24 hourly tick labels (0:00-23:00) at fixed 900px viewBox. On small screens, labels compress and overlap. `charts.js:109-111`. | R1-Frontend, R4-EndUser | DEFER | OPEN |
| R1-5 | **Treatment summary section hidden when no treatments.** If user has no carbs/insulin logged, section is absent with no explanation. Could show "No treatment data logged" instead. `renderer.js:78-90`. | R4-EndUser | SKIP | OPEN |
| R3-2 | **`parseFloat` in computeTreatmentStats accepts Infinity.** Changed to `isFinite()` check: `var rawCarbs = parseFloat(t.carbs); var carbs = isFinite(rawCarbs) ? rawCarbs : 0;`. | R3-Advocate | FIX | DONE |
| R3-3 | **Date format dd.mm.yyyy hardcoded, no locale awareness.** User requested this format explicitly, but it may conflict with date picker format elsewhere in Nightscout. `renderer.js:14-19`, `data_processor.js:183`. | R3-Advocate, R4-EndUser | SKIP | OPEN |
| R2-1 | **No unit tests for charts.js.** D3 chart rendering functions have no test coverage. Would require jsdom or similar. `charts.js`. | R2-Architecture, R3-Advocate | DEFER | OPEN |
| R3-4 | **14-day limit constant hardcoded in 3 places.** `data_processor.js:127`, `ai_eval.js:328`, `ai_eval.js:338`. Should be a single constant. | R3-Advocate | SKIP | OPEN |
| R4-2 | **Trend card color code has no legend.** Colored left borders (red/yellow/blue) have badge text but no explanation of what severity levels mean for glucose management. `renderer.js:160-173`. | R4-EndUser | SKIP | OPEN |

---

### Filtered
| ID | Details | Reviewer | Evidence |
|----|---------|----------|---------|
| R3-F1 | "Division by zero in treatment_summary when validDays empty" | R3-Advocate | [LOW CONFIDENCE -- `computePeriodStats` returns early at line 289-301 when input empty; `validDays.length === 0` triggers recursive call with `[]` which hits the guard. No division by zero possible.] |
| R3-F2 | "Infinite recursion in computePeriodStats" | R3-Advocate | [LOW CONFIDENCE -- `computePeriodStats([])` hits guard at line 289 (`dayStatsArray.length === 0`) and returns immediately. Max 1 recursive call.] |
| R3-F3 | "D3 chart DOM duplication on re-render" | R3-Advocate | [LOW CONFIDENCE -- `report()` resets `statsArea.textContent` (line 467), then `processAiEvaluationData` replaces innerHTML (line 330), destroying old containers. New containers created fresh. charts.js null-checks containers.] |
| R1-F1 | "Monthly limit check race condition" | R1-Frontend, R3-Advocate, R2-Architecture | [LOW CONFIDENCE for Phase 5 scope -- this code (lines 291-309) is pre-existing from Phase 2, not modified in Phase 5. Already reviewed and accepted in prior code review.] |
| R1-F2 | "Keyboard nav broken in error retry button" | R1-Frontend | [LOW CONFIDENCE for Phase 5 scope -- retry button code (lines 200-210) is pre-existing from Phase 2, not modified in Phase 5.] |

---

### Recommendation
**Ready to proceed** (0 critical, all 5 FIX items DONE, 2 DEFER warnings remain)

Remaining OPEN items (non-blocking):
- R1-2: Table overflow on mobile (DEFER)
- R1-3: prefers-reduced-motion (DEFER)
- R1-4, R2-1: Chart labels + chart tests (DEFER)
- R1-5, R3-3, R3-4, R4-2: Suggestions (SKIP)

---
**2026-04-10 — Plan Review: Admin Prompt Cleanup**

# Team Review Report
**Date:** 2026-04-10
**Mode:** plan
**Profile:** default-plan
**Plan:** C:\Users\thomas\.claude\plans\noble-cooking-horizon.md
**Status:** Planning
**Sources:** none
---

## Plan Review: Remove Legacy Interim Prompts + Rewrite Default Prompts — profile `default-plan`

### Quick Reference
| Reviewer | Verdict | Critical | Warnings | Suggestions |
|----------|---------|----------|----------|-------------|
| R1 — Technical Feasibility | feasible | 0 | 1 | 2 |
| R2 — Architecture | concerns | 1 | 1 | 1 |
| R3 — Devil's Advocate | concerns | 0 | 3 | 1 |
| R4 — Completeness | concerns | 0 | 0 | 3 |
| R5 — Scope Guard | concerns | 0 | 1 | 1 |

---

### Critical Findings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R2-1 | **treatment_insights prompt/schema mismatch.** The system prompt says "Always include treatment_insights" but `schemas.js:112` does NOT list it in the `required` array. Fix: add `treatment_insights` to required array in schemas.js:112 + update schema test. Plan updated with Step 6. (also R3-3, R5-2) | R2-Architecture, R3-Devil's Advocate, R5-Scope Guard | FIX | DONE — Plan Step 6 added |

### Warnings
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R5-3 | **Prompt expansion is a behavioral change.** System prompt grows from ~60 to ~280 tokens (5x). Fix: added verification step 6 — test on staging with real CGM data on at least one cheap model before merging. (also R3-4) | R5-Scope Guard, R3-Devil's Advocate | FIX | DONE — Verification step 6 added |
| R3-6 | **Custom interim prompts become invisible.** If any user spent time crafting custom `system_interim_prompt` or `user_interim_prompt_template` values in the old admin UI, those prompts remain in MongoDB but are no longer visible or editable. The plan doesn't mention any notification, migration, or documentation about this. | R3-Devil's Advocate | SKIP | OPEN |
| R2-2 | **Prompt-to-data-processor coupling.** DEFAULT_SYSTEM_PROMPT describes data sections by token name (CGMDATA_JSON, STATS_JSON, etc.). If `data_processor.js` renames tokens in the future, the hardcoded defaults become stale. No mitigation in the plan. Consider adding a code comment linking `ai_settings_api.js` defaults to `data_processor.js:177-188` as the source of truth for token names. | R2-Architecture | DEFER | OPEN |
| R2-5 | **Data array format not documented in prompt.** Fix: updated DEFAULT_SYSTEM_PROMPT "DATA SECTIONS" to specify exact formats: SGV as `[timestamp_ms, mg_dL]`, treatments as `[timestamp_ms, carbs_g, insulin_u, notes_string]`, profile as `{time, value}` arrays. | R2-Architecture | FIX | DONE — Plan Step 1a updated |
| R1-2 | **Deployment ordering dependency.** Steps 1 (API) and 2 (admin UI) must ship atomically. If only Step 2 ships (UI sends 2 fields) but Step 1d hasn't updated POST validation, the API rejects with 400. Plan implies sequential ordering but doesn't state the atomicity requirement explicitly. Since both are in the same branch/commit, this is low risk. | R1-Technical Feasibility | SKIP | OPEN |

### Suggestions
| ID | Details | Flagged By | Handling | Status |
|----|---------|-----------|----------|--------|
| R1-3 | **No automated tests for prompt API endpoints.** The plan verification section lists "manual check" for GET/POST but there are no existing tests for `/api/v1/ai_settings/prompts`. Consider adding tests: GET returns defaults when no config, GET returns stored config, POST with 2 fields succeeds, POST missing required field returns 400. (also R3-7, R4-8) | R1-Technical Feasibility, R3-Devil's Advocate, R4-Completeness | DEFER | OPEN |
| R4-7 | **Translation keys for new admin UI strings.** The admin UI uses `client.translate()`. New/changed strings won't have translations. Nightscout falls back to the original English string if no translation exists, so this isn't blocking — but non-English users see English labels for the prompt fields. | R4-Completeness | SKIP | OPEN |
| R4-9 | **Webpack rebuild question.** The plan modifies `lib/admin_plugins/ai_settings.js`. Admin plugins are loaded dynamically by the admin page (not bundled by webpack), so no rebuild is needed. Verified: admin plugins are registered in `lib/admin_plugins/index.js` and served server-side. | R4-Completeness | SKIP | OPEN |
| R3-5 | **Dead interim fields persist in MongoDB.** Old documents retain `system_interim_prompt` and `user_interim_prompt_template` forever. Minor tech debt — future developers may wonder what they are. A `$unset` migration could clean them up but is not blocking. | R3-Devil's Advocate | SKIP | OPEN |
| R5-4 | **Documentation updates scope.** The plan touches `ai_evaluation.md` and the design plan doc. The ai_evaluation.md placeholder table update (4 -> 10 tokens) is directly in scope. The design plan update is minor housekeeping. Both are appropriate for this PR. | R5-Scope Guard | SKIP | OPEN |
| R2-4 | **{{RETURNFORMAT}} appears in both system and user prompts.** This duplicates ~2KB of schema JSON, costing ~400 extra tokens per call. R2 concludes this is acceptable as "belt and suspenders" reinforcement for JSON compliance — the single-call architecture has no repair fallback, so redundancy is safer. Cost impact: ~$0.001/month. | R2-Architecture | SKIP | OPEN |

### Filtered
| ID | Details | Flagged By | Evidence |
|----|---------|-----------|---------|
| R1-1 | POST validation still requires 4 fields | R1, R3, R4 | [LOW CONFIDENCE — Plan Step 1d explicitly addresses this: "Line 69: Destructure only system_prompt, user_prompt_template. Lines 71-72: Validate only 2 fields"] |
| R4-2 | Admin UI still shows 4 prompts for single-call architecture | R4 | [LOW CONFIDENCE — Plan Step 2b explicitly addresses this: "Remove interim textareas (lines 44-45, 52-66)"] |
| R4-3 | Description still references two-phase flow | R4 | [LOW CONFIDENCE — Plan Step 2a explicitly addresses this: "Rewrite description (lines 18-22)"] |
| R4-1 | Token names in admin UI don't match actual code | R4, R5 | [LOW CONFIDENCE — Plan Steps 2c, 2d, 2e explicitly fix token names] |
| R4-5 | DATEFORMAT token may be dead code | R4 | [LOW CONFIDENCE — DATEFORMAT is used in DEFAULT_SYSTEM_PROMPT (ai_settings_api.js:9) and replaced in data_processor.js:183. Not dead.] |
| R3-1 | GET response dropping interim fields is a breaking API change | R3, R5 | [LOW CONFIDENCE — Endpoint is admin-only internal API (`admin:api:ai_settings:edit` permission). No external consumers documented. The admin UI handles missing fields with `|| ''` fallback. Hard drop is appropriate.] |

---

### Recommendation
**Ready to proceed** (all 3 FIX items DONE, 2 DEFER warnings remain)

Remaining OPEN items (non-blocking):
- R3-6: Custom interim prompts invisible (SKIP)
- R2-2: Prompt-to-data-processor coupling (DEFER)
- R1-2: Deployment ordering (SKIP)
- R1-3: API endpoint tests (DEFER)
- All suggestions: SKIP
