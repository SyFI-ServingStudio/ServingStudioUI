import { Box, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useViz } from '../store';
import { currentWorker } from '../application/runSelection';
import { useActiveRun } from '../application/ActiveRunProvider';
import { useProjectedWorkerTree } from '../application/useProjectedWorkerTree';
import { nodeById, leafById, fmtMs, kindLabel } from '../data/tree';
import { imbalanceFor, type Imbalance } from '../data/imbalance';
import { kernelPerf } from '../data/kernel';
import { tokens } from '../theme';

function Item({
  k,
  v,
  big,
  teal,
  terra,
}: {
  k: string;
  v: string;
  big?: boolean;
  teal?: boolean;
  terra?: boolean;
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
        {k}
      </Typography>
      <Typography
        sx={{
          fontFamily: big ? tokens.serif : tokens.mono,
          fontSize: big ? 22 : 12.5,
          fontWeight: big ? 600 : 400,
          color: terra ? tokens.terra : teal ? tokens.teal : tokens.ink,
          wordBreak: 'break-word',
        }}
      >
        {v}
      </Typography>
    </Box>
  );
}

/** Per-lane average load, drawn as a compact strip; the straggler is highlighted. */
function LaneStrip({ imb }: { imb: Imbalance }) {
  const max = Math.max(...imb.perLaneAvg, 1);
  const many = imb.lanes > 24;
  return (
    <Box sx={{ p: '12px 18px 14px', borderTop: `1px solid ${tokens.hair}` }}>
      <Typography
        sx={{
          fontFamily: tokens.mono,
          fontSize: 9.5,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: tokens.sub,
          mb: 0.8,
        }}
      >
        load per lane · {imb.label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: many ? '2px' : '4px', height: 46 }}>
        {imb.perLaneAvg.map((v, i) => {
          const isStrag = i === imb.stragglerLane;
          return (
            <Tooltip
              key={i}
              title={`${imb.laneLabels[i]} · ${v.toFixed(2)}× mean${isStrag ? ' · straggler' : ''}`}
              arrow
              enterDelay={80}
            >
              <Box
                sx={{
                  flex: 1,
                  minWidth: 0,
                  height: `${Math.max(6, (v / max) * 100)}%`,
                  borderRadius: '2px 2px 0 0',
                  background: isStrag ? tokens.terra : 'rgba(122,92,255,.45)',
                  outline: isStrag ? `1px solid ${tokens.terra}` : 'none',
                }}
              />
            </Tooltip>
          );
        })}
      </Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 9, color: tokens.sub2 }}
      >
        <span>lane 0</span>
        <span>
          1.0× = balanced ·{' '}
          <b style={{ color: tokens.terra }}>straggler {imb.laneLabels[imb.stragglerLane]}</b>
        </span>
        <span>lane {imb.lanes - 1}</span>
      </Stack>
    </Box>
  );
}

/** Bottom panel when a Max ("parallel") node is selected: identifies the lanes,
 *  the straggler that sets the node's wall-time, and its achieved perf. */
export default function ParallelDetail() {
  const scope = useViz((state) => state.scope);
  const workerKey = useViz((state) => state.workerKey);
  const parId = useViz((state) => state.parId);
  const selectWorker = useViz((state) => state.selectWorker);
  const run = useActiveRun();
  const w = currentWorker(run, { workerKey });
  const tree = useProjectedWorkerTree();
  if (scope !== 'parallel' || parId == null) return null;
  const node = nodeById(tree, parId);
  if (!node || node.kind !== 'max') return null;
  const imb = imbalanceFor(run, w, node);
  const sLeaf = leafById(tree, imb.stragglerLeafId);
  const perf = sLeaf ? kernelPerf(sLeaf) : null;
  const stragKind = sLeaf ? kindLabel(sLeaf.slot.kind) : '—';

  return (
    <Paper sx={{ borderRadius: 2, overflow: 'hidden', background: tokens.tile2 }}>
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{
          gap: 1.5,
          p: '15px 18px',
          borderBottom: `1px solid ${tokens.hair}`,
          background: 'linear-gradient(180deg, rgba(122,92,255,.07), transparent)',
        }}
      >
        <Typography
          sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 22, letterSpacing: '-.015em' }}
        >
          parallel{' '}
          <Box
            component="span"
            sx={{ fontFamily: tokens.mono, fontSize: 13, color: tokens.violet }}
          >
            ⇉ {node.label ?? 'max'}
          </Box>
        </Typography>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            fontFamily: tokens.mono,
            fontSize: 10.5,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            px: 1.1,
            py: 0.4,
            borderRadius: 0.75,
            color: tokens.violet,
            background: 'rgba(122,92,255,.12)',
          }}
        >
          {imb.label} · overlap {imb.overlap.toFixed(2)}
        </Box>
        <IconButton
          aria-label={`Back to worker ${w.ref.poolTag}/${w.ref.workerId}`}
          size="small"
          onClick={() => selectWorker(w.ref)}
          sx={{
            ml: 'auto',
            color: tokens.sub,
            '&:hover': { color: '#fff', background: tokens.terra },
          }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>
      <Box
        sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' } }}
      >
        <Item k="wall-time" v={fmtMs(imb.nodeMs)} big teal />
        <Item
          k="straggler lane"
          v={`${imb.laneLabels[imb.stragglerLane]} · ${imb.stragglerFactor}× mean`}
          big
          terra
        />
        <Item k="max imbalance" v={`+${imb.maxImbalancePct}%`} big terra />
        <Item k="lanes" v={`${imb.lanes} · ${imb.dim}`} big />
        <Item k="straggler kernel" v={`${imb.stragglerName.split('.').pop()} · ${stragKind}`} />
        <Item k="straggler TFLOP/s" v={perf ? `${perf.tflops}` : '—'} teal />
        <Item k="straggler GB/s" v={perf ? `${perf.gbps}` : '—'} teal />
        <Item k="avg imbalance" v={`+${imb.avgImbalancePct}%`} />
      </Box>
      <LaneStrip imb={imb} />
    </Paper>
  );
}
