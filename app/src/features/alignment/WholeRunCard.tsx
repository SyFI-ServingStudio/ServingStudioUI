import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useMemo, useState } from 'react';

import SurfaceCard from '../../components/SurfaceCard';
import type {
  AlignmentDefinitions,
  AlignmentE2eSeries,
  AlignmentWorkloadSeries,
} from '../../domain/alignment';
import { tokens } from '../../theme';
import { fmtInt, fmtLatencyMs, fmtQuantity, fmtRounded } from './format';
import {
  MetricCard,
  SectionHeading,
  SummaryCard,
  type FigureKeyRow,
  type StatItem,
  type StatTone,
} from './wholeRunCards';
import {
  deltaText,
  latencyCards,
  latencyNote,
  roundToInteger,
  scheduleContext,
  splitFormatted,
  throughputCard,
  throughputNote,
  workloadCards,
  workloadNote,
  workloadSummaryRows,
  type LatencyCardModel,
  type WorkloadAxisMode,
  type WorkloadCardModel,
} from './wholeRunModel';
import {
  LANE_COLORS,
  latencyCdfOption,
  throughputRateOption,
  workloadShapeOption,
} from './wholeRunOption';

/**
 * §05 — the whole run.
 *
 * The loosest question, and the one with two ways to be right: a rate can
 * match while the schedule that produced it does not. So the section is read
 * in three passes — every latency result as its own card, the rate as its
 * own, and underneath them the workload each side actually scheduled, which
 * is what tells a model that got the right answer apart from one that got the
 * right answer on a different problem.
 *
 * The analyzer's definition of each metric is on the card, verbatim, as the
 * title's tooltip. It is not a line of the card: a definition is a glossary
 * entry, the same on every capture, and six of them stacked under six figures
 * buried the one thing the footers are for — where each result sits against
 * the results beside it, which no single definition can say.
 */

/** Which definition answers "what did this card measure". The throughput card
 * has three, because the rate it states and the two spans it is read over are
 * defined separately. */
const THROUGHPUT_DEFINITIONS = [
  'completion_throughput',
  'client_completion_throughput',
  'simulated_completion_throughput',
];

/** The analyzer splits the cycle definition by side and by the last iteration
 * of a capture; every other metric defines itself in one sentence. */
function workloadDefinitionKeys(field: string): readonly string[] {
  return field === 'iteration_cycle_ms'
    ? [`${field}.measured`, `${field}.simulated`, `${field}.last_iteration`]
    : [field];
}

/** Several definitions as one tooltip, in the analyzer's own words. Absent
 * keys drop out rather than becoming an empty line. */
function definitionText(
  definitions: AlignmentDefinitions,
  keys: readonly string[],
): string | undefined {
  const sentences = keys.flatMap((key) => {
    const sentence = definitions[key];
    return sentence === undefined ? [] : [sentence];
  });
  return sentences.length === 0 ? undefined : sentences.join('\n\n');
}

const deltaTone = (delta: number | null): StatTone =>
  delta === null ? 'flat' : delta >= 0 ? 'over' : 'under';

function statFromQuantity(formatted: string, label: string, tone: StatTone): StatItem {
  const { value, unit } = splitFormatted(formatted);
  return { value, unit, label, tone };
}

const optionalInteger = (value: number | null): string =>
  value === null ? '—' : fmtInt(roundToInteger(value));

const optionalQuantity = (value: number | null, unit: string): string =>
  value === null ? '—' : `${optionalInteger(value)} ${unit}`;

