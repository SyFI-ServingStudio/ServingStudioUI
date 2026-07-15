import { useMemo, type ReactNode } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { useActiveRun, useActiveRunSubject } from '../../application/ActiveRunProvider';
import type { Deployment } from '../../domain/deployment';
import { tokens } from '../../theme';
import { fmtInt } from '../../util';

interface Property {
  label: string;
  value: string;
}

function distinct(values: Array<number | string | null | undefined>, fallback = 'n/a'): string {
  const present = values.filter((value): value is number | string => value != null);
  return [...new Set(present.map(String))].join(' · ') || fallback;
}

function deploymentHeadline(deployment: Deployment): string {
  if (deployment === 'afd') return 'AFD deployment';
  if (deployment === 'pd') return 'Prefill / decode deployment';
  return 'Unified deployment';
}

function PropertyGrid({ properties }: { properties: Property[] }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2,minmax(0,1fr))', sm: 'repeat(4,minmax(0,1fr))' },
        gap: 0.5,
        mt: 1,
      }}
    >
      {properties.map((property) => (
        <Box
          key={property.label}
          sx={{
            minWidth: 0,
            minHeight: { xs: 36, sm: 42 },
            p: { xs: '4px 8px', sm: '6px 8px' },
            borderRadius: 1,
            background: tokens.tile2,
          }}
        >
          <Typography
            sx={{
              fontFamily: tokens.mono,
              fontWeight: 600,
              fontSize: 10.5,
              lineHeight: 1.2,
              color: tokens.ink,
              overflowWrap: 'anywhere',
            }}
          >
            {property.value}
          </Typography>
          <Typography
            sx={{
              mt: 0.25,
              fontFamily: tokens.mono,
              fontSize: 8,
              lineHeight: 1.25,
              letterSpacing: '.09em',
              textTransform: 'uppercase',
              color: tokens.sub2,
            }}
          >
            {property.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function OverviewHeader({
  id,
  title,
  kind,
  accent,
}: {
  id: string;
  title: string;
  kind: string;
  accent: string;
}) {
  return (
    <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={2}>
      <Typography
        id={id}
        component="h2"
        sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}
      >
        {title}
      </Typography>
      <Typography
        sx={{
          fontFamily: tokens.mono,
          fontSize: 8.5,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: accent,
        }}
      >
        {kind}
      </Typography>
    </Stack>
  );
}

function OverviewCard({
  id,
  title,
  kind,
  accent,
  headline,
  description,
  properties,
}: {
  id: string;
  title: string;
  kind: string;
  accent: string;
  headline: string;
  description: ReactNode;
  properties: Property[];
}) {
  return (
    <Paper
      component="section"
      aria-labelledby={id}
      sx={{
        flex: { xs: '0 0 auto', md: '1 1 0' },
        minHeight: 0,
        overflow: 'hidden',
        borderRadius: 2,
        borderTop: `2px solid ${accent}`,
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <OverviewHeader id={id} title={title} kind={kind} accent={accent} />
      <Typography
        sx={{
          mt: 0.7,
          fontFamily: tokens.serif,
          fontWeight: 600,
          fontSize: { xs: 19, md: 20 },
          lineHeight: 1.1,
          color: tokens.ink,
        }}
      >
        {headline}
      </Typography>
      <Typography
        component="div"
        sx={{ mt: 0.3, fontFamily: tokens.mono, fontSize: 9.5, lineHeight: 1.4, color: tokens.sub }}
      >
        {description}
      </Typography>
      <Box sx={{ mt: 'auto' }}>
        <PropertyGrid properties={properties} />
      </Box>
    </Paper>
  );
}

export default function RunOverviewRow() {
  const run = useActiveRun();
  const throughputSubject = useActiveRunSubject('throughput');
  const throughput = throughputSubject.status === 'ready' ? throughputSubject.payload : null;
  const overview = useMemo(() => {
    const param = (key: string, fallback = 'n/a') =>
      distinct(
        run.workerList.map((worker) => worker.arch.params[key]),
        fallback,
      );
    const traceEndMs = throughput?.t_end_ms[throughput.t_end_ms.length - 1];
    const traceSpan =
      traceEndMs === undefined
        ? 'n/a'
        : traceEndMs >= 1000
          ? `${(traceEndMs / 1000).toFixed(traceEndMs % 1000 ? 1 : 0)} s`
          : `${traceEndMs} ms`;

    const hasMoeArch = run.workerList.some((worker) =>
      worker.archType.toLowerCase().includes('moe'),
    );
    const experts = param('experts', hasMoeArch ? 'n/a' : 'dense');
    const topK = param('top_k', 'n/a');
    return {
      traceSpan,
      modelKind: hasMoeArch ? 'mixture of experts' : 'dense transformer',
      modelProperties: [
        { label: 'Parameters', value: param('parameters') },
        { label: 'Active params', value: param('active_parameters') },
        { label: 'Layers', value: param('layers') },
        { label: 'Hidden size', value: param('hidden') },
        { label: 'Attention heads', value: param('attention_heads') },
        { label: 'KV heads', value: param('kv_heads') },
        { label: 'Context', value: param('context_length') },
        { label: 'Experts / top-k', value: hasMoeArch ? `${experts} / ${topK}` : 'dense' },
      ],
      simulationProperties: [
        { label: 'GPU type', value: run.gpu.replace('NVIDIA ', '') },
        { label: 'GPUs', value: fmtInt(run.gpuTotal) },
        { label: 'Pools', value: fmtInt(run.topology.pools.length) },
        { label: 'Workers', value: fmtInt(run.workerList.length) },
        { label: 'Tensor parallel', value: param('attn_tp', '1') },
        { label: 'Expert parallel', value: param('ep', '1') },
        {
          label: 'Data parallel',
          value: distinct(
            run.workerList.map((worker) => worker.dp ?? worker.arch.params.dp_groups),
            '1',
          ),
        },
        { label: 'Placement', value: distinct(run.topology.pools.map((pool) => pool.placement)) },
      ],
    };
  }, [run, throughput]);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,.92fr) minmax(0,1.08fr)' },
        gap: 1.5,
        mt: 2,
        alignItems: 'stretch',
      }}
    >
      <Stack spacing={1.5} sx={{ minWidth: 0, height: '100%' }}>
        <OverviewCard
          id="model-overview-title"
          title="Model overview"
          kind="model"
          accent={tokens.teal}
          headline={run.model}
          description={`${overview.modelKind} · ${distinct(run.workerList.map((worker) => worker.archType))}`}
          properties={overview.modelProperties}
        />
        <OverviewCard
          id="simulation-overview-title"
          title="Simulation overview"
          kind="preset"
          accent={tokens.gold}
          headline={deploymentHeadline(run.deployment)}
          description={
            <>
              {run.source.simulationFolder}
              <br />
              {run.source.kind === 'synthetic'
                ? 'synthetic preset topology'
                : 'analyzer folder · topology · parallelism · placement'}
            </>
          }
          properties={overview.simulationProperties}
        />
      </Stack>

      <Paper
        component="section"
        aria-labelledby="trace-overview-title"
        sx={{
          minWidth: 0,
          minHeight: { md: 440 },
          height: '100%',
          overflow: 'hidden',
          borderRadius: 2,
          borderTop: `2px solid ${tokens.terra}`,
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
        }}
      >
        <Box>
          <OverviewHeader
            id="trace-overview-title"
            title="Trace overview"
            kind="workload"
            accent={tokens.terra}
          />
          <Stack
            direction="row"
            alignItems="baseline"
            justifyContent="space-between"
            spacing={2}
            sx={{ mt: 0.7 }}
          >
            <Typography
              sx={{
                fontFamily: tokens.serif,
                fontWeight: 600,
                fontSize: { xs: 19, md: 20 },
                lineHeight: 1.1,
              }}
            >
              {overview.traceSpan} wall-clock
            </Typography>
            <Typography
              sx={{
                px: 0.8,
                py: 0.3,
                borderRadius: 1,
                background: 'rgba(194,92,58,.09)',
                fontFamily: tokens.mono,
                fontSize: 9,
                color: tokens.terra,
                whiteSpace: 'nowrap',
              }}
            >
              not generated
            </Typography>
          </Stack>
          <Typography sx={{ mt: 0.3, fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub }}>
            {fmtInt(run.summary.requests)} requests · {fmtInt(run.workerList.length)} workers ·{' '}
            {run.source.simulationFolder}
          </Typography>
        </Box>

        <Box
          sx={{
            flex: 1,
            minHeight: 220,
            display: 'grid',
            placeItems: 'center',
            border: `1px dashed ${tokens.hair}`,
            borderRadius: 1.5,
            background: tokens.tile2,
            p: 3,
            textAlign: 'center',
          }}
        >
          <Box>
            <Typography
              sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16, color: tokens.ink }}
            >
              Trace distribution not generated
            </Typography>
            <Typography
              sx={{
                mt: 0.75,
                maxWidth: 470,
                fontFamily: tokens.mono,
                fontSize: 10.5,
                lineHeight: 1.6,
                color: tokens.sub,
              }}
            >
              This simulation folder has no offered-workload summary for input/output lengths or
              arrival burstiness. The UI will not substitute synthetic distributions.
            </Typography>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
