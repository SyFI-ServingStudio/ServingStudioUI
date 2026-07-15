# Zustand Selector Tightening

## Summary

- Replaced every zero-argument `useViz()` subscription in the assigned system
  map, pool drill, cluster/pool stages, timeline, focus dialog, and iteration
  band with the narrowest scalar or stable-action selectors used by that view.
- Kept the existing `metricView(VizState)` and iteration projection contracts
  intact with memoized, type-complete selection snapshots that change only when
  their documented selection inputs change.
- Added a render-count regression proving timeline cursor updates do not
  re-render the system map, while a pool selection still updates the store and
  re-renders the map.

## Files

- `app/src/components/SystemMapBand.tsx`: subscribes only to map selection and
  drill actions.
- `app/src/components/WorkersInPool.tsx`: subscribes only to `selectWorker`.
- `app/src/components/stages/{ClusterStage,PoolStage}.tsx`: subscribes only to
  the four fields consumed by metric scope/cursor projection.
- `app/src/components/TimelineBand.tsx`: subscribes only to `cursorMs` and
  `setTime`.
- `app/src/components/FocusDialog.tsx`: subscribes only to `focus` and
  `closeFocus`.
- `app/src/components/IterationBand.tsx`: subscribes only to worker identity,
  cursor, and `setTime`.
- `app/src/components/SystemMapBand.test.tsx`: unrelated-update render-count and
  retained pool-drill behavior coverage.

## Validation

- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings.
- `npm run format:check`: passed.
- `npm run test:unit`: 25 files, 170 tests passed.
- Targeted `SystemMapBand.test.tsx`: passed.
- `git diff --check`: passed; no assigned-file zero-argument `useViz()` remains.

## Review

- Primary integration review confirmed the assigned files no longer subscribe
  to the whole store, action identities remain stable, and the Profiler test
  covers both the non-render and retained pool-selection behavior. Accepted
  without corrective code changes.
- The type-complete memoized snapshots are intentionally transitional. Once
  `runSelection` is touched after the CostTree merge, its helpers should accept
  an explicit four-field selection projection instead of a full `VizState`.
- Follow-up `1343797` completed that transition: `runSelection` and
  `metricView` now accept narrow structural/cursor projections, Cluster/Pool/
  Iteration no longer spread `useViz.getState()`, and the remaining App,
  CostTree, breadcrumb, worker, kernel, parallel, and time-share views use
  scalar/stable-action selectors. A production-code search now finds no
  zero-argument `useViz()` or manufactured full-store snapshot.

## Feedback

- The isolated branch applied cleanly after chart/trace integration and stayed
  within its declared files. A later removal of the legacy `REAL_RUNS` fixture
  should migrate the Profiler test to the application test repository rather
  than discard this regression coverage.
- The same follow-up also removed the synthetic-only gate around Perfetto, so a
  selected real HTTP run can render its descriptor-declared trace at cluster
  scope. TypeScript, ESLint, and all 212 merged unit tests passed afterward.
