import CenterFocusStrongRoundedIcon from '@mui/icons-material/CenterFocusStrongRounded';
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded';
import { Box, IconButton, Stack, Tooltip } from '@mui/material';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { criticalLeafTotals, type CostTree } from '../../domain/cost-tree';
import { tokens, withAlpha } from '../../theme';
import CostTreeNode from './CostTreeNode';

export const COST_TREE_VIEWPORT_HEIGHT = 675;

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2;
const FIT_MAX_ZOOM = 1;
const FIT_PADDING_PX = 18;
const ZOOM_STEP = 1.2;
const READABLE_ZOOM = 0.9;

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

interface PanGesture {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

interface PendingWheelZoom {
  deltaY: number;
  clientX: number;
  clientY: number;
}

export interface CostTreeCanvasControlLabels {
  zoomIn: string;
  zoomOut: string;
  fit: string;
  reset: string;
}

interface CostTreeCanvasProps {
  tree: CostTree;
  selectedLeafId: number | null;
  selectedParallelId: number | null;
  onSelectLeaf: (id: number) => void;
  onSelectParallel: (id: number) => void;
  onSelectRoot: () => void;
  ariaLabel: string;
  controlLabels: CostTreeCanvasControlLabels;
  browserExpansion?: {
    expanded: boolean;
    onToggle: () => void;
    expandLabel: string;
    collapseLabel: string;
  };
  /** Fill the dynamic worker frame; omitted by the isolated demo, which keeps
   * the stable default height for standalone rendering. */
  fillFrame?: boolean;
}

const clampZoom = (scale: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
const normalizeZoom = (scale: number): number =>
  clampZoom(Math.round(clampZoom(scale) * 1000) / 1000);

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('button, a, input, select, textarea, [role="button"]') !== null
  );
}

/** Pure worker-feature viewport. Data loading and selection ownership stay in
 * the caller; this component owns only direct DOM pan/zoom interaction. */
