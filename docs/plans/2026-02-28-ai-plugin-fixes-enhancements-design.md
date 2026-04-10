# AI Plugin -- Fixes, Refactoring & Redesign

**Date:** 2026-04-10 (replaces 2026-02-28 plan)
**Branch:** feat/ai-report-plugin
**Status:** Phase 4 in progress

## Context

Code review of the AI evaluation plugin found 22 issues (security, quality, architecture). The original plan proposed a 3-phase approach. This updated plan incorporates architectural decisions made during brainstorming:

1. **Single-phase LLM call** replaces the 14+1 two-phase pattern (eliminates cross-day information loss)
2. **Client-side statistics** -- all deterministic calculations (TIR, SD, CV, MAGE, episodes) move to JavaScript via shared `lib/statistics.js` module
3. **Compact JSON data format** replaces markdown tables
4. **Multi-provider support** -- two adapter paths: OpenAI-compatible (OpenAI + Gemini + any compatible) and Anthropic
5. **Curated model tiers** -- supported (tested/tailored) vs compatible (works, not optimized)
6. **Language** follows Nightscout `LANGUAGE` setting
7. **Prompts** stored in MongoDB with built-in defaults as fallback when no custom prompts are configured

**Cost comparison (14-day analysis, estimated):**

| Model | Two-phase (old) | Single-phase (new) |
|-------|----------------|--------------------|
| Gemini 2.5 Flash-Lite ($0.10/$0.40) | $0.016 | $0.008 |
| gpt-5.4-nano ($0.20/$1.25) | $0.042 | $0.017 |
| gpt-5.4-mini ($0.75/$4.50) | $0.156 | $0.064 |
| Claude Haiku 4.5 ($1.00/$5.00) | $0.182 | $0.080 |

---

## Testing Strategy (applies to all phases)

**Approach: TDD** -- tests first, then implementation.

**Framework:** Mocha + should.js (already in codebase). Add jsdom for DOM-dependent tests.

**Per-module test requirements:**
- `stats.js` -- highest priority: MAGE algorithm, episode counting, TIR/TBR/TAR, CV against known medical reference values. Minimum 20 test cases covering edge cases (data gaps, monotonic sequences, single excursion, <18h data, DST boundary).
- `renderer.js` -- XSS escaping verification: inject `<script>`, `onclick`, HTML entities into LLM-sourced strings, verify sanitized output.
- `llm_client.js` -- JSON repair: valid JSON, invalid JSON, markdown fences, partial JSON, retry behavior.
- `prompts.js` -- placeholder replacement: `replaceAll` correctness, missing placeholders, injection-resistant templates.
- `cost_tracker.js` -- cost formula per provider: OpenAI (prompt_tokens + completion_tokens), Anthropic (input_tokens + output_tokens), Gemini (tiered pricing). Verified against published rates.
- `data_processor.js` -- compact JSON output: validate structure, measure token count against markdown baseline.
- `schemas.js` -- schema validation: valid response passes, missing required fields fail, extra fields ignored.
- `ai_eval_api.js` -- field whitelist: verify unknown fields rejected, rate limit enforced, timeout fires.

**Integration test:** Mock LLM API (Nock or similar), run full pipeline: data prep -> API call -> response parse -> render. Compare output structure against baseline.

**Provider adapter tests (Phase 3):** Require API keys for each provider. Tests skip gracefully if keys not present.

---

## Deployment & Rollback Strategy

**Environment:** Staging server -- not production.

**Rollback:** `backup/feat-ai-report-plugin-pre-rebase` branch preserves the original 170-commit history.

**Phase progression:** Each phase is a set of commits on `feat/ai-report-plugin`. Team review checkpoint before merging to master.

**Plugin disable:** If `AI_LLM_KEY` is not set, the plugin is completely invisible. Zero footprint.

---

## Phase 1: Modular Extraction + Security Fixes -- COMPLETE

Split the 2260-line monolith, fixed all security issues.

### Module Structure

```
lib/report_plugins/
  ai_eval.js                 # Plugin entry point (~100 lines)
  ai_eval/
    ui.js                    # Tab init, DOM, settings display, button handlers
    llm_client.js            # API call with retry, JSON repair, fence stripping
    data_processor.js        # Data extraction from datastorage, formatting
    renderer.js              # Report rendering with HTML escaping
    schemas.js               # Response JSON schemas
    prompts.js               # Placeholder replacement, i18n via translate()
    cost_tracker.js          # Usage recording, cost calculation, display

lib/api/
  ai_eval_api.js             # LLM proxy (extracted from inline route)
  ai_settings_api.js         # Prompt settings CRUD
  ai_usage_api.js            # Usage stats
```

