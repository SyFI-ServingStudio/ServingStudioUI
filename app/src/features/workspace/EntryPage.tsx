import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  listCodexBackends,
  type CodexModelOption,
  type CodexRoleRuntime,
  type CodexRuntimeSelection,
  type WorkspaceConversationSummary,
} from '../../application/conversationRepository';
import { listManagedJobs, type ManagedJobListItem } from '../../application/managedJobRepository';
import {
  forgetActiveConversation,
  forgetPendingCodexRuntime,
  rememberActiveConversation,
  rememberPendingCodexRuntime,
} from '../../application/conversationSession';
import { useOfflineResourcesQuery, useSweepListQuery } from '../../application/queries';
import {
  createWorkspace,
  listWorkspaces,
  type WorkspaceSummary,
} from '../../application/workspaceRepository';
import { agentWorkspaceHref } from '../../application/workspaceRoute';
import { analyzerEvidenceHref } from '../../domain/analyzerNavigation';
import type { SweepListItem } from '../../domain/sweep';
import type { OfflineResourceCatalogItem } from '../../domain/offlineResource';
import { tokens } from '../../theme';
import CodexRuntimePicker from './CodexRuntimePicker';
import { EMPTY_RUNTIME_SELECTION } from './codexRuntime';
import ConversationCatalog from './ConversationCatalog';
import ExperimentCatalog from './ExperimentCatalog';
import WorkspacePicker from './WorkspacePicker';

type EntryMode = 'experiments' | 'new-conversation' | 'resume-conversation';

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

function navigateToOfflineResource(
  resource: OfflineResourceCatalogItem,
  workspaceId: string,
): void {
  const query = new URLSearchParams({ workspace: workspaceId });
  let route: 'prediction' | 'alignment' | 'kernel-profile' | 'kernel-measurement';
  if (resource.kind === 'timing_predict') {
    route = 'prediction';
    query.set('prediction', resource.resourceId);
    query.set('optimalityMode', 'unlocked');
  } else if (resource.kind === 'alignment') {
    route = 'alignment';
    query.set('alignment', resource.resourceId);
  } else if (resource.kind === 'kernel_profile') {
    route = 'kernel-profile';
    query.set('profile', resource.resourceId);
  } else {
    route = 'kernel-measurement';
    query.set('measurement', resource.resourceId);
  }
  window.location.hash = `#/${route}?${query.toString()}`;
}

function navigateToAgent(
  prompt: string,
  workspaceId: string,
  conversationId?: string,
  codexRuntime?: CodexRuntimeSelection,
): void {
  if (prompt) {
    window.sessionStorage.setItem('vibesim.entry.prompt', prompt);
  } else {
    window.sessionStorage.removeItem('vibesim.entry.prompt');
  }
  if (conversationId) {
    rememberActiveConversation(workspaceId, conversationId);
    forgetPendingCodexRuntime();
  } else {
    forgetActiveConversation(workspaceId);
    if (codexRuntime) rememberPendingCodexRuntime(codexRuntime);
  }
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
          ['new-conversation', 'New conversation'],
          ['resume-conversation', 'Resume conversation'],
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

export function AgentStart({ workspaces }: { workspaces: readonly WorkspaceSummary[] }) {
  const [prompt, setPrompt] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<readonly CodexModelOption[]>([]);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [codexRuntime, setCodexRuntime] = useState<CodexRuntimeSelection>(EMPTY_RUNTIME_SELECTION);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId) ?? null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || creating) return;
    setCreating(true);
    setCreationError(null);
    if (selectedWorkspaceId !== null) {
      navigateToAgent(text, selectedWorkspaceId, undefined, codexRuntime);
      return;
    }
    void createWorkspace(workspaceNameFromPrompt(text))
      .then((workspace) => navigateToAgent(text, workspace.workspaceId, undefined, codexRuntime))
      .catch((caught) => {
        setCreationError(caught instanceof Error ? caught.message : 'Workspace creation failed');
        setCreating(false);
      });
  };
  useEffect(() => {
    let disposed = false;
    void listCodexBackends()
      .then((catalog) => {
        if (disposed) return;
        setModelOptions(catalog.models);
        setCatalogUnavailable(catalog.models.length === 0);
        // A default may name a model whose provider this host cannot serve;
        // never preselect one the user would only find out about on send.
        const firstAvailable = catalog.models.find((model) => model.available);
        const usable = (runtime: { model: string }) =>
          catalog.models.some((model) => model.id === runtime.model && model.available);
        const resolve = (runtime: CodexRoleRuntime) =>
          usable(runtime) || !firstAvailable
            ? runtime
            : {
                model: firstAvailable.id,
                effort: firstAvailable.defaultEffort,
                serviceTier: firstAvailable.defaultServiceTier,
              };
        setCodexRuntime({
          orchestrator: resolve(catalog.defaults.orchestrator),
          implementer: resolve(catalog.defaults.implementer),
        });
      })
      .catch(() => {
        if (!disposed) setCatalogUnavailable(true);
      });
    return () => {
      disposed = true;
    };
  }, []);
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
      <Box sx={{ mt: 3.6 }}>
        <WorkspacePicker
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelect={setSelectedWorkspaceId}
        />
      </Box>
      {/* Centred on the page axis and spaced to read as the composer's own header. */}
      <Stack
        direction="row"
        justifyContent="center"
        sx={{ maxWidth: 760, mx: 'auto', mt: 2.6, mb: 1.4 }}
      >
        <CodexRuntimePicker
          models={modelOptions}
          selection={codexRuntime}
          size="md"
          unavailable={catalogUnavailable}
          onChange={(role, runtime) =>
            setCodexRuntime((current) => ({ ...current, [role]: runtime }))
          }
        />
      </Stack>
      <Box
        component="form"
        onSubmit={submit}
        sx={{
          maxWidth: 760,
          mx: 'auto',
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
          <Typography sx={{ color: tokens.sub2, fontSize: 10.5 }}>
            {selectedWorkspace
              ? `New conversation in ${selectedWorkspace.displayName}`
              : 'A new workspace will be created'}
          </Typography>
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
    </Box>
  );
}

