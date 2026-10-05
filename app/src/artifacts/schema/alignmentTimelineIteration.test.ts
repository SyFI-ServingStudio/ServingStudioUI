import { describe, expect, it } from 'vitest';

import timelineJson from '../../../e2e/fixtures/alignment/iterations/timeline_6.json';
import { parseAnalyzerV1AlignmentTimelineIteration } from './alignment';

describe('parseAnalyzerV1AlignmentTimelineIteration', () => {
  it('carries the Analyzer`s reference-rank occupancy for the wall-clock card', () => {
    const { referenceRank } = parseAnalyzerV1AlignmentTimelineIteration(timelineJson, 6);
    const wire = timelineJson.reference_rank;
    expect(referenceRank).toEqual({
      spanMs: wire.span_ms,
      idleFraction: wire.idle_fraction,
      gapCount: wire.gap_count,
      interPhaseMs: wire.inter_phase_ms,
      gaps: expect.any(Array),
      phases: expect.any(Array),
    });
    expect(referenceRank.gaps).toHaveLength(wire.gap_count);
    expect(referenceRank.gaps[0]).toEqual({
      startNs: wire.gaps_ns[0][0],
      endNs: wire.gaps_ns[0][1],
    });
    const forward = referenceRank.phases.find((phase) => phase.phase === 'forward');
    const wireForward = wire.phases.find((phase) => phase.phase === 'forward')!;
    expect(forward?.largestGaps[0]).toEqual({
      startNs: wireForward.largest_gaps[0].start_ns,
      durationUs: wireForward.largest_gaps[0].duration_us,
      afterOperation: wireForward.largest_gaps[0].after.operation,
      beforeOperation: wireForward.largest_gaps[0].before.operation,
    });
    expect(forward).toEqual({
      phase: 'forward',
      busyMs: wireForward.busy_ms,
      idleMs: wireForward.idle_ms,
      idleFraction: wireForward.idle_fraction,
      largestGaps: expect.any(Array),
    });
  });

  it('refuses a shard analysed before the Analyzer wrote the occupancy into it', () => {
    const { reference_rank: _dropped, ...older } = timelineJson;
    expect(() => parseAnalyzerV1AlignmentTimelineIteration(older, 6)).toThrow(/reference_rank/);
  });
});
