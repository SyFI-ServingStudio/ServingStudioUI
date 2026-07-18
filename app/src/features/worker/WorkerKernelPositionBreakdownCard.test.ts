import { describe, expect, it } from 'vitest';

import { makeWorkerKey } from '../../domain/worker';
import { workerKernelPositionOption } from './workerKernelPositionOption';

describe('workerKernelPositionOption', () => {
  it('does not render a position label on its zero-valued family row', () => {
    const option = workerKernelPositionOption(
      {
        status: 'ready',
        workerKey: makeWorkerKey('attn', '4'),
        totalMs: 100,
        positionMixExact: true,
        sampledRows: 1,
        rawRows: 1,
        positions: [
          {
            position: 'afd.attn.decode',
            kind: 'flashinfer_attn_decode',
            timeMs: 98.5,
            sharePct: 98.5,
            color: '#123456',
          },
        ],
      },
      {
        status: 'ready',
        families: [{ group: 'attention', label: 'Attention', color: '#654321' }],
        rows: [{ label: 'attn/4', total: 100, byGroup: { attention: 100 } }],
        kernelTimeTotalsExact: true,
        positionMixExact: true,
        sampling: {
          positionMixExact: true,
          method: 'all rows',
          rawRows: 1,
          sampledRows: 1,
          maxReplayRowsTarget: 1,
        },
      },
    );
    const decodeSeries = (
      option.series as Array<{
        name: string;
        label: { formatter: (params: { value?: number }) => string };
      }>
    ).find((series) => series.name === 'afd.attn.decode');

    expect(decodeSeries?.label.formatter({ value: 0 })).toBe('');
    expect(decodeSeries?.label.formatter({ value: 98.5 })).toBe('decode\n98.5%');
  });
});