export default function EntryPage() {
  const [mode, setMode] = useState<EntryMode>('experiments');
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const [managedJobs, setManagedJobs] = useState<readonly ManagedJobListItem[]>([]);
  const [managedJobsLoading, setManagedJobsLoading] = useState(true);
  const [managedJobsError, setManagedJobsError] = useState(false);
  const workspaceNames = useMemo(
    () =>
      Object.fromEntries(
        workspaces.map((workspace) => [workspace.workspaceId, workspace.displayName]),
      ),
    [workspaces],
  );
  const sweepList = useSweepListQuery();
  const offlineResources = useOfflineResourcesQuery();
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
  useEffect(() => {
    let disposed = false;
    setManagedJobsLoading(true);
    setManagedJobsError(false);
    void listManagedJobs()
      .then((jobs) => {
        if (!disposed) setManagedJobs(jobs);
      })
      .catch(() => {
        if (!disposed) setManagedJobsError(true);
      })
      .finally(() => {
        if (!disposed) setManagedJobsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);
  const simulationResults = sweepList.data ?? [];
  const analyzerOfflineResults = offlineResources.data ?? [];
  const resultCatalogPending =
    sweepList.isPending && offlineResources.isPending && managedJobsLoading;
  const resultCatalogFailed = sweepList.isError && offlineResources.isError && managedJobsError;
  const resultCatalogEmpty =
    simulationResults.length === 0 &&
    analyzerOfflineResults.length === 0 &&
    managedJobs.length === 0;
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
                  Open a simulation, timing prediction, or kernel result, then ask the Agent when
                  interpretation is useful.
                </Typography>
              </Box>
              {resultCatalogPending ? (
                <Box
                  sx={{
                    height: 280,
                    borderTop: `1.5px solid ${tokens.ink}`,
                    background: 'rgba(250,247,240,.35)',
                  }}
                />
              ) : resultCatalogFailed ? (
                <Typography role="alert" sx={{ py: 4, color: tokens.terra, textAlign: 'center' }}>
                  The result catalog could not be loaded.
                </Typography>
              ) : resultCatalogEmpty ? (
                <Typography role="status" sx={{ py: 4, color: tokens.sub, textAlign: 'center' }}>
                  No results are available.
                </Typography>
              ) : (
                <ExperimentCatalog
                  entries={simulationResults}
                  jobs={managedJobs}
                  offlineResources={analyzerOfflineResults}
                  workspaceNames={workspaceNames}
                  onActivate={navigateToExperiment}
                  onActivateOfflineResource={navigateToOfflineResource}
                />
              )}
            </Box>
          ) : mode === 'new-conversation' ? (
            <AgentStart workspaces={workspaces} />
          ) : (
            <ConversationCatalog
              workspaces={workspaces}
              onActivate={(conversation: WorkspaceConversationSummary) =>
                navigateToAgent('', conversation.workspaceId, conversation.id)
              }
            />
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
