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
  useMemo,
  useRef,
  useState,
} from 'react';

import type { AppView } from '../../application/appRoute';
import { useSweepListQuery, useSweepQuery } from '../../application/queries';
import { analyzerSelectionFromVizState } from '../../application/analyzerSelection';
import { listWorkspaces } from '../../application/workspaceRepository';
import { workspaceIdFromLocation } from '../../application/workspaceRoute';
import { evidenceRefFromHash } from '../../domain/analyzerNavigation';
import { useViz } from '../../store';
import { tokens } from '../../theme';
import AgentPane from './AgentWorkspace';
import { analyzerTurnContext } from './citationDictionary';
import CatalogTag from './CatalogTag';
import {
  agentPanelModeForWorkspaceView,
  MAX_AGENT_PANEL_WIDTH,
  MIN_AGENT_PANEL_WIDTH,
  useWorkspaceUi,
} from './workspaceUiStore';

function leaveWorkspace(): void {
  const destination = new URL(window.location.href);
  destination.search = '';
  destination.hash = '#/';
  window.location.assign(destination);
}

function displayExperimentName(name: string): string {
  return name.replace(/^\d{8}_\d+_/, '');
}

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
        background: '#d5cbbb',
        color: tokens.teal,
        filter: 'drop-shadow(0 3px 7px rgba(42,38,34,.13))',
        transition: `width 180ms ${tokens.ease}, background 180ms ${tokens.ease}, filter 180ms ${tokens.ease}`,
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '1px 1px 1px 0',
          clipPath: 'polygon(0 0, 100% 11%, 100% 89%, 0 100%)',
          background: '#f2ece1',
          transition: `background 180ms ${tokens.ease}`,
        },
        '&:hover': {
          width: 22,
          background: 'rgba(31,111,107,.34)',
          filter: 'drop-shadow(0 4px 8px rgba(31,111,107,.18))',
          '&::before': { background: '#e9efea' },
        },
        '&:focus-visible': {
          width: 22,
          background: tokens.teal,
          outline: `2px solid ${tokens.teal}`,
          outlineOffset: 2,
          '&::before': { background: '#e9efea' },
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

export default function WorkspaceShell({
  children,
  view,
}: {
  children: ReactNode;
  view: Exclude<AppView, 'entry'>;
}) {
  const narrow = useMediaQuery('(max-width:900px)');
  const workspaceId = workspaceIdFromLocation();
  const [workspaceName, setWorkspaceName] = useState<string>();
  const sweepList = useSweepListQuery();
  const aggregateSelection = useViz((state) => state.aggregateSelection);
  const analyzerSelection = useViz(analyzerSelectionFromVizState);
  const hashEvidence = evidenceRefFromHash(window.location.hash);
  const experimentId =
    (hashEvidence?.kind === 'aggregate' ? hashEvidence.experimentId : null) ??
    aggregateSelection?.experimentId ??
    null;
  const experiment =
    sweepList.data?.find(
      (entry) => entry.workspaceId === workspaceId && entry.sweepId === experimentId,
    ) ?? null;
  const sweep = useSweepQuery(experimentId, experiment?.status === 'ready');
  const turnContext = useMemo(
    () => analyzerTurnContext(analyzerSelection, sweep.data),
    [analyzerSelection, sweep.data],
  );
  const agentPanelMode = useWorkspaceUi((state) => state.agentPanelMode);
  const agentPanelWidth = useWorkspaceUi((state) => state.agentPanelWidth);
  const setAgentPanelMode = useWorkspaceUi((state) => state.setAgentPanelMode);
  const setAgentPanelWidth = useWorkspaceUi((state) => state.setAgentPanelWidth);
  const [resizeOrigin, setResizeOrigin] = useState<{
    pointerX: number;
    panelWidth: number;
  } | null>(null);
  const prompt = window.sessionStorage.getItem('vibesim.entry.prompt') ?? '';
  const consumeInitialPrompt = useCallback(() => {
    window.sessionStorage.removeItem('vibesim.entry.prompt');
  }, []);
  const previousView = useRef(view);

  useEffect(() => {
    let disposed = false;
    void listWorkspaces()
      .then((workspaces) => {
        if (!disposed) {
          setWorkspaceName(
            workspaces.find((workspace) => workspace.workspaceId === workspaceId)?.displayName,
          );
        }
      })
      .catch(() => {
        if (!disposed) setWorkspaceName(undefined);
      });
    return () => {
      disposed = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    const currentMode = useWorkspaceUi.getState().agentPanelMode;
    const nextMode = agentPanelModeForWorkspaceView(
      previousView.current,
      view,
      currentMode,
      new URLSearchParams(window.location.search).get('agent') === '1',
    );
    if (nextMode !== currentMode) setAgentPanelMode(nextMode);
    previousView.current = view;
  }, [setAgentPanelMode, view]);

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
      const state = useWorkspaceUi.getState();
      state.setAgentPanelWidth(state.agentPanelWidth, window.innerWidth);
    };
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, []);

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
        <AgentEdgeToggle direction="right" onActivate={() => setAgentPanelMode('docked')} />
      )}

      <Box
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
        <AgentPane
          key={workspaceId}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          onWorkspaceNameChange={setWorkspaceName}
          prompt={prompt}
          onInitialPromptStarted={consumeInitialPrompt}
          onClose={
            agentPanelMode === 'full'
              ? view === 'agent'
                ? leaveWorkspace
                : () => setAgentPanelMode('docked')
              : undefined
          }
          onFold={narrow ? () => setAgentPanelMode('spine') : undefined}
          onToggleFull={() => setAgentPanelMode(agentPanelMode === 'full' ? 'docked' : 'full')}
          analyzerContext={turnContext}
          enabled={agentPaneVisible}
          requireAnalyzerContext={view !== 'agent' && view !== 'job'}
          expanded={agentPanelMode === 'full'}
          showSelectionContext={view !== 'agent' && view !== 'job'}
        />
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
              agentPanelMode === 'docked' && resizeOrigin ? 'rgba(31,111,107,.08)' : 'transparent',
            transition: `background 140ms ${tokens.ease}, color 140ms ${tokens.ease}`,
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: '1px',
              opacity: agentPanelMode === 'docked' ? 1 : 0,
              background: resizeOrigin ? 'rgba(31,111,107,.38)' : tokens.hair,
              transition: `opacity 160ms ${tokens.ease}, background 140ms ${tokens.ease}`,
            },
            '&:hover':
              agentPanelMode === 'docked'
                ? { color: tokens.teal, background: 'rgba(31,111,107,.055)' }
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
            onActivate={() => setAgentPanelMode(agentPanelMode === 'docked' ? 'spine' : 'docked')}
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
            background: 'rgba(244,240,232,.94)',
            backdropFilter: 'blur(14px)',
            zIndex: 5,
          }}
        >
          <ButtonBase
            onClick={leaveWorkspace}
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
                {experiment
                  ? displayExperimentName(experiment.displayName)
                  : view === 'job'
                    ? 'Result'
                    : view === 'prediction'
                      ? 'Timing prediction'
                      : 'Analyzer'}
              </Typography>
              {experiment && (
                <Typography
                  noWrap
                  sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}
                >
                  {experiment.numRuns} {experiment.numRuns === 1 ? 'run' : 'runs'}
                </Typography>
              )}
            </Stack>
            {experiment && (
              <Stack
                direction="row"
                alignItems="center"
                sx={{ mt: 0.25, minWidth: 0, gap: 0.45, overflow: 'hidden' }}
              >
                {experiment.deployments.slice(0, 1).map((deployment) => (
                  <CatalogTag key={deployment} tone="deployment" compact>
                    {deployment}
                  </CatalogTag>
                ))}
                {experiment.traces.slice(0, 1).map((trace) => (
                  <CatalogTag key={trace} tone="trace" compact>
                    {trace}
                  </CatalogTag>
                ))}
                {experiment.axes.slice(0, 2).map((axis) => (
                  <CatalogTag key={axis} tone="axis" compact>
                    {axis}
                  </CatalogTag>
                ))}
              </Stack>
            )}
          </Box>
          <Box sx={{ flex: 1 }} />
          {agentPanelMode === 'hidden' && (
            <ButtonBase
              onClick={() => setAgentPanelMode('docked')}
              sx={{
                minHeight: 34,
                px: 1.15,
                flex: '0 0 auto',
                border: `1px solid ${tokens.hair}`,
                borderRadius: 0.85,
                background: tokens.tile,
                color: tokens.ink,
                fontSize: 10.5,
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