### Security Fixes Applied

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | CRITICAL | ai_llm_api_url leaked | Added to secureSettings |
| 2 | HIGH | Unrestricted proxy payload | Field whitelist in ai_eval_api.js |
| 3 | HIGH | Wrong permissions on destructive routes | Admin permission on delete/rebuild |
| 4 | HIGH | XSS via unescaped LLM content | HTML escape in renderer.js |
| 5 | HIGH | Double response send | Guard with headersSent check |
| 6 | HIGH | 2260-line God object | Split into 7 modules |
| 7 | MEDIUM | No rate limiting | In-memory counter, 10 req/min |
| 8 | MEDIUM | Prompt injection | Treatment notes JSON-encoded |
| 10 | MEDIUM | Promise anti-pattern | Rewritten as async |
| 11 | MEDIUM | Dead code | Removed during extraction |
| 12 | MEDIUM | Duplicated fence stripping | Single stripJsonFences() helper |
| 13 | MEDIUM | Hardcoded German strings | translate() calls |
| 14 | MEDIUM | replacePlaceholders first-only | replaceAll() |
| 15 | MEDIUM | Cost calculation bug | Separate prompt + completion rates |
| 16 | LOW | No LLM proxy timeout | Configurable timeout (default 120s) |
| 17 | LOW | Hard failure in multi-day flow | Per-day catch, partial results |
| 18 | LOW | Missing MongoDB indexes | Programmatic ensureIndex at startup |
| 19 | LOW | 18 window.* globals | Consolidated to window.aiEvalState |
| 20 | LOW | Typo: poling_intervall | Renamed + backward-compat alias |
| 21 | LOW | exchange_rates unbounded | findOneAndUpdate with upsert |
| 22 | LOW | Inline API route | Extracted to ai_eval_api.js |

Finding #9 (deprecated `request` package): New code uses Node.js `https`. Existing app-wide `request` usage preserved.

---

## Phase 2: Single-Call Architecture + Client-Side Statistics -- COMPLETE

Replaced 14+1 call pattern with single LLM call. Moved all deterministic calculations to shared `lib/statistics.js`.

### lib/statistics.js

Shared module using `simple-statistics`. Exports:

- `computeDayStats(sgvRecords, treatments, options)` -- TIR/TBR/TAR, average, median, SD, CV, MAGE, episode counting, time-block distributions
- `computePeriodStats(dayStatsArray)` -- aggregated statistics across multiple days

**MAGE algorithm**: Service & Nelson (1980), adapted per International Consensus on Use of CGM (2017). Identifies turning points via derivative sign change, filters excursions >= 1 SD, requires >= 18 hours valid data and >= 4 qualifying pairs.

**Episode counting**: Consecutive readings below targetLow (hypo) or above targetHigh (hyper) lasting >= 15 min. Episodes < 15 min apart are merged.

### Compact JSON Data Format

```json
{
  "days": [{
    "date": "2026-03-15",
    "sgv": [[1710500400000, 120], [1710500700000, 125]],
    "treatments": [[1710504000000, 45, 3.5, "lunch"]],
    "stats": { "from computeDayStats()" }
  }],
  "period_stats": { "from computePeriodStats()" },
  "profile": { "structured JSON" },
  "meta": { "days": 7, "from": "...", "to": "...", "units": "mg/dL" }
}
```

### Unified Response Schema

Single `CgmAnalysisSchema` replaces the two separate schemas (DailyAnalysis + MultiDayAnalysis):

```json
{
  "period": { "from": "string", "to": "string", "days": "integer" },
  "summary": ["string"],
  "trends": [{ "label": "string", "evidence": "string", "severity": "info|warning|critical" }],
  "recommendations": {
    "therapy_settings": [{ "action": "string", "rationale": "string" }],
    "behavioral_timing": [{ "action": "string", "rationale": "string" }],
    "monitoring": ["string"]
  },
  "per_day": [{ "date": "string", "notes": ["string"] }],
  "data_quality_notes": ["string"]
}
```

### Failure Handling

1. Client-side stats are always available, even if LLM call fails
2. JSON repair mechanism: strip fences, attempt parse, retry with repair prompt (max 2 retries)
3. Timeout: show client-side stats + retry option
4. No localStorage caching needed: data prep and stats are instant client-side

---

## Phase 3: Multi-Provider Support + Plugin Isolation -- COMPLETE

Server-side provider adapters. Togglable plugin with zero footprint when disabled.

### Provider Adapters

All new code uses Node.js built-in `https`/`http` module.

**`lib/ai/index.js`** -- Factory:
- `createProvider(config)` auto-detects from URL or uses `AI_LLM_PROVIDER` override
- Anthropic detected via `anthropic` in URL
- `'openai'` normalized to `'openai_compat'`

**`lib/ai/providers/openai_compat.js`:**
- Auth: `Authorization: Bearer`
- Response: `choices[0].message.content`, usage: `{ prompt_tokens, completion_tokens }`
- Structured output: `response_format: { type: 'json_schema', ... }`
- 10 MB response size cap

**`lib/ai/providers/anthropic.js`:**
- Auth: `x-api-key` + `anthropic-version: 2023-06-01`
- System message extraction to top-level `system` param
- Response: `content[0].text`, usage normalized from `input_tokens`/`output_tokens`
- Structured output: schema embedded in system prompt
- `max_tokens` defaults to 4096

