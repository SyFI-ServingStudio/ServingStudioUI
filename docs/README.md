# VibeSim UI documentation

Start with the [repository README](../README.md) for quickstart, live builds and
service setup. These documents cover the implementation contracts.

| Document | Read it when working on |
| --- | --- |
| [Frontend architecture](frontend-architecture.md) | Feature ownership, state, rendering and interaction boundaries. |
| [Analyzer data protocol](data-protocol.md) | Resource identities, units, availability, HTTP routes and adapters. |
| [Agent–Analyzer integration](inquiry-wiring.md) | Workspace/conversation ownership and execution-to-result relationships. |
| [Citation DSL](citation-dsl.md) | Frozen evidence tokens and click navigation. |
| [Themes](themes.md) | Palette selection, shared visual tokens and reading metrics. |

## Versions and source authority

Analyzer HTTP routes and subject adapters use v1, while browser navigation,
selection and frozen evidence use v2. These are independent contracts.
Consult `app/src/repositories/AnalyzerRepository.ts`, `app/src/contracts/analyzer/v1/`
and `app/src/domain/{analyzerNavigation,analyzerSelection,evidenceRef}.ts` for the
implemented interfaces. The application reads the Analyzer over HTTP and has no second,
checked-in data source; `app/testdata/` is sample input to unit tests only.

CI commands live in `app/package.json` and `.github/workflows/ci.yml`. Default
checks cover lint, types, behavioral tests and bundling.
Formatting checks are optional local
tools. Build success alone does not establish browser or Agent/GPU readiness.

Update the relevant contract when behavior changes. Keep temporary plans and
local audit evidence outside these maintained documents.
