@AGENTS.md

# Working in this repo

- Follow docs/ENGINEERING_RULES.md: inspect → plan → implement → verify, one logical change per commit.
- Read decisions in docs/adr/ before changing architecture; add a new ADR for a new decision.
- Never import src/db/client.ts or src/lib/env.ts from tests; use src/db/client-factory.ts.
- Every state change that matters is audited with recordAudit() inside the same transaction.
- Real client files live only in fixtures/ (git-ignored). Never commit client data.
- Run `npm run check` and `npm run test:integration` before committing.
