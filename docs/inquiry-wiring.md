# Agent–Analyzer Workspace Wiring

This document describes the production boundary between the VibeSim Agent,
conversation backend, Launcher, Rust Analyzer, and VibeSimUI. It replaces the
earlier model where every conversation implicitly owned a separate repository
or where an “inquiry” was treated as a durable top-level object.

## 1. Durable identity model

```text
workspace
├── one repository and logs root
├── one workspace SQLite database
├── many conversations
├── many Analyzer resources
└── many managed jobs and experiment relationships
```

- A **workspace** is the durable read/write and authorization boundary.
- A **conversation** is one narrative and set of role sessions inside that
  workspace. Creating a conversation does not copy the repository.
- A **turn** owns one request, capability, event stream, and citation snapshot.
- An **Analyzer resource** is stable result identity: simulation sweep/run,
  timing prediction, kernel profile, or kernel measurement.
- `w_main` is the real development checkout represented as a normal workspace.
- “Inquiry” is currently a UI concept expressed by conversation turns and
  resource relationships, not a separate persistent entity.

Deleting a Docker runner does not delete workspace files, conversations, or
Analyzer results. Archiving a workspace removes its logs root from active
Analyzer discovery.

## 2. Ownership boundaries

| Component | Owns | Must not own |
| --- | --- | --- |
| Launcher | Expansion, ordered sweep axes, run membership, managed lifecycle registration | UI view models or citation rendering |
| Rust Analyzer | Result discovery, payloads, descriptors, curves, plots, hardware limits | Conversation lifecycle or Agent prose |
| Conversation backend | Workspaces, conversations, turns, capabilities, job ownership overlays, citation dictionaries and frozen targets | Recomputed result metrics or plot bytes |
| Analyzer MCP bridge | Bounded read-only Analyzer access and compact evidence projection | Metric computation or resource-choice policy |
| Agent | Resource choice, interpretation, derived reasoning, citation-token choice | Navigation target construction |
| VibeSimUI | Analyzer presentation, Agent shell, frozen citation rendering and click navigation | DSL parsing into targets or metric inference |

Result values are always read from Analyzer. A conversation job row proves
lifecycle and ownership only.

## 3. Supported invocation forms

### 3.1 Direct development

A developer or coding Agent runs Launcher without managed context. Results are
ordinary Analyzer resources under the configured logs root. No conversation
relationship is required.

### 3.2 Managed UI Agent

The backend signs a short-lived capability for one workspace, conversation,
turn, and role. The runner receives it through managed context. Launcher uses
that context to register a stable result identity and report lifecycle events.
The backend enforces the workspace logs-root boundary.

### 3.3 Existing-result analysis

A user may open any active result visible in the workspace, or the Agent may
select one from Analyzer discovery. No simulation rerun is required.

## 4. Resource discovery and selection

The Agent should use an explicit resource supplied by the UI or just-created
managed workflow whenever available. Otherwise it inspects a bounded,
newest-first catalog:

```text
GET /api/analyzer/v1/sweeps?status=ready&limit=5
GET /api/analyzer/v1/sweeps/latest
```

Catalog entries expose stable opaque IDs plus the information required for a
decision: display name, ordered axes, run count, status, experiment date,
deployments, traces, and update time.

The Agent, not the backend, decides whether a candidate matches the user's
question. It must verify those fields; “latest” is only a shortcut to one newest
ready candidate. If several candidates remain plausible, the Agent presents or
asks about them instead of silently choosing.

The exact result is then read by ID:

```text
GET /api/analyzer/v1/sweeps/{sweep_id}/subjects/sweep/payload
```

## 5. Managed simulation lifecycle

```text
turn starts with capability
  -> Launcher expands and dry-runs the preset
  -> Launcher registers experiment root, axes, run count
  -> backend returns stable experimentId/jobId and approved root
  -> Launcher writes immutable experiment.meta.json
  -> simulation.running
  -> analysis.running
  -> experiment.ready | experiment.failed | experiment.interrupted
  -> Analyzer discovers the stable experimentId
```

`experiment.meta.json`, the workspace SQLite relationship, and Analyzer catalog
must agree on identity. Directory names remain human-facing provenance and are
never parsed into navigation identity.

Timing prediction, kernel profile, and kernel measurement use parallel typed
job lifecycles with their own Analyzer resource IDs. They do not masquerade as
simulation runs.

## 6. Same-workspace reuse

