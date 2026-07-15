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

<!-- main agent -->

## Feedback

<!-- main agent -->
