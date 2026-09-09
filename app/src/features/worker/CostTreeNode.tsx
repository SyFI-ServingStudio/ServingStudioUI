import { Box, ButtonBase, Stack, Tooltip, Typography } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';
import type { MouseEvent, ReactNode } from 'react';

import {
  colorOf,
  costTreeDisplayLabel,
  kindLabel,
  fmtMs,
  fmtPct,
  type CostNode,
  type LeafNode,
  type LeafPosition,
  type MaxNode,
  type ScaleNode,
  type SumNode,
} from '../../domain/cost-tree';
import { tokens, withAlpha, colors } from '../../theme';
import { scaledQuantity } from '../../util';
import SelectionBoundary from './SelectionBoundary';

const COMPUTE_RATE_SCALES = [
  { divisor: 1000, unit: 'PFLOP/s' },
  { divisor: 1, unit: 'TFLOP/s' },
] as const;
const BANDWIDTH_RATE_SCALES = [
  { divisor: 1000, unit: 'TB/s' },
  { divisor: 1, unit: 'GB/s' },
] as const;

interface NodeProps<Node extends CostNode = CostNode> {
  node: Node;
  criticalContributionByPositionName: ReadonlyMap<string, LeafPosition>;
  selId: number | null;
  onSelect?: (id: number) => void;
  onRoot?: () => void;
  parSel?: number | null;
  onPar?: (id: number) => void;
  density?: 'default' | 'compact';
}

/** Keep presentation-only nodes out of the tab order while giving every
 * drillable CostTree surface native button semantics and focus behavior. */
function NodeControl({
  ariaLabel,
  pressed,
  onActivate,
  sx,
  children,
}: {
  ariaLabel: string;
  pressed: boolean;
  onActivate?: () => void;
  sx: SystemStyleObject<Theme>;
  children: ReactNode;
}) {
  if (!onActivate) return <Box sx={sx}>{children}</Box>;

  return (
    <ButtonBase
      type="button"
      disableRipple
      aria-label={ariaLabel}
      aria-pressed={pressed}
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      sx={[
        sx,
        {
          color: 'inherit',
          '&:focus-visible': {
            outline: `2px solid ${tokens.ink}`,
            outlineOffset: 2,
          },
        },
      ]}
    >
      {children}
    </ButtonBase>
  );
}

