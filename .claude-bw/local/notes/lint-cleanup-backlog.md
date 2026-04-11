# Lint Cleanup Backlog

**Parked:** 2026-04-11 (during R5 closure session on `feat/ai-report-plugin`)
**Origin:** Surfaced during narrow team-review of this session's changes (see `20260411-review-team-feat-ai-report-plugin.md`).

## State

Running `npx eslint lib` at commit `07ceccc0` (pre-session baseline) reported:

```
✖ 71 problems (54 errors, 17 warnings)
  3 errors and 0 warnings potentially fixable with the `--fix` option.
```

After this session's changes (ESLint config update + small renames) the count is:

```
✖ 60 problems (43 errors, 17 warnings)
```

So the session **reduced** the error count by 11, but the baseline was already broken. This is pre-existing tech debt, not a regression introduced by the AI plugin work.

## Why it's been tolerated

The `npm run lint` script (`"lint": "eslint lib"`) exists but CI clearly does not gate on it — otherwise master could not have been shipping with 54 errors. Lint is informational only today.

## Error categories (ballpark, from a single run)

- **`no-unused-vars`** — majority of errors. Unused `require` imports (e.g., `crypto` in `lib/server/env.js:15`), unused function args, unused assignment-but-never-read variables. Some are dead code; some are signature-required params (same class as the `ctx` / `_ctx` fix we did for `lib/report_plugins/ai_eval.js:66`).
- **`no-prototype-builtins`** — direct `obj.hasOwnProperty(...)` calls. One seen at `lib/server/purifier.js:14`. Need `Object.prototype.hasOwnProperty.call(obj, key)`.
- **`no-extra-semi`** — stray semicolons. Seen at `lib/server/websocket.js:584, 587`. Trivial `--fix`.
- **`security/detect-non-literal-require`** — non-literal arguments to `require()`. Seen in `lib/storage/openaps-storage.js:34, 129`. Legitimate dynamic requires — either silence per-file or refactor to explicit imports.
- **`security/detect-non-literal-fs-filename`** — `fs.readFileSync`/`fs.existsSync`/`fs.statSync` with non-literal path arguments. Seen in `lib/server/enclave.js`, `lib/server/env.js`, `lib/storage/openaps-storage.js`. These are real "arbitrary file read" risks in theory, but in practice the paths come from trusted config. Usually suppressed via per-line eslint-disable with a security review comment.
- **`security/detect-non-literal-regexp`** — one at `lib/server/query.js:206`. Same story: suppress with justification.
- **`no-unused-vars` with `^_` hint** — a handful of args like `index`, `results`, `env`, `ctx` that are signature-required but unused. Same class as our `_ctx`/`_meta` work. These can all be prefixed with `_` to silence.

## Recommended approach when someone picks this up

1. **Separate PR/branch.** Do NOT bundle into a feature branch — the diff noise would make feature review useless.
2. **Start with `--fix`.** The 3 auto-fixable errors (`no-extra-semi` etc.) are free. Run `npx eslint lib --fix` and commit as "chore(lint): apply auto-fix".
3. **Unused-vars sweep, one file at a time.** Walk each offending file, decide per offender: delete the dead code, or prefix with `_` (signature-required), or silence with a targeted `// eslint-disable-line` + comment explaining why. Commit per logical chunk.
4. **Security-rule suppressions.** For `detect-non-literal-*` rules, audit each site for actual risk. Most are false positives on trusted config reads — silence with a comment like `// eslint-disable-line security/detect-non-literal-fs-filename -- path from trusted env config`.
5. **Once clean, wire into CI.** Only after lint is green should `npm run lint` be promoted to a CI gate. Until then it stays advisory.
6. **Do NOT touch `lib/report_plugins/ai_eval*`.** Those files were scrubbed in the AI plugin R5 work (this session's branch) and already pass cleanly — the remaining 10 `no-unsanitized/property` disable comments were validated when we installed `eslint-plugin-no-unsanitized@^4.0.2`.

## Size estimate

By file count: ~15 files have errors. By line count: ~43 errors. Realistic scope for a single focused cleanup session, maybe 2-3 hours of mechanical work + 30 minutes of judgment calls on the security rules.

## Why it's NOT being fixed now

This parking note was created during the narrow team-review fix round for `feat/ai-report-plugin`. Fixing these would balloon the session's diff and mix two unrelated concerns (AI plugin closure vs. repo-wide lint hygiene). The user explicitly asked to park this as follow-up work.

## Next steps when resumed

- Start a new branch off the merge point of `feat/ai-report-plugin` (or `dev`, whichever is current after this branch lands).
- Run `npx eslint lib > lint-baseline.txt` and commit as the starting point so progress is measurable.
- Work file-by-file from the top of the baseline file.
- Final verification: `npx eslint lib` exits 0, then update `package.json` lint script (if needed) and wire into CI.