export default function WholeRunCard({
  e2e,
  workload,
}: {
  e2e: AlignmentE2eSeries | null;
  workload: AlignmentWorkloadSeries | null;
}) {
  const [workloadAxisMode, setWorkloadAxisMode] = useState<WorkloadAxisMode>('elapsedTime');
  const latency = useMemo(
    () => (e2e === null ? [] : latencyCards(e2e.latencyCdfComparisons)),
    [e2e],
  );
  const throughput = useMemo(() => (e2e === null ? null : throughputCard(e2e)), [e2e]);
  const shape = useMemo(
    () => (workload === null ? [] : workloadCards(workload, workloadAxisMode)),
    [workload, workloadAxisMode],
  );
  const summary = useMemo(
    () => (workload === null ? [] : workloadSummaryRows(workload, shape)),
    [workload, shape],
  );
  const schedule = useMemo(() => scheduleContext(workload, shape), [workload, shape]);

  return (
    <Box
      sx={{
        display: 'grid',
        alignItems: 'stretch',
        gap: '14px',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: 'repeat(3, minmax(0, 1fr))',
        },
      }}
    >
      {e2e === null && (
        <MissingSourceCard
          title="Latency and rate not generated"
          detail="This bundle carries no end-to-end comparison subject. Scheduler-shape evidence remains independent below when available."
        />
      )}
      {workload === null && (
        <MissingSourceCard
          title="Scheduler shape not generated"
          detail="This bundle carries no workload comparison subject. Latency and rate remain independent above when available."
        />
      )}

      {e2e !== null && latency.length > 0 && (
        <>
          <SectionHeading
            first
            title="Latency"
            caption={`${fmtInt(roundToInteger(latency[0].n))} requests · the empirical CDF of every request per side, with p50 / p90 / p99 marked on the curves`}
          />
          {latency.map((card, cardIndex) => (
            <LatencyMetricCard
              key={card.key}
              card={card}
              cards={latency}
              comparison={e2e.latencyCdfComparisons[cardIndex]}
              definitions={e2e.definitions}
              measuredOutputTokens={throughput?.measured.outputTokens ?? null}
            />
          ))}
        </>
      )}

      {e2e !== null && throughput !== null && e2e.throughput !== null && (
        <>
          <SectionHeading
            title="Rate"
            caption="output tokens per second across the run, binned, with each side's whole-run rate as a dashed rule"
          />
          <MetricCard
            title="Throughput"
            titleDefinition={definitionText(e2e.definitions, THROUGHPUT_DEFINITIONS)}
            meta={`${
              throughput.measured.outputTokens !== null &&
              throughput.measured.outputTokens === throughput.simulated.outputTokens
                ? `same ${optionalInteger(throughput.measured.outputTokens)} output tokens`
                : 'output-token totals unavailable or different'
            } · ${fmtInt(roundToInteger(throughput.bins))} bins`}
            stats={[
              {
                value: optionalInteger(throughput.measured.tps),
                unit: 'tok/s',
                label: 'measured',
                tone: 'measured',
              },
              {
                value: optionalInteger(throughput.simulated.tps),
                unit: 'tok/s',
                label: 'modelled',
                tone: 'modelled',
              },
              {
                value: deltaText(throughput.deltaPct),
                label: 'difference',
                tone: deltaTone(throughput.deltaPct),
              },
            ]}
            option={throughputRateOption(e2e.throughput, {
              measured: throughput.measured.tps,
              simulated: throughput.simulated.tps,
            })}
            figureLabel="Throughput across the run: output tokens per second per bin, measured against modelled, with each side's whole-run rate as a dashed rule"
            figureKey={[
              {
                label: 'measured',
                color: LANE_COLORS.measured,
                cells: [
                  optionalQuantity(throughput.measured.tps, 'tok/s'),
                  `span ${optionalQuantity(throughput.measured.spanMs, 'ms')}`,
                  `peak bin ${fmtInt(roundToInteger(throughput.measured.peakBinTps))}`,
                  optionalQuantity(throughput.measured.outputTokens, 'tok'),
                ],
              },
              {
                label: 'modelled',
                color: LANE_COLORS.modelled,
                cells: [
                  optionalQuantity(throughput.simulated.tps, 'tok/s'),
                  `span ${optionalQuantity(throughput.simulated.spanMs, 'ms')}`,
                  `peak bin ${fmtInt(roundToInteger(throughput.simulated.peakBinTps))}`,
                  optionalQuantity(throughput.simulated.outputTokens, 'tok'),
                ],
              },
            ]}
            note={throughputNote(throughput, schedule)}
          />
        </>
      )}

      {workload !== null && shape.length > 0 && (
        <>
          <SectionHeading
            title="Scheduler shape"
            caption={
              workloadAxisMode === 'elapsedTime'
                ? 'every iteration on its own elapsed clock; each value holds until the next iteration starts'
                : 'every iteration at its original ID; measured and modelled sequences remain independent'
            }
            action={
              <ToggleButtonGroup
                exclusive
                size="small"
                value={workloadAxisMode}
                onChange={(_event, nextMode: WorkloadAxisMode | null) => {
                  if (nextMode !== null) setWorkloadAxisMode(nextMode);
                }}
                aria-label="Scheduler shape x-axis"
                sx={{
                  flexShrink: 0,
                  '& .MuiToggleButton-root': {
                    px: 1.25,
                    py: 0.35,
                    borderColor: tokens.hair,
                    color: tokens.sub,
                    fontFamily: tokens.body,
                    fontSize: 12,
                    lineHeight: 1.4,
                    textTransform: 'none',
                    whiteSpace: 'nowrap',
                    '&.Mui-selected': {
                      color: tokens.ink,
                      backgroundColor: tokens.tile,
                    },
                  },
                }}
              >
                <ToggleButton value="elapsedTime">Elapsed time</ToggleButton>
                <ToggleButton value="iterationId">Iteration ID</ToggleButton>
              </ToggleButtonGroup>
            }
          />
          {shape.map((card) => (
            <WorkloadMetricCard key={card.key} card={card} definitions={workload.definitions} />
          ))}
          <SummaryCard
            title="What each side ran, in numbers"
            meta="iteration count, workload percentiles and the span they were produced over — measured against modelled"
            legend="· each row is one number per side; the four cards above are the series behind them."
            rows={summary.map((row) => ({
              label: row.label,
              measured: row.measured === null ? '—' : fmtQuantity(row.measured, row.quantityUnit),
              simulated:
                row.simulated === null ? '—' : fmtQuantity(row.simulated, row.quantityUnit),
              measuredFraction: row.measuredFraction,
              simulatedFraction: row.simulatedFraction,
            }))}
          />
        </>
      )}
    </Box>
  );
}

