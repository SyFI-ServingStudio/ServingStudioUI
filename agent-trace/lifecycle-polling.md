# Analyzer Lifecycle Polling

## Summary

- Added a pure descriptor polling policy shared by React Query hooks and tests.
- Catalog discovery conditionally refreshes every 30 seconds while foregrounded.
- Selected descriptors refresh every 2 seconds only while simulation or analysis
  is pending; `not_started` uses the bounded 30-second cadence, while complete or
  failed stages stop timer polling.
- Catalog and descriptor queries refetch on window focus and continue to reuse
  the HTTP repository's ETag / `If-None-Match` / `304` cache path.

## Review

The 30-second `not_started` cadence covers the simulation-complete → analyzer
sidecar hand-off without turning intentional `--no-analyze` runs into permanent
2-second polling. A failure wins over malformed mixed lifecycle states and only
explicit focus/invalidation retries it.

After integration with the strict CostTree/provider changes, formatting,
TypeScript, ESLint, fixture verification, 29 test files / 212 tests, production
build, and size limits all passed. The merged bundle is 383.36 kB gzip initially
and 503.71 kB across all JavaScript chunks.

## Feedback

Keep lifecycle cadence policy transport-independent. Future push/SSE support can
invalidate the same query keys; it should not duplicate descriptor state or
bypass ETag validation inside `HttpAnalyzerRepository`.
