import { useMemo, type ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import {
  useActiveRun,
  useActiveRunModel,
  useActiveRunWorkload,
} from '../../application/ActiveRunProvider';
import { CHART_THEME } from '../../charts/platform';
import EChart from '../../components/EChart';
import SurfaceCard from '../../components/SurfaceCard';
import type { JsonValue } from '../../domain/overviewResources';
import type { Deployment } from '../../domain/deployment';
import { tokens } from '../../theme';
import { fmtInt } from '../../util';
import { arrivalPatternOption, lengthDistributionOption } from './overviewOptions';

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

function configNumber(config: Readonly<Record<string, JsonValue>>, ...keys: string[]) {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function modelCount(value: number | undefined): string {
  if (value === undefined) return 'n/a';
  if (value >= 1e9) return `${+(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
  return fmtInt(value);
}

function resourceStatusLabel(status: string): string {
  return status.replace('_', ' ');
}

function averageTokens(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function traceFileNames(sourcePaths: readonly string[]): string {
  return sourcePaths.map((path) => path.split('/').at(-1) ?? path).join(' · ');
}

function PropertyGrid({
  properties,
  columns = 4,
  lastFullWidthOnXs = false,
}: {
  properties: Property[];
  columns?: number;
  lastFullWidthOnXs?: boolean;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'repeat(2,minmax(0,1fr))',
          sm: `repeat(${columns},minmax(0,1fr))`,
        },
        gap: 0.5,
        mt: 1,
      }}
    >
      {properties.map((property, index) => (
        <Box
          key={property.label}
          sx={{
            gridColumn:
              lastFullWidthOnXs && index === properties.length - 1
                ? { xs: '1 / -1', sm: 'auto' }
                : undefined,
            minWidth: 0,
            minHeight: { xs: 44, sm: 50 },
            p: { xs: '6px 9px', sm: '8px 9px' },
            borderRadius: 1,
            background: tokens.tile2,
          }}
        >
          <Typography
            sx={{
              fontFamily: tokens.mono,
              fontWeight: 600,
              fontSize: 13.5,
              lineHeight: 1.15,
              color: tokens.ink,
              overflowWrap: 'anywhere',
            }}
          >
            {property.value}
          </Typography>
          <Typography
            sx={{
              mt: 0.4,
              fontFamily: tokens.mono,
              fontSize: 9.5,
              fontWeight: 600,
              lineHeight: 1.2,
              letterSpacing: '.055em',
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
        component="h3"
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
    <SurfaceCard
      accent={accent}
      component="section"
      aria-labelledby={id}
      sx={{
        flex: { xs: '0 0 auto', md: '1 1 0' },
        minHeight: 0,
        py: 1.5,
        px: 2,
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
    </SurfaceCard>
  );
}

export default function RunOverviewRow() {
  const run = useActiveRun();
  const modelResource = useActiveRunModel();
  const workloadResource = useActiveRunWorkload();
  const overview = useMemo(() => {
    const param = (key: string, fallback = 'n/a') =>
      distinct(
        run.workerList.map((worker) => worker.arch.params[key]),
        fallback,
      );
    const modelConfig = modelResource.status === 'ready' ? modelResource.resource.config : {};
    const layers = configNumber(modelConfig, 'num_hidden_layers');
    const hidden = configNumber(modelConfig, 'hidden_size');
    const attentionHeads = configNumber(modelConfig, 'num_attention_heads');
    const kvHeads = configNumber(modelConfig, 'num_key_value_heads');
    const contextLength = configNumber(modelConfig, 'max_position_embeddings');
    const experts = configNumber(modelConfig, 'num_experts');
    const topK = configNumber(modelConfig, 'num_experts_per_tok');
    const hasMoeArch =
      modelResource.status === 'ready'
        ? experts !== undefined
        : run.workerList.some((worker) => worker.archType.toLowerCase().includes('moe'));
    return {
      modelKind: hasMoeArch ? 'mixture of experts' : 'dense transformer',
      modelProperties: [
        { label: 'Parameters', value: modelCount(configNumber(modelConfig, 'num_parameters')) },
        {
          label: 'Active params',
          value: modelCount(configNumber(modelConfig, 'num_active_parameters')),
        },
        { label: 'Layers', value: layers === undefined ? 'n/a' : fmtInt(layers) },
        { label: 'Hidden size', value: hidden === undefined ? 'n/a' : fmtInt(hidden) },
        {
          label: 'Attention heads',
          value: attentionHeads === undefined ? 'n/a' : fmtInt(attentionHeads),
        },
        { label: 'KV heads', value: kvHeads === undefined ? 'n/a' : fmtInt(kvHeads) },
        { label: 'Context', value: contextLength === undefined ? 'n/a' : fmtInt(contextLength) },
        {
          label: 'Experts / top-k',
          value: hasMoeArch
            ? `${experts === undefined ? 'n/a' : fmtInt(experts)} / ${topK === undefined ? 'n/a' : fmtInt(topK)}`
            : 'dense',
        },
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
  }, [modelResource, run]);

  const workload = workloadResource.status === 'ready' ? workloadResource.resource : null;
  const workloadReason =
    workloadResource.status !== 'ready' && 'reason' in workloadResource
      ? workloadResource.reason
      : undefined;

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

      <SurfaceCard
        accent={tokens.terra}
        component="section"
        aria-labelledby="trace-overview-title"
        sx={{
          minWidth: 0,
          minHeight: { md: 440 },
          height: '100%',
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
          <PropertyGrid
            columns={3}
            lastFullWidthOnXs
            properties={[
              {
                label: 'Avg input tokens',
                value:
                  workload === null
                    ? resourceStatusLabel(workloadResource.status)
                    : averageTokens(workload.averageInputTokens),
              },
              {
                label: 'Avg output tokens',
                value:
                  workload === null
                    ? resourceStatusLabel(workloadResource.status)
                    : averageTokens(workload.averageOutputTokens),
              },
              {
                label: 'Trace file',
                value:
                  workload === null
                    ? resourceStatusLabel(workloadResource.status)
                    : traceFileNames(workload.sourcePaths),
              },
            ]}
          />
        </Box>

        {workload === null ? (
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
                Trace distribution {resourceStatusLabel(workloadResource.status)}
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
                {workloadReason ??
                  'This run has no configured-workload summary. The UI will not substitute synthetic distributions.'}
              </Typography>
            </Box>
          </Box>
        ) : (
          <Box
            sx={{
              flex: 1,
              minHeight: 300,
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2,minmax(0,1fr))' },
              gap: 1,
            }}
          >
            <Box sx={{ minWidth: 0, minHeight: 240 }}>
              <EChart
                option={lengthDistributionOption(workload, CHART_THEME)}
                ariaLabel="Configured trace input and output token length distributions"
              />
            </Box>
            <Box sx={{ minWidth: 0, minHeight: 240 }}>
              <EChart
                option={arrivalPatternOption(workload, CHART_THEME)}
                ariaLabel="Configured trace effective request rate over time"
              />
            </Box>
          </Box>
        )}
      </SurfaceCard>
    </Box>
  );
}
