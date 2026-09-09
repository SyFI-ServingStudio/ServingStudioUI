# VibeSim Visualization App

React 18 + TypeScript + Vite application for the integrated VibeSim result and
Agent workspace. It uses MUI, ECharts, Motion, TanStack Query, Zustand, and
runtime-validated Analyzer v1 adapters.

## Commands

Node.js 22 is required.

```bash
npm ci
npm run dev          # deterministic checked-in Analyzer fixture
npm run dev:live     # live Analyzer + VibeSimAgent proxies
npm run format:check
npm run typecheck
npm run lint
npm run fixture:check
npm run test:unit
npm run test:coverage
npm run test:e2e
npm run build
npm run size:check
```

See the repository-level [`README.md`](../README.md) for the three-service live
startup and proxy configuration.

## Application surfaces

- Entry catalog for existing results, new Agent conversations, and resume.
- Aggregate sweep heatmaps with coordinated run selection.
- Per-run deployment, pool, worker, iteration, kernel, trace, and optimality
  analysis.
- Offline timing-prediction cost trees and optimality analysis.
- Kernel profile curves and kernel measurement results.
- Dockable, resizable, and full-page Agent conversation UI with durable SSE
  reconnection and Analyzer evidence navigation.

## Data boundary

Features depend only on `AnalyzerRepository`; components never concatenate
artifact paths or read Parquet directly. `HttpAnalyzerRepository` reads live
Analyzer resources, while the fixture repository supports deterministic tests.
The FastAPI `/api/jobs` catalog contributes only conversation ownership and
lifecycle state. Result descriptors and payloads always come from Analyzer.

TanStack Query owns server state and versioned result identities. Zustand keeps
only local UI selection and layout state. Missing, unavailable, failed, and
incompatible resources remain explicit states rather than fabricated zeroes.

## Tests

Vitest covers repository adapters, route/selection behavior, visualization
models, and workspace interactions with isolated Query clients. Playwright runs
at 1440x900 and 390x844, checks browser errors, and covers interaction behavior.
Full-page WCAG audits are not part of this research test suite. Failure traces, screenshots, videos, and reports are written under
`../.artifacts/playwright-test/`.

`npm run size:check` checks an existing `dist/`; `npm run size` performs a
production build first. These optional local budgets cover both the initial entry and the
gzip total of all JavaScript chunks; they do not block CI. Formatting is also a
local check. CI checks types once before bundling the live application.

Architecture and wire contracts live in
[`../docs/frontend-architecture.md`](../docs/frontend-architecture.md) and
[`../docs/data-protocol.md`](../docs/data-protocol.md).

Browser tests run the functional suite on desktop and responsive cases at 390px.
The isolated `e2e/fixtures/cost-tree.html` mounts production components with an
explicit 95/5 cost split to check proportional rendering and kernel selection;
the bundled Analyzer run does not contain exact operation CostTrees. This test
entry is not included in the production build. Font-family/color token rules and
their regression tests run through `npm run lint`; see [themes](../docs/themes.md).
