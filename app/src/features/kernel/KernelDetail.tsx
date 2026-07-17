import CloseIcon from '@mui/icons-material/Close';
import { Box, IconButton, Stack, Typography } from '@mui/material';
import { Fragment, type ReactNode } from 'react';

import { useActiveRun, useActiveRunSubject } from '../../application/ActiveRunProvider';
import { currentWorker } from '../../application/runSelection';
import { useActiveWorkerTreeState } from '../../application/WorkerTreeProvider';
import SurfaceCard from '../../components/SurfaceCard';
import { colorOf, fmtMs, fmtPct, kindLabel, leafById, type LeafNode } from '../../domain/cost-tree';
import type { KernelRateStats } from '../../domain/kernelThroughput';
import type { SubjectName, SubjectResult } from '../../domain/subject';
import { useViz } from '../../store';
import { tokens } from '../../theme';
import KernelInputDistributionEvidence from './KernelInputDistributionEvidence';

function Item({
  label,
  value,
  teal,
  valueTitle,
}: {
  label: string;
  value: ReactNode;
  teal?: boolean;
  valueTitle?: string;
}) {
  return (
    <Box
      sx={{
        minWidth: 0,
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(82px,0.7fr) minmax(0,1.3fr)',
        },
        alignItems: 'start',
        gap: 1,
        py: 0.45,
        '&:not(:last-of-type)': { borderBottom: `1px solid ${tokens.hair}` },
      }}
    >
      <Typography
        sx={{
          fontFamily: tokens.mono,
          fontSize: 9.5,
          fontWeight: 650,
          lineHeight: 1.35,
          letterSpacing: '.055em',
          textTransform: 'uppercase',
          color: tokens.ink,
          pt: 0.15,
        }}
      >
        {label}
      </Typography>
      <Box
        component="div"
        title={valueTitle}
        sx={{
          fontFamily: tokens.mono,
          fontSize: 11.5,
          fontWeight: 500,
          lineHeight: 1.45,
          color: teal ? tokens.teal : tokens.ink,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </Box>
    </Box>
  );
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box
      component="section"
      sx={{
        p: '9px 11px 7px',
        border: `1px solid ${tokens.hair}`,
        borderRadius: 1.25,
        background: tokens.tile,
      }}
    >
      <Typography
        component="h3"
        sx={{
          mb: 0.2,
          pb: 0.55,
          borderBottom: `1px solid ${tokens.hair}`,
          fontFamily: tokens.serif,
          fontSize: 13,
          fontWeight: 600,
          color: tokens.ink,
        }}
      >
        {title}
      </Typography>
      <Box>{children}</Box>
    </Box>
  );
}

interface DisplayField {
  readonly label: string;
  readonly value: string;
}

function FieldList({ fields }: { fields: readonly DisplayField[] }) {
  return (
    <Box
      component="dl"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'max-content minmax(0,1fr)',
        gap: '3px 8px',
        m: 0,
      }}
    >
      {fields.map((field) => (
        <Fragment key={field.label}>
          <Typography
            component="dt"
            sx={{
              fontFamily: tokens.mono,
              fontSize: 9,
              fontWeight: 600,
              color: tokens.sub,
            }}
          >
            {field.label}
          </Typography>
          <Typography
            component="dd"
            sx={{
              m: 0,
              fontFamily: tokens.mono,
              fontSize: 10.5,
              fontWeight: 500,
              color: tokens.ink,
            }}
          >
            {field.value}
          </Typography>
        </Fragment>
      ))}
    </Box>
  );
}

function nonReadyReason<Name extends SubjectName>(subject: SubjectResult<Name>): string {
  return 'reason' in subject && subject.reason
    ? subject.reason
    : `Analyzer subject ${subject.subject} is ${subject.status}.`;
}

function EvidenceStatus({
  title,
  subject,
  readyText,
}: {
  title: string;
  subject: SubjectResult<SubjectName>;
  readyText?: string;
}) {
  const failed = subject.status === 'failed';
  return (
    <Box
      role={failed ? 'alert' : 'status'}
      sx={{
        p: 1.5,
        border: `1px solid ${tokens.hair}`,
        borderLeft: `3px solid ${failed ? tokens.terra : tokens.gold}`,
        borderRadius: 1.25,
        background: tokens.tile,
      }}
    >
      <Typography sx={{ fontFamily: tokens.serif, fontSize: 14, fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography sx={{ mt: 0.35, fontFamily: tokens.mono, fontSize: 10, color: tokens.sub }}>
        {subject.status === 'ready'
          ? (readyText ?? 'Ready Analyzer evidence.')
          : nonReadyReason(subject)}
      </Typography>
      <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 9, color: tokens.sub2 }}>
        evidence status · {subject.status}
      </Typography>
    </Box>
  );
}

