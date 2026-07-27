import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useSweepListQuery, useSweepQuery } from '../../application/queries';
import EChart from '../../components/EChart';
import SurfaceCard, { SurfaceAccentProvider } from '../../components/SurfaceCard';
import WorkspaceNav from '../../components/WorkspaceNav';
import type { SweepAnalysis, SweepMetric } from '../../domain/sweep';
import { useViz } from '../../store';
import { tokens } from '../../theme';
import { metricStatisticLabel, sweepMetricSections, type SweepMetricPanel } from './metricSections';
import ExperimentSelector from './ExperimentSelector';
import { formatMetricValue, sweepChartOption, sweepFacets, type SweepFacet } from './sweepOption';

function StatePanel({ title, detail }: { title: string; detail: string }) {
  return (
    <SurfaceCard sx={{ mt: 2, p: 2.5 }} role="status">
      <Typography component="h2" sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 18 }}>
        {title}
      </Typography>
      <Typography sx={{ mt: 0.5, color: tokens.sub, fontFamily: tokens.mono, fontSize: 10.5 }}>
        {detail}
      </Typography>
    </SurfaceCard>
  );
}

function Stat({
  value,
  label,
  accent = false,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <Box>
      <Typography
        sx={{
          color: accent ? tokens.teal : tokens.ink,
          fontFamily: tokens.serif,
          fontSize: { xs: 25, md: 34 },
          fontWeight: 600,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </Typography>
      <Typography
        sx={{
          mt: 0.65,
          color: tokens.sub,
          fontFamily: tokens.mono,
          fontSize: 9,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

function StatisticKnob({
  metrics,
  selectedMetric,
  onChange,
}: {
  metrics: readonly SweepMetric[];
  selectedMetric: SweepMetric;
  onChange: (metricKey: string) => void;
}) {
  if (metrics.length < 2) return null;
  return (
    <Box
      role="group"
      aria-label={`${selectedMetric.group} statistic`}
      sx={{
        display: 'inline-flex',
        p: '2px',
        border: `1px solid ${tokens.hair}`,
        borderRadius: 999,
        background: 'rgba(42,38,34,.035)',
      }}
    >
      {metrics.map((metric) => {
        const selected = metric.key === selectedMetric.key;
        return (
          <ButtonBase
            key={metric.key}
            aria-pressed={selected}
            onClick={() => onChange(metric.key)}
            sx={{
              minWidth: 44,
              px: 1.05,
              py: 0.45,
              borderRadius: 999,
              background: selected ? tokens.ink : 'transparent',
              color: selected ? tokens.tile : tokens.sub,
              fontFamily: tokens.mono,
              fontSize: 8.5,
              fontWeight: 600,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              transition: `background 160ms ${tokens.ease}, color 160ms ${tokens.ease}`,
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          >
            {metricStatisticLabel(metric) ?? metric.label}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

function MetricPanelCard({
  analysis,
  panel,
  selectedRunKey,
  facets,
  onChartClick,
  onChartDoubleClick,
}: {
  analysis: SweepAnalysis;
  panel: SweepMetricPanel;
  selectedRunKey: string | null;
  facets: readonly SweepFacet[];
  onChartClick: (event: unknown) => void;
  onChartDoubleClick: (event: unknown) => void;
}) {
  const [selectedMetricKey, setSelectedMetricKey] = useState<string>();
  const selectedMetric =
    panel.metrics.find((metric) => metric.key === selectedMetricKey) ?? panel.metrics[0];
  if (!selectedMetric) return null;
  const singletonRun = analysis.axes.length === 0 ? analysis.runs[0] : undefined;
  return (
    <SurfaceCard sx={{ p: { xs: 1.4, md: 1.8 } }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        useFlexGap
        sx={{ gap: 1.2, px: 0.4 }}
      >
        <Box>
          <Typography
            component="h4"
            sx={{ fontFamily: tokens.serif, fontSize: 17, fontWeight: 600 }}
          >
            {panel.label}
          </Typography>
          <Typography sx={{ mt: 0.1, color: tokens.sub, fontFamily: tokens.mono, fontSize: 9 }}>
            {selectedMetric.unit}
          </Typography>
        </Box>
        <StatisticKnob
          metrics={panel.metrics}
          selectedMetric={selectedMetric}
          onChange={setSelectedMetricKey}
        />
      </Stack>
      {singletonRun ? (
        <Box
          sx={{
            minHeight: 150,
            display: 'grid',
            alignContent: 'center',
            px: 0.4,
            borderTop: `1px solid ${tokens.hair}`,
            mt: 1.2,
          }}
        >
          <Typography
            sx={{
              color: tokens.ink,
              fontFamily: tokens.serif,
              fontSize: 'clamp(34px, 4vw, 48px)',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-.025em',
            }}
          >
            {formatMetricValue(selectedMetric, singletonRun.metrics[selectedMetric.key])}
          </Typography>
          <Typography
            sx={{
              mt: 0.4,
              color: tokens.sub,
              fontFamily: tokens.mono,
              fontSize: 9,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
            }}
          >
            Single-run aggregate
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns:
              facets.length > 1 ? { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' } : '1fr',
            gap: 1,
          }}
        >
          {facets.map((facet) => (
            <Box key={facet.key} sx={{ minWidth: 0 }}>
              {facets.length > 1 && (
                <Typography
                  sx={{
                    mt: 0.8,
                    px: 0.4,
                    color: tokens.sub,
                    fontFamily: tokens.mono,
                    fontSize: 9,
                  }}
                >
                  {facet.label}
                </Typography>
              )}
              <EChart
                option={sweepChartOption(analysis, selectedMetric, facet, selectedRunKey)}
                ariaLabel={`${selectedMetric.label} by ${analysis.axes.join(' and ')}${facets.length > 1 ? `, ${facet.label}` : ''}`}
                onEvents={{
                  click: onChartClick,
                  dblclick: onChartDoubleClick,
                }}
                style={{ height: facets.length > 1 ? 290 : 320 }}
              />
            </Box>
          ))}
        </Box>
      )}
    </SurfaceCard>
  );
}

export default function SweepPage() {
  const sweepList = useSweepListQuery();
  const [selectedSweepId, setSelectedSweepId] = useState<string | null>(null);
  const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null);
  const metricPanelsRef = useRef<HTMLDivElement>(null);
  const setRun = useViz((state) => state.setRun);
  const selectedSweep = sweepList.data?.find((sweep) => sweep.sweepId === selectedSweepId) ?? null;

  useEffect(() => {
    if (selectedSweepId !== null || !sweepList.data?.length) return;
    setSelectedSweepId(
      sweepList.data.find((sweep) => sweep.status === 'ready')?.sweepId ??
        sweepList.data[0].sweepId,
    );
  }, [selectedSweepId, sweepList.data]);

  useEffect(() => {
    document.title = 'VibeSim · Sweep aggregate';
    return () => {
      document.title = 'VibeSim · Run';
    };
  }, []);

  const sweep = useSweepQuery(selectedSweepId, selectedSweep?.status === 'ready');
  const analysis = sweep.data;
  const facets = useMemo(() => (analysis ? sweepFacets(analysis) : []), [analysis]);
  const metricSections = useMemo(
    () => (analysis ? sweepMetricSections(analysis.metrics) : []),
    [analysis],
  );

  useEffect(() => {
    setSelectedRunKey(null);
  }, [selectedSweepId]);

  const selectChartRun = (event: unknown) => {
    const runKey = (event as { data?: { runKey?: unknown } }).data?.runKey;
    if (typeof runKey === 'string') setSelectedRunKey(runKey);
  };

  const openChartRun = (event: unknown) => {
    const data = (event as { data?: { runId?: unknown } }).data;
    if (typeof data?.runId !== 'string') return;
    setRun(data.runId);
    window.location.hash = '/run';
  };

  const completeRuns =
    analysis?.runs.filter(
      (run) => run.lifecycle.simulation === 'complete' && run.lifecycle.analysis === 'complete',
    ).length ?? 0;
  const singletonRun = selectedSweep?.kind === 'singleton' ? analysis?.runs[0] : undefined;
  const inspectSingleton = () => {
    if (!singletonRun?.runId) return;
    setRun(singletonRun.runId);
    window.location.hash = '/run';
  };
  const activateSweep = (sweepId: string) => {
    setSelectedSweepId(sweepId);
    window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      metricPanelsRef.current?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  };

  return (
    <Box
      component="main"
      sx={{ maxWidth: 1560, mx: 'auto', px: { xs: 2.25, md: 5.5 }, pt: 3.75, pb: 10 }}
    >
      <Box sx={{ borderBottom: `1.5px solid ${tokens.ink}`, pb: 2.5 }}>
        <Stack
          direction="row"
          alignItems="center"
          useFlexGap
          sx={{ gap: 1.5, mb: 1.6, color: tokens.sub }}
        >
          <Typography
            sx={{
              fontFamily: tokens.mono,
              fontSize: 11,
              letterSpacing: '.24em',
              textTransform: 'uppercase',
            }}
          >
            VibeSim Analyzer
          </Typography>
          <Box sx={{ flex: 1, height: '1px', background: tokens.hair }} />
          <WorkspaceNav current="aggregate" />
        </Stack>
        <Typography
          component="h1"
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 'clamp(34px,5vw,60px)',
            lineHeight: 0.96,
            letterSpacing: '-.02em',
          }}
        >
          Sweep{' '}
          <Box component="em" sx={{ color: tokens.teal, fontWeight: 500 }}>
            aggregate
          </Box>
        </Typography>
        <Typography
          sx={{ mt: 1.4, maxWidth: 720, color: tokens.sub, fontSize: 13.5, lineHeight: 1.55 }}
        >
          Compare launcher-defined experiment coordinates across throughput, latency, and
          utilization. Membership follows an explicit sweep manifest or one unclaimed singleton run.
        </Typography>
      </Box>

      {sweepList.isPending ? (
        <StatePanel title="Loading sweep index" detail="Waiting for the Analyzer sweep catalog." />
      ) : sweepList.isError ? (
        <StatePanel
          title="Sweep index unavailable"
          detail={
            sweepList.error instanceof Error ? sweepList.error.message : 'Catalog read failed.'
          }
        />
      ) : sweepList.data.length === 0 ? (
        <StatePanel
          title="No aggregate experiments"
          detail="No launcher sweep manifests or standalone runs were found below the configured logs roots."
        />
      ) : (
        <>
          <Box sx={{ mt: 2.5 }}>
            <ExperimentSelector
              entries={sweepList.data}
              selectedId={selectedSweepId}
              onSelect={setSelectedSweepId}
              onActivate={activateSweep}
            />
            {analysis && (
              <Stack
                direction="row"
                justifyContent="flex-end"
                useFlexGap
                flexWrap="wrap"
                sx={{ gap: { xs: 2.5, md: 4 }, mt: 1.4 }}
              >
                <Stat value={String(analysis.runs.length)} label="member runs" />
                <Stat value={String(analysis.axes.length)} label="sweep axes" />
                <Stat
                  value={`${completeRuns}/${analysis.runs.length}`}
                  label="analysis ready"
                  accent
                />
              </Stack>
            )}
          </Box>

          <Box ref={metricPanelsRef} sx={{ scrollMarginTop: 16 }} />
          {selectedSweep?.status === 'pending' ? (
            <StatePanel
              title="Aggregate analysis pending"
              detail="The launcher manifest exists, but sweep_metrics_grid.json has not been generated."
            />
          ) : sweep.isPending ? (
            <StatePanel title="Loading aggregate payload" detail="Reading bounded sweep metrics." />
          ) : sweep.isError ? (
            <StatePanel
              title="Aggregate payload unavailable"
              detail={sweep.error instanceof Error ? sweep.error.message : 'Payload read failed.'}
            />
          ) : analysis ? (
            <SurfaceAccentProvider accent={tokens.sectionAnalysis}>
              <Box component="section" aria-labelledby="aggregate-metric-heading" sx={{ mt: 3 }}>
                <Stack
                  direction="row"
                  alignItems="end"
                  justifyContent="space-between"
                  useFlexGap
                  sx={{ gap: 2, mb: 1.2 }}
                >
                  <Box>
                    <Typography
                      sx={{
                        color: tokens.sectionAnalysis,
                        fontFamily: tokens.mono,
                        fontSize: 9.5,
                        letterSpacing: '.14em',
                      }}
                    >
                      00 · METRIC PANELS
                    </Typography>
                    <Typography
                      id="aggregate-metric-heading"
                      component="h2"
                      sx={{
                        mt: 0.25,
                        fontFamily: tokens.serif,
                        fontSize: 20,
                        fontWeight: 600,
                      }}
                    >
                      Aggregate evidence by outcome
                    </Typography>
                  </Box>
                  {singletonRun?.runId && (
                    <ButtonBase
                      onClick={inspectSingleton}
                      sx={{
                        px: 1.4,
                        py: 0.8,
                        border: `1px solid ${tokens.teal}`,
                        borderRadius: 1.5,
                        color: tokens.teal,
                        fontFamily: tokens.mono,
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: '.08em',
                        textTransform: 'uppercase',
                        '&:hover': { background: 'rgba(31,111,107,.06)' },
                      }}
                    >
                      Inspect run →
                    </ButtonBase>
                  )}
                </Stack>
                <Stack spacing={2.4}>
                  {metricSections.map((section) => (
                    <Box key={section.id}>
                      <Box
                        sx={{
                          mb: 0.9,
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 1,
                        }}
                      >
                        <Typography
                          component="h3"
                          sx={{ fontFamily: tokens.serif, fontSize: 18, fontWeight: 600 }}
                        >
                          {section.label}
                        </Typography>
                        <Box sx={{ flex: 1, height: '1px', background: tokens.hair }} />
                        <Typography
                          sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}
                        >
                          {section.panels.length} {section.panels.length === 1 ? 'view' : 'views'}
                        </Typography>
                      </Box>
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: {
                            xs: '1fr',
                            lg: 'repeat(2, minmax(0, 1fr))',
                          },
                          gap: 1.5,
                        }}
                      >
                        {section.panels.map((panel) => (
                          <MetricPanelCard
                            key={`${analysis.sweepId}:${panel.id}`}
                            analysis={analysis}
                            panel={panel}
                            selectedRunKey={selectedRunKey}
                            facets={facets}
                            onChartClick={selectChartRun}
                            onChartDoubleClick={openChartRun}
                          />
                        ))}
                      </Box>
                    </Box>
                  ))}
                </Stack>
              </Box>
            </SurfaceAccentProvider>
          ) : null}
        </>
      )}
    </Box>
  );
}
