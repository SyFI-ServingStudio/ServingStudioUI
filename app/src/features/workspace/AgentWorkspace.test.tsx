import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import AgentPane, { AgentConversation } from './AgentWorkspace';
import { useViz } from '../../store';

describe('AgentConversation', () => {
  it('makes execution roles, handoffs, and evidence explicit', async () => {
    const user = userEvent.setup();
    const onEvidence = vi.fn();
    render(<AgentConversation prompt="Compare TP choices." onEvidence={onEvidence} />);

    expect(screen.getByText('Orchestrator')).toBeInTheDocument();
    expect(screen.getByText('Implementer')).toBeInTheDocument();
    expect(screen.getByText('Answer')).toBeInTheDocument();
    expect(screen.getByText('Orchestrator to Implementer')).toBeInTheDocument();
    expect(screen.getByText('Implementer to Orchestrator')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open Total throughput evidence' }));
    expect(onEvidence).toHaveBeenCalledOnce();
  });

  it('exposes fold and full-page controls in the pane header', async () => {
    const user = userEvent.setup();
    const onFold = vi.fn();
    const onToggleFull = vi.fn();
    render(
      <AgentPane
        prompt="Inspect the sweep."
        onEvidence={vi.fn()}
        onFold={onFold}
        onToggleFull={onToggleFull}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Expand Agent to full page' }));
    await user.click(screen.getByRole('button', { name: 'Fold Agent' }));

    expect(onToggleFull).toHaveBeenCalledOnce();
    expect(onFold).toHaveBeenCalledOnce();
  });

  it('reflects the active Analyzer selection above the composer', () => {
    act(() => {
      useViz.getState().setAggregateSelection({
        kind: 'aggregate',
        experimentId: 's_test',
        panelId: 'total_tps',
        metricKey: 'total_tps',
        coordinates: { request_rate: 20, tensor_parallel: 2 },
      });
    });
    render(<AgentPane prompt="Inspect the sweep." onEvidence={vi.fn()} showSelectionContext />);

    const context = screen.getByRole('status', { name: 'Active Analyzer selection' });
    expect(context).toHaveTextContent('aggregate');
    expect(context).toHaveTextContent('total_tps');
    expect(context).toHaveTextContent('request_rate=20');
    expect(context).toHaveTextContent('tensor_parallel=2');
  });
});
