# AI Evaluation Plugin for Nightscout

## Overview

The AI Evaluation plugin adds an "AI Evaluation" tab to the Nightscout Reports screen. It combines **client-side statistical analysis** with **LLM-powered interpretation** to help users understand their CGM data.

**How it works:**

1. **Client-side statistics** (instant, always available): TIR/TBR/TAR, standard deviation, CV, MAGE, episode counting, and time-block breakdowns are computed locally in the browser using `lib/statistics.js`. These appear immediately when data is loaded.
2. **LLM analysis** (optional, requires API key): A single API call sends compact CGM data plus computed statistics to an LLM, which returns pattern analysis, trend detection, and therapy recommendations. The LLM focuses on interpretation -- it does not compute statistics.

**Architecture highlights:**

- **Single-call design**: One LLM call per analysis (replaces the previous 14+1 two-phase pattern)
- **Multi-provider support**: Works with OpenAI, Anthropic (Claude), Google Gemini, and any OpenAI-compatible endpoint
- **Plugin isolation**: When `AI_LLM_KEY` is not set, the plugin is completely invisible -- no tab, no routes, no console errors
- **Server-side proxy**: The API key never reaches the browser. All LLM calls go through the Nightscout server

## Features

- Client-side statistics: TIR, TBR, TAR, SD, CV, MAGE, hypo/hyper episode counting, diurnal breakdowns
- LLM-powered pattern analysis, trend detection, and therapy recommendations
- Multi-provider support: OpenAI, Anthropic Claude, Google Gemini, any OpenAI-compatible API
- Configurable prompts via Admin Tools (stored in MongoDB)
- Token usage tracking with cost calculation and optional currency conversion
- 14-day maximum analysis window to manage cost and performance
- Debug mode for inspecting prompts and API payloads
- Monthly USD spending limit with automatic button disabling
- Language support via Nightscout `LANGUAGE` setting

## DISCLAIMER

**The information generated is not medical advice and must not be used as a substitute for professional diagnosis or treatment. The AI analysis may be inaccurate, incomplete, or incorrect. Use it only as a general indicator or for informational purposes. Always consult a qualified healthcare provider for medical decisions.**

## Setup

### Environment Variables

Set these on your Nightscout server. **Restart required** after changes.

#### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `AI_LLM_KEY` | API key for the LLM service | `sk-xxxx...` |
| `AI_LLM_API_URL` | Full API endpoint URL | See provider examples below |
| `AI_LLM_MODEL` | Model name | See supported models below |

#### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_LLM_PROVIDER` | Auto-detected | Explicit provider override: `openai`, `anthropic` |
| `AI_LLM_TEMPERATURE` | `0` | LLM randomness (0 = deterministic, 1 = creative) |
| `AI_LLM_MAX_TOKENS` | `2000` | Maximum tokens in LLM response |
| `AI_LLM_TIMEOUT` | `120` | LLM API timeout in seconds |
| `AI_LLM_DEBUG` | `false` | Show prompts, payloads, and raw responses in the UI |
| `AI_LLM_DEFAULT_DISPLAY` | `Show all results` | Default display mode |
| `AI_LLM_MONTHLY_USD_LIMIT` | `20` | Monthly spending cap in USD (disables button when reached) |
| `AI_LLM_1K_TOKEN_COSTS_INPUT` | `0.005` | Cost per 1000 input tokens (USD) |
| `AI_LLM_1K_TOKEN_COSTS_OUTPUT` | `0.015` | Cost per 1000 output tokens (USD) |
| `AI_LLM_EXCHANGERATE_API_KEY` | (none) | API key for exchangerate.host currency conversion |
| `AI_LLM_EXCHANGERATE_API_CURRENCY` | (none) | Target currency code (e.g., `EUR`, `GBP`) |
| `AI_LLM_EXCHANGERATE_API_LIMIT` | `100` | Max exchange rate API calls per month |
| `AI_LLM_EXCHANGERATE_API_POLING_INTERVALL` | `7` | Days between exchange rate refreshes |

### Provider Configuration

#### OpenAI

```
AI_LLM_API_URL=https://api.openai.com/v1/chat/completions
AI_LLM_MODEL=gpt-4o
AI_LLM_KEY=sk-...
```

#### Anthropic (Claude)

```
AI_LLM_API_URL=https://api.anthropic.com/v1/messages
AI_LLM_MODEL=claude-haiku-4-5-20251001
AI_LLM_KEY=sk-ant-...
```

