import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { useSweepListQuery } from '../../application/queries';
import {
  createWorkspace,
  listWorkspaces,
  type WorkspaceSummary,
} from '../../application/workspaceRepository';
import { agentWorkspaceHref } from '../../application/workspaceRoute';
import { analyzerEvidenceHref } from '../../domain/analyzerNavigation';
import type { SweepListItem } from '../../domain/sweep';
import { tokens } from '../../theme';
import ExperimentCatalog from './ExperimentCatalog';

type EntryMode = 'experiments' | 'agent';

const PROMPT_STARTERS = [
  'Find the best tensor parallel configuration',
  'Compare two deployment plans',
  'Investigate a TTFT regression',
] as const;

function navigateToExperiment(entry: SweepListItem): void {
  const destination = new URL(window.location.href);
  destination.search = '';
  destination.hash = analyzerEvidenceHref({
    protocol: 'vibesim.analyzer/v2',
    kind: 'aggregate',
    workspaceId: entry.workspaceId,
    experimentId: entry.sweepId,
  });
  window.location.assign(destination);
}

function navigateToAgent(prompt: string, workspaceId: string): void {
  window.sessionStorage.setItem('vibesim.entry.prompt', prompt);
  const destination = new URL(window.location.href);
  destination.search = '';
  destination.hash = agentWorkspaceHref(workspaceId);
  window.location.assign(destination);
}

function ModeSwitch({ mode, onChange }: { mode: EntryMode; onChange: (mode: EntryMode) => void }) {
  return (
    <Stack
      role="tablist"
      aria-label="Workspace start mode"
      direction="row"
      sx={{
        width: 'max-content',
        mx: 'auto',
        p: 0.45,
        border: `1px solid ${tokens.hair}`,
        borderRadius: 1,
        background: 'rgba(250,247,240,.72)',
      }}
    >
      {(
        [
          ['experiments', 'Explore results'],
          ['agent', 'Work with Agent'],
        ] as const
      ).map(([value, label]) => {
        const selected = mode === value;
        return (
          <ButtonBase
            key={value}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(value)}
            sx={{
              px: 1.6,
              py: 0.8,
              borderRadius: 0.7,
              background: selected ? tokens.ink : 'transparent',
              color: selected ? tokens.paper : tokens.sub,
              fontSize: 11.5,
              fontWeight: 650,
              transition: `background 180ms ${tokens.ease}, color 180ms ${tokens.ease}`,
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          >
            {label}
          </ButtonBase>
        );
      })}
    </Stack>
  );
}

function workspaceNameFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  return normalized.length <= 56 ? normalized : `${normalized.slice(0, 53).trimEnd()}…`;
}

