import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import { Box, ButtonBase, Stack, Typography, useMediaQuery } from '@mui/material';
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { tokens, withAlpha, colors } from '../ui/theme';
import {
  DEFAULT_AGENT_PANEL_WIDTH,
  MAX_AGENT_PANEL_WIDTH,
  MIN_AGENT_PANEL_WIDTH,
  clampAgentPanelWidth,
  initialAgentPanelMode,
  nextAgentPanelMode,
  type AgentPanelMode,
} from './shellState';

function AgentEdgeToggle({
  direction,
  onActivate,
}: {
  direction: 'left' | 'right';
  onActivate: () => void;
}) {
  return (
    <ButtonBase
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onActivate}
      aria-label={direction === 'right' ? 'Open Agent' : 'Fold Agent'}
      sx={{
        position: 'absolute',
        top: '50%',
        left: 0,
        zIndex: 20,
        width: 18,
        height: 58,
        display: 'grid',
        placeItems: 'center',
        clipPath: 'polygon(0 0, 100% 11%, 100% 89%, 0 100%)',
        transform: 'translateY(-50%)',
        background: tokens.chrome,
        color: tokens.teal,
        filter: `drop-shadow(0 3px 7px ${withAlpha(tokens.ink, 0.13)})`,
        transition: `width 180ms ${tokens.ease}, background 180ms ${tokens.ease}, filter 180ms ${tokens.ease}`,
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '1px 1px 1px 0',
          clipPath: 'polygon(0 0, 100% 11%, 100% 89%, 0 100%)',
          background: tokens.tile2,
          transition: `background 180ms ${tokens.ease}`,
        },
        '&:hover': {
          width: 22,
          background: withAlpha(tokens.teal, 0.34),
          filter: `drop-shadow(0 4px 8px ${withAlpha(tokens.teal, 0.18)})`,
          '&::before': { background: colors.blueWash },
        },
        '&:focus-visible': {
          width: 22,
          background: tokens.teal,
          outline: `2px solid ${tokens.teal}`,
          outlineOffset: 2,
          '&::before': { background: colors.blueWash },
        },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      {direction === 'right' ? (
        <ChevronRightRounded sx={{ position: 'relative', zIndex: 1, fontSize: 15 }} />
      ) : (
        <ChevronLeftRounded sx={{ position: 'relative', zIndex: 1, fontSize: 15 }} />
      )}
    </ButtonBase>
  );
}

export interface ShellProps {
  readonly children: ReactNode;
  readonly title: string;
  readonly detail?: string;
  readonly metadata?: ReactNode;
  readonly agent: ((controls: AgentSurfaceControls) => ReactNode) | null;
  readonly agentOpen: boolean;
  readonly fullAgent?: boolean;
  readonly onBack: () => void;
  readonly onOpenAgent: () => void;
}

/** Controls the old Agent surface renders in its own header chrome. */
export interface AgentSurfaceControls {
  readonly expanded: boolean;
  readonly visible: boolean;
  readonly narrow: boolean;
  readonly onFold?: () => void;
  readonly onToggleFull: () => void;
}

/**
 * The persistent workspace frame.
 *
 * This is the old WorkspaceShell's DOM and styling with its data reads removed.
 * Its caller supplies the header and Agent content; only unshareable geometry
 * (fold/full mode, width, and an active resize) lives here.
 */
