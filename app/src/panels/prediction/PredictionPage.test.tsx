import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Artifacts from '../../artifacts';

const fixture = vi.hoisted(() => ({
  reads: new Map<string, unknown>(),
  refs: [] as { kind: string; offset?: number }[],
}));

vi.mock('../../artifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof Artifacts>()),
  useArtifact: (ref: { kind: string; offset?: number }) => {
    fixture.refs.push(ref);
    return fixture.reads.get(`${ref.kind}:${ref.offset ?? ''}`) ?? fixture.reads.get(ref.kind);
  },
}));

import type { Location } from '../../location';
import { PredictionPage } from './PredictionPage';

const LOCATION: Extract<Location, { view: 'result' }> = {
  view: 'result',
  ref: { kind: 'prediction', id: 'p_one', workspace: 'w_main' },
  focus: { path: [], cursorMs: null, panel: null, options: { optimality: 'unlocked' } },
  chat: null,
};

describe('PredictionPage Location selection', () => {
  beforeEach(() => {
    fixture.reads.clear();
    fixture.refs.length = 0;
  });

  it('commits the first available case before reading dependent artifacts', async () => {
    fixture.reads.set('predictionDescriptor', {
      status: 'ready',
      schemaVersion: 1,
      revision: 'r1',
      value: {
        predictionId: 'p_one',
        displayName: 'Llama timing prediction',
        selector: 'iter',
        archType: 'llama',
        gpu: { name: 'H100', count: 8 },
        caseCount: 1,
        lifecycle: { prediction: 'complete', analysis: 'complete' },
        kernelInputDistributionAvailable: false,
      },
    });
    fixture.reads.set('predictionCases', {
      status: 'ready',
      schemaVersion: 1,
      revision: 'r1',
      value: {
        predictionId: 'p_one',
        offset: 0,
        total: 1,
        cases: [
          {
            caseId: '0',
            input: { decode_count: 4 },
            totalTimeMs: 2.5,
            operations: [{ operationId: '0', section: 'attn', layer: 0, timeMs: 2.5 }],
          },
        ],
      },
    });
    const navigate = vi.fn();

    render(<PredictionPage location={LOCATION} navigate={navigate} />);

    expect(screen.getByText('Timing prediction')).toBeVisible();
    expect(screen.getByText('Llama timing prediction')).toBeVisible();
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          focus: expect.objectContaining({ path: [{ at: 'case', id: '0' }] }),
        }),
        'replace',
      );
    });
    expect([...fixture.reads.keys()]).toEqual(['predictionDescriptor', 'predictionCases']);
  });

  it('derives the requested page from a replacement Location', () => {
    fixture.reads.set('predictionDescriptor', {
      status: 'ready',
      schemaVersion: 1,
      revision: 'r1',
      value: {
        predictionId: 'p_one',
        displayName: 'Llama timing prediction',
        selector: 'iter',
        archType: 'llama',
        gpu: { name: 'H100', count: 8 },
        caseCount: 128,
        lifecycle: { prediction: 'complete', analysis: 'complete' },
        kernelInputDistributionAvailable: false,
      },
    });
    for (const offset of [0, 64]) {
      fixture.reads.set(`predictionCases:${offset}`, {
        status: 'ready',
        schemaVersion: 1,
        revision: 'r1',
        value: { predictionId: 'p_one', offset, total: 128, cases: [] },
      });
    }
    const navigate = vi.fn();
    const { rerender } = render(
      <PredictionPage
        location={{ ...LOCATION, focus: { ...LOCATION.focus, path: [{ at: 'case', id: '0' }] } }}
        navigate={navigate}
      />,
    );
    rerender(
      <PredictionPage
        location={{ ...LOCATION, focus: { ...LOCATION.focus, path: [{ at: 'case', id: '65' }] } }}
        navigate={navigate}
      />,
    );
    expect(fixture.refs.filter((ref) => ref.kind === 'predictionCases').at(-1)?.offset).toBe(64);
  });
});
