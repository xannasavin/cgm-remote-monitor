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