export default function Shell({
  children,
  title,
  detail,
  metadata,
  agent,
  agentOpen,
  fullAgent = false,
  onBack,
  onOpenAgent,
}: ShellProps) {
  const narrow = useMediaQuery('(max-width:900px)');
  const [agentPanelMode, setAgentPanelMode] = useState<AgentPanelMode>(() =>
    initialAgentPanelMode(agentOpen, fullAgent),
  );
  const [agentPanelWidth, setAgentPanelWidthState] = useState(DEFAULT_AGENT_PANEL_WIDTH);
  const [resizeOrigin, setResizeOrigin] = useState<{
    pointerX: number;
    panelWidth: number;
  } | null>(null);
  const previousAgentOpen = useRef(agentOpen);
  const setAgentPanelWidth = useCallback((width: number, viewportWidth = window.innerWidth) => {
    setAgentPanelWidthState(clampAgentPanelWidth(width, viewportWidth));
  }, []);

  useEffect(() => {
    setAgentPanelMode((current) =>
      nextAgentPanelMode(current, previousAgentOpen.current, agentOpen, fullAgent),
    );
    previousAgentOpen.current = agentOpen;
  }, [agentOpen, fullAgent]);

  useEffect(() => {
    if (!narrow || (agentPanelMode !== 'docked' && agentPanelMode !== 'full')) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [agentPanelMode, narrow]);

  useEffect(() => {
    if (!resizeOrigin) return;
    const move = (event: PointerEvent) => {
      setAgentPanelWidth(
        resizeOrigin.panelWidth + event.clientX - resizeOrigin.pointerX,
        window.innerWidth,
      );
    };
    const finish = () => setResizeOrigin(null);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [resizeOrigin, setAgentPanelWidth]);

  useEffect(() => {
    const clampToViewport = () => {
      setAgentPanelWidthState((current) => clampAgentPanelWidth(current, window.innerWidth));
    };
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, []);

  const exposeAgent = () => {
    setAgentPanelMode('docked');
    if (!agentOpen) onOpenAgent();
  };

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.focus();
    event.preventDefault();
    setResizeOrigin({ pointerX: event.clientX, panelWidth: agentPanelWidth });
  };
  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 24;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setAgentPanelWidth(agentPanelWidth - step, window.innerWidth);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setAgentPanelWidth(agentPanelWidth + step, window.innerWidth);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setAgentPanelWidth(MIN_AGENT_PANEL_WIDTH, window.innerWidth);
    } else if (event.key === 'End') {
      event.preventDefault();
      setAgentPanelWidth(MAX_AGENT_PANEL_WIDTH, window.innerWidth);
    }
  };

  const gridTemplateColumns =
    agentPanelMode === 'full'
      ? 'minmax(0,1fr)'
      : narrow
        ? 'minmax(0,1fr)'
        : agentPanelMode === 'docked'
          ? `${agentPanelWidth}px 8px minmax(0,1fr)`
          : '0 0 minmax(0,1fr)';
  const agentPaneVisible = agentPanelMode === 'docked' || agentPanelMode === 'full';
  const agentSurface =
    agent?.({
      expanded: agentPanelMode === 'full',
      visible: agentPaneVisible,
      narrow,
      ...(narrow ? { onFold: () => setAgentPanelMode('spine') } : {}),
      onToggleFull: () => setAgentPanelMode((current) => (current === 'full' ? 'docked' : 'full')),
    }) ?? null;

  return (
    <Box
      sx={{
        width: '100%',
        height: '100dvh',
        position: 'relative',
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns,
        gridTemplateRows: 'minmax(0,1fr)',
        overflow: 'hidden',
        background: tokens.paper,
        transition: resizeOrigin ? 'none' : `grid-template-columns 240ms ${tokens.ease}`,
      }}
    >
      {narrow && agentPanelMode === 'spine' && (
        <AgentEdgeToggle direction="right" onActivate={exposeAgent} />
      )}

      <Box
        data-testid="chat-dock"
        aria-hidden={!agentPaneVisible}
        sx={{
          gridColumn: 1,
          gridRow: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          opacity: agentPaneVisible ? 1 : 0,
          visibility: agentPaneVisible ? 'visible' : 'hidden',
          pointerEvents: agentPaneVisible ? 'auto' : 'none',
          transform: agentPaneVisible ? 'translateX(0)' : 'translateX(-10px)',
          transition: resizeOrigin
            ? 'none'
            : [
                `opacity 240ms ${tokens.ease}`,
                `transform 240ms ${tokens.ease}`,
                `visibility 0s linear ${agentPaneVisible ? '0ms' : '240ms'}`,
              ].join(', '),
          ...(narrow && agentPanelMode === 'docked'
            ? {
                position: 'fixed',
                inset: 0,
                zIndex: 30,
              }
            : {}),
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      >
        {agentSurface}
      </Box>

      {!narrow && agentPanelMode !== 'full' && (
        <Box
          role={agentPanelMode === 'docked' ? 'separator' : undefined}
          aria-label={agentPanelMode === 'docked' ? 'Resize Agent panel' : undefined}
          aria-orientation={agentPanelMode === 'docked' ? 'vertical' : undefined}
          aria-valuemin={agentPanelMode === 'docked' ? MIN_AGENT_PANEL_WIDTH : undefined}
          aria-valuemax={
            agentPanelMode === 'docked'
              ? Math.min(MAX_AGENT_PANEL_WIDTH, window.innerWidth - 520)
              : undefined
          }
          aria-valuenow={agentPanelMode === 'docked' ? agentPanelWidth : undefined}
          tabIndex={agentPanelMode === 'docked' ? 0 : -1}
          onPointerDown={agentPanelMode === 'docked' ? beginResize : undefined}
          onKeyDown={agentPanelMode === 'docked' ? resizeWithKeyboard : undefined}
          sx={{
            gridColumn: 2,
            gridRow: 1,
            position: 'relative',
            minHeight: 0,
            overflow: 'visible',
            cursor: agentPanelMode === 'docked' ? 'col-resize' : 'default',
            color: resizeOrigin ? tokens.teal : tokens.sub2,
            background:
              agentPanelMode === 'docked' && resizeOrigin
                ? withAlpha(tokens.teal, 0.08)
                : 'transparent',
            transition: `background 140ms ${tokens.ease}, color 140ms ${tokens.ease}`,
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: '1px',
              opacity: agentPanelMode === 'docked' ? 1 : 0,
              background: resizeOrigin ? withAlpha(tokens.teal, 0.38) : tokens.hair,
              transition: `opacity 160ms ${tokens.ease}, background 140ms ${tokens.ease}`,
            },
            '&:hover':
              agentPanelMode === 'docked'
                ? { color: tokens.teal, background: withAlpha(tokens.teal, 0.055) }
                : undefined,
            '&:focus-visible': {
              outline: `2px solid ${tokens.teal}`,
              outlineOffset: -2,
              color: tokens.teal,
            },
          }}
        >
          <AgentEdgeToggle
            direction={agentPanelMode === 'docked' ? 'left' : 'right'}
            onActivate={() =>
              agentPanelMode === 'docked' ? setAgentPanelMode('spine') : exposeAgent()
            }
          />
        </Box>
      )}

      <Box
        sx={{
          gridColumn: narrow ? 1 : 3,
          gridRow: 1,
          minWidth: 0,
          minHeight: 0,
          display: agentPanelMode === 'full' ? 'none' : 'grid',
          gridTemplateRows: 'auto minmax(0,1fr)',
        }}
      >
        <Box
          component="header"
          sx={{
            minHeight: 58,
            px: { xs: 1.5, md: 2.25 },
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            borderBottom: `1px solid ${tokens.hair}`,
            background: withAlpha(tokens.tile, 0.94),
            backdropFilter: 'blur(14px)',
            zIndex: 5,
          }}
        >
          <ButtonBase
            onClick={onBack}
            aria-label="Back to experiments"
            sx={{
              width: 32,
              height: 32,
              flex: '0 0 auto',
              border: `1px solid ${tokens.hair}`,
              borderRadius: 0.8,
              color: tokens.sub,
              '&:hover': { borderColor: tokens.sub2, color: tokens.ink },
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          >
            <ArrowBackRounded sx={{ fontSize: 17 }} />
          </ButtonBase>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" alignItems="baseline" sx={{ minWidth: 0, gap: 0.8 }}>
              <Typography
                noWrap
                sx={{ color: tokens.ink, fontFamily: tokens.serif, fontSize: 16, fontWeight: 600 }}
              >
                {title}
              </Typography>
              {detail !== undefined && (
                <Typography
                  noWrap
                  sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}
                >
                  {detail}
                </Typography>
              )}
            </Stack>
            {metadata}
          </Box>
          <Box sx={{ flex: 1 }} />
          {agentPanelMode === 'spine' && (
            <ButtonBase
              onClick={exposeAgent}
              sx={{
                minHeight: 34,
                px: 1.15,
                flex: '0 0 auto',
                border: `1px solid ${tokens.hair}`,
                borderRadius: 0.85,
                background: tokens.tile,
                color: tokens.ink,
                fontSize: 12,
                fontWeight: 650,
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
              }}
            >
              <AutoAwesomeOutlined sx={{ mr: 0.55, fontSize: 15 }} />
              Ask Agent
            </ButtonBase>
          )}
        </Box>
        <Box sx={{ minWidth: 0, minHeight: 0, overflow: 'auto' }}>{children}</Box>
      </Box>
    </Box>
  );
}
