import { Box, Stack, Tooltip, Typography } from '@mui/material';
import SurfaceCard from '../ui/controls/SurfaceCard';
import type { KernelComposition } from '../artifacts';
import { fmtMs, fmtPct, leafByName, type CostTree } from './costTreeModel';
import { familyShares } from './kernelFamilies';
import { kindColor, useKernelKinds } from './kernelTaxonomy';
import { tokens, withAlpha } from '../ui/theme';

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

// Small shares stay proportional and can be selected through the CostTree
// controls instead of inflating their displayed share.
const MIN_INTERACTIVE_SHARE_PCT = 8;

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
          fontFamily: tokens.body,
          fontSize: 12,
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
                  boxShadow: `inset -1.5px 0 ${withAlpha(tokens.tile, 0.65)}`,
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
                      fontSize: 12,
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
                      fontFamily: tokens.body,
                      fontSize: 12,
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

/** The Analyzer's critical-path composition of one exact CostTree, drawn by
 * family and by kernel position. `tree` only resolves a position to the leaf
 * a click selects. */
export function TimeShareBlocksView({
  tree,
  timeShare,
  selectedLeafId,
  onSelectKernel,
}: {
  tree: CostTree;
  timeShare: KernelComposition;
  selectedLeafId: number | null;
  onSelectKernel: (leafId: number) => void;
}) {
  const kinds = useKernelKinds();
  const totalMs = timeShare.kernelTimeMs;

  const groupSegs: Seg[] = familyShares(timeShare.segments, totalMs, kinds).map((family) => ({
    label: family.family,
    full: family.family,
    pct: family.sharePct,
    ms: family.kernelTimeMs,
    color: family.color,
    foreground: tokens.paper,
    nodeId: null,
  }));

  const cutoff = 8;
  const positions = timeShare.segments;
  const top = positions.slice(0, cutoff);
  let acc = 0;
  const posSegs: Seg[] = top.map((segment) => {
    acc += segment.sharePct;
    const node = leafByName(tree, segment.position);
    return {
      label: segment.position.split('.').pop() ?? segment.position,
      full: segment.position,
      pct: segment.sharePct,
      ms: segment.kernelTimeMs,
      color: kindColor(kinds, segment.kind),
      foreground: tokens.paper,
      nodeId: node ? node.id : null,
    };
  });
  if (positions.length > cutoff) {
    const restPct = Math.max(0, 100 - acc);
    posSegs.push({
      label: `other ×${positions.length - cutoff}`,
      full: `${positions.length - cutoff} smaller kernels`,
      pct: restPct,
      ms: (totalMs * restPct) / 100,
      color: tokens.sub2,
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
          <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
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
        <Stack
          direction="row"
          justifyContent="space-between"
          sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub2, letterSpacing: '.05em' }}
        >
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100% of CostTree root wall-clock cost</span>
        </Stack>
        <Typography
          sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub, letterSpacing: '.03em' }}
        >
          Critical-path share of this operation&apos;s CostTree root wall-clock cost by family and
          kernel position.
        </Typography>
      </Stack>
    </SurfaceCard>
  );
}