function formatRate(stats: KernelRateStats, unit: string): string {
  return stats.p50 === null ? `0 samples · ${unit}` : `${stats.p50.toFixed(1)} ${unit} · p50`;
}

function compactNumber(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
  });
}

function scaledQuantity(
  value: number | null,
  scales: readonly { divisor: number; unit: string }[],
): { display: string; exact?: string } {
  if (value === null) return { display: 'not recorded' };
  const scale = scales.find((candidate) => Math.abs(value) >= candidate.divisor) ?? scales.at(-1);
  if (scale === undefined) return { display: value.toLocaleString() };
  return {
    display: `${compactNumber(value / scale.divisor)} ${scale.unit}`,
    exact: value.toLocaleString(),
  };
}

const FLOP_SCALES = [
  { divisor: 1e15, unit: 'PFLOP' },
  { divisor: 1e12, unit: 'TFLOP' },
  { divisor: 1e9, unit: 'GFLOP' },
  { divisor: 1e6, unit: 'MFLOP' },
  { divisor: 1, unit: 'FLOP' },
] as const;

const BYTE_SCALES = [
  { divisor: 1e12, unit: 'TB' },
  { divisor: 1e9, unit: 'GB' },
  { divisor: 1e6, unit: 'MB' },
  { divisor: 1e3, unit: 'KB' },
  { divisor: 1, unit: 'B' },
] as const;

function humanFieldLabel(key: string): string {
  if (/^[mnk]$/.test(key)) return key.toUpperCase();
  const labels: Readonly<Record<string, string>> = {
    backends: 'Backends',
    gpu_name: 'GPU',
    dtype: 'Data type',
  };
  return labels[key] ?? key.replace(/_/g, ' ');
}

function humanScalar(value: unknown): string {
  if (typeof value === 'string') {
    const fp8 = /^Fp8(E\dM\d)$/i.exec(value);
    return fp8 === null ? value : `FP8 ${fp8[1].toUpperCase()}`;
  }
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value === null) return 'none';
  if (Array.isArray(value)) return value.map(humanScalar).join(', ');
  return JSON.stringify(value);
}

function configFields(config: string): readonly DisplayField[] {
  const fields: DisplayField[] = [];
  const fieldPattern = /(\w+)=((?:\[[^\]]*\])|(?:"[^"]*")|(?:'[^']*')|[^\s]+)/g;
  for (const match of config.matchAll(fieldPattern)) {
    const [, key, encoded] = match;
    let decoded: unknown = encoded;
    try {
      decoded = JSON.parse(encoded.replace(/'/g, '"'));
    } catch {
      decoded = encoded.replace(/^['"]|['"]$/g, '');
    }
    fields.push({ label: humanFieldLabel(key), value: humanScalar(decoded) });
  }
  return fields;
}

function inputFields(node: LeafNode): readonly DisplayField[] {
  const input = node.stats.input;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return [];
  return Object.entries(input).map(([key, value]) => ({
    label: humanFieldLabel(key),
    value: humanScalar(value),
  }));
}

function RealKernelEvidence({ node }: { node: LeafNode }) {
  const throughput = useActiveRunSubject('kernelThroughput');
  const location =
    throughput.status === 'ready'
      ? throughput.payload.locations.find(
          (candidate) => candidate.name === node.slot.name && candidate.kind === node.slot.kind,
        )
      : undefined;

  return (
    <Box
      data-testid="kernel-evidence"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'repeat(2,minmax(0,1fr))' },
        gap: 1.5,
        p: 1.5,
        borderTop: `1px solid ${tokens.hair}`,
      }}
    >
      {throughput.status === 'ready' && location !== undefined ? (
        <Box
          role="status"
          sx={{
            p: 1.5,
            border: `1px solid ${tokens.hair}`,
            borderRadius: 1.25,
            background: tokens.tile,
          }}
        >
          <Typography sx={{ fontFamily: tokens.serif, fontSize: 14, fontWeight: 600 }}>
            Aggregate sampled throughput
          </Typography>
          <Typography sx={{ mt: 0.35, fontFamily: tokens.mono, fontSize: 10, color: tokens.sub }}>
            {formatRate(location.tflops, throughput.payload.units.tflops)} ·{' '}
            {formatRate(location.gbps, throughput.payload.units.gbps)}
          </Typography>
          <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 9, color: tokens.sub2 }}>
            run aggregate · {location.tflops.sampleCount} compute samples ·{' '}
            {location.gbps.sampleCount} memory samples
          </Typography>
        </Box>
      ) : (
        <EvidenceStatus
          title={
            throughput.status === 'ready'
              ? 'No sampled throughput for this location'
              : 'Kernel throughput evidence'
          }
          subject={throughput}
          readyText={`Ready aggregate payload has no exact (${node.slot.name}, ${node.slot.kind}) location.`}
        />
      )}
      <KernelInputDistributionEvidence positionName={node.slot.name} />
    </Box>
  );
}