function MissingSourceCard({ title, detail }: { title: string; detail: string }) {
  return (
    <SurfaceCard sx={{ p: '14px 16px', gridColumn: '1 / -1' }}>
      <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 15 }}>
        {title}
      </Typography>
      <Typography sx={{ color: tokens.sub, fontFamily: tokens.body, fontSize: 12, mt: 0.75 }}>
        {detail}
      </Typography>
    </SurfaceCard>
  );
}

function LatencyMetricCard({
  card,
  cards,
  comparison,
  definitions,
  measuredOutputTokens,
}: {
  card: LatencyCardModel;
  /** Every latency card, because this one's footer is about the distance to
   * the others: a client clock has a server-clock pair, a decode step has an
   * end-to-end row it accumulates into. */
  cards: readonly LatencyCardModel[];
  comparison: AlignmentE2eSeries['latencyCdfComparisons'][number];
  definitions: AlignmentDefinitions;
  measuredOutputTokens: number | null;
}) {
  const markerCells = (side: LatencyCardModel['measured']): readonly string[] => {
    const quantity = (value: number | null) => fmtLatencyMs(value);
    return [
      `p50 ${quantity(side.p50)}`,
      `p90 ${quantity(side.p90)}`,
      `p99 ${quantity(side.p99)}`,
      `${quantity(side.low)} – ${quantity(side.high)}`,
    ];
  };
  const figureKey: readonly FigureKeyRow[] = [
    { label: 'measured', color: LANE_COLORS.measured, cells: markerCells(card.measured) },
    { label: 'modelled', color: LANE_COLORS.modelled, cells: markerCells(card.simulated) },
  ];
  return (
    <MetricCard
      title={card.title}
      titleDefinition={definitions[card.key]}
      meta={`${card.label} · ${fmtInt(roundToInteger(card.n))} requests`}
      stats={[
        statFromQuantity(fmtLatencyMs(card.measured.p50), 'measured p50', 'measured'),
        statFromQuantity(fmtLatencyMs(card.simulated.p50), 'modelled p50', 'modelled'),
        {
          value: deltaText(card.deltaP50Pct),
          label: 'Δ p50',
          tone: deltaTone(card.deltaP50Pct),
        },
      ]}
      option={latencyCdfOption(comparison, card.measured.p50)}
      figureLabel={`${card.title}: the measured and modelled cumulative distributions over ${fmtInt(roundToInteger(card.n))} requests`}
      figureKey={figureKey}
      note={latencyNote(card, cards, { measuredOutputTokens })}
    />
  );
}

function WorkloadMetricCard({
  card,
  definitions,
}: {
  card: WorkloadCardModel;
  definitions: AlignmentDefinitions;
}) {
  // Counts are whole things — requests, tokens, iterations — so an
  // interpolated percentile of them is reported at the grain the analyzer
  // counted, not at the grain the interpolation produced.
  const quantity = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '—';
    return card.quantityUnit === '' ? fmtRounded(value) : fmtQuantity(value, card.quantityUnit);
  };
  const statsCells = (side: WorkloadCardModel['measured']): readonly string[] => [
    `p50 ${quantity(side?.stats.p50)}`,
    `p90 ${quantity(side?.stats.p90)}`,
    `p99 ${quantity(side?.stats.p99)}`,
    `max ${quantity(side?.stats.max)}`,
  ];
  const sampleCount = (side: WorkloadCardModel['measured']) =>
    side === null ? '—' : fmtInt(roundToInteger(side.stats.n));
  return (
    <MetricCard
      title={card.label}
      titleDefinition={definitionText(definitions, workloadDefinitionKeys(card.field))}
      meta={`${card.unit} · ${sampleCount(card.measured)} measured vs ${sampleCount(card.simulated)} modelled iterations`}
      stats={[
        statFromQuantity(quantity(card.measured?.stats.p50), 'measured p50', 'measured'),
        statFromQuantity(quantity(card.simulated?.stats.p50), 'modelled p50', 'modelled'),
        {
          value: deltaText(card.deltaP50Pct),
          label: 'Δ p50',
          tone: deltaTone(card.deltaP50Pct),
        },
      ]}
      option={workloadShapeOption(card)}
      figureLabel={`${card.label} by ${
        card.axisMode === 'elapsedTime' ? 'elapsed time' : 'iteration ID'
      }: every measured and modelled iteration is shown on its own sequence`}
      figureKey={[
        { label: 'measured', color: LANE_COLORS.measured, cells: statsCells(card.measured) },
        { label: 'modelled', color: LANE_COLORS.modelled, cells: statsCells(card.simulated) },
      ]}
      note={workloadNote(card)}
    />
  );
}
