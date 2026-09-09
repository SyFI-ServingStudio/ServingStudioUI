import { Box, ButtonBase, Typography } from '@mui/material';
import { useMemo } from 'react';

import type { SweepAnalysis, SweepMetric, SweepRun } from '../../domain/sweep';
import { tokens, withAlpha } from '../../theme';
import {
  coordinateLabel,
  runCoordinateKey,
  SWEEP_OUTCOME_SCALE,
  sweepMetricBounds,
  sweepMetricDisplayValue,
  type SweepFacet,
} from './sweepOption';

function coordinatePairKey(xValue: unknown, yValue: unknown): string {
  return `${JSON.stringify(xValue)}|${JSON.stringify(yValue)}`;
}

function outcomeColor(
  metric: SweepMetric,
  displayedValue: number,
  minimum: number,
  maximum: number,
): string {
  const normalized = maximum === minimum ? 0.5 : (displayedValue - minimum) / (maximum - minimum);
  const betterNormalized = metric.objective === 'minimize' ? 1 - normalized : normalized;
  const colorIndex = Math.round(
    Math.max(0, Math.min(1, betterNormalized)) * (SWEEP_OUTCOME_SCALE.length - 1),
  );
  return SWEEP_OUTCOME_SCALE[colorIndex]!;
}