function AgentStart({ workspaces }: { workspaces: readonly WorkspaceSummary[] }) {
  const [prompt, setPrompt] = useState('');
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const visibleWorkspaces = useMemo(() => {
    const query = workspaceSearch.trim().toLocaleLowerCase();
    if (!query) return workspaces;
    return workspaces.filter(
      (workspace) =>
        workspace.displayName.toLocaleLowerCase().includes(query) ||
        workspace.workspaceId.toLocaleLowerCase().includes(query),
    );
  }, [workspaceSearch, workspaces]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || creating) return;
    setCreating(true);
    setCreationError(null);
    void createWorkspace(workspaceNameFromPrompt(text))
      .then((workspace) => navigateToAgent(text, workspace.workspaceId))
      .catch((caught) => {
        setCreationError(caught instanceof Error ? caught.message : 'Workspace creation failed');
        setCreating(false);
      });
  };
  return (
    <Box>
      <Box sx={{ maxWidth: 700, mx: 'auto', textAlign: 'center' }}>
        <Typography
          component="h1"
          sx={{
            fontFamily: tokens.serif,
            fontSize: 'clamp(40px,5.5vw,68px)',
            fontWeight: 600,
            letterSpacing: '-.035em',
            lineHeight: 1,
          }}
        >
          Begin with a{' '}
          <Box component="em" sx={{ color: tokens.teal, fontWeight: 500 }}>
            question.
          </Box>
        </Typography>
        <Typography sx={{ maxWidth: 560, mx: 'auto', mt: 1.8, color: tokens.sub, fontSize: 14.5 }}>
          The Agent can choose a configuration, run the simulation, and connect its findings to the
          Analyzer.
        </Typography>
      </Box>
      <Box
        component="form"
        onSubmit={submit}
        sx={{
          maxWidth: 760,
          mx: 'auto',
          mt: 4,
          p: 1.4,
          border: `1px solid ${tokens.hair}`,
          borderRadius: 1.4,
          background: tokens.tile,
          boxShadow: '0 22px 70px -42px rgba(42,38,34,.55)',
        }}
      >
        <Box
          component="textarea"
          ref={inputRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          aria-label="Ask VibeSim Agent"
          placeholder="What would you like to learn or optimize?"
          sx={{
            width: '100%',
            minHeight: 92,
            p: 1,
            resize: 'none',
            border: 0,
            outline: 0,
            boxSizing: 'border-box',
            background: 'transparent',
            color: tokens.ink,
            fontFamily: tokens.serif,
            fontSize: 18,
            lineHeight: 1.45,
            '&::placeholder': { color: tokens.sub2, opacity: 0.75 },
          }}
        />
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 1 }}>
          <Stack direction="row" alignItems="center" sx={{ gap: 0.7 }}>
            <ButtonBase
              type="button"
              sx={{
                minHeight: 34,
                px: 1.1,
                border: `1px solid ${tokens.hair}`,
                borderRadius: 0.85,
                color: tokens.sub,
                fontSize: 10.5,
                fontWeight: 600,
              }}
            >
              <AddRounded sx={{ mr: 0.4, fontSize: 15 }} />
              Context
            </ButtonBase>
            <Typography sx={{ color: tokens.sub2, fontSize: 10.5 }}>
              No experiment selected
            </Typography>
          </Stack>
          <ButtonBase
            type="submit"
            disabled={!prompt.trim() || creating}
            aria-label="Send"
            sx={{
              width: 36,
              height: 34,
              borderRadius: 0.85,
              background: tokens.ink,
              color: tokens.paper,
              '&.Mui-disabled': { background: tokens.hair, color: tokens.sub2 },
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          >
            <ArrowUpwardRounded sx={{ fontSize: 17 }} />
          </ButtonBase>
        </Stack>
      </Box>
      <Stack
        direction="row"
        justifyContent="center"
        useFlexGap
        flexWrap="wrap"
        sx={{ maxWidth: 760, mx: 'auto', mt: 1.3, gap: 0.65 }}
      >
        {PROMPT_STARTERS.map((starter) => (
          <ButtonBase
            key={starter}
            onClick={() => {
              setPrompt(starter);
              inputRef.current?.focus();
            }}
            sx={{
              px: 1.1,
              py: 0.7,
              border: `1px solid ${tokens.hair}`,
              borderRadius: 0.8,
              color: tokens.sub,
              background: 'rgba(250,247,240,.55)',
              fontSize: 10.5,
              '&:hover': { borderColor: tokens.sub2, color: tokens.ink },
            }}
          >
            {starter}
          </ButtonBase>
        ))}
      </Stack>
      {creationError && (
        <Typography role="alert" sx={{ mt: 1.2, color: tokens.terra, textAlign: 'center' }}>
          {creationError}
        </Typography>
      )}
      {workspaces.length > 0 && (
        <Box sx={{ maxWidth: 760, mx: 'auto', mt: 3.2 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 0.8 }}
          >
            <Typography
              sx={{
                color: tokens.sub2,
                fontFamily: tokens.mono,
                fontSize: 8.5,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
              }}
            >
              Continue a workspace
            </Typography>
            <Typography sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8 }}>
              {visibleWorkspaces.length}/{workspaces.length}
            </Typography>
          </Stack>
          {workspaces.length > 8 && (
            <Stack
              direction="row"
              alignItems="center"
              sx={{
                mb: 0.8,
                px: 1,
                border: `1px solid ${tokens.hair}`,
                borderRadius: 0.7,
                background: 'rgba(250,247,240,.55)',
              }}
            >
              <SearchRounded aria-hidden sx={{ mr: 0.7, color: tokens.sub2, fontSize: 14 }} />
              <Box
                component="input"
                value={workspaceSearch}
                onChange={(event) => setWorkspaceSearch(event.target.value)}
                aria-label="Search workspaces"
                placeholder="Name or workspace id"
                sx={{
                  width: '100%',
                  height: 32,
                  border: 0,
                  outline: 0,
                  background: 'transparent',
                  color: tokens.ink,
                  fontFamily: tokens.mono,
                  fontSize: 9.5,
                  '&::placeholder': { color: tokens.sub2 },
                }}
              />
            </Stack>
          )}
          <Box
            sx={{
              maxHeight: 112,
              overflowY: 'auto',
              pr: 0.5,
              scrollbarWidth: 'thin',
              scrollbarColor: `${tokens.hair} transparent`,
            }}
          >
            <Stack direction="row" useFlexGap flexWrap="wrap" sx={{ gap: 0.6 }}>
              {visibleWorkspaces.map((workspace) => (
                <ButtonBase
                  key={workspace.workspaceId}
                  onClick={() => navigateToAgent('', workspace.workspaceId)}
                  aria-label={`Continue ${workspace.displayName}`}
                  title={workspace.displayName}
                  sx={{
                    maxWidth: '100%',
                    px: 1,
                    py: 0.6,
                    border: `1px solid ${tokens.hair}`,
                    borderRadius: 0.65,
                    background:
                      workspace.workspaceId === 'w_main' ? 'rgba(31,111,107,.055)' : tokens.tile,
                    color: workspace.workspaceId === 'w_main' ? tokens.teal : tokens.sub,
                    fontSize: 10,
                    '&:hover': { borderColor: tokens.sub2, color: tokens.ink },
                    '&:focus-visible': {
                      outline: `2px solid ${tokens.teal}`,
                      outlineOffset: 1,
                    },
                  }}
                >
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {workspace.displayName}
                  </Box>
                </ButtonBase>
              ))}
            </Stack>
            {visibleWorkspaces.length === 0 && (
              <Typography sx={{ py: 1.2, color: tokens.sub2, fontSize: 10.5 }}>
                No workspace matches this search.
              </Typography>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default function EntryPage() {
  const [mode, setMode] = useState<EntryMode>('experiments');
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const workspaceNames = useMemo(
    () =>
      Object.fromEntries(
        workspaces.map((workspace) => [workspace.workspaceId, workspace.displayName]),
      ),
    [workspaces],
  );
  const sweepList = useSweepListQuery();
  useEffect(() => {
    document.title = 'VibeSim';
  }, []);
  useEffect(() => {
    let disposed = false;
    void listWorkspaces()
      .then((items) => {
        if (!disposed) setWorkspaces(items);
      })
      .catch(() => {
        if (!disposed) setWorkspaces([]);
      });
    return () => {
      disposed = true;
    };
  }, []);
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        px: { xs: 2.25, md: 6.5 },
        py: { xs: 2.5, md: 3.5 },
        display: 'grid',
        gridTemplateRows: 'auto minmax(0,1fr) auto',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" sx={{ gap: 1 }}>
          <Box
            sx={{
              width: 22,
              height: 22,
              display: 'grid',
              placeItems: 'center',
              border: `1px solid ${tokens.ink}`,
              borderRadius: 999,
              fontFamily: tokens.serif,
              fontSize: 12,
            }}
          >
            V
          </Box>
          <Typography sx={{ color: tokens.ink, fontWeight: 650, fontSize: 12 }}>VibeSim</Typography>
        </Stack>
        <Typography sx={{ color: tokens.sub, fontFamily: tokens.mono, fontSize: 9.5 }}>
          Analyzer ready
        </Typography>
      </Stack>

      <Box sx={{ width: 'min(1100px,100%)', mx: 'auto', pt: { xs: 5, md: 6.5 }, pb: 8 }}>
        <ModeSwitch mode={mode} onChange={setMode} />
        <Box
          key={mode}
          sx={{
            mt: 5.2,
            '@keyframes entryModeIn': {
              from: { opacity: 0, transform: 'translateY(8px)' },
              to: { opacity: 1, transform: 'none' },
            },
            animation: `entryModeIn 360ms ${tokens.ease} both`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          {mode === 'experiments' ? (
            <Box>
              <Box sx={{ maxWidth: 700, mx: 'auto', mb: 4, textAlign: 'center' }}>
                <Typography
                  component="h1"
                  sx={{
                    fontFamily: tokens.serif,
                    fontSize: 'clamp(40px,5.5vw,68px)',
                    fontWeight: 600,
                    letterSpacing: '-.035em',
                    lineHeight: 1,
                  }}
                >
                  Start from{' '}
                  <Box component="em" sx={{ color: tokens.teal, fontWeight: 500 }}>
                    what ran.
                  </Box>
                </Typography>
                <Typography
                  sx={{ maxWidth: 560, mx: 'auto', mt: 1.8, color: tokens.sub, fontSize: 14.5 }}
                >
                  Open an experiment, compare its operating points, and ask the Agent when
                  interpretation is useful.
                </Typography>
              </Box>
              {sweepList.isPending ? (
                <Box
                  sx={{
                    height: 280,
                    borderTop: `1.5px solid ${tokens.ink}`,
                    background: 'rgba(250,247,240,.35)',
                  }}
                />
              ) : sweepList.isError ? (
                <Typography role="alert" sx={{ py: 4, color: tokens.terra, textAlign: 'center' }}>
                  The experiment catalog could not be loaded.
                </Typography>
              ) : sweepList.data.length === 0 ? (
                <Typography role="status" sx={{ py: 4, color: tokens.sub, textAlign: 'center' }}>
                  No experiments are available.
                </Typography>
              ) : (
                <ExperimentCatalog
                  entries={sweepList.data}
                  workspaceNames={workspaceNames}
                  onActivate={navigateToExperiment}
                />
              )}
            </Box>
          ) : (
            <AgentStart workspaces={workspaces} />
          )}
        </Box>
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ color: tokens.sub2 }}>
        <Typography sx={{ fontFamily: tokens.mono, fontSize: 8.5 }}>
          Local workspace, old-logs excluded
        </Typography>
        <Typography sx={{ fontFamily: tokens.mono, fontSize: 8.5 }}>
          Experiments and agent work
        </Typography>
      </Stack>
    </Box>
  );
}
