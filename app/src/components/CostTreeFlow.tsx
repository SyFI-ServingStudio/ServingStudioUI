import { Box, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useViz } from '../store';
import { currentWorker, workerTree, currentIter } from '../application/runSelection';
import { useActiveRun } from '../application/ActiveRunProvider';
import { tokens } from '../theme';
import { GROUP, colorOf, kindLabel, fmtMs, fmtPct, type CostNode } from '../data/tree';

interface NodeProps {
  node: CostNode;
  selId: number | null;
  onSelect?: (id: number) => void;
  onRoot?: () => void;
  parSel?: number | null;
  onPar?: (id: number) => void;
}

function SelectionBoundary({ color }: { color: string }) {
  const reduceMotion = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const [boundaryGeometry, setBoundaryGeometry] = useState({ width: 0, height: 0, radius: 0 });

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const updateSize = () => {
      const bounds = svg.getBoundingClientRect();
      const parentRadius =
        Number.parseFloat(getComputedStyle(svg.parentElement ?? svg).borderTopLeftRadius) || 0;
      setBoundaryGeometry((current) =>
        current.width === bounds.width &&
        current.height === bounds.height &&
        current.radius === parentRadius
          ? current
          : { width: bounds.width, height: bounds.height, radius: parentRadius },
      );
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const { width, height, radius: parentRadius } = boundaryGeometry;
  const inset = 1;
  // The stroke's outer edge must follow the card's CSS radius exactly. Since
  // the 2 px stroke is centred 1 px inward, its centreline radius is 1 px less.
  const radius = Math.min(
    Math.max(0, parentRadius - inset),
    Math.max(0, height / 2 - inset),
    Math.max(0, width / 2 - inset),
  );
  const middleY = height / 2;
  const leftX = inset;
  const rightX = Math.max(inset, width - inset);
  const topY = inset;
  const bottomY = Math.max(inset, height - inset);
  // Keep the complete left edge visible, then grow both halves from the two
  // left corners until they meet at the middle of the right edge.
  const leftPath = `M ${leftX + radius} ${topY} Q ${leftX} ${topY} ${leftX} ${topY + radius} L ${leftX} ${bottomY - radius} Q ${leftX} ${bottomY} ${leftX + radius} ${bottomY}`;
  const topPath = `M ${leftX + radius} ${topY} L ${rightX - radius} ${topY} Q ${rightX} ${topY} ${rightX} ${topY + radius} L ${rightX} ${middleY}`;
  const bottomPath = `M ${leftX + radius} ${bottomY} L ${rightX - radius} ${bottomY} Q ${rightX} ${bottomY} ${rightX} ${bottomY - radius} L ${rightX} ${middleY}`;
  const boundaryProgress = useMotionValue(0);

  useEffect(() => {
    if (width <= 0 || height <= 0) return undefined;
    if (reduceMotion) {
      boundaryProgress.set(1);
      return undefined;
    }
    boundaryProgress.set(0);
    const animation = animate(boundaryProgress, 1, {
      duration: 0.9,
      ease: [0.4, 0, 0.2, 1],
    });
    return () => animation.stop();
  }, [boundaryProgress, height, reduceMotion, width]);

  return (
    <Box
      component="svg"
      ref={svgRef}
      aria-hidden="true"
      sx={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {width > 0 && height > 0 && (
        <>
          <path
            d={leftPath}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <motion.path
            d={topPath}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ pathLength: boundaryProgress, filter: `drop-shadow(0 0 3px ${color}55)` }}
          />
          <motion.path
            d={bottomPath}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ pathLength: boundaryProgress, filter: `drop-shadow(0 0 3px ${color}55)` }}
          />
        </>
      )}
    </Box>
  );
}

function WrapLabel({
  text,
  glyph,
  node,
  extra,
}: {
  text?: string;
  glyph: string;
  node: CostNode;
  extra?: string;
}) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      useFlexGap
      flexWrap="wrap"
      sx={{
        rowGap: 0.4,
        fontFamily: tokens.mono,
        fontWeight: 500,
        fontSize: 9,
        letterSpacing: '.12em',
        textTransform: 'uppercase',
        color: tokens.sub,
      }}
    >
      {text && (
        <>
          <Box component="span" sx={{ color: tokens.teal, fontSize: 12 }}>
            {glyph}
          </Box>
          {text}
        </>
      )}
      {node.label && text && (
        <Box component="span" sx={{ color: tokens.sub2, textTransform: 'none', letterSpacing: 0 }}>
          · {node.label}
        </Box>
      )}
      {extra && (
        <Box
          component="span"
          sx={{
            fontFamily: tokens.mono,
            fontSize: 8.5,
            color: tokens.violet,
            border: '1px solid rgba(122,92,255,.3)',
            background: 'rgba(122,92,255,.08)',
            px: 0.75,
            py: '1px',
            borderRadius: 0.75,
            textTransform: 'none',
            letterSpacing: 0,
          }}
        >
          {extra}
        </Box>
      )}
      <Box
        component="span"
        sx={{
          ml: 'auto',
          fontFamily: tokens.mono,
          fontSize: 9.5,
          color: tokens.sub,
          letterSpacing: 0,
          textTransform: 'none',
        }}
      >
        <b style={{ color: tokens.ink }}>{fmtMs(node.ms)}</b> · {fmtPct(node.pct)}
      </Box>
    </Stack>
  );
}