function cellValueLabel(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function chartEventData(analysis: SweepAnalysis, run: SweepRun) {
  return {
    data: {
      runId: run.runId,
      runKey: runCoordinateKey(analysis, run),
      coordinates: run.coordinates,
    },
  };
}

/**
 * A two-axis sweep is a small categorical matrix, so native layout is both
 * clearer and cheaper than asking multiple chart engines to recompute SVG
 * scenes during every workspace-width frame.
 */
export default function SweepHeatmap({
  analysis,
  metric,
  facet,
  selectedRunKey,
  ariaLabel,
  height,
  onCellClick,
  onCellDoubleClick,
}: {
  analysis: SweepAnalysis;
  metric: SweepMetric;
  facet: SweepFacet;
  selectedRunKey: string | null;
  ariaLabel: string;
  height: number;
  onCellClick: (event: unknown) => void;
  onCellDoubleClick: (event: unknown) => void;
}) {
  const xAxisName = analysis.axes[0]!;
  const yAxisName = analysis.axes[1]!;
  const xDomain = analysis.domains[xAxisName] ?? [];
  const yDomain = analysis.domains[yAxisName] ?? [];
  const displayedYDomain = [...yDomain].reverse();
  const [minimum, maximum] = sweepMetricBounds(metric, analysis.runs);
  const runsByCoordinate = useMemo(
    () =>
      new Map(
        facet.runs.map((run) => [
          coordinatePairKey(run.coordinates[xAxisName], run.coordinates[yAxisName]),
          run,
        ]),
      ),
    [facet.runs, xAxisName, yAxisName],
  );
  const betterAtTop = metric.objective !== 'minimize';
  const legendColors = betterAtTop ? [...SWEEP_OUTCOME_SCALE].reverse() : [...SWEEP_OUTCOME_SCALE];

  return (
    <Box
      role="img"
      aria-label={ariaLabel}
      sx={{
        height,
        minWidth: 0,
        display: 'grid',
        gridTemplateColumns: '18px max-content minmax(0,1fr) 42px',
        gridTemplateRows: 'minmax(0,1fr) 22px 26px',
        columnGap: 0.65,
      }}
    >
      <Typography
        sx={{
          gridColumn: 1,
          gridRow: 1,
          alignSelf: 'center',
          justifySelf: 'center',
          color: tokens.ink,
          fontFamily: tokens.body,
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1,
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
        }}
      >
        {yAxisName}
      </Typography>
      <Box
        sx={{
          gridColumn: 2,
          gridRow: 1,
          display: 'grid',
          gridTemplateRows: `repeat(${Math.max(1, displayedYDomain.length)}, minmax(0,1fr))`,
          alignItems: 'center',
        }}
      >
        {displayedYDomain.map((value) => (
          <Typography
            key={JSON.stringify(value)}
            sx={{
              pr: 0.2,
              color: tokens.ink,
              fontFamily: tokens.body,
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1,
              textAlign: 'right',
            }}
          >
            {coordinateLabel(value)}
          </Typography>
        ))}
      </Box>
      <Box
        sx={{
          gridColumn: 3,
          gridRow: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(1, xDomain.length)}, minmax(0,1fr))`,
          gridTemplateRows: `repeat(${Math.max(1, displayedYDomain.length)}, minmax(0,1fr))`,
          gap: '3px',
          borderBottom: `1px solid ${tokens.hair}`,
          borderLeft: `1px solid ${tokens.hair}`,
        }}
      >
        {displayedYDomain.flatMap((yValue) =>
          xDomain.map((xValue) => {
            const run = runsByCoordinate.get(coordinatePairKey(xValue, yValue));
            const rawValue = run?.metrics[metric.key];
            if (!run || rawValue === null || rawValue === undefined) {
              return (
                <Box
                  key={coordinatePairKey(xValue, yValue)}
                  aria-hidden="true"
                  sx={{ minWidth: 0, minHeight: 0, background: `${withAlpha(tokens.sub, 0.045)}` }}
                />
              );
            }
            const displayedValue = sweepMetricDisplayValue(metric, rawValue);
            const runKey = runCoordinateKey(analysis, run);
            const selected = runKey === selectedRunKey;
            return (
              <ButtonBase
                key={coordinatePairKey(xValue, yValue)}
                aria-pressed={selected}
                aria-label={`${metric.label}, ${xAxisName} ${coordinateLabel(xValue)}, ${yAxisName} ${coordinateLabel(yValue)}, ${cellValueLabel(displayedValue)} ${metric.unit}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCellClick(chartEventData(analysis, run));
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onCellDoubleClick(chartEventData(analysis, run));
                }}
                sx={{
                  minWidth: 0,
                  minHeight: 0,
                  borderRadius: 0.65,
                  background: outcomeColor(metric, displayedValue, minimum, maximum),
                  color: tokens.ink,
                  fontFamily: tokens.body,
                  fontSize: 12,
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  boxShadow: selected
                    ? `inset 0 0 0 3px ${tokens.teal}, 0 0 12px ${withAlpha(tokens.teal, 0.42)}`
                    : 'none',
                  zIndex: selected ? 2 : 1,
                  transition: `box-shadow 160ms ${tokens.ease}, filter 160ms ${tokens.ease}`,
                  '&:hover': { filter: 'saturate(1.08) brightness(.98)' },
                  '&:focus-visible': {
                    outline: `3px solid ${tokens.teal}`,
                    outlineOffset: -3,
                    zIndex: 3,
                  },
                }}
              >
                {cellValueLabel(displayedValue)}
              </ButtonBase>
            );
          }),
        )}
      </Box>
      <Box
        aria-hidden="true"
        sx={{
          gridColumn: 4,
          gridRow: 1,
          alignSelf: 'center',
          justifySelf: 'center',
          height: 122,
          display: 'grid',
          gridTemplateColumns: '9px max-content',
          gridTemplateRows: '15px 92px 15px',
          columnGap: 0.45,
        }}
      >
        <Box
          sx={{
            gridColumn: 1,
            gridRow: '2',
            borderRadius: 0.5,
            background: `linear-gradient(to bottom, ${legendColors.join(',')})`,
          }}
        />
        <Typography
          sx={{
            gridColumn: 2,
            gridRow: 1,
            alignSelf: 'end',
            color: tokens.sub,
            fontFamily: tokens.body,
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          {betterAtTop ? 'better' : 'worse'}
        </Typography>
        <Typography
          sx={{
            gridColumn: 2,
            gridRow: 3,
            alignSelf: 'start',
            color: tokens.sub,
            fontFamily: tokens.body,
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          {betterAtTop ? 'worse' : 'better'}
        </Typography>
      </Box>
      <Box
        sx={{
          gridColumn: 3,
          gridRow: 2,
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(1, xDomain.length)}, minmax(0,1fr))`,
          alignItems: 'end',
        }}
      >
        {xDomain.map((value) => (
          <Typography
            key={JSON.stringify(value)}
            sx={{
              color: tokens.ink,
              fontFamily: tokens.body,
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1,
              textAlign: 'center',
            }}
          >
            {coordinateLabel(value)}
          </Typography>
        ))}
      </Box>
      <Typography
        sx={{
          gridColumn: 3,
          gridRow: 3,
          alignSelf: 'end',
          color: tokens.ink,
          fontFamily: tokens.body,
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1,
          textAlign: 'center',
        }}
      >
        {xAxisName}
      </Typography>
    </Box>
  );
}
