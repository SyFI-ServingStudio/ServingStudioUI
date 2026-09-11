import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Shell from './Shell';

describe('Shell', () => {
  it('keeps the injected Agent mounted through fold/full transitions and preserves resize controls', () => {
    const onOpenAgent = vi.fn();
    render(
      <Shell
        title="Llama throughput"
        detail="4 runs"
        agentOpen
        onBack={() => undefined}
        onOpenAgent={onOpenAgent}
        agent={({ expanded, onToggleFull }) => (
          <aside data-testid="agent-surface" data-expanded={expanded ? 'true' : 'false'}>
            <button type="button" onClick={onToggleFull}>
              {expanded ? 'Return Agent to split view' : 'Expand Agent to full page'}
            </button>
          </aside>
        )}
      >
        <main data-testid="result-content">result</main>
      </Shell>,
    );

    expect(screen.getByText('Llama throughput')).toBeVisible();
    expect(screen.getByText('4 runs')).toBeVisible();
    const surface = screen.getByTestId('agent-surface');
    const separator = screen.getByRole('separator', { name: 'Resize Agent panel' });
    expect(separator).toHaveAttribute('aria-valuenow', '410');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '434');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '320');

    fireEvent.click(screen.getByRole('button', { name: 'Fold Agent' }));
    expect(screen.getByTestId('chat-dock')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open Agent' }));
    expect(screen.getByTestId('agent-surface').isSameNode(surface)).toBe(true);
    expect(onOpenAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Expand Agent to full page' }));
    expect(screen.getByTestId('agent-surface').isSameNode(surface)).toBe(true);
    expect(screen.getByTestId('agent-surface')).toHaveAttribute('data-expanded', 'true');
    expect(screen.getByTestId('result-content')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Return Agent to split view' }));
    expect(screen.getByTestId('result-content')).toBeVisible();
  });
});
