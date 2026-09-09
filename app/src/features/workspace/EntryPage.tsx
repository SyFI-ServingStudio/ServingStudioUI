import ThemePicker from '../../components/ThemePicker';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  listCodexBackends,
  type AgentSettings,
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
import { tokens, withAlpha } from '../../theme';
import {
  agentSettingsSentence,
  rolesForAgentMode,
  savedAgentSettings,
  saveAgentSettings,
} from './agentMode';
import AgentModePicker from './AgentModePicker';
import CodexRuntimePicker from './CodexRuntimePicker';
import { EMPTY_RUNTIME_SELECTION } from './codexRuntime';
import ConversationCatalog from './ConversationCatalog';
import ExperimentCatalog from './ExperimentCatalog';
import SetupStep from './SetupStep';
import WorkspacePicker from './WorkspacePicker';

type EntryMode = 'experiments' | 'new-conversation' | 'resume-conversation';

const PROMPT_STARTERS = [
  'For Llama3-8B on a single H200, what is the maximum throughput with TPOT < 20 ms, given 4K input tokens and 1K output tokens per request?',
  'When serving GLM5.2 with TP4 + EP4, which kernel takes the most time when processing 16K prefill tokens?',
  'What is the best ratio of prefill to decode servers for Llama3-8B when serving requests with 2K input tokens and 4K output tokens?',
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
        width: '100%',
        gap: { xs: 0, sm: 2 },
        borderBottom: `1px solid ${tokens.hair}`,
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
              px: { xs: 0.75, sm: 1.5 },
              py: 1.8,
              minWidth: 0,
              flex: { xs: 1, sm: 'none' },
              borderBottom: `2px solid ${selected ? tokens.teal : 'transparent'}`,
              color: selected ? tokens.teal : tokens.sub,
              fontSize: { xs: 12, sm: 15 },
              '&:hover': { background: withAlpha(tokens.teal, 0.045) },
              fontWeight: 500,
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

/**
 * Page 0 asks three things, in order, folding each as it is answered.
 *
 * `null` is a legitimate workspace answer — it means "create a new one" — so
 * whether a step has been answered cannot be read off its value. Hence the two
 * explicit `answered` flags rather than a null check.
 */
type SetupStepIndex = 1 | 2 | 3;

export function AgentStart({ workspaces }: { workspaces: readonly WorkspaceSummary[] }) {
  const [prompt, setPrompt] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<SetupStepIndex>(1);
  const [styleAnswered, setStyleAnswered] = useState(false);
  const [workspaceAnswered, setWorkspaceAnswered] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<readonly CodexModelOption[]>([]);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [codexRuntime, setCodexRuntime] = useState<CodexRuntimeSelection>(EMPTY_RUNTIME_SELECTION);
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(savedAgentSettings);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId) ?? null;
  const styleSentence = agentSettingsSentence(agentSettings);
  // Answering a step advances to the next unanswered one, so a reader who
  // reopens step 1 late is returned to the composer rather than marched back
  // through a workspace choice they already made.
  const answerStyle = (settings: AgentSettings) => {
    saveAgentSettings(settings);
    setAgentSettings(settings);
    setStyleAnswered(true);
    setOpenStep(workspaceAnswered ? 3 : 2);
  };
  const answerWorkspace = (workspaceId: string | null) => {
    setSelectedWorkspaceId(workspaceId);
    setWorkspaceAnswered(true);
    setOpenStep(3);
  };
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
          assistant: resolve(catalog.defaults.assistant),
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
      <Box sx={{ maxWidth: 760, mx: 'auto', textAlign: 'left' }}>
        <Typography
          component="h1"
          sx={{
            fontFamily: tokens.serif,
            fontSize: 'clamp(30px,3vw,42px)',
            fontWeight: 600,
            letterSpacing: '-.035em',
            lineHeight: 1,
          }}
        >
          New conversation
        </Typography>
        <Typography sx={{ maxWidth: 640, mt: 1.5, color: tokens.sub, fontSize: 16 }}>
          The Agent can choose a configuration, run the simulation, and connect its findings to the
          Analyzer.
        </Typography>
      </Box>
      <Stack sx={{ maxWidth: 760, mx: 'auto', mt: 3.6, gap: 1.5 }}>
        <SetupStep
          index={1}
          label="Working style"
          summary={`${styleSentence.cast} · ${styleSentence.autonomy}`}
          open={openStep === 1}
          onReopen={() => setOpenStep(1)}
        >
          <AgentModePicker
            settings={agentSettings}
            locked={false}
            size="md"
            onChange={answerStyle}
          />
        </SetupStep>
        {styleAnswered && (
          <SetupStep
            index={2}
            label="Workspace"
            summary={selectedWorkspace?.displayName ?? 'A new workspace'}
            open={openStep === 2}
            onReopen={() => setOpenStep(2)}
          >
            <WorkspacePicker
              workspaces={workspaces}
              selectedWorkspaceId={selectedWorkspaceId}
              onSelect={answerWorkspace}
            />
          </SetupStep>
        )}
        {workspaceAnswered && (
          <SetupStep
            index={3}
            label="Your question"
            open={openStep === 3}
            onReopen={() => setOpenStep(3)}
          >
            <Box
              component="form"
              onSubmit={submit}
              sx={{
                width: '100%',
                p: 1.4,
                border: `1px solid ${tokens.hair}`,
                borderRadius: 1.4,
                background: tokens.tile,
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
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ gap: 1, flexWrap: 'wrap' }}
              >
                <CodexRuntimePicker
                  models={modelOptions}
                  selection={codexRuntime}
                  roles={rolesForAgentMode(agentSettings.agentMode)}
                  size="sm"
                  compact
                  unavailable={catalogUnavailable}
                  onChange={(role, runtime) =>
                    setCodexRuntime((current) => ({ ...current, [role]: runtime }))
                  }
                />
                <ButtonBase
                  type="submit"
                  disabled={!prompt.trim() || creating}
                  aria-label="Send"
                  sx={{
                    flex: 'none',
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
          </SetupStep>
        )}
      </Stack>
      {/* Starters fill the composer, so they only mean anything once it exists. */}
      <Stack
        direction="column"
        justifyContent="center"
        useFlexGap
        flexWrap="wrap"
        sx={{
          maxWidth: 760,
          mx: 'auto',
          mt: 1.3,
          gap: 0.65,
          visibility: openStep === 3 ? 'visible' : 'hidden',
        }}
      >
        {PROMPT_STARTERS.map((starter) => (
          <ButtonBase
            key={starter}
            onClick={() => {
              setPrompt(starter);
              inputRef.current?.focus();
            }}
            sx={{
              px: 1.4,
              py: 1,
              textAlign: 'left',
              justifyContent: 'flex-start',
              lineHeight: 1.5,
              border: `1px solid ${tokens.hair}`,
              borderRadius: 0.8,
              color: tokens.sub,
              background: withAlpha(tokens.tile, 0.55),
              fontSize: 12,
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
        px: { xs: 2, md: 5 },
        py: { xs: 2, md: 3.5 },
        maxWidth: 1360,
        mx: 'auto',
        display: 'grid',
        gridTemplateRows: 'auto minmax(0,1fr) auto',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" sx={{ gap: 1 }}>
          <Box
            component="img"
            src="./vibesim-logo.png"
            alt=""
            sx={{ width: 34, height: 30, objectFit: 'contain' }}
          />
          <Typography
            sx={{ color: tokens.ink, fontWeight: 500, fontSize: 25, letterSpacing: '-.06em' }}
          >
            VibeSim
          </Typography>
        </Stack>
        {mode !== 'new-conversation' && <ThemePicker />}
      </Stack>

      <Box sx={{ width: '100%', minWidth: 0, mx: 'auto', pt: 2.5, pb: 4 }}>
        <ModeSwitch mode={mode} onChange={setMode} />
        <Box
          key={mode}
          sx={{
            mt: { xs: 3, md: 5 },
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
              <Box sx={{ maxWidth: 760, mb: 3, textAlign: 'left' }}>
                <Typography
                  component="h1"
                  sx={{
                    fontFamily: tokens.serif,
                    fontSize: 'clamp(30px,3vw,42px)',
                    fontWeight: 600,
                    letterSpacing: '-.035em',
                    lineHeight: 1,
                  }}
                >
                  Results
                </Typography>
                <Typography sx={{ maxWidth: 640, mt: 1.5, color: tokens.sub, fontSize: 16 }}>
                  Explore simulations, timing predictions, and kernel measurements across your
                  workspaces.
                </Typography>
              </Box>
              {resultCatalogPending ? (
                <Box
                  sx={{
                    height: 280,
                    borderTop: `1.5px solid ${tokens.ink}`,
                    background: withAlpha(tokens.tile, 0.35),
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
        <Typography sx={{ fontSize: 12 }}>VibeSim · Performance analysis</Typography>
        <Typography sx={{ fontSize: 12 }}>Simulate. Inspect. Compare.</Typography>
      </Stack>
    </Box>
  );
}
