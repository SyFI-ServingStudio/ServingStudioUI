# CostTree Refactor

## Summary

- Replaced the permissive cost-node shape with separate strict raw and annotated discriminated unions for `leaf`, `sum`, `max`, and `scale`.
- Added an exact Zod boundary, finite-number/cardinality validation, cycle rejection, deterministic preorder annotation, and deeply immutable output.
- Removed downstream non-null assertions and optional-child fallbacks by narrowing components and helpers to `LeafNode`, `MaxNode`, or `CostTree` where appropriate.
- Separated `kernel-time-share` aggregate worker composition from the independently versioned `worker-cost-tree` detail contract. The UI now labels aggregate projection evidence explicitly and repository detail reads no longer reinterpret aggregate subjects.
- Kept synthetic hierarchical fixture trees in a separately injected detail index, with tests proving both the detail path and aggregate/detail separation.

## Files

- Tree contract and validation: `app/src/data/treeTypes.ts`, `app/src/data/treeSchema.ts`, `app/src/data/tree.ts`, `app/src/data/tree.test.ts`.
- Aggregate projection: `app/src/data/aggregateKernelComposition.ts`, `app/src/data/aggregateKernelComposition.test.ts`; removed `app/src/data/kernelTimeTree.ts`.
- Application evidence boundary: `app/src/application/WorkerTreeProvider.tsx`, `app/src/application/queries.ts`, projection helpers, and provider tests.
- Repository contract: `AnalyzerRepository` plus Artifact, HTTP, and Fixture implementations/tests.
- Consumers: CostTree, breadcrumb, time-share, worker-stage, iteration, imbalance, and kernel helpers.
- Domain naming: aggregate kernel-time composition types and analyzer-v1 adapter imports.

## Validation

- `npm run typecheck` — passed after the final semantic review.
- `npx vitest run src/data/tree.test.ts src/data/aggregateKernelComposition.test.ts src/application/WorkerTreeProvider.test.tsx` — 3 files, 22 tests passed after final fixes.
- Targeted ESLint over every file changed by the final review — passed with zero warnings.
- Full project gates run during the implementation: `npm run lint`, `npm run format:check`, `npm run test:unit` (21 files / 177 tests before the final added boundary test), and `npm run size` all passed.
- `rg -n "slot!|as CostNode|children \\?\\?" app/src --glob '!**/*.test.*'` — no production matches.
- `git diff --check` — passed.

Known protocol limitation: Artifact and HTTP repositories intentionally return an `incompatible` detail error when a descriptor declares `worker-cost-tree` ready, because analyzer protocol-v1 does not yet define a hierarchical CostTree decoder. Runs without that detail continue to render the explicitly labelled aggregate projection from the already loaded `kernel-time-share` subject.

## Review

Independent review found and fixed two protocol-level blockers before merge:

- The first implementation treated `Max.overlap` as a `[0,1]` blend. Current
  CostTree v1 now accepts only the production value `1`, computes a pure
  critical-path maximum, and reports any other value as incompatible. `Scale.n`
  also matches the Rust `u32` wire type and a one-child fan-out remains valid.
- Worker evidence no longer collapses valid zero data and the distinct
  `unavailable`, `not_generated`, `failed`, and `incompatible` states into one
  retryable error. Only transient failures use `role=alert` and expose retry.

The merged series passed Prettier, TypeScript, ESLint, 21 test files / 192 tests,
the production build, `git diff --check`, and both size limits (381.99 kB gzip
initial; 502.35 kB gzip across all chunks). No unsafe CostTree assertions or
optional-child fallbacks remain in production code.

## Feedback

The aggregate kernel composition is intentionally a labelled run-level
projection, not hierarchical worker detail. When the analyzer eventually marks
`worker-cost-tree` ready, add its independently versioned decoder and endpoint
to both Artifact and HTTP repositories; until then the explicit `incompatible`
state is the correct boundary and must not silently fall back to aggregate data.
