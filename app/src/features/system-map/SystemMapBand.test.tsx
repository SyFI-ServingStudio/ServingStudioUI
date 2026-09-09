import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useActiveRun, useActiveRunModel } from '../../application/ActiveRunProvider';
import { assembleActiveRunCore } from '../../application/loadActiveRun';
import { useViz } from '../../store';
import { makeTestDescriptor, makeTestTopology } from '../../test/analyzerRepositoryFixture';
import SystemMapBand from './SystemMapBand';

vi.mock('../../application/ActiveRunProvider', () => ({
  useActiveRun: vi.fn(),
  useActiveRunModel: vi.fn(),
}));

const testRun = assembleActiveRunCore(
  makeTestDescriptor(),
  { totalTokS: 10, numGpus: 2, requestsFinished: 5 },
  makeTestTopology(),
).run;

beforeEach(() => {
  vi.mocked(useActiveRun).mockReturnValue(testRun);
  vi.mocked(useActiveRunModel).mockReturnValue({ status: 'not_generated' });
  useViz.setState({
    runId: testRun.id,
    scope: 'cluster',
    poolRole: null,
    workerKey: null,
    leafId: null,
    parId: null,
    cursorMs: null,
  });
});

describe('SystemMapBand store subscription', () => {
  it('does not re-render while an unrelated timeline cursor changes', () => {
    const onRender = vi.fn();
    render(
      <Profiler id="system-map" onRender={onRender}>
        <SystemMapBand />
      </Profiler>,
    );
    const initialRenderCount = onRender.mock.calls.length;

    act(() => useViz.setState({ cursorMs: 1_000 }));

    expect(onRender).toHaveBeenCalledTimes(initialRenderCount);

    const selectedRole = testRun.topology.pools[0].role;
    fireEvent.click(screen.getByRole('button', { name: `Scope to pool ${selectedRole}` }));

    expect(useViz.getState()).toMatchObject({ scope: 'pool', poolRole: selectedRole });
    expect(onRender.mock.calls.length).toBeGreaterThan(initialRenderCount);
  });

  it('adds model architecture facts without mutating topology', () => {
    vi.mocked(useActiveRunModel).mockReturnValue({
      status: 'ready',
      resource: {
        schemaVersion: 1,
        sourcePath: 'model/config/test.json',
        parameterCounts: null,
        config: { num_hidden_layers: 62, num_experts: 160, num_experts_per_tok: 8 },
      },
    });

    render(<SystemMapBand />);

    expect(screen.getAllByText('L=62')).toHaveLength(2);
    expect(screen.getAllByText('160E/8')).toHaveLength(2);
    expect(testRun.topology.pools[0].groups[0].arch.params.layers).toBeUndefined();
  });
});