The provider is auto-detected from the URL (URLs containing "anthropic" use the Anthropic adapter). You can also set `AI_LLM_PROVIDER=anthropic` explicitly.

#### Google Gemini (via OpenAI-compatible endpoint)

```
AI_LLM_API_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
AI_LLM_MODEL=gemini-2.5-flash-lite
AI_LLM_KEY=AIza...
```

#### Any OpenAI-Compatible Endpoint (Ollama, vLLM, etc.)

```
AI_LLM_API_URL=http://localhost:11434/v1/chat/completions
AI_LLM_MODEL=llama3
AI_LLM_KEY=ollama
```

### Supported Model Tiers

**Supported** (tested, tailored prompts/schemas):

| Model | Provider | Estimated Cost (14-day analysis) |
|-------|----------|----------------------------------|
| Gemini 2.5 Flash-Lite | Google | ~$0.008 |
| gpt-5.4-nano | OpenAI | ~$0.017 |
| gpt-5.4-mini | OpenAI | ~$0.064 |
| Claude Haiku 4.5 | Anthropic | ~$0.080 |

**Compatible** (works via OpenAI-compatible path, not optimized):

- Any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, etc.)
- User's responsibility for prompt tuning and JSON reliability

### Prompt Configuration (Admin Tools)

1. Navigate to **Admin Tools** (`/admin`)
2. Find the **"AI Evaluation Prompt Settings"** section
3. Configure:
   - **System Prompt**: Defines the LLM's role and instructions
   - **User Prompt Template**: The analysis instruction with placeholders
4. Click **"Save Prompts"**

Prompts are stored in MongoDB (`ai_prompt_settings` collection). If no prompts are configured, the UI shows a message directing to Admin Tools.

#### Available Placeholders

| Placeholder | Description |
|-------------|-------------|
| `{{CGMDATA_JSON}}` | Compact JSON of CGM data (SGV readings + treatments per day) |
| `{{STATS_JSON}}` | Client-computed statistics (TIR, SD, CV, MAGE, episodes) |
| `{{PROFILE_JSON}}` | Structured Nightscout profile (basal, ISF, carb ratios, targets) |
| `{{LANGUAGE}}` | Language code from Nightscout LANGUAGE setting |

## Usage

### Generating an Analysis

1. Go to **Reports** and click **"Show"** on any report type to load data
2. Click the **"AI Evaluation"** tab
3. The **Statistics** section appears immediately with computed metrics (TIR, SD, CV, MAGE, episodes, time-block breakdowns)
4. Click **"Send to AI"** to request LLM interpretation
5. The **Analysis** section renders trends, recommendations, and per-day notes when the LLM responds

### Reading the Report

The report has two sections:

**Statistics** (always available, computed client-side):
- Time in Range (TIR), Time Below Range (TBR), Time Above Range (TAR)
- Average, median, standard deviation, coefficient of variation
- MAGE (Mean Amplitude of Glycemic Excursions)
- Hypo/hyper episode counts with durations
- Diurnal distribution (00-06, 06-12, 12-18, 18-24)

**Analysis** (requires LLM):
- Summary of key findings
- Detected trends with evidence and severity (info/warning/critical)
- Therapy recommendations: settings (basal/I:C/ISF) and behavioral/timing
- Monitoring suggestions
- Per-day notes
- Data quality observations

### If the LLM Call Fails

The statistics section remains visible. The analysis section shows an error message with a retry option. Common causes: network timeout, invalid API key, rate limit exceeded.

### Usage Statistics (Admin Tools)

In Admin Tools, the **"AI Usage Statistics"** section shows:
- Monthly breakdown of requests, token usage, and costs
- Input/output token split
- Average tokens per request and per day
- Currency conversion (if configured)
- **Recalculate Summary** button for re-syncing aggregated data
- **Delete Old Data** for managing database size

## Cost Guide

Costs depend on the model and date range. Single-call architecture significantly reduces costs compared to per-day calling patterns.

**Estimated costs per analysis (USD):**

| Model | 3-day | 7-day | 14-day |
|-------|-------|-------|--------|
| Gemini 2.5 Flash-Lite ($0.10/$0.40) | ~$0.002 | ~$0.004 | ~$0.008 |
| gpt-5.4-nano ($0.20/$1.25) | ~$0.005 | ~$0.009 | ~$0.017 |
| gpt-5.4-mini ($0.75/$4.50) | ~$0.016 | ~$0.033 | ~$0.064 |
| Claude Haiku 4.5 ($1.00/$5.00) | ~$0.020 | ~$0.040 | ~$0.080 |

