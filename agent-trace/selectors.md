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

- Pending primary-agent integration review.

## Feedback

- Pending primary-agent integration feedback.
