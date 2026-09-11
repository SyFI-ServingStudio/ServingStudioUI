import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MarkdownBody from './MarkdownBody';

describe('MarkdownBody navigation boundary', () => {
  it('shows only the final reference label while retaining its full description and target', () => {
    const target = { kind: 'prediction', predictionId: 'p_one', caseId: 0, operationId: 0 };
    const onOpenEvidence = vi.fn();
    const displayLabel = 'prediction p_one · case 0 · operation 0 · cost-tree';
    render(
      <MarkdownBody
        text="See `pred.result`."
        citations={[
          { token: 'pred.result', sourceStart: 4, sourceEnd: 17, displayLabel, target },
        ]}
        onOpenEvidence={onOpenEvidence}
      />,
    );
    const reference = screen.getByRole('button', { name: 'cost-tree 1' });
    expect(reference).toHaveAttribute('title', `${displayLabel} (pred.result)`);
    expect(reference).not.toHaveTextContent('prediction p_one');
    fireEvent.click(reference);
    expect(onOpenEvidence).toHaveBeenCalledWith(target, expect.any(Function));
  });

  it('reports a citation click to its caller and renders the returned status', () => {
    const target = { kind: 'run', id: 'r_one' };
    const onOpenEvidence = vi.fn((_target, onStatus) => onStatus('unavailable'));
    render(
      <MarkdownBody
        text="See `run.result`."
        citations={[
          {
            token: 'run.result',
            sourceStart: 4,
            sourceEnd: 16,
            displayLabel: 'run result',
            target,
          },
        ]}
        onOpenEvidence={onOpenEvidence}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /run result/ }));

    expect(onOpenEvidence).toHaveBeenCalledWith(target, expect.any(Function));
    expect(screen.getByRole('button', { name: /run result/ })).toHaveAttribute(
      'title',
      'Evidence is not ready',
    );
  });

  it('delegates workspace file links without changing their visual element', () => {
    const onOpenFile = vi.fn();
    render(
      <MarkdownBody
        text="[source](simulator/src/main.rs:42)"
        citations={[]}
        workspaceId="w_main"
        onOpenFile={onOpenFile}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'source' }));

    expect(onOpenFile).toHaveBeenCalledWith('w_main', 'simulator/src/main.rs', 42);
  });
});
