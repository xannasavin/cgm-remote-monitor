# AI Plugin — Fixes & Enhancements Design

Date: 2026-02-28
Branch: feat/ai-report-plugin
Status: Approved

## Context

Code review of the `feat/ai-report-plugin` branch identified 22 issues across security, code quality, and architecture. Additionally, several enhancements are planned: multi-model support, streaming, plugin isolation, error recovery, and prompt/UX improvements.

## Approach: Refactor-First, Fix-During (Approach B)

Rather than fixing bugs on the current monolithic structure and then refactoring, we restructure the code into modules first and fix bugs as part of the extraction. This avoids throwaway work and produces a clean foundation for enhancements.

## Phase 1: Modular Refactoring + Bug Fixes

### Module Structure

```
lib/report_plugins/
  ai_eval.js              # Plugin entry point (~100 lines)
  ai_eval/
    ui.js                 # Tab initialization, DOM manipulation, settings display
    llm_client.js         # callAiWithRetry, JSON repair, fence stripping (deduplicated)
    data_processor.js     # processAiEvaluationData, day grouping, data preparation
    renderer.js           # renderCgmReport, renderDaily, renderMultiDay, table() with HTML escaping
    schemas.js            # DailyAnalysisSchema, MultiDayAnalysisSchema
    prompts.js            # replacePlaceholders (replaceAll), formatProfileMarkdown (i18n)
    cost_tracker.js       # Usage recording, cost calculation (fixed formula)

lib/api/
  ai_eval_api.js          # Extracted from inline route in index.js, with field whitelist
  ai_settings_api.js      # Fixed double-send bug, simplified retry logic
  ai_usage_api.js         # Fixed permissions, fixed Promise anti-pattern
```

### Findings Addressed in Phase 1

| # | Severity | Issue | Fix Location |
|---|----------|-------|-------------|
| 1 | CRITICAL | ai_llm_api_url leaked to clients | lib/settings.js — add to secureSettings |
| 2 | HIGH | Unrestricted LLM proxy payload | ai_eval_api.js — whitelist fields |
| 3 | HIGH | Wrong permissions on destructive routes | ai_usage_api.js — use admin permission |
| 4 | HIGH | XSS via unescaped LLM content | renderer.js — HTML escape/sanitize |
| 5 | HIGH | Double response send bug | ai_settings_api.js — remove line 167 |
| 6 | HIGH | 2260-line God object | Split into 7 modules |
| 7 | MEDIUM | No rate limiting on AI proxy | ai_eval_api.js — configurable RPM limit |
| 8 | MEDIUM | Prompt injection via treatment notes | prompts.js — document risk, add delimiter |
| 10 | MEDIUM | Promise constructor anti-pattern | ai_usage_api.js — rewrite as async |
| 11 | MEDIUM | Dead code | Removed during extraction |
| 12 | MEDIUM | Duplicated fence stripping | llm_client.js — single helper |
| 13 | MEDIUM | Hardcoded German strings | prompts.js — use translate() |
| 14 | MEDIUM | replacePlaceholders first-only | prompts.js — use replaceAll() |
| 15 | MEDIUM | Cost calculation bug | cost_tracker.js — prompt + completion |
| 16 | LOW | No LLM proxy timeout | ai_eval_api.js — configurable timeout |
| 17 | LOW | Hard failure in multi-day flow | data_processor.js — cache interim results |
| 18 | LOW | Missing MongoDB indexes | Document in setup guide |
| 19 | LOW | 18 window.* globals | Module-scoped state object |
| 20 | LOW | Typo: poling_intervall | Fix with backward-compat alias |
| 21 | LOW | exchange_rates grows unbounded | ai_usage_api.js — keep only latest per pair |
| 22 | LOW | Inline API route | Extracted to ai_eval_api.js |

### Finding #9 (deprecated request package)

Deferred. The `request` package is used by core Nightscout (maker.js, pushover.js). Replacing it only in AI code would be inconsistent. Address app-wide in a future rebase cycle.

### Team Review Point 1

After Phase 1, run multi-perspective team review to validate:
- Security fixes are effective
- Module boundaries are sensible
- No regressions from restructuring
- Code follows Nightscout conventions

## Phase 2: Plugin Isolation

Make the AI feature a proper togglable plugin with zero footprint when disabled.

### Changes

1. **Auto-enable logic**: If `AI_LLM_KEY` is set, the `ai` plugin auto-enables (mirrors API/API_SECRET pattern)
2. **report_plugins/index.js**: Conditionally include ai_eval only when ai plugin is enabled
3. **admin_plugins/index.js**: Conditionally include ai_settings and ai_usage_viewer
4. **api/index.js**: Conditionally register /ai_eval, /ai_settings, /ai_usage routes
5. **settings.js**: Only expose AI settings when plugin is enabled
6. **env.js**: AI env vars still parsed (needed for auto-enable detection) but not leaked when off

### Team Review Point 2

After Phase 2, run multi-perspective team review to validate:
- Plugin is truly invisible when disabled
- Auto-enable logic is correct
- No side effects on other plugins

## Phase 3: Enhancements

### 3a. Server-Side LLM Adapter Layer

```
lib/ai/
  index.js              # Factory: createProvider(config) -> adapter
  providers/
    base.js             # Base class with common interface
    openai.js           # OpenAI / compatible endpoints
    anthropic.js        # Anthropic Claude API
    gemini.js           # Google Gemini API
```

Each provider implements:
- `chat(messages, options)` -> `{ content, usage }`
- `supportsJsonMode()` -> boolean
- `supportsStreaming()` -> boolean

New env var: `AI_LLM_PROVIDER` (openai|anthropic|gemini).

### 3b. Streaming LLM Responses

- Server: SSE format via `res.write()` on `/ai_eval` endpoint
- Client: `fetch` with `ReadableStream` for progressive token display
- Provider adapters handle format differences
- Progressive rendering: show report sections as they complete

### 3c. Error Recovery

- Cache successful interim day results in localStorage (keyed by date range + data hash)
- On failure: offer "Resume from day N" button
- Show partial results even if final merge call fails

### 3d. Prompt & Schema Improvements

- Review and optimize JSON schemas per provider
- Structured prompt templates with clear sections
- Prompt versioning for forward compatibility
- Improved data preparation: pre-calculate statistics, identify patterns

### 3e. UI/UX Improvements

- Progress bar with per-day status indicators
- Responsive table design for mobile
- Print-friendly CSS
- Improved display mode options

### Team Review Point 3

After Phase 3, comprehensive team review covering:
- Provider adapter design quality
- Streaming implementation correctness
- Overall architecture coherence
- End-to-end functionality
