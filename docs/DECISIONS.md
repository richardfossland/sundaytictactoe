# Decisions

Lightweight ADRs. Newest first.

---

## ADR-001 — TypeScript 7 via `@typescript/native`; the `typescript` name stays on the 6.0 API; Next uses the API type-checker

- **Status:** accepted
- **Reference:** the full reasoning lives in sundayquiz `docs/DECISIONS.md` ADR-001 (introduced in richardfossland/sundayquiz#29). This repo uses the identical setup.
- **Decision:** two npm aliases instead of one dependency:

  ```json
  "@typescript/native": "npm:typescript@~7.0.2",
  "typescript":         "npm:@typescript/typescript6@^6.0.2"
  ```

  `node_modules/.bin/tsc` is TS 7 (used by `npm run typecheck` and CI), while
  `require("typescript")` is the TS 6.0 API that typescript-eslint and Next use.
- **Consequences:**
  - `"typescript": "npm:@typescript/typescript6@..."` is not a downgrade. Do not
    "fix" it to `"typescript": "^7"`: typescript-eslint throws on TS >= 7
    (typescript-eslint#10940) and `npm run lint` breaks.
  - `experimental.useTypeScriptCli: false` in `next.config.ts` is load-bearing.
    The compat package has no `bin.tsc`, so without it `next build` fails with
    "you do not have the required package(s) installed".
  - Revisit when typescript-eslint supports TS >= 7.1: collapse both aliases to
    `"typescript": "^7"` and drop `useTypeScriptCli`.

---
