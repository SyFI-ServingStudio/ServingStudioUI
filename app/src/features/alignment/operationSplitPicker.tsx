import { Box } from '@mui/material';
import { useId, useMemo } from 'react';

import { tokens } from '../../theme';
import { fmtInt, fmtSignedPct } from './format';
import {
  CYCLE_PICKER,
  pickerGeometry,
  steppedCycleIndex,
  type CycleChoice,
} from './operationSplitModel';
import { withAlpha } from './operationSplitPalette';

/**
 * The cycle picker: one visual bar per offered cycle, its height that cycle's
 * error. Each option owns the whole picker body as its hit target; otherwise a
 * near-zero error would leave only a one-pixel-high target to click.
 *
 * DOM blocks rather than a drawing, because this is a control before it is a
 * chart. As a listbox it arrives with the arrow, home and end keys, a focus
 * ring and a name for each option; the same thing painted would need every one
 * of those rebuilt by hand and would still be invisible to a screen reader.
 *
 * Horizontal positions are percentages so the row follows the card's width,
 * while the vertical design space stays fixed: the bars encode a signed
 * percentage against a zero line, and a zero line that moved with the viewport
 * would make two screenshots of one capture disagree.
 */

const PICKER_BODY_HEIGHT = 46;
const PICKER_LABEL_HEIGHT = 12;
const SELECTION_FRAME_PAD = 2.6;

export default function OperationSplitPicker({
  cycles,
  selectedIndex,
  onSelect,
}: {
  cycles: readonly CycleChoice[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const listId = useId();
  const geometry = useMemo(() => pickerGeometry(cycles, selectedIndex), [cycles, selectedIndex]);
  const toPercent = (value: number): string => `${(value / CYCLE_PICKER.width) * 100}%`;
  const scaleY = PICKER_BODY_HEIGHT / CYCLE_PICKER.height;
  const optionId = (index: number): string => `${listId}-cycle-${index}`;

  return (
    <Box>
      <Box
        role="listbox"
        tabIndex={0}
        aria-label="cycle picker: bar height is that cycle's modelled minus measured, in percent"
        aria-activedescendant={selectedIndex >= 0 ? optionId(selectedIndex) : undefined}
        onKeyDown={(event) => {
          const next = steppedCycleIndex(selectedIndex, cycles.length, event.key);
          if (next === null) return;
          event.preventDefault();
          onSelect(next);
        }}
        sx={{
          position: 'relative',
          height: PICKER_BODY_HEIGHT,
          cursor: 'pointer',
          borderRadius: 1,
          '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 3 },
        }}
      >
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: geometry.zeroY * scaleY,
            borderTop: `1px dashed ${tokens.sub2}`,
          }}
        />
        {geometry.bars.map((bar) => {
          const cycle = cycles[bar.index];
          const chosen = bar.index === selectedIndex;
          return (
            <Box
              key={cycle.iterationId}
              id={optionId(bar.index)}
              role="option"
              aria-selected={chosen}
              title={`iteration ${fmtInt(cycle.iterationId)} · ${cycle.stage} · ${fmtSignedPct(cycle.relativeDiffPct)}`}
              onClick={() => onSelect(bar.index)}
              sx={{
                position: 'absolute',
                left: toPercent(bar.x - SELECTION_FRAME_PAD),
                width: toPercent(bar.width + SELECTION_FRAME_PAD * 2),
                top: 0,
                height: PICKER_BODY_HEIGHT,
                borderRadius: 1,
                background: chosen ? withAlpha(tokens.teal, 0.1) : 'transparent',
                border: chosen
                  ? `1px solid ${withAlpha(tokens.teal, 0.45)}`
                  : '1px solid transparent',
                cursor: 'pointer',
                zIndex: 1,
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  position: 'absolute',
                  left: `${(SELECTION_FRAME_PAD / (bar.width + SELECTION_FRAME_PAD * 2)) * 100}%`,
                  right: `${(SELECTION_FRAME_PAD / (bar.width + SELECTION_FRAME_PAD * 2)) * 100}%`,
                  top: bar.y * scaleY,
                  height: Math.max(1, bar.height * scaleY),
                  borderRadius: '1.5px',
                  background: bar.overpredicted ? tokens.terra : tokens.teal,
                  // Selection owns the full-height frame above; it must not
                  // erase the error distribution the picker is for.
                  opacity: 1,
                  pointerEvents: 'none',
                }}
              />
            </Box>
          );
        })}
      </Box>
      <Box aria-hidden="true" sx={{ position: 'relative', height: PICKER_LABEL_HEIGHT }}>
        {geometry.bars
          .filter((bar) => bar.ticked)
          .map((bar) => (
            <Box
              key={cycles[bar.index].iterationId}
              sx={{
                position: 'absolute',
                left: toPercent(bar.labelX),
                transform: 'translateX(-50%)',
                fontFamily: tokens.mono,
                fontSize: 9.5,
                lineHeight: 1,
                whiteSpace: 'nowrap',
                color: bar.index === selectedIndex ? tokens.teal : tokens.sub2,
                fontWeight: bar.index === selectedIndex ? 600 : 400,
              }}
            >
              {fmtInt(cycles[bar.index].iterationId)}
            </Box>
          ))}
      </Box>
    </Box>
  );
}
