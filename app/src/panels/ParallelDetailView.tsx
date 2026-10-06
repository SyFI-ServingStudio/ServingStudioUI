import CloseIcon from '@mui/icons-material/Close';
import { Box, IconButton, Stack, Typography } from '@mui/material';

import SurfaceCard from '../ui/controls/SurfaceCard';
import {
  costTreeDisplayLabel,
  fmtMs,
  fmtPct,
  type CostNode,
  type FanoutNode,
} from './costTreeModel';
import { tokens, withAlpha } from '../ui/theme';

function nodeLabel(node: CostNode): string {
  if (node.kind === 'leaf') return node.slot.name;
  return costTreeDisplayLabel(node.label ?? node.kind);
}

/** Selected fan-out view: a rank Max or same-GPU Parallel streams. It exposes
 * only facts derivable from the validated CostTree algebra; per-rank load and
 * straggler claims require a future artifact. */
export function ParallelDetailView({
  node,
  closeLabel,
  onClose,
}: {
  readonly node: FanoutNode;
  readonly closeLabel: string;
  readonly onClose: () => void;
}) {
  const criticalChild = node.children.reduce((critical, child) =>
    child.ms > critical.ms ? child : critical,
  );
  const streams = node.kind === 'parallel';
  const accent = streams ? tokens.teal : tokens.gold;

  return (
    <SurfaceCard accent={tokens.violet}>
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ gap: 1.5, p: '15px 18px', borderBottom: `1px solid ${tokens.hair}` }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 22 }}>
          {streams ? 'streams' : 'ranks'}{' '}
          <Box
            component="span"
            sx={{ fontFamily: tokens.body, fontSize: 13, color: tokens.violet }}
          >
            {streams ? '≡' : '⇉'} {costTreeDisplayLabel(node.label ?? node.kind)}
          </Box>
        </Typography>
        <Box
          sx={{
            fontFamily: tokens.body,
            fontSize: 12,
            px: 1.1,
            py: 0.4,
            borderRadius: 0.75,
            color: tokens.violet,
            background: withAlpha(tokens.violet, 0.12),
          }}
        >
          {streams ? 'Parallel on one GPU · critical stream' : 'Max over ranks · critical path'}
        </Box>
        <IconButton
          aria-label={closeLabel}
          size="small"
          onClick={onClose}
          sx={{ ml: 'auto', color: tokens.sub }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' },
          '& > div': { p: '12px 18px', borderBottom: `1px solid ${tokens.hair}` },
        }}
      >
        <div>
          wall-time
          <br />
          <b>{fmtMs(node.ms)}</b>
        </div>
        <div>
          share of tree root
          <br />
          <b>{fmtPct(node.pct)}</b>
        </div>
        <div>
          {streams ? 'streams' : 'ranks'}
          <br />
          <b>{node.children.length}</b>
        </div>
        <div>
          critical child
          <br />
          <b>{nodeLabel(criticalChild)}</b>
        </div>
      </Box>
      {streams ? (
        <Box
          role="note"
          sx={{ m: 1.5, p: 1.5, borderLeft: `3px solid ${accent}`, background: tokens.tile }}
        >
          <Typography sx={{ fontFamily: tokens.serif, fontSize: 14, fontWeight: 600 }}>
            Streams overlap; they are not balanced
          </Typography>
          <Typography sx={{ mt: 0.35, fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
            The streams run different work at the same time on one GPU. Wall time is the slowest
            stream divided by the overlap, while their work still adds, so the gap between streams
            is overlap and never counts as imbalance.
          </Typography>
        </Box>
      ) : (
        <Box
          role="status"
          sx={{ m: 1.5, p: 1.5, borderLeft: `3px solid ${accent}`, background: tokens.tile }}
        >
          <Typography sx={{ fontFamily: tokens.serif, fontSize: 14, fontWeight: 600 }}>
            Load-imbalance detail not generated
          </Typography>
          <Typography sx={{ mt: 0.35, fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
            Analyzer v1 has no versioned per-lane load or straggler artifact. The critical child
            above is the real CostTree Max result, not an inferred lane measurement.
          </Typography>
          <Typography sx={{ mt: 0.5, fontFamily: tokens.body, fontSize: 12, color: tokens.sub2 }}>
            evidence status · not_generated
          </Typography>
        </Box>
      )}
    </SurfaceCard>
  );
}