export default function CostTreeCanvas({
  tree,
  selectedLeafId,
  selectedParallelId,
  onSelectLeaf,
  onSelectParallel,
  onSelectRoot,
  ariaLabel,
  controlLabels,
  browserExpansion,
  fillFrame = false,
}: CostTreeCanvasProps) {
  const criticalContributionByPositionName = useMemo(
    () => new Map(criticalLeafTotals(tree).positions.map((position) => [position.name, position])),
    [tree],
  );
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ViewTransform>({
    x: FIT_PADDING_PX,
    y: FIT_PADDING_PX,
    scale: READABLE_ZOOM,
  });
  const panRef = useRef<PanGesture | null>(null);
  const pendingWheelRef = useRef<PendingWheelZoom | null>(null);
  const wheelFrameRef = useRef<number | null>(null);

  const applyTransform = useCallback((next: ViewTransform) => {
    transformRef.current = next;
    const content = contentRef.current;
    if (content === null) return;
    content.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
    content.dataset.zoom = String(next.scale);
  }, []);

  const resetView = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (viewport === null || content === null) return;
    const viewportRect = viewport.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const currentScale = transformRef.current.scale;
    const contentWidth = content.offsetWidth || contentRect.width / currentScale;
    const contentHeight = content.offsetHeight || contentRect.height / currentScale;
    if (
      viewportRect.width <= 0 ||
      viewportRect.height <= 0 ||
      contentWidth <= 0 ||
      contentHeight <= 0
    ) {
      applyTransform({ x: FIT_PADDING_PX, y: FIT_PADDING_PX, scale: READABLE_ZOOM });
      return;
    }
    const readableWidth = contentWidth * READABLE_ZOOM;
    const readableHeight = contentHeight * READABLE_ZOOM;
    // Small trees centre horizontally; wide trees keep a predictable left
    // origin. Tall trees start at the top so their root remains visible.
    const fitsWidth = readableWidth <= viewportRect.width - FIT_PADDING_PX * 2;
    applyTransform({
      x: fitsWidth ? (viewportRect.width - readableWidth) / 2 : FIT_PADDING_PX,
      y: Math.max(FIT_PADDING_PX, (viewportRect.height - readableHeight) / 2),
      scale: READABLE_ZOOM,
    });
  }, [applyTransform]);

  const fitTree = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (viewport === null || content === null) return;
    const viewportRect = viewport.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const currentScale = transformRef.current.scale;
    const contentWidth = content.offsetWidth || contentRect.width / currentScale;
    const contentHeight = content.offsetHeight || contentRect.height / currentScale;
    if (
      viewportRect.width <= 0 ||
      viewportRect.height <= 0 ||
      contentWidth <= 0 ||
      contentHeight <= 0
    ) {
      return;
    }
    const availableWidth = Math.max(1, viewportRect.width - FIT_PADDING_PX * 2);
    const availableHeight = Math.max(1, viewportRect.height - FIT_PADDING_PX * 2);
    const scale = clampZoom(
      Math.min(FIT_MAX_ZOOM, availableWidth / contentWidth, availableHeight / contentHeight),
    );
    applyTransform({
      x: (viewportRect.width - contentWidth * scale) / 2,
      y: (viewportRect.height - contentHeight * scale) / 2,
      scale,
    });
  }, [applyTransform]);

  const zoomAt = useCallback(
    (nextScale: number, clientX?: number, clientY?: number) => {
      const viewport = viewportRef.current;
      if (viewport === null) return;
      const rect = viewport.getBoundingClientRect();
      const current = transformRef.current;
      const scale = normalizeZoom(nextScale);
      if (scale === current.scale) return;
      const anchorX = clientX === undefined ? rect.width / 2 : clientX - rect.left;
      const anchorY = clientY === undefined ? rect.height / 2 : clientY - rect.top;
      const worldX = (anchorX - current.x) / current.scale;
      const worldY = (anchorY - current.y) / current.scale;
      applyTransform({
        x: anchorX - worldX * scale,
        y: anchorY - worldY * scale,
        scale,
      });
    },
    [applyTransform],
  );

  useLayoutEffect(() => {
    resetView();
  }, [resetView, tree]);

  const browserExpanded = browserExpansion?.expanded ?? false;
  const supportsBrowserExpansion = browserExpansion !== undefined;
  useLayoutEffect(() => {
    if (!supportsBrowserExpansion) return;
    // The fixed frame has its final viewport dimensions on the next paint.
    // Expanded mode shows the whole tree; the normal frame starts readable.
    // Ordinary resizes preserve a user's deliberate pan/zoom position.
    const fitFrame = requestAnimationFrame(browserExpanded ? fitTree : resetView);
    return () => cancelAnimationFrame(fitFrame);
  }, [browserExpanded, fitTree, resetView, supportsBrowserExpansion]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const options = { passive: false } as const;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const pending = pendingWheelRef.current;
      pendingWheelRef.current = {
        deltaY: (pending?.deltaY ?? 0) + event.deltaY,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      if (wheelFrameRef.current !== null) return;
      wheelFrameRef.current = requestAnimationFrame(() => {
        wheelFrameRef.current = null;
        const wheel = pendingWheelRef.current;
        pendingWheelRef.current = null;
        if (wheel === null) return;
        zoomAt(
          transformRef.current.scale * Math.exp(-wheel.deltaY * 0.0015),
          wheel.clientX,
          wheel.clientY,
        );
      });
    };
    viewport.addEventListener('wheel', handleWheel, options);
    return () => {
      viewport.removeEventListener('wheel', handleWheel, false);
      pendingWheelRef.current = null;
      if (wheelFrameRef.current !== null) {
        cancelAnimationFrame(wheelFrameRef.current);
        wheelFrameRef.current = null;
      }
    };
  }, [zoomAt]);

  const finishPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    event.currentTarget.style.cursor = 'grab';
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <Box
      ref={viewportRef}
      data-testid="cost-tree-viewport"
      role="region"
      aria-label={ariaLabel}
      onPointerDown={(event) => {
        if (event.button !== 0 || isInteractiveTarget(event.target)) return;
        const current = transformRef.current;
        panRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: current.x,
          originY: current.y,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.style.cursor = 'grabbing';
      }}
      onPointerMove={(event) => {
        const pan = panRef.current;
        if (pan === null || pan.pointerId !== event.pointerId) return;
        applyTransform({
          ...transformRef.current,
          x: pan.originX + event.clientX - pan.startX,
          y: pan.originY + event.clientY - pan.startY,
        });
      }}
      onPointerUp={finishPan}
      onPointerCancel={finishPan}
      sx={{
        position: 'relative',
        height: fillFrame ? 'auto' : COST_TREE_VIEWPORT_HEIGHT,
        flex: fillFrame ? 1 : undefined,
        minHeight: fillFrame ? 0 : undefined,
        overflow: 'hidden',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
        backgroundColor: tokens.tile2,
        backgroundImage: `radial-gradient(circle, ${withAlpha(tokens.sub, 0.12)} 0.7px, transparent 0.8px)`,
        backgroundSize: '16px 16px',
      }}
    >
      <Stack
        direction="row"
        sx={{
          position: 'absolute',
          zIndex: 20,
          top: 9,
          right: 9,
          gap: 0.25,
          p: 0.35,
          borderRadius: 1,
          border: `1px solid ${tokens.hair}`,
          background: withAlpha(tokens.tile, 0.94),
          boxShadow: tokens.shadow,
        }}
      >
        <Tooltip title="Zoom in">
          <IconButton
            size="small"
            aria-label={controlLabels.zoomIn}
            onClick={() => zoomAt(transformRef.current.scale * ZOOM_STEP)}
          >
            <ZoomInRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom out">
          <IconButton
            size="small"
            aria-label={controlLabels.zoomOut}
            onClick={() => zoomAt(transformRef.current.scale / ZOOM_STEP)}
          >
            <ZoomOutRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Fit tree">
          <IconButton size="small" aria-label={controlLabels.fit} onClick={fitTree}>
            <CenterFocusStrongRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Reset to readable scale">
          <IconButton size="small" aria-label={controlLabels.reset} onClick={resetView}>
            <RestartAltRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {browserExpansion !== undefined && (
          <Tooltip title={browserExpanded ? 'Exit expanded view' : 'Fill browser'}>
            <IconButton
              size="small"
              aria-label={
                browserExpanded ? browserExpansion.collapseLabel : browserExpansion.expandLabel
              }
              aria-pressed={browserExpanded}
              onClick={browserExpansion.onToggle}
            >
              {browserExpanded ? (
                <CloseFullscreenRoundedIcon fontSize="small" />
              ) : (
                <OpenInFullRoundedIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      <Box
        ref={contentRef}
        data-testid="cost-tree-content"
        data-cost-tree-content
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          display: 'inline-flex',
          alignItems: 'stretch',
          width: 'max-content',
          transformOrigin: '0 0',
        }}
      >
        <CostTreeNode
          node={tree}
          criticalContributionByPositionName={criticalContributionByPositionName}
          selId={selectedLeafId}
          parSel={selectedParallelId}
          onSelect={onSelectLeaf}
          onPar={onSelectParallel}
          onRoot={onSelectRoot}
          density="compact"
        />
      </Box>
    </Box>
  );
}