Set `AI_LLM_MONTHLY_USD_LIMIT` to cap spending. The "Send to AI" button disables when the limit is reached.

## Troubleshooting

### Plugin not visible (no AI Evaluation tab)

- `AI_LLM_KEY` must be set. The plugin is completely hidden without it.
- Restart the Nightscout server after setting the key.
- Check server startup logs for `AI plugin: enabled` or `AI plugin: disabled`.

### "Send to AI" button disabled

- Verify `AI_LLM_API_URL` and `AI_LLM_MODEL` are set. The status area shows which settings are missing.
- Check if the monthly spending limit has been reached.
- Ensure the date range is <= 14 days.

### LLM API errors

- **504 Gateway Timeout**: The LLM took longer than `AI_LLM_TIMEOUT` seconds. Try a shorter date range or increase the timeout.
- **502 Bad Gateway / Connection refused**: Check `AI_LLM_API_URL`. The server cannot reach the LLM endpoint.
- **429 Rate limit exceeded**: Max 10 requests per minute. Wait and retry.
- **401/403**: Invalid or expired API key.

### Provider-specific issues

- **Anthropic**: Requires `max_tokens` in the request. The adapter sets a default of 4096 if not specified. The `anthropic-version: 2023-06-01` header is sent automatically.
- **Gemini**: Use the OpenAI-compatible endpoint (`generativelanguage.googleapis.com/v1beta/openai/`), not the native Gemini API.
- **Ollama/local**: Use `http://` (not `https://`). Set `AI_LLM_KEY` to any non-empty value (e.g., `ollama`).

### No prompts configured

If the Admin UI prompt fields are empty, the "Send to AI" button may not work. Configure prompts in Admin Tools > AI Evaluation Prompt Settings.

### Exchange rate issues

- Verify `AI_LLM_EXCHANGERATE_API_KEY` is valid at exchangerate.host.
- Check server logs for exchange rate fetch errors.
- The rate is cached for `AI_LLM_EXCHANGERATE_API_POLING_INTERVALL` days.

### Debug mode

Set `AI_LLM_DEBUG=true` and restart. The UI shows:
- Constructed JSON payload sent to the server
- Raw LLM response
- Provider selection and timing information

Server logs also show detailed request/response data when debug is enabled.

## Technical Reference

### Module Structure

```
lib/report_plugins/
  ai_eval.js                 # Plugin entry point (~100 lines)
  ai_eval/
    data_processor.js        # Data extraction, compact JSON formatting
    llm_client.js            # API call with retry, JSON repair, fence stripping
    renderer.js              # Report rendering with HTML escaping (XSS-safe)
    schemas.js               # Unified response JSON schema
    prompts.js               # Placeholder replacement, profile formatting
    cost_tracker.js          # Usage recording, per-provider cost calculation

lib/statistics.js            # Shared stats: TIR, SD, CV, MAGE, episodes
                             # Used by ai_eval and available to other report plugins

lib/ai/
  index.js                   # Factory: createProvider(config)
  providers/
    openai_compat.js         # OpenAI + Gemini + any compatible (Node.js https)
    anthropic.js             # Claude API (Node.js https)

lib/api/
  ai_eval_api.js             # LLM proxy with field whitelist + rate limiting
  ai_settings_api.js         # Prompt settings CRUD
  ai_usage_api.js            # Usage tracking + exchange rates
```

### Data Flow

```
1. User clicks "Show" on a report
   -> datastorage loaded with CGM data

2. User opens "AI Evaluation" tab
   -> data_processor.prepareCgmData() extracts compact JSON
   -> statistics.computeDayStats() runs for each day
   -> statistics.computePeriodStats() aggregates across days
   -> Stats section renders immediately via renderer.js

3. User clicks "Send to AI"
   -> prompts.js fills placeholders in prompt template
   -> Client POSTs to /api/v1/ai_eval

4. Server-side (ai_eval_api.js):
   -> Rate limit check (10 req/min)
   -> Field whitelist: messages, model, temperature, top_p, max_tokens
   -> Provider auto-detection from AI_LLM_API_URL
   -> createProvider() -> openai_compat or anthropic adapter
   -> adapter.chatCompletion(payload) via Node.js https
   -> Normalized response: { content, usage: { prompt_tokens, completion_tokens } }
   -> Return to client as { html_content, usage }

5. Client receives response
   -> JSON repair if needed (fence stripping, retry)
   -> renderer.js renders analysis with HTML escaping
   -> cost_tracker.js records usage
```

