# VibeSim Visualization App

React 18 + TypeScript + Vite application for the integrated VibeSim result and
Agent workspace. It uses MUI, ECharts, Motion, TanStack Query, and
runtime-validated Analyzer artifact schemas.

## Commands

Node.js 22 is required.

```bash
npm ci
npm run dev          # proxies to a running Analyzer + VibeSimAgent
npm run format:check
npm run typecheck
npm run lint
npm run test:unit
npm run test:coverage
npm run test:e2e
npm run build
```

See the repository-level [`README.md`](../README.md) for getting started and
[`deployment.md`](../docs/deployment.md) for service and proxy configuration.

## Application surfaces

- Entry catalog for existing results, new Agent conversations, and resume.
- Aggregate sweep heatmaps with coordinated run selection.
- Per-run deployment, pool, worker, iteration, kernel, trace, and optimality
  analysis.
- Offline timing-prediction cost trees and optimality analysis.
- Framework alignment: paired iterations, operation mappings, and end-to-end comparisons.
- Kernel profile curves and kernel measurement results.
- Dockable, resizable, and full-page Agent conversation UI with durable SSE
  reconnection and Analyzer evidence navigation.

## Data boundary

`Location` is the only shared UI state. Panels declare the artifacts they need,
and the artifact client derives immutable Analyzer addresses from typed refs.
Result descriptors and payloads always come from Analyzer; the Agent session
boundary owns conversation transport and frozen evidence schemas.

TanStack Query owns server state and versioned result identities. Missing,
unavailable, failed, and incompatible resources remain explicit states rather
than fabricated zeroes.

## Tests

Vitest covers artifact schemas, route/selection behavior, visualization models,
and workspace interactions with isolated Query clients. Playwright runs
at 1440x900 and 390x844, checks browser errors, and covers interaction behavior.
Full-page WCAG audits are not part of this research test suite. Failure traces, screenshots, videos, and reports are written under
`../.artifacts/playwright-test/`.

Formatting is also a local check. CI checks types once before bundling the live
application.

Architecture and wire contracts live in
[`../docs/frontend-architecture.md`](../docs/frontend-architecture.md) and
[`../docs/data-protocol.md`](../docs/data-protocol.md).

Browser tests run the functional suite on desktop and responsive cases at 390px.
The isolated `e2e/harness/cost-tree.html` mounts production components with an
explicit 95/5 cost split to check proportional rendering and kernel selection;
the bundled Analyzer run does not contain exact operation CostTrees. This test
entry is not included in the production build. Font-family/color token rules and
their regression tests run through `npm run lint`; see [themes](../docs/themes.md).
