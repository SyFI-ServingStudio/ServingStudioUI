# VibeSim Citation DSL v2

This document defines how an Agent cites Analyzer evidence in natural language
and how a user click resolves that citation to an aggregate coordinate, metric,
or run panel.

## 1. User-visible form

The Agent writes a complete symbolic token as Markdown inline code next to the
claim it supports:

```md
At TP2 and 20 req/s, throughput is 30,124.2 tok/s.
`exp.tp2.rate20.throughput`
```

The conversation host freezes an exact allowlisted token to an
`EvidenceRefV2`. The UI renders only that frozen reference as a clickable
control. Text generation, streaming, hover, focus, and history restoration never
navigate the Analyzer; only a user click or keyboard activation does.

The Agent never writes a navigation URL, percent-encoded payload, target JSON,
or message-local `ev_1` indirection.

## 2. Selection, evidence, and navigation are separate

Resource discovery intentionally exposes Analyzer resource IDs. When the exact
resource is not already selected, the Agent may inspect a newest-first catalog:

```text
GET /api/analyzer/v1/sweeps?status=ready&limit=5
GET /api/analyzer/v1/sweeps/latest
```

The Agent compares display name, ordered axes, deployment, trace, status, and
time before choosing a `sweep_id`. “Latest” supplies one candidate; it does not
prove semantic relevance.

After selection, an exact managed sweep read returns a compact evidence block.
Each raw value is adjacent to its complete citation token:

```json
{
  "resource": {"id": "e_...", "name": "20260801_3_llama3_8b_tp"},
  "axes": ["tensor_parallel", "request_rate"],
  "metrics": {
    "total_tps": {
      "label": "Total throughput",
      "unit": "tok/s",
      "objective": "maximize",
      "citation": "exp.throughput"
    }
  },
  "rows": [
    {
      "coordinates": {"tensor_parallel": 2, "request_rate": 20},
      "values": {
        "total_tps": {
          "raw": 30124.2,
          "citation": "exp.tp2.rate20.throughput"
        }
      }
    }
  ]
}
```

The Agent copies a token whole. It never constructs one by joining axis aliases,
values, or metric names.

## 3. Ownership

| Stage | Owner | Responsibility |
| --- | --- | --- |
| Result discovery | Analyzer | Publish ordered catalogs and stable resource IDs |
| Resource choice | Agent or user | Choose the exact result that matches the question |
| Token generation | Conversation host | Build a bounded token-to-target dictionary from the exact Analyzer payload |
| Agent evidence | Analyzer MCP | Return compact raw values with adjacent complete tokens |
| Freezing | Conversation host | Resolve exact inline-code matches and persist immutable targets |
| Rendering | Conversation UI | Render frozen citations without interpreting token text |
| Activation | User | Explicitly request navigation by clicking |
| Navigation | Analyzer bridge | Send the frozen target and await acknowledgement |

The authorization boundary is the workspace. A current turn may cite any ready
Analyzer resource owned by the same workspace, including one produced by an
earlier conversation or turn. Producer conversation/turn identity is
provenance, not read authorization. Cross-workspace registration is rejected.

`source="host"` and `source="workspace"` choose where MCP reads data; they do
not change this ownership rule.

## 4. Lexical grammar

```ebnf
citation-source = "`", citation-token, "`" ;
citation-token  = namespace, ".", path ;
namespace       = "exp" | "run" | "pred" | "kprof" | "kmeasure" ;
path            = segment, { ".", segment } ;
segment         = letter, { letter | digit | "_" | "-" } ;
letter          = "a" … "z" ;
digit           = "0" … "9" ;
```

A token must:

- be lowercase and contain no whitespace or percent encoding;
- be at most 160 characters;
- occupy one complete single-backtick inline-code node; and
- exactly match the dictionary registered for that turn.

A grammar-valid but unpublished token remains ordinary inline code. The UI does
not scan prose, numbers, titles, IDs, or display names for fuzzy links.

## 5. Aggregate namespace

`exp` is bound when the dictionary is registered. The symbolic token omits the
opaque experiment ID; the frozen target contains it.