/** Selected-leaf view. Cost and slot identity are CostTree facts; optional
 * performance fields are shown only when their Analyzer subject is ready. */
export default function KernelDetail({ height }: { height: number | string }) {
  const scope = useViz((state) => state.scope);
  const workerKey = useViz((state) => state.workerKey);
  const leafId = useViz((state) => state.leafId);
  const selectWorker = useViz((state) => state.selectWorker);
  const run = useActiveRun();
  const treeState = useActiveWorkerTreeState();
  if (scope !== 'kernel' || leafId === null) return null;
  if (treeState.status !== 'ready') return null;
  const worker = currentWorker(run, { workerKey });
  const node = leafById(treeState.tree, leafId);
  if (node === null) return null;
  const slot = node.slot;
  const color = colorOf(slot.kind);
  const decodedConfig = configFields(slot.config);
  const decodedInput = inputFields(node);
  const flops = scaledQuantity(node.stats.flops, FLOP_SCALES);
  const bytes = scaledQuantity(node.stats.bytes, BYTE_SCALES);
  const throughput = scaledQuantity(node.stats.tflops, [
    { divisor: 1000, unit: 'PFLOP/s' },
    { divisor: 1, unit: 'TFLOP/s' },
  ]);
  const bandwidth = scaledQuantity(node.stats.gbps, [
    { divisor: 1000, unit: 'TB/s' },
    { divisor: 1, unit: 'GB/s' },
  ]);

  return (
    <SurfaceCard
      data-testid="kernel-inspector"
      sx={{
        height,
        minHeight: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ flexShrink: 0, gap: 1, p: '10px 12px' }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 18 }}>
          {slot.name.split('.').pop()}
        </Typography>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            fontFamily: tokens.mono,
            fontSize: 10.5,
            px: 1.1,
            py: 0.4,
            borderRadius: 0.75,
            color,
            border: `1px solid ${color}55`,
            background: tokens.leafbg,
          }}
        >
          <Box sx={{ width: 8, height: 8, borderRadius: '2px', background: color }} />
          {kindLabel(slot.kind)}
        </Box>
        <IconButton
          aria-label={`Back to worker ${worker.ref.poolTag}/${worker.ref.workerId}`}
          size="small"
          onClick={() => selectWorker(worker.ref)}
          sx={{ ml: 'auto', color: tokens.sub }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>
      <Box
        data-testid="kernel-detail-cards"
        sx={{
          display: 'grid',
          flex: 1,
          minHeight: 0,
          gridTemplateColumns: 'minmax(0,1fr)',
          alignItems: 'stretch',
          gap: 0.75,
          p: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          borderTop: `1px solid ${tokens.hair}`,
        }}
      >
        <DetailGroup title="Overview">
          <Item label="cost / call" value={fmtMs(node.ms)} teal />
          <Item label="share of tree root" value={fmtPct(node.pct)} />
          <Item label="slot" value={slot.name} />
          <Item label="kind" value={slot.kind} />
          <Item label="backend" value={slot.backend ?? 'not recorded'} />
        </DetailGroup>
        <DetailGroup title="Execution">
          <Item
            label="config"
            value={
              decodedConfig.length === 0 ? 'not recorded' : <FieldList fields={decodedConfig} />
            }
          />
          <Item
            label="exact input"
            value={decodedInput.length === 0 ? 'not recorded' : <FieldList fields={decodedInput} />}
          />
        </DetailGroup>
        <DetailGroup title="Performance">
          <Item
            label="exact FLOPs"
            value={flops.display}
            valueTitle={flops.exact === undefined ? undefined : `${flops.exact} FLOPs`}
          />
          <Item
            label="exact bytes"
            value={bytes.display}
            valueTitle={bytes.exact === undefined ? undefined : `${bytes.exact} bytes`}
          />
          <Item label="exact throughput" value={throughput.display} />
          <Item label="exact bandwidth" value={bandwidth.display} />
        </DetailGroup>
      </Box>
    </SurfaceCard>
  );
}

/** Aggregate subjects remain below the joint workbench so they never compete
 * with the exact-operation CostTree for horizontal inspector space. */
export function KernelEvidence() {
  const scope = useViz((state) => state.scope);
  const leafId = useViz((state) => state.leafId);
  const treeState = useActiveWorkerTreeState();
  if (scope !== 'kernel' || leafId === null || treeState.status !== 'ready') return null;
  const node = leafById(treeState.tree, leafId);
  return node === null ? null : <RealKernelEvidence node={node} />;
}