function WrapLabel({
  text,
  glyph,
  node,
  extra,
  compact = false,
}: {
  text?: string;
  glyph: string;
  node: SumNode;
  extra?: string;
  compact?: boolean;
}) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={compact ? 0.6 : 1}
      useFlexGap
      flexWrap="wrap"
      sx={{
        rowGap: compact ? 0.2 : 0.4,
        fontFamily: tokens.body,
        fontWeight: 500,
        fontSize: compact ? 10 : 12,
        letterSpacing: '.12em',
        textTransform: 'uppercase',
        color: tokens.sub,
        ...(compact
          ? {
              flexWrap: 'nowrap',
              minWidth: 0,
              lineHeight: 1,
              overflow: 'hidden',
            }
          : {}),
      }}
    >
      {text && (
        <>
          <Box component="span" sx={{ color: tokens.olive, fontSize: 12 }}>
            {glyph}
          </Box>
          {text}
        </>
      )}
      {node.label && text && (
        <Box
          component="span"
          title={costTreeDisplayLabel(node.label)}
          sx={{
            color: tokens.sub2,
            textTransform: 'none',
            letterSpacing: 0,
            ...(compact
              ? {
                  maxWidth: 220,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }
              : {}),
          }}
        >
          · {costTreeDisplayLabel(node.label)}
        </Box>
      )}
      {extra && (
        <Box
          component="span"
          sx={{
            fontFamily: tokens.body,
            fontSize: 12,
            color: tokens.violet,
            border: `1px solid ${withAlpha(tokens.violet, 0.3)}`,
            background: withAlpha(tokens.violet, 0.08),
            px: 0.75,
            py: '1px',
            borderRadius: 0.75,
            width: 72,
            flexShrink: 0,
            boxSizing: 'border-box',
            textAlign: 'center',
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
          fontFamily: tokens.body,
          fontSize: 12,
          color: tokens.sub,
          letterSpacing: 0,
          textTransform: 'none',
          ...(compact ? { lineHeight: 1, flexShrink: 0 } : {}),
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
  compact = false,
}: {
  glyph: string;
  text: string;
  node: MaxNode | ScaleNode;
  extra?: string;
  showLabel?: boolean;
  compact?: boolean;
}) {
  const capSx = {
    fontFamily: tokens.body,
    fontWeight: 500,
    fontSize: compact ? 10 : 12,
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    color: tokens.sub,
    ...(compact ? { lineHeight: 1 } : {}),
  } as const;
  return (
    <Stack spacing={compact ? 0.15 : 0.3} sx={capSx}>
      <Stack
        direction="row"
        alignItems="center"
        useFlexGap
        flexWrap={compact ? 'nowrap' : 'wrap'}
        sx={{ gap: compact ? 0.45 : 0.7, rowGap: 0.2 }}
      >
        <Box component="span" sx={{ color: tokens.teal, fontSize: 12 }}>
          {glyph}
        </Box>
        <span>{text}</span>
        {showLabel && node.label && (
          <Box
            component="span"
            title={costTreeDisplayLabel(node.label)}
            sx={{
              color: tokens.sub2,
              textTransform: 'none',
              letterSpacing: 0,
              ...(compact
                ? {
                    maxWidth: 220,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }
                : {}),
            }}
          >
            · {costTreeDisplayLabel(node.label)}
          </Box>
        )}
      </Stack>
      <Stack
        direction="row"
        alignItems="center"
        useFlexGap
        flexWrap={compact ? 'nowrap' : 'wrap'}
        sx={{ gap: 0.7, rowGap: 0.2 }}
      >
        {extra && (
          <Box
            component="span"
            sx={{
              fontSize: 12,
              color: tokens.violet,
              border: `1px solid ${withAlpha(tokens.violet, 0.3)}`,
              background: withAlpha(tokens.violet, 0.08),
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
          sx={{ fontSize: 12, color: tokens.sub, letterSpacing: 0, textTransform: 'none' }}
        >
          <b style={{ color: tokens.ink }}>{fmtMs(node.ms)}</b> · {fmtPct(node.pct)}
        </Box>
      </Stack>
    </Stack>
  );
}

function LeafCard({
  node,
  criticalContributionByPositionName,
  selId,
  onSelect,
  density = 'default',
}: NodeProps<LeafNode>) {
  const s = node.slot;
  const color = colorOf(s.kind);
  const selected = selId === node.id;
  const compact = density === 'compact';
  const finalContributionPct = criticalContributionByPositionName.get(s.name)?.pct ?? 0;
  const hoverFacts = [
    { label: 'Kind', value: s.kind },
    { label: 'Backend', value: s.backend ?? '—' },
    { label: 'Time', value: fmtMs(node.ms) },
    {
      label: 'Time share',
      value: fmtPct(finalContributionPct),
    },
    {
      label: 'Compute',
      value: scaledQuantity(node.stats.tflops, COMPUTE_RATE_SCALES).display,
      accent: true,
    },
    {
      label: 'Bandwidth',
      value: scaledQuantity(node.stats.gbps, BANDWIDTH_RATE_SCALES).display,
      accent: true,
    },
  ] as const;
  // The family rail grows into the selection perimeter. Reusing one hue avoids
  // a teal selection ring fighting with GEMM/attention/collective edge colors.
  const title = (
    <Box component="dl" sx={{ width: 248, m: 0, py: 0.25 }}>
      {hoverFacts.map((fact, index) => (
        <Box
          component="div"
          key={fact.label}
          sx={{
            display: 'grid',
            gridTemplateColumns: '90px minmax(0, 1fr)',
            alignItems: 'baseline',
            gap: 1.25,
            py: 0.55,
            borderBottom:
              index < hoverFacts.length - 1
                ? `1px solid ${withAlpha(tokens.ink, 0.14)}`
                : undefined,
          }}
        >
          <Box
            component="dt"
            sx={{
              fontFamily: tokens.body,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0,
              textTransform: 'none',
              color: `${withAlpha(tokens.ink, 0.62)}`,
            }}
          >
            {fact.label}
          </Box>
          <Box
            component="dd"
            sx={{
              m: 0,
              minWidth: 0,
              overflowWrap: 'anywhere',
              fontFamily: tokens.body,
              fontSize: 12,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: 'accent' in fact && fact.accent ? colors.blueBright : colors.tooltipText,
            }}
          >
            {fact.value}
          </Box>
        </Box>
      ))}
    </Box>
  );
  return (
    <Tooltip
      title={title}
      arrow
      placement="right-start"
      enterDelay={120}
      describeChild
      PopperProps={{
        modifiers: [
          { name: 'offset', options: { offset: [0, 10] } },
          {
            name: 'flip',
            options: { fallbackPlacements: ['left-start', 'bottom-start'] },
          },
        ],
      }}
    >
      <Box
        component={onSelect ? 'button' : 'div'}
        data-cost-node-kind="leaf"
        data-cost-tree-density={density}
        type={onSelect ? 'button' : undefined}
        aria-label={onSelect ? `Inspect kernel ${s.name}` : undefined}
        aria-pressed={onSelect ? selected : undefined}
        onClick={
          onSelect
            ? (event: MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                onSelect(node.id);
              }
            : undefined
        }
        sx={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: 'flex-start',
          textAlign: 'left',
          appearance: 'none',
          font: 'inherit',
          color: 'inherit',
          gap: compact ? '1px' : '2px',
          minWidth: compact ? 104 : 120,
          maxWidth: compact ? 142 : 160,
          p: compact ? '6.5px 8px' : '9px 11px',
          borderRadius: 1,
          cursor: onSelect ? 'pointer' : 'default',
          background: tokens.leafbg,
          border: `1px solid ${tokens.hair}`,
          transform: 'none',
          boxShadow: selected ? tokens.shadowLift : `inset 2px 0 0 ${color}, ${tokens.shadow}`,
          zIndex: selected ? 4 : 1,
          transition: `transform .18s ${tokens.ease}, box-shadow .18s ${tokens.ease}, border-color .18s ${tokens.ease}`,
          '&:hover': {
            transform: selected ? 'none' : 'translateY(-2px)',
            borderColor: selected ? tokens.hair : colors.borderHover,
            boxShadow: selected
              ? tokens.shadowLift
              : `inset 2px 0 0 ${color}, ${tokens.shadowLift}`,
            zIndex: 5,
          },
          '&:focus-visible': {
            outline: `2px solid ${tokens.ink}`,
            outlineOffset: 2,
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
            top: compact ? 7 : 9,
            right: compact ? 8 : 10,
            width: compact ? 5 : 6,
            height: compact ? 5 : 6,
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
            fontSize: compact ? 11.5 : 13,
            lineHeight: compact ? 1.05 : undefined,
            color,
            letterSpacing: '-.01em',
            pr: 1.25,
          }}
        >
          {s.name.split('.').pop()}
        </Typography>
        <Typography
          sx={{
            fontFamily: tokens.body,
            fontSize: compact ? 7.5 : 8.5,
            lineHeight: compact ? 1.15 : undefined,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: tokens.ink,
          }}
        >
          {kindLabel(s.kind)}
        </Typography>
        <Stack
          direction="row"
          alignItems="baseline"
          spacing={compact ? 0.6 : 0.9}
          sx={{ mt: compact ? 0 : '2px' }}
        >
          <Box
            component="span"
            sx={{
              fontFamily: tokens.body,
              fontSize: compact ? 9.5 : 11,
              lineHeight: compact ? 1.1 : undefined,
              color: tokens.ink,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtMs(node.ms)}
          </Box>
          <Box
            component="span"
            sx={{
              fontFamily: tokens.body,
              fontSize: compact ? 8.5 : 9.5,
              lineHeight: compact ? 1.1 : undefined,
              color: tokens.sub,
            }}
          >
            {fmtPct(finalContributionPct)}
          </Box>
        </Stack>
      </Box>
    </Tooltip>
  );
}

export default function CostTreeNode({
  node,
  criticalContributionByPositionName,
  selId,
  onSelect,
  onRoot,
  parSel,
  onPar,
  density = 'default',
}: NodeProps) {
  const compact = density === 'compact';
  if (node.kind === 'leaf') {
    return (
      <LeafCard
        node={node}
        criticalContributionByPositionName={criticalContributionByPositionName}
        selId={selId}
        onSelect={onSelect}
        density={density}
      />
    );
  }

  if (node.kind === 'sum') {
    const kids = node.children;
    const isRoot = node.depth === 0 && !!onRoot;
    const subSel = selId != null || parSel != null;
    // Keep nested sequential surfaces opaque so tint does not accumulate.
    const sequentialBorderAlpha = Math.min(0.34 + node.depth * 0.1, 0.54);
    return (
      <Box
        data-cost-node-kind="sum"
        data-cost-tree-density={density}
        sx={{
          borderRadius: 1.25,
          p: compact ? 0.85 : 1.4,
          display: 'flex',
          flexDirection: 'column',
          gap: compact ? 0.4 : 1,
          // Green sequential boundaries complement amber Max and violet Scale.
          border: `1px solid ${
            isRoot && subSel ? tokens.olive : withAlpha(tokens.olive, sequentialBorderAlpha)
          }`,
          background: node.depth === 0 ? tokens.tile2 : colors.sumSurface,
        }}
      >
        <NodeControl
          ariaLabel="Scope to worker CostTree root"
          pressed={isRoot && !subSel}
          onActivate={isRoot ? onRoot : undefined}
          sx={{
            display: 'block',
            textAlign: 'left',
            mx: -0.5,
            px: 0.5,
            py: compact ? 0 : 0.25,
            borderRadius: 1,
            cursor: isRoot ? 'pointer' : 'default',
            transition: `background .2s ${tokens.ease}`,
            ...(isRoot ? { '&:hover': { background: withAlpha(tokens.olive, 0.07) } } : {}),
          }}
        >
          <WrapLabel
            text="sequential"
            glyph="→"
            node={node}
            extra={isRoot ? (subSel ? '← worker' : 'arch root') : undefined}
            compact={compact}
          />
        </NodeControl>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: kids.length > 4 ? 'wrap' : 'nowrap',
            rowGap: compact ? 0.7 : 1.75,
          }}
        >
          {kids.map((c, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center' }}>
              <CostTreeNode
                node={c}
                criticalContributionByPositionName={criticalContributionByPositionName}
                selId={selId}
                onSelect={onSelect}
                parSel={parSel}
                onPar={onPar}
                density={density}
              />
              {i < kids.length - 1 && (
                <Box
                  component="span"
                  sx={{
                    color: tokens.sub,
                    fontSize: compact ? 12 : 14,
                    px: compact ? 0.6 : 1.1,
                    opacity: 0.75,
                    fontFamily: tokens.body,
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
    const selected = parSel != null && parSel === node.id;
    const clickable = !!onPar;
    return (
      <Box
        data-cost-node-kind="max"
        data-cost-tree-density={density}
        sx={{
          borderRadius: 1.25,
          p: compact ? 0.65 : 1.4,
          display: 'flex',
          flexDirection: 'column',
          gap: compact ? 0.4 : 1,
          border: `${selected ? 1.5 : 1}px solid ${selected ? tokens.gold : withAlpha(tokens.gold, 0.32)}`,
          boxShadow: selected ? tokens.shadowLift : 'none',
          background: colors.maxSurface,
        }}
      >
        <NodeControl
          ariaLabel={`Inspect parallel critical path ${costTreeDisplayLabel(node.label ?? 'max')}`}
          pressed={selected}
          onActivate={clickable ? () => onPar?.(node.id) : undefined}
          sx={{
            display: 'block',
            textAlign: 'left',
            mx: -0.5,
            px: 0.5,
            py: compact ? 0 : 0.25,
            borderRadius: 1,
            cursor: clickable ? 'pointer' : 'default',
            transition: `background .2s ${tokens.ease}`,
            ...(clickable ? { '&:hover': { background: withAlpha(tokens.gold, 0.12) } } : {}),
          }}
        >
          <ContainerHead
            glyph="⇉"
            text="parallel"
            node={node}
            extra={`overlap ${node.overlap} · ${
              selected ? '▾ critical path' : clickable ? 'critical path ▸' : 'critical path'
            }`}
            compact={compact}
          />
        </NodeControl>
        <Box
          sx={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: compact ? 0.45 : 1.1,
            pl: compact ? 1 : 1.9,
            '&::before': {
              content: '""',
              position: 'absolute',
              left: 4,
              top: 5,
              bottom: 5,
              width: '2px',
              background: `linear-gradient(180deg, ${tokens.gold}, transparent)`,
              opacity: 0.55,
              borderRadius: '2px',
            },
          }}
        >
          {node.children.map((c, i) => (
            <CostTreeNode
              key={i}
              node={c}
              criticalContributionByPositionName={criticalContributionByPositionName}
              selId={selId}
              onSelect={onSelect}
              parSel={parSel}
              onPar={onPar}
              density={density}
            />
          ))}
        </Box>
      </Box>
    );
  }

  // scale — dashed container with ×N badge; ONE child (repeats never expanded)
  const badgeLabel =
    costTreeDisplayLabel(node.label ?? '')
      .replace(/[×x]\s*\d+\s*/, '')
      .trim() || 'repeat';
  return (
    <Box
      data-cost-node-kind="scale"
      data-cost-tree-density={density}
      sx={{
        position: 'relative',
        mt: compact ? 1.1 : 1.9,
        borderRadius: 1.25,
        p: compact ? 0.65 : 1.4,
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 0.4 : 1,
        border: `1.5px dashed ${withAlpha(tokens.violet, 0.5)}`,
        background: withAlpha(tokens.violet, 0.05),
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          top: compact ? -10 : -12,
          left: compact ? 10 : 14,
          fontFamily: tokens.body,
          fontWeight: 600,
          fontSize: compact ? 11 : 12,
          color: tokens.violet,
          background: colors.scaleSurface,
          border: `1px solid ${withAlpha(tokens.violet, 0.45)}`,
          px: compact ? 0.8 : 1.25,
          py: compact ? '1px' : '2px',
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
        extra={`${fmtMs(node.n === 0 ? 0 : node.ms / node.n)} ea`}
        showLabel={false}
        compact={compact}
      />
      <CostTreeNode
        node={node.children[0]}
        criticalContributionByPositionName={criticalContributionByPositionName}
        selId={selId}
        onSelect={onSelect}
        parSel={parSel}
        onPar={onPar}
        density={density}
      />
    </Box>
  );
}