Panel-wide forms contain only the metric path:

```text
exp.throughput
exp.tpot.mean
```

Coordinate forms contain one complete member prefix followed by the metric:

```text
exp.tp2.rate20.throughput
exp.tp4.rate44p6.tpot.mean
```

Axis segments follow launcher declaration order. Compound sweep bindings remain
one axis member and are never expanded into a fictitious Cartesian product.
Segments such as `rate44p6` have no global parsing semantics; only the frozen
dictionary maps them to raw coordinates.

Metric paths come from registered Analyzer panels. Typical paths include
`throughput`, `utilization`, `ttft.mean`, `ttft.p99`, `tpot.mean`, and
`tpot.p99`, but only tokens issued for the exact payload are valid.

## 6. Run namespace

Run tokens address a frozen run panel or drill state, for example:

```text
run.cluster.throughput
run.cluster.utilization
run.worker.ffn_0.batch
run.kernel.leaf52.performance
```

The dictionary supplies every valid token. The host freezes workspace, run,
panel, scope, worker, operation, leaf, parallel branch, and cursor identity as
needed. A click never inherits missing dimensions from the current Analyzer
state.

## 7. Prediction and kernel namespaces

`pred` freezes a timing-prediction case, operation, CostTree node, optimality
mode, and panel. `kprof` freezes a profile curve metric, while `kmeasure`
freezes either a runtime summary metric or a declared plot:

```text
pred.casev40.batch_locked.optimality-breakdown
kprof.curve.time_ms
kmeasure.summary.median
kmeasure.plot.runtime_png
```

These are symbolic handles only. Their frozen targets carry `predictionId`,
`profileId`, or `measurementId` and navigate to the corresponding first-class
Analyzer route. Managed job IDs never appear in a citation target.

## 8. Registration and freezing

For an Agent-first exact sweep read:

```text
MCP fetches the full Analyzer payload internally
  -> current turn capability authenticates workspace and destination turn
  -> backend verifies the experiment is ready in that workspace
  -> backend builds and persists the dictionary on the current turn
  -> MCP joins payload values to dictionary targets by authoritative fields
  -> MCP returns only compact citation-adjacent evidence
```

The join uses `(metricKey, runId)` and target fields, never token parsing. It
fails atomically on missing or duplicate mappings and on an oversized response.

When final Markdown arrives, the conversation host:

1. finds complete single-backtick inline-code ranges;
2. accepts only exact tokens in the latest dictionary registered for that turn;
3. persists source range, display label, dictionary identity, and frozen
   `EvidenceRefV2`; and
4. leaves invalid or unpublished tokens as ordinary inline code.

Every follow-up turn that reports result values re-reads the exact resource and
registers a dictionary for that turn. Historical messages continue using their
already-frozen targets.

## 9. Derived claims

The compact evidence block is the numerical authority. A derived value may use
its raw values, but the answer must cite every source coordinate used and label
the result as derived. The Agent must not substitute `/api/jobs`, launcher
status, an implementer summary, or direct report-file parsing when the Analyzer
resource is ready.

Every resource family uses its own namespace. An Agent must never substitute an
`exp.*` token for a run, prediction, profile, or measurement.

## 10. Click semantics

Renderer behavior:

- display the frozen `displayLabel` rather than raw token text;
- reuse one footnote number for the same target within a message;
- provide native link/button keyboard semantics and the existing focus ring;
- send the stored target unchanged on activation; and
- wait for a matching navigation acknowledgement before marking it active.

If the artifact later disappears, the citation is stale rather than invalid.
Analyzer returns `not-found` or `unavailable`; the UI retains its current view
and shows a concise status.

## 11. Implementation boundaries

- Analyzer owns catalogs and result payloads.
- The conversation backend owns capability validation, dictionaries, frozen
  citations, and lifecycle/ownership overlays.
- MCP owns exact-resource reads and compact evidence projection; it does not
  recompute metrics.
- The Agent selects a published resource and copies published tokens.
- The frontend renders frozen citations and never reconstructs targets from DSL
  text or current UI state.
