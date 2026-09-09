import { Box, Skeleton, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import SurfaceCard from '../../components/SurfaceCard';
import type { AlignmentBreakdown, AlignmentIterationReport } from '../../domain/alignment';
import { tokens } from '../../theme';
import { fmtInt, fmtMs, fmtSignedMs, fmtSignedPct } from './format';
import OperationSplitCanvas from './operationSplitCanvas';
import {
  cycleFromBreakdown,
  MODELLED_SLOT_FIELD,
  type OperationSplitCycle,
} from './operationSplitCycles';
import {
  cycleOperationRows,
  criticalPathMeasuredGroups,
  divergingBars,
  plotGeometry,
  runOperationRows,
  selectableCycles,
  simulatedSlotRows,
  sortOperationRows,
  type OperationScope,
  type OperationSortKey,
} from './operationSplitModel';
import OperationSplitPicker from './operationSplitPicker';
import { operationPalette, withAlpha } from './operationSplitPalette';
import SubjectError from './SubjectError';

/**
 * §03 — one cycle, opened up.
 *
 * The card is layout and wiring only. Which cycles are offered, how the two
 * stacks fall on the axis, where the difference accumulates and how the rail
 * is ordered are all decided in `operationSplitModel`, so none of it has to be
 * read back out of a rendered card to be checked.
 *
 * Two selections drive everything: the cycle, held here because the picker
 * belongs to this section, and the operation, which dims both lanes, the
 * ribbons between them and the rail at once. That second one is why the rail
 * and the plot live in one card rather than beside each other.
 */

/** How many cycles the picker offers out of the capture. Enough to show the
 * shape of the run, few enough that a bar is still a target. */
const CYCLE_SAMPLE_SIZE = 50;

const SCOPES: readonly OperationScope[] = ['cycle', 'run'];
const SORTS: readonly { readonly key: OperationSortKey; readonly label: string }[] = [
  { key: 'delta', label: 'Δ ms' },
  { key: 'relative', label: 'Δ %' },
  { key: 'measured', label: 'measured' },
];

export default function OperationSplitCard({
  report,
  breakdown,
  breakdownLoading,
  breakdownError,
  selectedIterationId,
  onSelectIteration,
  prediction,
}: {
  report: AlignmentIterationReport;
  breakdown: AlignmentBreakdown | null;
  breakdownLoading: boolean;
  breakdownError: unknown;
  selectedIterationId: number | null;
  onSelectIteration: (iterationId: number) => void;
  /** Where the modelled stack came from, and how to get there. `null` when the
   * bundle names no prediction this Analyzer serves; the way through is then
   * left out rather than pointed somewhere else. */
  prediction: { readonly href: string; readonly displayName: string } | null;
}) {
  const cycles = useMemo(
    () => selectableCycles(report.iterations, CYCLE_SAMPLE_SIZE, selectedIterationId),
    [report.iterations, selectedIterationId],
  );
  const activeIndex =
    selectedIterationId === null
      ? cycles.length === 0
        ? -1
        : 0
      : cycles.findIndex((candidate) => candidate.iterationId === selectedIterationId);
  const activeCycle = activeIndex >= 0 ? cycles[activeIndex] : null;
  const cycle: OperationSplitCycle | null = useMemo(() => {
    if (
      activeCycle === null ||
      breakdown === null ||
      breakdown.iterationId !== activeCycle.iterationId
    ) {
      return null;
    }
    return cycleFromBreakdown(breakdown);
  }, [activeCycle, breakdown]);

  const palette = useMemo(
    () => operationPalette(report.mapping.operations),
    [report.mapping.operations],
  );
  const groups = useMemo(() => (cycle === null ? [] : criticalPathMeasuredGroups(cycle)), [cycle]);
  const slots = useMemo(
    () => (cycle === null ? [] : simulatedSlotRows(cycle.simulatedSlots)),
    [cycle],
  );
  const geometry = useMemo(
    () =>
      cycle === null ? null : plotGeometry(groups, slots, cycle.measuredMs, cycle.simulatedMs),
    [cycle, groups, slots],
  );

  const [scope, setScope] = useState<OperationScope>('cycle');
  const [sort, setSort] = useState<OperationSortKey>('delta');
  const [selectedOperation, setSelectedOperation] = useState<string | null>(null);
  useEffect(() => setSelectedOperation(null), [selectedIterationId]);
  const activeScope: OperationScope = cycle === null ? 'run' : scope;
  const rows = useMemo(() => {
    const unsorted =
      activeScope === 'cycle' && cycle !== null
        ? cycleOperationRows(cycle, palette)
        : runOperationRows(report.operations, palette);
    return sortOperationRows(unsorted, sort);
  }, [activeScope, cycle, palette, report.operations, sort]);
  const bars = useMemo(() => divergingBars(rows), [rows]);

  return (
    <SurfaceCard sx={{ overflow: 'hidden' }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          gap: 1.75,
          flexWrap: 'wrap',
          p: '12px 16px 11px',
          borderBottom: `1px solid ${tokens.hair}`,
        }}
      >
        <Typography
          component="h3"
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 15.5,
            m: 0,
            letterSpacing: '-.01em',
          }}
        >
          {activeCycle === null
            ? 'Measured stack against modelled stack'
            : `Iteration ${fmtInt(activeCycle.iterationId)} · ${activeCycle.stage} · measured stack against modelled stack`}
        </Typography>
        <Stack direction="row" alignItems="center" sx={{ gap: 1.5, flexWrap: 'wrap' }}>
          <Typography
            sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub, whiteSpace: 'nowrap' }}
          >
            {fmtInt(cycles.length)} of {fmtInt(report.meta.iterations)} cycles selectable · modelled
            slot value = {MODELLED_SLOT_FIELD}
          </Typography>
          {prediction === null ? null : (
            <Box
              component="a"
              href={prediction.href}
              // Named, because a bundle holds several timing-predict directories
              // once its capture has been re-analysed and the stack drawn here
              // came out of exactly one of them.
              aria-label={`Open the timing prediction this comparison was made against: ${prediction.displayName}`}
              title={prediction.displayName}
              sx={{
                fontFamily: tokens.body,
                fontSize: 12,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                textDecoration: 'none',
                color: tokens.teal,
                border: `1px solid ${tokens.hair}`,
                borderRadius: 1.5,
                p: '5px 10px',
                whiteSpace: 'nowrap',
                '&:hover': { borderColor: withAlpha(tokens.teal, 0.42) },
              }}
            >
              the timing-predict page →
            </Box>
          )}
        </Stack>
      </Stack>

      <Box sx={{ p: '9px 14px 4px', borderBottom: `1px solid ${tokens.hair}` }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          sx={{
            gap: 1.5,
            flexWrap: 'wrap',
            p: '0 2px 2px',
            fontFamily: tokens.body,
            fontSize: 12,
            color: tokens.sub2,
          }}
        >
          <Box component="span">
            {activeCycle === null ? null : (
              <>
                iteration{' '}
                <Box component="b" sx={{ color: tokens.ink }}>
                  {fmtInt(activeCycle.iterationId)}
                </Box>{' '}
                · {activeCycle.stage} · {fmtSignedPct(activeCycle.relativeDiffPct)}
                {cycle === null
                  ? null
                  : ` · cross-stream overlap evidence ${fmtMs(cycle.concurrentHiddenMs)} · unmapped path ${fmtMs(cycle.unmappedMeasuredMs)}`}
              </>
            )}
          </Box>
          <Box component="span">
            pick a cycle · <Key>←</Key> <Key>→</Key> step · <Key>home</Key> <Key>end</Key>
          </Box>
        </Stack>
        <OperationSplitPicker
          cycles={cycles}
          selectedIndex={activeIndex}
          onSelect={(index) => {
            const selectedCycle = cycles[index];
            if (selectedCycle !== undefined) onSelectIteration(selectedCycle.iterationId);
          }}
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0,1fr) minmax(262px,.3fr)' },
        }}
      >
        <Box sx={{ p: '6px 8px 4px', minWidth: 0, overflow: 'hidden' }}>
          {geometry !== null && cycle !== null && activeCycle !== null ? (
            <OperationSplitCanvas
              geometry={geometry}
              groups={groups}
              slots={slots}
              measuredTotalMs={cycle.measuredMs}
              simulatedTotalMs={cycle.simulatedMs}
              relativeDiffPct={activeCycle.relativeDiffPct}
              palette={palette}
              selectedOperation={selectedOperation}
              onSelectOperation={setSelectedOperation}
              ariaLabel={`Iteration ${fmtInt(activeCycle.iterationId)}: measured kernel stack, modelled slot stack and their cumulative difference`}
            />
          ) : breakdownError !== null && breakdownError !== undefined ? (
            <SubjectError error={breakdownError} />
          ) : breakdownLoading ? (
            <Skeleton variant="rounded" height={300} />
          ) : (
            <Typography
              sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub, p: '24px 8px' }}
            >
              This bundle serves no per-cycle kernel detail.
            </Typography>
          )}
        </Box>

        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            borderLeft: { lg: `1px solid ${tokens.hair}` },
            borderTop: { xs: `1px solid ${tokens.hair}`, lg: 'none' },
          }}
        >
          <Stack sx={{ gap: 0.5, p: '10px 12px 9px', borderBottom: `1px solid ${tokens.hair}` }}>
            <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
              {SCOPES.map((key) => (
                <Chip
                  key={key}
                  pressed={activeScope === key}
                  disabled={key === 'cycle' && cycle === null}
                  onClick={() => setScope(key)}
                >
                  {key === 'cycle' && activeCycle !== null
                    ? `iteration ${fmtInt(activeCycle.iterationId)}`
                    : 'whole run'}
                </Chip>
              ))}
            </Stack>
            <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
              {SORTS.map(({ key, label }) => (
                <Chip key={key} pressed={sort === key} onClick={() => setSort(key)}>
                  {label}
                </Chip>
              ))}
            </Stack>
          </Stack>
          <Stack
            sx={{
              flex: '1 1 0',
              minHeight: 210,
              gap: '3px',
              p: '10px 12px 12px',
              overflow: 'auto',
            }}
          >
            {rows.map((row, index) => (
              <Box
                key={row.operation}
                component="button"
                type="button"
                aria-pressed={row.operation === selectedOperation}
                onClick={() =>
                  setSelectedOperation(row.operation === selectedOperation ? null : row.operation)
                }
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '11px minmax(0,1fr) 70px',
                  gap: '9px',
                  alignItems: 'center',
                  width: '100%',
                  border: 0,
                  background: row.operation === selectedOperation ? tokens.leafbg : 'transparent',
                  boxShadow:
                    row.operation === selectedOperation ? `inset 2px 0 0 ${row.color}` : 'none',
                  opacity:
                    selectedOperation !== null && row.operation !== selectedOperation ? 0.42 : 1,
                  font: 'inherit',
                  color: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  p: '4px 7px',
                  borderRadius: '7px',
                  '&:hover': { background: withAlpha(tokens.ink, 0.04) },
                }}
              >
                <Box
                  aria-hidden="true"
                  sx={{ width: 11, height: 11, borderRadius: '3px', background: row.color }}
                />
                <Box sx={{ minWidth: 0 }}>
                  <Box
                    sx={{
                      fontFamily: tokens.body,
                      fontSize: 12,
                      color: tokens.ink,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.shortName}
                  </Box>
                  <Box
                    sx={{
                      fontFamily: tokens.body,
                      fontSize: 12,
                      color: tokens.sub2,
                      mt: '1px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.pairings === null ? null : `${fmtInt(row.pairings)} × `}
                    {fmtMs(row.measuredMs)} → {fmtMs(row.simulatedMs)}
                  </Box>
                  <Box
                    aria-hidden="true"
                    sx={{
                      position: 'relative',
                      height: 4,
                      mt: '3px',
                      borderRadius: '3px',
                      background: tokens.tile2,
                      border: `1px solid ${tokens.hair}`,
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      sx={{
                        position: 'absolute',
                        left: '50%',
                        top: 0,
                        bottom: 0,
                        width: '1px',
                        background: tokens.sub2,
                        opacity: 0.5,
                      }}
                    />
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${bars[index].leftPct}%`,
                        width: `${bars[index].widthPct}%`,
                        borderRadius: '2px',
                        background: bars[index].overpredicted ? tokens.terra : tokens.teal,
                      }}
                    />
                  </Box>
                </Box>
                <Box>
                  <Box
                    sx={{
                      fontFamily: tokens.body,
                      fontSize: 12,
                      textAlign: 'right',
                      color: row.deltaMs >= 0 ? tokens.terra : tokens.teal,
                    }}
                  >
                    {row.relativeDiffPct === null ? '—' : fmtSignedPct(row.relativeDiffPct)}
                  </Box>
                  <Box
                    sx={{
                      fontFamily: tokens.body,
                      fontSize: 12,
                      color: tokens.sub2,
                      textAlign: 'right',
                      mt: '1px',
                    }}
                  >
                    {fmtSignedMs(row.deltaMs)}
                  </Box>
                </Box>
              </Box>
            ))}
          </Stack>
        </Box>
      </Box>
    </SurfaceCard>
  );
}

/** A keycap in the picker's hint line. */
function Key({ children }: { children: ReactNode }) {
  return (
    <Box
      component="kbd"
      sx={{
        fontFamily: tokens.body,
        fontSize: 12,
        border: `1px solid ${tokens.hair}`,
        borderRadius: '4px',
        p: '1px 4px',
        background: tokens.leafbg,
        color: tokens.sub,
      }}
    >
      {children}
    </Box>
  );
}

function Chip({
  pressed,
  disabled = false,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      sx={{
        appearance: 'none',
        cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${pressed ? withAlpha(tokens.teal, 0.42) : tokens.hair}`,
        background: pressed ? withAlpha(tokens.teal, 0.07) : 'transparent',
        color: pressed ? tokens.teal : tokens.sub,
        opacity: disabled ? 0.45 : 1,
        fontFamily: tokens.body,
        fontSize: 12,
        p: '4px 10px',
        borderRadius: '6px',
        '&:hover': disabled ? {} : { borderColor: tokens.sub2, color: tokens.ink },
      }}
    >
      {children}
    </Box>
  );
}
