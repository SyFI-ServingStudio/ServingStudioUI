/**
 * The three-step flow that turns a question into a conversation.
 *
 * Its own file because it is the only part of the entry page that holds
 * state, and all of it: the working style, the workspace, the runtime
 * selection and the in-flight creation request. Everything around it renders.
 */
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { Navigate } from '../location';
import { createWorkspace, listCodexBackends } from '../session/api';
import type {
  CodexModelOption,
  CodexRoleRuntime,
  CodexRuntimeSelection,
  Workspace,
} from '../session/types';
import { tokens, withAlpha } from '../ui/theme';
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
import SetupStep from '../panels/catalog/SetupStep';
import WorkspacePicker from '../panels/catalog/WorkspacePicker';
import { storeEntryDraft } from './entryDraft';

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

function workspaceNameFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  return normalized.length <= 56 ? normalized : `${normalized.slice(0, 53).trimEnd()}…`;
}

export default function AgentStart({
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
                aria-label="Ask ServingStudio Agent"
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
