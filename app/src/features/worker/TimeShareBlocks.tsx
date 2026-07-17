import { Box, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { useViz } from '../../store';
import { useActiveWorkerTreeState } from '../../application/WorkerTreeProvider';
import { tokens } from '../../theme';
import { criticalLeafTotals, leafByName, colorOf, fmtMs, fmtPct } from '../../domain/cost-tree';

interface Seg {
  label: string;
  full: string;
  pct: number;
  ms: number;
  color: string;
  nodeId: number | null;
  other?: boolean;
}

// The supported 390 px layout leaves this bar more than 300 px wide, so an
// 8% share is a real >=24 px target. Responsive E2E locks that geometry; smaller
// shares stay proportional and use the equivalent CostTree leaf-card action.
const MIN_INTERACTIVE_SHARE_PCT = 8;

function Bar({
  title,
  note,
  segs,
  clickable,
}: {
  title: string;
  note: string;
  segs: Seg[];
  clickable: boolean;
}) {
  const scope = useViz((state) => state.scope);
  const leafId = useViz((state) => state.leafId);
  const selectKernel = useViz((state) => state.selectKernel);
  return (
    <Stack spacing={0.9}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          fontFamily: tokens.mono,
          fontSize: 9.5,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: tokens.sub,
        }}
      >
        <span>{title}</span>
        <Box
          component="span"
          sx={{ color: tokens.sub2, letterSpacing: '.02em', textTransform: 'none' }}
        >
          {note}
        </Box>
      </Stack>
      <Box
        role={clickable ? 'group' : undefined}
        aria-label={clickable ? 'Kernel position time share' : undefined}
        sx={{
          position: 'relative',
          display: 'flex',
          width: '100%',
          height: 42,
          borderRadius: 1.25,
          overflow: 'hidden',
          border: `1px solid ${tokens.hair}`,
          background: tokens.tile2,
        }}
      >
        {segs.map((s, i) => {
          const selected =
            clickable && scope === 'kernel' && s.nodeId != null && s.nodeId === leafId;
          const tinyShare = clickable && s.pct < MIN_INTERACTIVE_SHARE_PCT;
          const interactive = clickable && s.nodeId != null && !tinyShare;
          const accessibleLabel = `${s.full} — ${fmtMs(s.ms)} · ${fmtPct(s.pct)}`;
          return (
            <Tooltip key={i} title={accessibleLabel} arrow placement="top" describeChild>
              <Box
                component={interactive ? 'button' : 'div'}
                type={interactive ? 'button' : undefined}
                role={interactive ? undefined : 'img'}
                aria-label={accessibleLabel}
                aria-pressed={interactive ? selected : undefined}
                onClick={
                  interactive
                    ? () => {
                        if (s.nodeId !== null) selectKernel(s.nodeId);
                      }
                    : undefined
                }
                sx={{
                  position: 'relative',
                  height: '100%',
                  width: `${s.pct}%`,
                  boxSizing: 'border-box',
                  flex: '0 0 auto',
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  px: tinyShare ? 0 : 1.4,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  appearance: 'none',
                  font: 'inherit',
                  textAlign: 'left',
                  borderTop: 0,
                  borderBottom: 0,
                  borderLeft: 0,
                  cursor: interactive ? 'pointer' : 'default',
                  background: s.color,
                  borderRight: 0,
                  boxShadow: 'inset -1.5px 0 rgba(250,247,240,.65)',
                  outline: selected ? `2.5px solid ${tokens.ink}` : 'none',
                  outlineOffset: -2.5,
                  zIndex: selected ? 4 : 1,
                  transition: `filter .18s ${tokens.ease}`,
                  ...(interactive
                    ? { '&:hover': { filter: 'brightness(1.07) saturate(1.05)' } }
                    : {}),
                  '&:focus-visible': {
                    outline: `2.5px solid ${tokens.ink}`,
                    outlineOffset: -2.5,
                    zIndex: 5,
                  },
                  '&:last-of-type': { boxShadow: 'none' },
                }}
              >
                {s.pct >= 5 && (
                  <Typography
                    sx={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: s.other ? tokens.sub : '#fff',
                      textShadow: s.other ? 'none' : '0 1px 1px rgba(0,0,0,.2)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {s.label}
                  </Typography>
                )}
                {s.pct >= 3 && (
                  <Typography
                    sx={{
                      fontFamily: tokens.mono,
                      fontSize: 9,
                      color: s.other ? tokens.sub : '#fff',
                    }}
                  >
                    {fmtPct(s.pct)}
                  </Typography>
                )}
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Stack>
  );
}

export default function TimeShareBlocks() {
  const treeState = useActiveWorkerTreeState();
  if (treeState.status !== 'ready') {
    throw new Error(
      `TimeShareBlocks requires ready worker evidence, received ${treeState.status}.`,
    );
  }
  const tree = treeState.tree;
  const lt = criticalLeafTotals(tree);

  const groupSegs: Seg[] = lt.groups.map((g) => ({
    label: g.label,
    full: g.label,
    pct: g.pct,
    ms: g.ms,
    color: g.color,
    nodeId: null,
  }));

  const cutoff = 8;
  const top = lt.positions.slice(0, cutoff);
  let acc = 0;
  const posSegs: Seg[] = top.map((p) => {
    acc += p.pct;
    const node = leafByName(tree, p.name);
    return {
      label: p.name.split('.').pop() ?? p.name,
      full: p.name,
      pct: p.pct,
      ms: p.ms,
      color: colorOf(p.kind),
      nodeId: node ? node.id : null,
    };
  });
  if (lt.positions.length > cutoff) {
    const restPct = Math.max(0, 100 - acc);
    posSegs.push({
      label: `other ×${lt.positions.length - cutoff}`,
      full: `${lt.positions.length - cutoff} smaller kernels`,
      pct: restPct,
      ms: (lt.totalMs * restPct) / 100,
      color: '#e5ddca',
      nodeId: null,
      other: true,
    });
  }

  return (
    <Paper sx={{ borderRadius: 2, p: '16px 18px 18px' }}>
      <Stack spacing={2}>
        <Bar
          title="by kernel family"
          note="critical path · root wall-clock"
          segs={groupSegs}
          clickable={false}
        />
        <Bar
          title="by kernel position"
          note="critical path · large shares select"
          segs={posSegs}
          clickable
        />
        <Stack
          direction="row"
          justifyContent="space-between"
          sx={{ fontFamily: tokens.mono, fontSize: 9, color: tokens.sub2, letterSpacing: '.05em' }}
        >
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100% of CostTree root wall-clock cost</span>
        </Stack>
      </Stack>
    </Paper>
  );
}