/** Compact 2-line header for container nodes (parallel / ×N repeat): identity on
 *  line 1, the badge + cost on line 2. Stacking keeps the node's intrinsic width
 *  down to the widest single line rather than the whole row, so a container never
 *  gets wider than its child cards. */
function ContainerHead({
  glyph,
  text,
  node,
  extra,
  showLabel = true,
}: {
  glyph: string;
  text: string;
  node: CostNode;
  extra?: string;
  showLabel?: boolean;
}) {
  const capSx = {
    fontFamily: tokens.mono,
    fontWeight: 500,
    fontSize: 9,
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    color: tokens.sub,
  } as const;
  return (
    <Stack spacing={0.3} sx={capSx}>
      <Stack
        direction="row"
        alignItems="center"
        useFlexGap
        flexWrap="wrap"
        sx={{ gap: 0.7, rowGap: 0.2 }}
      >
        <Box component="span" sx={{ color: tokens.teal, fontSize: 12 }}>
          {glyph}
        </Box>
        <span>{text}</span>
        {showLabel && node.label && (
          <Box
            component="span"
            sx={{ color: tokens.sub2, textTransform: 'none', letterSpacing: 0 }}
          >
            · {node.label}
          </Box>
        )}
      </Stack>
      <Stack
        direction="row"
        alignItems="center"
        useFlexGap
        flexWrap="wrap"
        sx={{ gap: 0.7, rowGap: 0.2 }}
      >
        {extra && (
          <Box
            component="span"
            sx={{
              fontSize: 8.5,
              color: tokens.violet,
              border: '1px solid rgba(122,92,255,.3)',
              background: 'rgba(122,92,255,.08)',
              px: 0.6,
              py: '1px',
              borderRadius: 0.75,
              textTransform: 'none',
              letterSpacing: 0,
            }}
          >
            {extra}
          </Box>
        )}
        <Box
          component="span"
          sx={{ fontSize: 9.5, color: tokens.sub, letterSpacing: 0, textTransform: 'none' }}
        >
          <b style={{ color: tokens.ink }}>{fmtMs(node.ms)}</b> · {fmtPct(node.pct)}
        </Box>
      </Stack>
    </Stack>
  );
}

function LeafCard({ node, selId, onSelect }: NodeProps) {
  const s = node.slot!;
  const color = colorOf(s.kind);
  const selected = selId === node.id;
  // The family rail grows into the selection perimeter. Reusing one hue avoids
  // a teal selection ring fighting with GEMM/attention/collective edge colors.
  const title = (
    <Box sx={{ maxWidth: 320 }}>
      <Typography
        sx={{
          fontFamily: tokens.serif,
          fontWeight: 600,
          fontSize: 14,
          mb: 0.5,
          wordBreak: 'break-all',
        }}
      >
        {s.name}
      </Typography>
      <Box sx={{ fontFamily: tokens.mono, fontSize: 10.5 }}>
        <div>kind · {kindLabel(s.kind)}</div>
        <div>config · {s.config || '—'}</div>
        <div>backend · {s.backend || 'default'}</div>
        <div style={{ color: '#5fc7c1' }}>
          {fmtMs(node.ms)} · {fmtPct(node.pct)} of worker total
        </div>
      </Box>
    </Box>
  );
  return (
    <Tooltip title={title} arrow placement="top" enterDelay={120}>
      <Box
        onClick={
          onSelect
            ? (e) => {
                e.stopPropagation();
                onSelect(node.id);
              }
            : undefined
        }
        sx={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          minWidth: 120,
          maxWidth: 160,
          p: '9px 11px',
          borderRadius: 1.25,
          cursor: onSelect ? 'pointer' : 'default',
          background: tokens.leafbg,
          border: `1px solid ${tokens.hair}`,
          transform: 'none',
          boxShadow: selected ? tokens.shadowLift : `inset 2px 0 0 ${color}, ${tokens.shadow}`,
          zIndex: selected ? 4 : 1,
          transition: `transform .18s ${tokens.ease}, box-shadow .18s ${tokens.ease}, border-color .18s ${tokens.ease}`,
          '&:hover': {
            transform: selected ? 'none' : 'translateY(-2px)',
            borderColor: selected ? tokens.hair : '#cabf9f',
            boxShadow: selected
              ? tokens.shadowLift
              : `inset 2px 0 0 ${color}, ${tokens.shadowLift}`,
            zIndex: 5,
          },
          '@media (prefers-reduced-motion: reduce)': {
            transition: 'none',
          },
        }}
      >
        {selected && <SelectionBoundary color={color} />}
        <Box
          sx={{
            position: 'absolute',
            top: 9,
            right: 10,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: color,
            opacity: selected ? 1 : 0.6,
            boxShadow: selected ? `0 0 0 3px ${color}22` : 'none',
          }}
        />
        <Typography
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 13,
            color: tokens.ink,
            letterSpacing: '-.01em',
            pr: 1.25,
          }}
        >
          {s.name.split('.').pop()}
        </Typography>
        <Typography
          sx={{
            fontFamily: tokens.mono,
            fontSize: 8.5,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color,
          }}
        >
          {kindLabel(s.kind)}
        </Typography>
        <Stack direction="row" alignItems="baseline" spacing={0.9} sx={{ mt: '2px' }}>
          <Box
            component="span"
            sx={{
              fontFamily: tokens.mono,
              fontSize: 11,
              color: tokens.ink,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtMs(node.ms)}
          </Box>
          <Box component="span" sx={{ fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub }}>
            {fmtPct(node.pct)}
          </Box>
        </Stack>
      </Box>
    </Tooltip>
  );
}

