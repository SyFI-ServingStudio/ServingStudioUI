import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import OperationSplitPicker from './operationSplitPicker';

const cycles = [
  {
    iterationId: 106,
    positionInCapture: 105,
    stage: 'decode',
    relativeDiffPct: 0.08,
  },
  {
    iterationId: 107,
    positionInCapture: 106,
    stage: 'decode',
    relativeDiffPct: -0.06,
  },
] as const;

describe('OperationSplitPicker', () => {
  it('makes a near-zero bar selectable across the whole picker body', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<OperationSplitPicker cycles={cycles} selectedIndex={0} onSelect={onSelect} />);

    const option = screen.getByRole('option', { name: /iteration 106/ });
    const optionStyle = getComputedStyle(option);
    expect(optionStyle.top).toBe('0px');
    expect(optionStyle.height).toBe('46px');

    const visualBar = option.firstElementChild;
    expect(visualBar).not.toBeNull();
    expect(getComputedStyle(visualBar as HTMLElement).pointerEvents).toBe('none');

    await user.click(option);
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});
