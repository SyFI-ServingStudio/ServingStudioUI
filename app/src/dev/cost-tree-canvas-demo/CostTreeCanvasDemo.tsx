import { Box, Paper, Stack, Typography } from '@mui/material';
import { useState } from 'react';

import { GROUP } from '../../domain/cost-tree';
import CostTreeCanvas from '../../features/worker/CostTreeCanvas';
import { tokens } from '../../theme';
import { COST_TREE_CANVAS_DEMO_TREE } from './fixture';

const DEMO_CONTROLS = {
  zoomIn: 'Zoom in CostTree demo',
  zoomOut: 'Zoom out CostTree demo',
  fit: 'Fit CostTree demo',
  reset: 'Reset CostTree demo',
} as const;

export default function CostTreeCanvasDemo() {
  const [selectedLeafId, setSelectedLeafId] = useState<number | null>(null);
  const [selectedParallelId, setSelectedParallelId] = useState<number | null>(null);

  return (
    <Paper
      component="main"
      sx={{
        width: 'min(1480px, calc(100vw - 32px))',
        mx: 'auto',
        my: 2,
        borderRadius: 2,
        borderTop: `2px solid ${tokens.teal}`,
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ gap: 1.2, p: '9px 13px', borderBottom: `1px solid ${tokens.hair}` }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
          arch{' '}
          <Box
            component="span"
            sx={{ fontFamily: tokens.mono, fontSize: 10.5, color: tokens.teal, fontWeight: 500 }}
          >
            1 · qwen3_ffn_moe · 8 GPU
          </Box>
        </Typography>
        <Box
          sx={{
            fontFamily: tokens.mono,
            fontSize: 10,
            color: tokens.sub,
            border: `1px solid ${tokens.hair}`,
            borderRadius: 0.9,
            px: 1,
            py: 0.35,
            background: tokens.tile2,
          }}
        >
          Σ / iter 9418 · batch 0 · operation 8 <b style={{ color: tokens.teal }}>426.1 µs</b>
        </Box>
        <Stack
          direction="row"
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ gap: '3px 9px', ml: 'auto' }}
        >
          {Object.entries(GROUP)
            .filter(([group]) => group !== 'misc')
            .map(([group, definition]) => (
              <Box
                key={group}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.45, fontSize: 9.5 }}
              >
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: 0.6,
                    background: definition.color,
                  }}
                />
                {definition.label}
              </Box>
            ))}
        </Stack>
      </Stack>
      <CostTreeCanvas
        tree={COST_TREE_CANVAS_DEMO_TREE}
        selectedLeafId={selectedLeafId}
        selectedParallelId={selectedParallelId}
        onSelectLeaf={(id) => {
          setSelectedLeafId(id);
          setSelectedParallelId(null);
        }}
        onSelectParallel={(id) => {
          setSelectedParallelId(id);
          setSelectedLeafId(null);
        }}
        onSelectRoot={() => {
          setSelectedLeafId(null);
          setSelectedParallelId(null);
        }}
        ariaLabel="CostTree canvas demo"
        controlLabels={DEMO_CONTROLS}
      />
    </Paper>
  );
}
