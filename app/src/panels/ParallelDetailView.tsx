import CloseIcon from '@mui/icons-material/Close';
import { Box, IconButton, Stack, Typography } from '@mui/material';

import SurfaceCard from '../ui/controls/SurfaceCard';
import { costTreeDisplayLabel, fmtMs, fmtPct, type CostNode, type MaxNode } from './costTreeModel';
import { tokens, withAlpha } from '../ui/theme';

function nodeLabel(node: CostNode): string {
  if (node.kind === 'leaf') return node.slot.name;
  return costTreeDisplayLabel(node.label ?? node.kind);
}

/** Selected Max view. It exposes only facts derivable from the validated pure
 * Max algebra; per-lane load and straggler claims require a future artifact. */
export function ParallelDetailView({
  node,
  closeLabel,
  onClose,
}: {
  readonly node: MaxNode;
  readonly closeLabel: string;
  readonly onClose: () => void;
}) {
  const criticalChild = node.children.reduce((critical, child) =>
    child.ms > critical.ms ? child : critical,
  );

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
          parallel{' '}
          <Box
            component="span"
            sx={{ fontFamily: tokens.body, fontSize: 13, color: tokens.violet }}
          >
            ⇉ {costTreeDisplayLabel(node.label ?? 'max')}
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
          pure Max · critical path
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
          parallel branches
          <br />
          <b>{node.children.length}</b>
        </div>
        <div>
          critical child
          <br />
          <b>{nodeLabel(criticalChild)}</b>
        </div>
      </Box>
      <Box
        role="status"
        sx={{ m: 1.5, p: 1.5, borderLeft: `3px solid ${tokens.gold}`, background: tokens.tile }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontSize: 14, fontWeight: 600 }}>
          Load-imbalance detail not generated
        </Typography>
        <Typography sx={{ mt: 0.35, fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
          Analyzer v1 has no versioned per-lane load or straggler artifact. The critical child above
          is the real CostTree Max result, not an inferred lane measurement.
        </Typography>
        <Typography sx={{ mt: 0.5, fontFamily: tokens.body, fontSize: 12, color: tokens.sub2 }}>
          evidence status · not_generated
        </Typography>
      </Box>
    </SurfaceCard>
  );
}
