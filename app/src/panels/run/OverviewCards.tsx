import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import type { ArtifactResult, RunModel, RunTopology, RunWorkload } from '../../artifacts';
import EChart from '../../ui/controls/EChart';
import SurfaceCard from '../../ui/controls/SurfaceCard';
import { fmtInt } from '../../ui/format';
import { CHART_THEME } from '../../ui/charts/platform';
import { tokens } from '../../ui/theme';
import { arrivalPatternOption, lengthDistributionOption } from './overviewOption';

interface Property {
  readonly label: string;
  readonly value: string;
}

function distinct(values: readonly unknown[], fallback = 'n/a'): string {
  const present = values.filter(
    (value): value is number | string =>
      (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string',
  );
  return [...new Set(present.map(String))].join(' · ') || fallback;
}

function modelCount(value: number | undefined): string {
  if (value === undefined) return 'n/a';
  if (value >= 1e9) return `${+(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
  return fmtInt(value);
}

function configNumber(model: RunModel | undefined, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = model?.config[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function propertyNumber(value: number | undefined): string {
  return value === undefined ? 'n/a' : fmtInt(value);
}

function modelName(model: RunModel | undefined, topology: RunTopology): string {
  const topologyPath = topology.pools
    .map((pool) => pool.group.params.model_config)
    .find((value): value is string => typeof value === 'string');
  return topologyPath ?? model?.sourcePath ?? 'Model unavailable';
}

function deploymentHeadline(topology: RunTopology): string {
  if (topology.deployment === 'afd') return 'AFD deployment';
  if (topology.deployment === 'pd') return 'Prefill / decode deployment';
  return 'Unified deployment';
}

function PropertyGrid({
  properties,
  columns = 4,
  lastFullWidthOnXs = false,
}: {
  readonly properties: readonly Property[];
  readonly columns?: number;
  readonly lastFullWidthOnXs?: boolean;
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
              fontFamily: tokens.body,
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
              fontFamily: tokens.body,
              fontSize: 12,
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
          fontFamily: tokens.body,
          fontSize: 12,
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
  properties: readonly Property[];
}) {
  return (
    <SurfaceCard
      accent={accent}
      component="section"
      aria-labelledby={id}
      sx={{
        flex: '1 0 auto',
        minHeight: 'min-content',
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
        sx={{ mt: 0.3, fontFamily: tokens.body, fontSize: 12, lineHeight: 1.4, color: tokens.sub }}
      >
        {description}
      </Typography>
      <Box sx={{ mt: 'auto' }}>
        <PropertyGrid properties={properties} />
      </Box>
    </SurfaceCard>
  );
}

function readStatus(result: ArtifactResult<unknown>): string {
  return result.status.replace('_', ' ');
}

export function OverviewCards({
  runId,
  topology,
  model,
  workload,
}: {
  runId: string;
  topology: RunTopology;
  model: RunModel | undefined;
  workload: ArtifactResult<RunWorkload>;
}) {
  const groups = topology.pools.map((pool) => pool.group);
  const param = (...keys: string[]) =>
    distinct(
      groups.map((group) => keys.map((key) => group.params[key]).find((value) => value != null)),
      '1',
    );
  const layers = configNumber(model, 'num_hidden_layers');
  const hidden = configNumber(model, 'hidden_size');
  const attentionHeads = configNumber(model, 'num_attention_heads');
  const kvHeads = configNumber(model, 'num_key_value_heads');
  const contextLength = configNumber(model, 'max_position_embeddings');
  const experts = configNumber(model, 'num_experts');
  const topK = configNumber(model, 'num_experts_per_tok');
  const data = workload.status === 'ready' ? workload.value : null;
  const reason = 'reason' in workload ? workload.reason : undefined;

  return (
    <Box
      data-testid="run-overview-cards"
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
          headline={modelName(model, topology)}
          description={`${experts === undefined ? 'dense transformer' : 'mixture of experts'} · ${distinct(groups.map((group) => group.archType))}`}
          properties={[
            { label: 'Parameters', value: modelCount(model?.parameters?.total) },
            { label: 'Active params', value: modelCount(model?.parameters?.active) },
            { label: 'Layers', value: propertyNumber(layers) },
            { label: 'Hidden size', value: propertyNumber(hidden) },
            { label: 'Attention heads', value: propertyNumber(attentionHeads) },
            { label: 'KV heads', value: propertyNumber(kvHeads) },
            { label: 'Context', value: propertyNumber(contextLength) },
            {
              label: 'Experts / top-k',
              value:
                experts === undefined
                  ? 'dense'
                  : `${fmtInt(experts)} / ${topK === undefined ? 'n/a' : fmtInt(topK)}`,
            },
          ]}
        />
        <OverviewCard
          id="simulation-overview-title"
          title="Simulation overview"
          kind="preset"
          accent={tokens.gold}
          headline={deploymentHeadline(topology)}
          description={
            <>
              {runId}
              <br />
              analyzer folder · topology · parallelism · placement
            </>
          }
          properties={[
            {
              label: 'GPU type',
              value: distinct(groups.map((group) => group.gpu.replace('NVIDIA ', ''))),
            },
            { label: 'GPUs', value: fmtInt(topology.gpus) },
            { label: 'Pools', value: fmtInt(topology.pools.length) },
            {
              label: 'Workers',
              value: fmtInt(groups.reduce((sum, group) => sum + group.replicas, 0)),
            },
            { label: 'Tensor parallel', value: param('attn_tp', 'tp_size', 'attn_tp_size') },
            { label: 'Expert parallel', value: param('ep', 'ep_size') },
            { label: 'Data parallel', value: param('dp', 'dp_groups') },
            { label: 'Placement', value: distinct(topology.pools.map((pool) => pool.placement)) },
          ]}
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
                  data === null
                    ? readStatus(workload)
                    : data.averageInputTokens.toLocaleString('en-US', { maximumFractionDigits: 1 }),
              },
              {
                label: 'Avg output tokens',
                value:
                  data === null
                    ? readStatus(workload)
                    : data.averageOutputTokens.toLocaleString('en-US', {
                        maximumFractionDigits: 1,
                      }),
              },
              {
                label: 'Trace file',
                value:
                  data === null
                    ? readStatus(workload)
                    : data.sourcePaths.map((path) => path.split('/').at(-1) ?? path).join(' · '),
              },
            ]}
          />
        </Box>
        {data === null ? (
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
                Trace distribution {readStatus(workload)}
              </Typography>
              <Typography
                sx={{
                  mt: 0.75,
                  maxWidth: 470,
                  fontFamily: tokens.body,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: tokens.sub,
                }}
              >
                {reason ??
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
                option={lengthDistributionOption(data, CHART_THEME)}
                ariaLabel="Configured trace input and output token length distributions"
              />
            </Box>
            <Box sx={{ minWidth: 0, minHeight: 240 }}>
              <EChart
                option={arrivalPatternOption(data, CHART_THEME)}
                ariaLabel="Configured trace effective request rate over time"
              />
            </Box>
          </Box>
        )}
      </SurfaceCard>
    </Box>
  );
}
