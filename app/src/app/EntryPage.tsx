import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { CatalogFilter, Navigate } from '../location';
import { createWorkspace, listCodexBackends, listWorkspaces } from '../session/api';
import type {
  CodexModelOption,
  CodexRoleRuntime,
  CodexRuntimeSelection,
  Workspace,
} from '../session/types';
import ThemePicker from '../ui/controls/ThemePicker';
import { tokens, withAlpha } from '../ui/theme';
import { pageLayout } from '../ui/theme/metrics';
import AgentModePicker from '../panels/conversation/AgentModePicker';
import type { AgentSettings } from '../panels/conversation/agentTypes';
import {
  agentSettingsSentence,
  rolesForAgentMode,
  savedAgentSettings,
  saveAgentSettings,
} from '../panels/conversation/agentMode';
import CodexRuntimePicker from '../panels/conversation/CodexRuntimePicker';
import { EMPTY_RUNTIME_SELECTION } from '../panels/conversation/codexRuntime';
import { CatalogPage } from '../panels/catalog/CatalogPage';
import ConversationCatalog from '../panels/catalog/ConversationCatalog';
import SetupStep from '../panels/catalog/SetupStep';
import WorkspacePicker from '../panels/catalog/WorkspacePicker';
import { storeEntryDraft } from './entryDraft';

type EntryMode = 'experiments' | 'new-conversation' | 'resume-conversation';

const PROMPT_STARTERS = [
  {
    label: 'Llama3-8B · Max throughput',
    prompt:
      'For Llama3-8B on a single H200, what is the maximum throughput with TPOT < 20 ms, given 4K input tokens and 1K output tokens per request?',
  },
  {
    label: 'GLM5.2 · Kernel bottleneck',
    prompt:
      'When serving GLM5.2 with TP4 + EP4, which kernel takes the most time when processing 16K prefill tokens?',
  },
  {
    label: 'Llama3-8B · Prefill/decode split',
    prompt:
      'What is the best ratio of prefill to decode servers for Llama3-8B on NVIDIA H200 GPUs when serving requests with 2K input tokens and 4K output tokens?',
  },
] as const;

function ModeSwitch({ mode, onChange }: { mode: EntryMode; onChange: (mode: EntryMode) => void }) {
  return (
    <Stack
      role="tablist"
      aria-label="Workspace start mode"
      direction="row"
      sx={{ width: '100%', gap: { xs: 0, sm: 2 }, borderBottom: `1px solid ${tokens.hair}` }}
    >
      {(
        [
          ['experiments', 'Explore results'],
          ['new-conversation', 'New conversation'],
          ['resume-conversation', 'Resume conversation'],
        ] as const
      ).map(([value, label]) => (
        <ButtonBase
          key={value}
          role="tab"
          aria-selected={mode === value}
          onClick={() => onChange(value)}
          sx={{
            px: { xs: 0.75, sm: 1.5 },
            py: 1.8,
            minWidth: 0,
            flex: { xs: 1, sm: 'none' },
            borderBottom: `2px solid ${mode === value ? tokens.teal : 'transparent'}`,
            color: mode === value ? tokens.teal : tokens.sub,
            fontSize: { xs: 12, sm: 15 },
            fontWeight: 500,
            transition: `background 180ms ${tokens.ease}, color 180ms ${tokens.ease}`,
            '&:hover': { background: withAlpha(tokens.teal, 0.045) },
            '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
          }}
        >
          {label}
        </ButtonBase>
      ))}
    </Stack>
  );
}

function workspaceNameFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  return normalized.length <= 56 ? normalized : `${normalized.slice(0, 53).trimEnd()}…`;
}

function AgentStart({
  workspaces,
  navigate,
}: {
  workspaces: readonly Workspace[];
  navigate: Navigate;
}) {
  const [prompt, setPrompt] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<1 | 2 | 3>(1);
  const [styleAnswered, setStyleAnswered] = useState(false);
  const [workspaceAnswered, setWorkspaceAnswered] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<readonly CodexModelOption[]>([]);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [codexRuntime, setCodexRuntime] = useState<CodexRuntimeSelection>(EMPTY_RUNTIME_SELECTION);
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(savedAgentSettings);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const creationRequest = useRef<AbortController | null>(null);
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const styleSentence = agentSettingsSentence(agentSettings);

  useEffect(() => {
    const abort = new AbortController();
    void listCodexBackends(abort.signal)
      .then((catalog) => {
        setModelOptions(catalog.models);
        setCatalogUnavailable(catalog.models.length === 0);
        const firstAvailable = catalog.models.find((model) => model.available);
        const usable = (runtime: { model: string }) =>
          catalog.models.some((model) => model.id === runtime.model && model.available);
        const resolve = (runtime: CodexRoleRuntime) =>
          usable(runtime) || firstAvailable === undefined
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
        if (!abort.signal.aborted) setCatalogUnavailable(true);
      });
    return () => abort.abort();
  }, []);

  useEffect(
    () => () => {
      creationRequest.current?.abort();
      creationRequest.current = null;
    },
    [],
  );

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
    const enter = (workspace: string): boolean => {
      try {
        storeEntryDraft({ workspace, prompt: text, runtime: codexRuntime });
        navigate({ view: 'chat', chat: { state: 'draft', workspace } }, 'push');
        return true;
      } catch (error) {
        setCreationError(
          error instanceof Error
            ? `Could not preserve your question: ${error.message}`
            : 'Could not preserve your question',
        );
        setCreating(false);
        return false;
      }
    };
    if (selectedWorkspaceId !== null) {
      enter(selectedWorkspaceId);
      return;
    }
    const controller = new AbortController();
    creationRequest.current?.abort();
    creationRequest.current = controller;
    void createWorkspace(workspaceNameFromPrompt(text), controller.signal)
      .then((workspace) => {
        if (creationRequest.current !== controller || controller.signal.aborted) return;
        enter(workspace.id);
      })
      .catch((error) => {
        if (creationRequest.current !== controller || controller.signal.aborted) return;
        setCreationError(error instanceof Error ? error.message : 'Workspace creation failed');
        setCreating(false);
      })
      .finally(() => {
        if (creationRequest.current === controller) creationRequest.current = null;
      });
  };

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
            summary={selectedWorkspace?.label ?? 'A new workspace'}
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
      <Stack
        direction="row"
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
            key={starter.label}
            onClick={() => {
              setPrompt(starter.prompt);
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
            {starter.label}
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

export default function EntryPage({
  filter,
  navigate,
}: {
  filter: CatalogFilter;
  navigate: Navigate;
}) {
  const [mode, setMode] = useState<EntryMode>('experiments');
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  useEffect(() => {
    document.title = 'VibeSim';
    const abort = new AbortController();
    void listWorkspaces(abort.signal)
      .then(setWorkspaces)
      .catch(() => setWorkspaces([]));
    return () => abort.abort();
  }, []);
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        px: 0,
        py: { xs: 2, md: 3.5 },
        ...pageLayout,
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
            <CatalogPage filter={filter} navigate={navigate} workspaces={workspaces} />
          ) : mode === 'new-conversation' ? (
            <AgentStart workspaces={workspaces} navigate={navigate} />
          ) : (
            <ConversationCatalog
              workspaces={workspaces}
              onActivate={(conversation) =>
                navigate(
                  {
                    view: 'chat',
                    chat: {
                      state: 'created',
                      workspace: conversation.workspaceId,
                      id: conversation.id,
                    },
                  },
                  'push',
                )
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