### Provider Adapters

Both adapters use Node.js built-in `https`/`http` modules (not the deprecated `request` package).

**OpenAI-compatible** (`openai_compat.js`):
- Auth: `Authorization: Bearer {key}`
- System prompt: in `messages` array as `{ role: 'system' }`
- Response: `choices[0].message.content`
- Usage: `{ prompt_tokens, completion_tokens }`
- Structured output: `response_format: { type: 'json_schema', ... }`

**Anthropic** (`anthropic.js`):
- Auth: `x-api-key` header + `anthropic-version: 2023-06-01`
- System prompt: top-level `system` parameter (extracted from messages)
- Response: `content[0].text`
- Usage: `{ input_tokens, output_tokens }` (normalized to `prompt_tokens`, `completion_tokens`)
- Structured output: schema embedded in system prompt (Anthropic doesn't support `response_format`)
- `max_tokens` required (defaults to 4096)

### Unified Response Schema

The LLM returns structured JSON matching `CgmAnalysisSchema`:

```json
{
  "period": { "from": "2026-03-01", "to": "2026-03-07", "days": 7 },
  "summary": ["Key finding 1", "Key finding 2"],
  "trends": [
    { "label": "Nocturnal hypoglycemia", "evidence": "...", "severity": "warning" }
  ],
  "recommendations": {
    "therapy_settings": [{ "action": "...", "rationale": "..." }],
    "behavioral_timing": [{ "action": "...", "rationale": "..." }],
    "monitoring": ["..."]
  },
  "per_day": [{ "date": "2026-03-01", "notes": ["..."] }],
  "data_quality_notes": ["..."]
}
```

Statistics (TIR, SD, CV, MAGE, episodes) are **not** in the LLM schema -- they are computed client-side.

### API Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| POST | `/api/v1/ai_eval` | `api:treatments:read` | LLM proxy (rate limited, field whitelist) |
| GET | `/api/v1/ai_settings/prompts` | `api:treatments:read` | Fetch prompt templates |
| POST | `/api/v1/ai_settings/prompts` | `admin:api:ai_settings:edit` | Save prompt templates |
| POST | `/api/v1/ai_usage/record` | `api:treatments:read` | Record token usage |
| GET | `/api/v1/ai_usage/monthly_summary` | `api:treatments:read` | Aggregated usage data |
| POST | `/api/v1/ai_usage/rebuild_summary` | `api:treatments:read` | Rebuild summary from raw data |
| POST | `/api/v1/ai_usage/delete_old` | `api:treatments:read` | Delete data older than N months |

### Database Collections

| Collection | Purpose |
|------------|---------|
| `ai_prompt_settings` | Stores system + user prompt templates (single doc, `_id: "main_config"`) |
| `ai_usage_stats` | Per-request usage records (tokens, costs, dates) |
| `ai_usage_summary` | Pre-aggregated monthly summaries for fast display |
| `exchange_rates` | Cached currency conversion rates (upsert by currency pair) |

### Security

- **API key isolation**: `AI_LLM_KEY` is in `secureSettings` -- never sent to the client. The client sees only a boolean `ai_llm_key_is_set` flag.
- **Field whitelist**: The server-side proxy only forwards known fields (`messages`, `model`, `temperature`, `top_p`, `max_tokens`) to the LLM. Unknown fields are silently dropped.
- **Response format**: `response_format` is set server-side from the known schema -- client-provided schemas are never forwarded.
- **Rate limiting**: In-memory counter, max 10 requests per minute, returns 429 on exceed.
- **XSS protection**: All LLM-sourced content is HTML-escaped before rendering.
- **Prompt injection mitigation**: Treatment notes are JSON-encoded strings in a structured data block, never raw text interpolation.
- **Response size cap**: 10 MB maximum on LLM responses to prevent memory exhaustion.
- **Error sanitization**: Provider error details are not leaked to the client.

### Plugin States

| State | Condition | Behavior |
|-------|-----------|----------|
| **Not configured** | `AI_LLM_KEY` not set | Plugin completely invisible. No tab, no routes, no console errors. |
| **Partially configured** | Key set, URL or model missing | Tab visible, stats display, "Send to AI" disabled with status message. |
| **Fully configured** | All required vars set + prompts configured | Full functionality. |

Changing `AI_LLM_KEY` requires a server restart (same as all Nightscout env vars). Disabling the plugin does not delete saved prompts or usage data.
