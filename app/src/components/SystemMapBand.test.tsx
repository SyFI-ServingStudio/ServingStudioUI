import { Profiler } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useActiveRun } from '../application/ActiveRunProvider';
import { REAL_RUNS } from '../data/realRunFixture';
import { useViz } from '../store';
import SystemMapBand from './SystemMapBand';

vi.mock('../application/ActiveRunProvider', () => ({ useActiveRun: vi.fn() }));

beforeEach(() => {
  vi.mocked(useActiveRun).mockReturnValue(REAL_RUNS[0]);
  useViz.setState({
    runId: REAL_RUNS[0].id,
    scope: 'cluster',
    poolRole: null,
    workerKey: null,
    leafId: null,
    parId: null,
    cursorMs: null,
    focus: null,
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

    const selectedRole = REAL_RUNS[0].topology.pools[0].role;
    fireEvent.click(screen.getByRole('button', { name: `Scope to pool ${selectedRole}` }));

    expect(useViz.getState()).toMatchObject({ scope: 'pool', poolRole: selectedRole });
    expect(onRender.mock.calls.length).toBeGreaterThan(initialRenderCount);
  });
});
