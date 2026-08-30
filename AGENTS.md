# jbot-review-arena — agent guide

Trusted GitHub Actions orchestration for comparing J-Bot review results across
models. This repository parses `/compare`, freezes a public target PR, runs one
pinned J-Bot image per model, and publishes results back to the arena PR. It
contains no review logic.

## Commands

- `npm test` — all node:test suites
- `npm run typecheck` / `npm run lint` / `npm run format:check`
- `npm run build` — bundle workflow entrypoints to `dist/` (gitignored)

## Invariants

1. Only trusted `issue_comment.created` commands from arena maintainers fan out.
2. Workers receive only the selected provider's credential routes and no GitHub write token.
3. Target repositories are public, frozen by SHA, mounted read-only, and never executed.
4. Every worker uses the same full-SHA J-Bot image digest resolved by prepare.
5. Publisher inputs are untrusted. Render prose inert and edit/delete only bot comments with exact markers.
6. Publishing is idempotent per command-comment ID and always runs after worker failures.
7. Keep orchestration thin and pure logic unit-tested. Do not copy review behavior from jbot-review.

## Hygiene

Keep the smallest surface that satisfies the versioned contract. Comments must
explain a non-obvious security or operational reason. Tests protect distinct
failure modes rather than restating implementation details.
