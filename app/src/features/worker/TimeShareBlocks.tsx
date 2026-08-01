import { Box, Stack, Tooltip, Typography } from '@mui/material';
import SurfaceCard from '../../components/SurfaceCard';
import { useViz } from '../../store';
import { useActiveWorkerTreeState } from '../../application/WorkerTreeProvider';
import { tokens } from '../../theme';
import {
  criticalLeafTotals,
  GROUP,
  GROUP_ORDER,
  leafByName,
  fmtMs,
  fmtPct,
  type CostTree,
} from '../../domain/cost-tree';

interface Seg {
  label: string;
  full: string;
  pct: number;
  ms: number;
  color: string;
  foreground: string;
  nodeId: number | null;
  other?: boolean;
}

// The supported 390 px layout leaves this bar more than 300 px wide, so an
// 8% share is a real >=24 px target. Responsive E2E locks that geometry; smaller
// shares stay proportional and use the equivalent CostTree leaf-card action.
const MIN_INTERACTIVE_SHARE_PCT = 8;

type PreviewPalette = Readonly<
  Record<string, { readonly color: string; readonly foreground: string }>
>;

const MINERAL_PALETTE: PreviewPalette = Object.fromEntries(
  GROUP_ORDER.map((group) => [group, { color: GROUP[group].color, foreground: '#fff' }]),
);

// Light palette candidate intentionally disabled after review:
// gemm #a9bdd2, attn #a8cdb8, comm #d4b0be,
// norm #c7d6a3, route #c2b8dc, misc #c5ccd2.

function PalettePreviewBar({ palette }: { palette: PreviewPalette }) {
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
        <span>all kernel families</span>
        <Box
          component="span"
          sx={{ color: tokens.sub2, letterSpacing: '.02em', textTransform: 'none' }}
        >
          equal-width · visual only
        </Box>
      </Stack>
      <Box
        role="group"
        aria-label="All kernel family colors"
        sx={{
          display: 'flex',
          height: 42,
          overflow: 'hidden',
          border: `1px solid ${tokens.hair}`,
          borderRadius: 1.25,
        }}
      >
        {GROUP_ORDER.map((group) => {
          const family = GROUP[group];
          const swatch = palette[group];
          return (
            <Tooltip key={group} title={`${family.label} · ${swatch.color}`} arrow placement="top">
              <Box
                role="img"
                aria-label={`${family.label} color ${swatch.color}`}
                sx={{
                  display: 'flex',
                  width: `${100 / GROUP_ORDER.length}%`,
                  minWidth: 0,
                  alignItems: 'center',
                  px: 1,
                  color: swatch.foreground,
                  background: swatch.color,
                  boxShadow: 'inset -1.5px 0 rgba(250,247,240,.65)',
                  '&:last-of-type': { boxShadow: 'none' },
                }}
              >
                <Typography noWrap sx={{ fontSize: 10, fontWeight: 600 }}>
                  {family.label}
                </Typography>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Stack>
  );
}

function Bar({
  title,
  note,
  segs,
  clickable,
  selectedLeafId,
  onSelectKernel,
}: {
  title: string;
  note?: string;
  segs: Seg[];
  clickable: boolean;
  selectedLeafId: number | null;
  onSelectKernel: (leafId: number) => void;
}) {
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
        {note && (
          <Box
            component="span"
            sx={{ color: tokens.sub2, letterSpacing: '.02em', textTransform: 'none' }}
          >
            {note}
          </Box>
        )}
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
          const selected = clickable && s.nodeId != null && s.nodeId === selectedLeafId;
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
                        if (s.nodeId !== null) onSelectKernel(s.nodeId);
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
                      color: s.foreground,
                      textShadow: 'none',
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
                      color: s.foreground,
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
  const scope = useViz((state) => state.scope);
  const leafId = useViz((state) => state.leafId);
  const selectKernel = useViz((state) => state.selectKernel);
  if (treeState.status !== 'ready') {
    throw new Error(
      `TimeShareBlocks requires ready worker evidence, received ${treeState.status}.`,
    );
  }
  return (
    <TimeShareBlocksView
      tree={treeState.tree}
      selectedLeafId={scope === 'kernel' ? leafId : null}
      onSelectKernel={selectKernel}
    />
  );
}

export function TimeShareBlocksView({
  tree,
  selectedLeafId,
  onSelectKernel,
}: {
  tree: CostTree;
  selectedLeafId: number | null;
  onSelectKernel: (leafId: number) => void;
}) {
  const lt = criticalLeafTotals(tree);
  const palette = MINERAL_PALETTE;

  const groupSegs: Seg[] = lt.groups.map((g) => ({
    label: g.label,
    full: g.label,
    pct: g.pct,
    ms: g.ms,
    color: palette[g.group].color,
    foreground: palette[g.group].foreground,
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
      color: palette[p.group].color,
      foreground: palette[p.group].foreground,
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
      foreground: tokens.sub,
      nodeId: null,
      other: true,
    });
  }

  return (
    <SurfaceCard
      component="section"
      aria-labelledby="operation-kernel-time-breakdown-title"
      sx={{ p: '16px 16px 14px' }}
    >
      <Box sx={{ mb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            id="operation-kernel-time-breakdown-title"
            component="h3"
            sx={{
              fontFamily: tokens.serif,
              fontWeight: 600,
              fontSize: 16,
              letterSpacing: '-.01em',
            }}
          >
            Kernel time breakdown
          </Typography>
          <Typography sx={{ fontFamily: tokens.mono, fontSize: 10, color: tokens.sub }}>
            critical path · root wall-clock
          </Typography>
        </Box>
      </Box>
      <Stack spacing={1.65}>
        <Bar
          title="by kernel family"
          segs={groupSegs}
          clickable={false}
          selectedLeafId={selectedLeafId}
          onSelectKernel={onSelectKernel}
        />
        <Bar
          title="by kernel position"
          note="critical path · large shares select"
          segs={posSegs}
          clickable
          selectedLeafId={selectedLeafId}
          onSelectKernel={onSelectKernel}
        />
        <PalettePreviewBar palette={palette} />
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
        <Typography
          sx={{ fontFamily: tokens.mono, fontSize: 10, color: tokens.sub, letterSpacing: '.03em' }}
        >
          Critical-path share of this operation&apos;s CostTree root wall-clock cost by family and
          kernel position.
        </Typography>
      </Stack>
    </SurfaceCard>
  );
}