Both return normalized: `{ content: string, usage: { prompt_tokens, completion_tokens } }`

### Plugin Isolation

| File | Change |
|------|--------|
| `lib/report_plugins/index.js` | Conditional `require('./ai_eval')` when `ai_llm_key_is_set` |
| `lib/admin_plugins/index.js` | Conditional ai_settings + ai_usage_viewer |
| `lib/api/index.js` | Conditional route registration |
| `lib/server/env.js` | `env.settings.ai_llm_key_is_set = !!env.ai_llm_key` + startup log |

### Env Vars Added

| Var | Purpose | Default |
|-----|---------|---------|
| `AI_LLM_PROVIDER` | Explicit provider override | Auto-detected from URL |
| `AI_LLM_TIMEOUT` | LLM API timeout in seconds | 120 |

### Tests

114 tests passing:
- 48 statistics tests (MAGE, episodes, TIR/TBR/TAR, edge cases)
- 66 ai_eval tests (modules, provider adapters, plugin isolation)

---

## Phase 4: Documentation Overhaul + Admin Cleanup -- COMPLETE

### ai_evaluation.md -- Full Rewrite

New structure:
1. Overview -- single-call architecture, client-side stats + LLM interpretation
2. Features -- 14-day limit, supported models, language support
3. Setup -- env vars, provider configuration, supported model tiers, prompt configuration
4. Usage -- generating analysis, reading the report, failure handling
5. Cost Guide -- per-model pricing table, estimated cost by date range
6. Troubleshooting -- provider-specific errors, plugin states, debug mode
7. Technical Reference -- module structure, data flow, API endpoints, schemas, security
8. Medical Disclaimer

### Admin Settings Cleanup

- Removed legacy interim prompt fields (`system_interim_prompt`, `user_interim_prompt_template`) from admin UI and API
- Reduced admin UI from 4 textareas to 2 (System Prompt, User Prompt Template)
- Rewrote DEFAULT_SYSTEM_PROMPT and DEFAULT_USER_PROMPT for optimal single-call LLM results
- Updated token documentation in admin UI to list all 10 available placeholders
- Added `treatment_insights` to schema `required` array (aligns schema with prompt instructions)
- API backward-compatible: old MongoDB fields are silently ignored, not deleted
- Updated Available Placeholders table in ai_evaluation.md (4 -> 10 tokens)

### Design Plan -- Updated

This file replaces the original 2026-02-28 plan with all architectural decisions and implementation status.

---

## Finding Resolution Summary

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | CRITICAL | ai_llm_api_url leaked to clients | DONE (Phase 1) |
| 2 | HIGH | Unrestricted LLM proxy payload | DONE (Phase 1) |
| 3 | HIGH | Wrong permissions on destructive routes | DONE (Phase 1) |
| 4 | HIGH | XSS via unescaped LLM content | DONE (Phase 1) |
| 5 | HIGH | Double response send bug | DONE (Phase 1) |
| 6 | HIGH | 2260-line God object | DONE (Phase 1) |
| 7 | MEDIUM | No rate limiting on AI proxy | DONE (Phase 1) |
| 8 | MEDIUM | Prompt injection via treatment notes | DONE (Phase 1) |
| 9 | MEDIUM | Deprecated request package | New code uses https. Existing deferred. |
| 10 | MEDIUM | Promise constructor anti-pattern | DONE (Phase 1) |
| 11 | MEDIUM | Dead code | DONE (Phase 1) |
| 12 | MEDIUM | Duplicated fence stripping | DONE (Phase 1) |
| 13 | MEDIUM | Hardcoded German strings | DONE (Phase 1) |
| 14 | MEDIUM | replacePlaceholders first-only | DONE (Phase 1) |
| 15 | MEDIUM | Cost calculation bug | DONE (Phase 1) |
| 16 | LOW | No LLM proxy timeout | DONE (Phase 1) |
| 17 | LOW | Hard failure in multi-day flow | DONE (Phase 1) |
| 18 | LOW | Missing MongoDB indexes | DONE (Phase 1) |
| 19 | LOW | 18 window.* globals | DONE (Phase 1) |
| 20 | LOW | Typo: poling_intervall | DONE (Phase 1) |
| 21 | LOW | exchange_rates grows unbounded | DONE (Phase 1) |
| 22 | LOW | Inline API route | DONE (Phase 1) |

## Commit History

```
e3b39b62 refactor: Phase 3 - multi-provider support + plugin isolation + review fixes
409aa1c2 refactor: Phase 2 - single-call architecture + client-side statistics + review fixes
eedfbdeb chore: gitignore .env files
46376fe2 refactor: Phase 1 - modular extraction + security fixes for AI plugin
b62fd88a docs: AI plugin documentation and design plan
8866f326 feat: AI evaluation report plugin
```

## Team Reviews

Three team reviews completed (all persisted in `.claude-bw/local/notes/20260410-review-team-feat-ai-report-plugin.md`):
1. Plan review (pre-implementation)
2. Phase 1+2 code review
3. Phase 3 code review

All critical and FIX-marked findings have been addressed.
