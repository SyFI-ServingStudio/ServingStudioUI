import CloseIcon from '@mui/icons-material/Close';
import { Box, IconButton, Paper, Stack, Typography } from '@mui/material';

import { useActiveRun, useActiveRunSubject } from '../../application/ActiveRunProvider';
import { currentWorker } from '../../application/runSelection';
import { useActiveWorkerTreeState } from '../../application/WorkerTreeProvider';
import { colorOf, fmtMs, fmtPct, kindLabel, leafById, type LeafNode } from '../../domain/cost-tree';
import type { KernelRateStats } from '../../domain/kernelThroughput';
import type { SubjectName, SubjectResult } from '../../domain/subject';
import { useViz } from '../../store';
import { tokens } from '../../theme';

function Item({
  label,
  value,
  big,
  teal,
}: {
  label: string;
  value: string;
  big?: boolean;
  teal?: boolean;
}) {
  return (
    <Box
      sx={{
        p: '12px 18px',
        borderTop: `1px solid ${tokens.hair}`,
        borderRight: `1px solid ${tokens.hair}`,
        '&:last-of-type': { borderRight: 'none' },
      }}
    >
      <Typography
        sx={{
          fontFamily: tokens.mono,
          fontSize: 9.5,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: tokens.sub,
          mb: 0.6,
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontFamily: big ? tokens.serif : tokens.mono,
          fontSize: big ? 22 : 12.5,
          fontWeight: big ? 600 : 400,
          color: teal ? tokens.teal : tokens.ink,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </Typography>
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

function RealKernelEvidence({ node }: { node: LeafNode }) {
  const throughput = useActiveRunSubject('kernelThroughput');
  const inputDistribution = useActiveRunSubject('kernelInputDistribution');
  const location =
    throughput.status === 'ready'
      ? throughput.payload.locations.find(
          (candidate) => candidate.name === node.slot.name && candidate.kind === node.slot.kind,
        )
      : undefined;

  return (
    <Box
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
      <EvidenceStatus title="Kernel input distribution" subject={inputDistribution} />
    </Box>
  );
}

/** Selected-leaf view. Cost and slot identity are CostTree facts; optional
 * performance fields are shown only when their Analyzer subject is ready. */
export default function KernelDetail() {
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

  return (
    <Paper sx={{ borderRadius: 2, overflow: 'hidden', background: tokens.tile2 }}>
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ gap: 1.5, p: '15px 18px', borderBottom: `1px solid ${tokens.hair}` }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 22 }}>
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
        sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' } }}
      >
        <Item label="cost / call" value={fmtMs(node.ms)} big teal />
        <Item label="share of tree root" value={fmtPct(node.pct)} big />
        <Item label="slot" value={slot.name} />
        <Item label="kind" value={slot.kind} />
        <Item label="backend" value={slot.backend ?? 'not recorded'} />
        <Item label="config" value={slot.config || 'not recorded'} />
      </Box>
      <RealKernelEvidence node={node} />
    </Paper>
  );
}
