import { describe, expect, it } from 'vitest';

import timelineIndexJson from '../../../e2e/fixtures/alignment/payloads/alignment_timeline.json';
import { parseAnalyzerV1AlignmentTimelineIndex } from './alignment';

describe('parseAnalyzerV1AlignmentTimelineIndex', () => {
  it('keeps a Parallel cost-tree node apart from a rank Max', () => {
    const manifest = timelineIndexJson.sim_manifest;
    const nodes = [
      { Parallel: { overlap: 0.9, children: { start: 1, end: 3 } } },
      { Max: { overlap: 1, children: { start: 3, end: 4 } } },
      { Leaf: 0 },
      { Leaf: 1 },
    ];
    const { simNodes } = parseAnalyzerV1AlignmentTimelineIndex({
      ...timelineIndexJson,
      sim_manifest: { ...manifest, nodes },
    });
    expect(simNodes.slice(0, 2)).toEqual([
      { kind: 'parallel', overlap: 0.9, children: [1, 3] },
      { kind: 'max', overlap: 1, children: [3, 4] },
    ]);
  });
});