function FlowNode({ node, selId, onSelect, onRoot, parSel, onPar }: NodeProps) {
  if (node.kind === 'leaf') return <LeafCard node={node} selId={selId} onSelect={onSelect} />;

  if (node.kind === 'sum') {
    const kids = node.children ?? [];
    const isRoot = node.depth === 0 && !!onRoot;
    const subSel = selId != null || parSel != null;
    return (
      <Box
        sx={{
          borderRadius: 1.5,
          p: 1.4,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          border: `1px dashed ${isRoot && subSel ? tokens.teal : tokens.hair}`,
          background: 'rgba(247,242,231,.55)',
        }}
      >
        <Box
          onClick={
            isRoot
              ? (e) => {
                  e.stopPropagation();
                  onRoot!();
                }
              : undefined
          }
          sx={{
            mx: -0.5,
            px: 0.5,
            py: 0.25,
            borderRadius: 1,
            cursor: isRoot ? 'pointer' : 'default',
            transition: `background .2s ${tokens.ease}`,
            ...(isRoot ? { '&:hover': { background: 'rgba(31,111,107,.07)' } } : {}),
          }}
        >
          <WrapLabel
            text="sequential"
            glyph="→"
            node={node}
            extra={isRoot ? (subSel ? '← back to worker' : 'arch root') : undefined}
          />
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: kids.length > 4 ? 'wrap' : 'nowrap',
            rowGap: 1.75,
          }}
        >
          {kids.map((c, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center' }}>
              <FlowNode node={c} selId={selId} onSelect={onSelect} parSel={parSel} onPar={onPar} />
              {i < kids.length - 1 && (
                <Box
                  component="span"
                  sx={{
                    color: tokens.sub,
                    fontSize: 14,
                    px: 1.1,
                    opacity: 0.75,
                    fontFamily: tokens.mono,
                  }}
                >
                  →
                </Box>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  if (node.kind === 'max') {
    const ov = node.overlap == null ? 1 : node.overlap;
    const selected = parSel != null && parSel === node.id;
    const clickable = !!onPar;
    return (
      <Box
        sx={{
          borderRadius: 1.5,
          p: 1.4,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          border: `${selected ? 1.5 : 1}px solid ${selected ? tokens.violet : 'rgba(122,92,255,.32)'}`,
          boxShadow: selected ? tokens.shadowLift : 'none',
          background:
            'repeating-linear-gradient(-45deg, rgba(122,92,255,.07) 0 7px, rgba(122,92,255,.015) 7px 14px)',
        }}
      >
        <Box
          onClick={
            clickable
              ? (e) => {
                  e.stopPropagation();
                  onPar!(node.id);
                }
              : undefined
          }
          sx={{
            mx: -0.5,
            px: 0.5,
            py: 0.25,
            borderRadius: 1,
            cursor: clickable ? 'pointer' : 'default',
            transition: `background .2s ${tokens.ease}`,
            ...(clickable ? { '&:hover': { background: 'rgba(122,92,255,.12)' } } : {}),
          }}
        >
          <ContainerHead
            glyph="⇉"
            text="parallel"
            node={node}
            extra={selected ? '▾ straggler' : clickable ? 'straggler ▸' : `ov ${ov.toFixed(2)}`}
          />
        </Box>
        <Box
          sx={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.1,
            pl: 1.9,
            '&::before': {
              content: '""',
              position: 'absolute',
              left: 4,
              top: 5,
              bottom: 5,
              width: '2px',
              background: `linear-gradient(180deg, ${tokens.violet}, transparent)`,
              opacity: 0.55,
              borderRadius: '2px',
            },
          }}
        >
          {(node.children ?? []).map((c, i) => (
            <FlowNode
              key={i}
              node={c}
              selId={selId}
              onSelect={onSelect}
              parSel={parSel}
              onPar={onPar}
            />
          ))}
        </Box>
      </Box>
    );
  }

  // scale — dashed container with ×N badge; ONE child (repeats never expanded)
  const badgeLabel = (node.label ?? '').replace(/[×x]\s*\d+\s*/, '').trim() || 'repeat';
  return (
    <Box
      sx={{
        position: 'relative',
        mt: 1.9,
        borderRadius: 1.5,
        p: 1.4,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        border: '1.5px dashed rgba(176,137,0,.5)',
        background: 'rgba(176,137,0,.05)',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          top: -12,
          left: 14,
          fontFamily: tokens.mono,
          fontWeight: 600,
          fontSize: 10.5,
          color: '#7a5f00',
          background: '#f6ecd0',
          border: '1px solid rgba(176,137,0,.45)',
          px: 1.25,
          py: '2px',
          borderRadius: 0.75,
          boxShadow: tokens.shadow,
        }}
      >
        <b>×{node.n}</b> {badgeLabel}
      </Box>
      <ContainerHead
        glyph="×"
        text="repeat"
        node={node}
        extra={`${fmtMs(node.ms / (node.n ?? 1))} ea`}
        showLabel={false}
      />
      <FlowNode
        node={(node.children ?? [])[0]}
        selId={selId}
        onSelect={onSelect}
        parSel={parSel}
        onPar={onPar}
      />
    </Box>
  );
}

export default function CostTreeFlow() {
  const st = useViz();
  const run = useActiveRun();
  const w = currentWorker(run, st);
  const tree = workerTree(run, st);
  const atIter = currentIter(run, st) != null;
  const selId = st.scope === 'kernel' ? st.leafId : null;
  const parSel = st.scope === 'parallel' ? st.parId : null;
  const timeBasis = run.capabilities.workerIterations
    ? atIter
      ? 'selected iter'
      : 'iter mean'
    : 'full-run aggregate';
  const canInspectKernel =
    run.capabilities.kernelPerformance || run.capabilities.kernelInputDistribution;

  return (
    <Paper sx={{ borderRadius: 2, borderTop: `2px solid ${tokens.teal}`, overflow: 'hidden' }}>
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ gap: 1.75, p: '14px 18px', borderBottom: `1px solid ${tokens.hair}` }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 18 }}>
          arch{' '}
          <Box
            component="span"
            sx={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.teal, fontWeight: 500 }}
          >
            {w.id} · {w.arch.type} · {w.gpuCount} GPU
          </Box>
        </Typography>
        <Box
          sx={{
            fontFamily: tokens.mono,
            fontSize: 11.5,
            color: tokens.sub,
            border: `1px solid ${tokens.hair}`,
            borderRadius: 0.9,
            px: 1.25,
            py: 0.5,
            background: tokens.tile2,
          }}
        >
          Σ / {timeBasis} <b style={{ color: tokens.teal }}>{fmtMs(tree.totalMs!)}</b>
        </Box>
        <Stack
          direction="row"
          flexWrap="wrap"
          useFlexGap
          sx={{ gap: '5px 12px', alignItems: 'center', ml: 'auto' }}
        >
          {Object.entries(GROUP)
            .filter(([g]) => g !== 'misc')
            .map(([g, G]) => (
              <Box
                key={g}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.6,
                  fontSize: 10.5,
                  color: tokens.sub,
                }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: 0.75,
                    background: G.color,
                    border: '1px solid rgba(42,38,34,.12)',
                  }}
                />
                {G.label}
              </Box>
            ))}
          <Box
            component="span"
            sx={{ fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub2, ml: 0.5 }}
          >
            → seq · ⇉ overlap · ×N repeat
          </Box>
        </Stack>
      </Stack>
      <Box sx={{ overflow: 'auto', p: '22px 18px 24px', minHeight: 220 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'stretch', width: 'max-content' }}>
          <FlowNode
            node={tree}
            selId={selId}
            onSelect={canInspectKernel ? st.selectKernel : undefined}
            onRoot={() => st.selectWorker(w.ref)}
            parSel={parSel}
            onPar={run.capabilities.loadImbalance ? st.selectParallel : undefined}
          />
        </Box>
      </Box>
    </Paper>
  );
}