A ready Analyzer result may be used by any conversation or turn in the same
workspace. The conversation and turn that produced it remain provenance only.
Citation registration therefore validates:

1. the current capability and destination turn;
2. stable resource identity and payload identity;
3. resource ownership by the current workspace; and
4. ready state.

It does not require the current conversation or turn to be the producer.
Cross-workspace registration is rejected unless a future explicit
attachment/import contract is added.

## 7. Citation flow

For an already-open Analyzer surface, viz-ui sends the literal current selection
and a machine dictionary snapshot with the turn request. The prompt receives the
selection and a short instruction, not the verbose dictionary document.

For Agent-first or follow-up analysis:

```text
Agent reads exact sweep through Analyzer MCP
  -> MCP fetches full Analyzer payload internally
  -> MCP registers payload with current turn capability
  -> backend validates workspace ownership and ready state
  -> backend builds and persists token -> EvidenceRefV2 dictionary
  -> MCP joins raw values to tokens by target fields
  -> MCP returns compact resource + axes + metrics + rows
  -> Agent copies adjacent complete tokens into final Markdown
  -> backend freezes exact inline-code matches
  -> UI renders frozen citations
  -> user click navigates and highlights evidence
```

The compact response contains raw values once, their units/objectives once, and
one exact citation beside each value. It contains no navigation targets,
citation grammar document, duplicate raw payload, or instructions repeated per
row.

See [citation-dsl.md](citation-dsl.md) for the lexical and freezing contract.

## 8. MCP source modes

- `source="host"` reads the shared Analyzer service, including resources opened
  in viz-ui.
- `source="workspace"` reads an Analyzer process over the current Agent
  workspace when the result is not yet available from the shared host service.

Source is transport/location, not authorization. Both modes return the same
compact exact-sweep shape in managed turns and register citations against the
same workspace capability.

## 9. Shared UI shell

Existing-result and Agent-first entry points use the same `WorkspaceShell`:

- aggregate/run/prediction/profile/measurement Analyzer view on the result side;
- one shared Agent pane that can be docked, resized, folded to a spine, or
  expanded full-page;
- conversation history persists independently of the current Analyzer view;
- an empty conversation is materialized only when the first message is sent;
- changing Analyzer selection updates the next turn context but does not
  navigate or rewrite historical citations.
- A terminal Agent event carries `outcome=final_answer` or
  `outcome=request_user_input`. The latter is a blocking clarification state,
  not a completed answer, so the shared pane labels it `Input needed` and
  focuses the composer. Historical events without `outcome` default to
  `final_answer`.

Panel geometry belongs to the workspace UI store, not Analyzer selection state.
The Agent pane remains mounted through width transitions so expensive history
does not remount and charts resize coherently.

## 10. Failure and recovery semantics

- An idle stream returns `204`; it is not an error.
- A running turn reconnects through SSE and continues without requiring the
  frontend to stay open.
- Full runtime diagnostics remain in backend logs; the user sees a concise
  recoverable error.
- Pending, unavailable, failed, incompatible, and valid-empty Analyzer states
  are distinct and must not collapse into “0 records.”
- A stale frozen citation does not change the current Analyzer view; navigation
  returns `not-found` or `unavailable`.

## 11. Current citation scope

Aggregate, run, timing-prediction, kernel-profile, and kernel-measurement
`EvidenceRefV2` targets are implemented.
Timing prediction selection is resource-local and carries `predictionId`,
`caseId`, `operationId`, CostTree `leafId` / `parallelId`, the active optimality
mode, and the selected panel. It must never fall back to a previously visited
run or sweep selection. Prediction citations use `pred.*` tokens and navigate
back to that exact case/operation/panel in the shared workspace shell.

Kernel profile selections carry `profileId`, `panelId`, and `metricKey`; their
citations use `kprof.*`. Kernel measurement selections carry `measurementId`,
`panelId`, `metricKey`, and `plotName`; their citations use `kmeasure.*`.
Both navigate directly to their first-class Analyzer pages. Managed job identity
never appears in an evidence target and cannot be used as a result URL.

## 12. Acceptance checks

- Catalog discovery is newest-first and bounded when requested.
- The Agent can choose and inspect a result produced by another conversation in
  the same workspace.
- Cross-workspace citation registration fails.
- Exact sweep MCP responses contain compact citation-adjacent evidence and no
  target JSON or duplicate payload.
- Traditional Codex and CodexDS both copy valid tokens for the same questions.
- Historical citations retain frozen targets across selection changes and page
  refreshes.
- No navigation occurs before a user click.
