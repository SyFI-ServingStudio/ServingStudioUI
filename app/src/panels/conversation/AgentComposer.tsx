import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import AdjustRounded from '@mui/icons-material/AdjustRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import PendingActionsRounded from '@mui/icons-material/PendingActionsRounded';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import StopRounded from '@mui/icons-material/StopRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { type FormEvent, memo, useEffect, useRef, useState } from 'react';

import { tokens, withAlpha } from '../../ui/theme';
import { WorkingStyleTag } from './AgentModePicker';
import CodexRuntimePicker from './CodexRuntimePicker';
import { rolesForAgentMode } from './agentMode';
import { MAX_QUEUED_MESSAGES } from './agentQueue';
import type {
  AgentSettings,
  CodexModelOption,
  CodexRoleRuntime,
  CodexRuntimeSelection,
} from './agentTypes';

export interface AgentSelectionContext {
  readonly present: boolean;
  readonly identity: string;
  readonly values: readonly string[];
  readonly json: string;
}

function AnalyzerSelectionStrip({
  context,
  onClear,
}: {
  context: AgentSelectionContext;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { identity, values } = context;
  return (
    <Box
      role="status"
      aria-label="Active Analyzer selection"
      aria-live="polite"
      sx={{
        mb: 1.15,
        px: 0.85,
        py: 0.7,
        border: `1px solid ${withAlpha(tokens.teal, 0.22)}`,
        borderRadius: 0.85,
        background: withAlpha(tokens.teal, 0.045),
      }}
    >
      <Stack direction="row" alignItems="center" useFlexGap sx={{ gap: 0.65 }}>
        <AdjustRounded sx={{ flex: '0 0 auto', color: tokens.teal, fontSize: 13 }} />
        <Typography
          sx={{
            flex: '0 0 auto',
            color: tokens.teal,
            fontFamily: tokens.body,
            fontSize: 12,
            fontWeight: 650,
            letterSpacing: '.11em',
            textTransform: 'uppercase',
          }}
        >
          Selected
        </Typography>
        <Stack
          key={identity}
          direction="row"
          alignItems="center"
          useFlexGap
          flexWrap="wrap"
          sx={{
            minWidth: 0,
            gap: 0.4,
            '@keyframes selectionContextIn': {
              from: { opacity: 0.35, transform: 'translateY(2px)' },
              to: { opacity: 1, transform: 'none' },
            },
            animation: `selectionContextIn 320ms ${tokens.ease} both`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          {values.length === 0 ? (
            <Typography sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}>
              No Analyzer selection
            </Typography>
          ) : (
            values.map((value, index) => (
              <Box
                key={`${index}-${value}`}
                component="span"
                title={value}
                sx={{
                  maxWidth: 180,
                  px: 0.55,
                  py: 0.3,
                  overflow: 'hidden',
                  border: `1px solid ${index === 0 ? withAlpha(tokens.teal, 0.25) : tokens.hair}`,
                  borderRadius: 0.55,
                  background: index === 0 ? withAlpha(tokens.teal, 0.08) : tokens.tile,
                  color: index === 0 ? tokens.teal : tokens.sub,
                  fontFamily: tokens.body,
                  fontSize: 12,
                  lineHeight: 1,
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {value}
              </Box>
            ))
          )}
        </Stack>
        {context.present && (
          <ButtonBase
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            sx={{
              ml: 'auto',
              flex: '0 0 auto',
              color: tokens.teal,
              fontFamily: tokens.body,
              fontSize: 12,
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          >
            {expanded ? 'hide JSON' : 'view JSON'}
          </ButtonBase>
        )}
        <ButtonBase
          onClick={onClear}
          aria-label="Clear Analyzer context"
          title="Do not include this selection in the next Agent turn"
          sx={{
            width: 20,
            height: 20,
            flex: '0 0 auto',
            borderRadius: 0.55,
            color: tokens.sub2,
            '&:hover': { background: withAlpha(tokens.teal, 0.08), color: tokens.teal },
            '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
          }}
        >
          <CloseRounded sx={{ fontSize: 13 }} />
        </ButtonBase>
      </Stack>
      {expanded && context.present && (
        <Box
          component="pre"
          sx={{
            m: 0,
            mt: 0.75,
            p: 0.8,
            maxHeight: 150,
            overflow: 'auto',
            borderTop: `1px solid ${tokens.hair}`,
            color: tokens.sub,
            fontFamily: tokens.body,
            fontSize: 12,
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
          }}
        >
          {context.json}
        </Box>
      )}
    </Box>
  );
}

/**
 * Says where the next message goes after an interrupt.
 *
 * Read-only on purpose: the target is not a preference, it is wherever the
 * interrupt landed. Offering a switch would imply you can address a role whose
 * session has nothing to continue.
 */
/**
 * Who the next message reaches, while that is not the driving role.
 *
 * It stays up for as long as the side conversation lasts — the implementer
 * keeps answering, so a second question needs no second interrupt — which is
 * exactly why it needs a way out: without one, returning to the orchestrator
 * would mean saying something the implementer chooses to hand back.
 */
function ResumeTargetStrip({ role, onRelease }: { role: string; onRelease: () => void }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      sx={{
        gap: 0.6,
        mb: 0.75,
        px: 0.9,
        py: 0.5,
        border: `1px solid ${withAlpha(tokens.teal, 0.26)}`,
        borderRadius: 0.7,
        background: withAlpha(tokens.teal, 0.045),
      }}
    >
      <Box aria-hidden sx={{ width: 4, height: 4, borderRadius: '50%', background: tokens.teal }} />
      <Typography sx={{ color: tokens.teal, fontFamily: tokens.body, fontSize: 12 }}>
        To {role}
      </Typography>
      <ButtonBase
        onClick={onRelease}
        aria-label="Send the next message to the orchestrator instead"
        sx={{
          ml: 'auto',
          px: 0.6,
          py: 0.15,
          borderRadius: 0.5,
          color: tokens.sub2,
          fontFamily: tokens.body,
          fontSize: 12,
          '&:hover': { color: tokens.teal, background: withAlpha(tokens.teal, 0.08) },
        }}
      >
        Back to orch
      </ButtonBase>
    </Stack>
  );
}

/** One sentence covering the Stop button's three states. */
function interruptStopLabel(interrupting: boolean, armed: boolean, pendingRole: string): string {
  if (interrupting) return 'Interrupting turn';
  if (armed) {
    return pendingRole
      ? `Stopping as soon as the ${pendingRole} starts — click to keep going`
      : 'Stopping as soon as this step starts — click to keep going';
  }
  if (pendingRole) return `Stop after the ${pendingRole} starts`;
  return 'Interrupt turn';
}

export const AgentComposer = memo(function AgentComposer({
  insetLeft,
  insetRight,
  readingColumnWidth,
  selectionContext,
  focusRequest,
  draftInsertion,
  streaming,
  interrupting,
  interruptArmed,
  pendingRole,
  resumeRole,
  queueFull,
  modelOptions,
  catalogUnavailable,
  codexRuntime,
  lockedFamilies,
  compactRuntime,
  agentSettings,
  sendUnavailable = false,
  inputUnavailable = false,
  connectionAction = null,
  onRuntimeChange,
  onClearSelectionContext,
  onSend,
  onQueue,
  onCancel,
  onReleaseResumeRole,
}: {
  /** Rail widths to reserve, so the reading column lands where the transcript is. */
  insetLeft: string;
  insetRight: string;
  readingColumnWidth: string;
  selectionContext: AgentSelectionContext | null;
  focusRequest: number;
  /** A returned queued message; the counter is what makes a repeat land. */
  draftInsertion: { text: string; version: number };
  streaming: boolean;
  interrupting: boolean;
  /** An interrupt is waiting for `pendingRole` to produce its first output. */
  interruptArmed: boolean;
  /** The role currently inside its blind window, empty once it has spoken. */
  pendingRole: string;
  /** Set after an interrupt: the role the next message continues with. */
  resumeRole: string;
  queueFull: boolean;
  modelOptions: readonly CodexModelOption[];
  catalogUnavailable: boolean;
  codexRuntime: CodexRuntimeSelection;
  lockedFamilies: Record<keyof CodexRuntimeSelection, string> | null;
  compactRuntime: boolean;
  /** Controls which roles and working style the composer displays. */
  agentSettings: AgentSettings;
  sendUnavailable?: boolean;
  inputUnavailable?: boolean;
  connectionAction?: { readonly label: string; readonly activate: () => void } | null;
  onRuntimeChange: (role: keyof CodexRuntimeSelection, runtime: CodexRoleRuntime) => void;
  onClearSelectionContext: () => void;
  onSend: (message: string) => void;
  onQueue: (message: string) => void;
  onCancel: () => void;
  /** Send the next message to the driver instead of the role holding the thread. */
  onReleaseResumeRole: () => void;
}) {
  const [draft, setDraft] = useState('');
  // The runtime band is settled once a conversation starts, so it stays out of
  // the way behind a small toggle until someone asks for it.
  const [runtimeExpanded, setRuntimeExpanded] = useState(false);
  const inputElement = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusRequest > 0) inputElement.current?.focus();
  }, [focusRequest]);
  // The draft stays local: lifting it to the hook would re-render the whole
  // Agent page on every keystroke. A returned queued message therefore arrives
  // as a versioned prop rather than as a value.
  useEffect(() => {
    if (draftInsertion.version === 0) return;
    setDraft(draftInsertion.text);
    inputElement.current?.focus();
  }, [draftInsertion]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    // Enter does the same thing the visible button does: send when idle, queue
    // when a turn is running. Queueing comes first: a running turn is exactly
    // when sending is unavailable, and checking that first dropped every queue.
    if (streaming) {
      if (queueFull) return;
      setDraft('');
      onQueue(message);
      return;
    }
    if (sendUnavailable) return;
    setDraft('');
    onSend(message);
  };
  return (
    <Box
      component="form"
      onSubmit={submit}
      sx={{
        // The composer is the page's bottom band, like the header is its top
        // one. Both rails stop above it rather than running down beside the
        // input, which would dead-end their borders into this one.
        gridColumn: '1 / -1',
        gridRow: 3,
        pl: insetLeft,
        pr: insetRight,
        borderTop: `1px solid ${tokens.hair}`,
      }}
    >
      <Box
        data-testid="agent-composer-column"
        sx={{
          width: readingColumnWidth,
          mx: 'auto',
          px: 2,
          pt: 0.55,
          pb: compactRuntime ? 1 : 1.5,
        }}
      >
        <Box
          data-testid="agent-runtime-picker"
          sx={{
            mb: 0.35,
            containerType: 'inline-size',
          }}
        >
          <Stack direction="row" justifyContent="center">
            <ButtonBase
              type="button"
              aria-label={runtimeExpanded ? 'Collapse model controls' : 'Expand model controls'}
              aria-expanded={runtimeExpanded}
              onClick={() => setRuntimeExpanded((current) => !current)}
              sx={{
                height: 16,
                px: 0.55,
                borderRadius: 999,
                color: tokens.sub2,
                '&:hover': { color: tokens.teal, background: withAlpha(tokens.teal, 0.055) },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
              }}
            >
              <ExpandMoreRounded
                sx={{
                  fontSize: 14,
                  transform: runtimeExpanded ? 'none' : 'rotate(180deg)',
                  transition: `transform 180ms ${tokens.ease}`,
                }}
              />
            </ButtonBase>
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gridTemplateRows: runtimeExpanded ? '1fr' : '0fr',
              opacity: runtimeExpanded ? 1 : 0,
              transition: `grid-template-rows 180ms ${tokens.ease}, opacity 140ms ${tokens.ease}`,
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}
          >
            <Box sx={{ minHeight: 0, overflow: 'hidden' }}>
              {/* The two style axes bracket the band, the runtime chips sit
                  between them. The plates themselves live in the empty
                  transcript body — this band reports the choice once it is
                  settled, it is not where the choice is made. */}
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{
                  width: '100%',
                  minWidth: 0,
                  gap: 0.85,
                  pt: 0.45,
                  '@container (max-width: 500px)': { flexWrap: 'wrap' },
                }}
              >
                <WorkingStyleTag axis="cast" settings={agentSettings} />
                <Box
                  sx={{
                    minWidth: 0,
                    '@container (max-width: 500px)': { width: '100%', order: 1 },
                  }}
                >
                  <CodexRuntimePicker
                    models={modelOptions}
                    selection={codexRuntime}
                    roles={rolesForAgentMode(agentSettings.agentMode)}
                    lockedFamilies={lockedFamilies}
                    compact={compactRuntime}
                    // Deliberately editable mid-turn. Every turn pushes the
                    // runtime it is about to use, so a change made now lands on
                    // the next call — including a queued message, which runs with
                    // whatever is selected when it is finally sent. `lockedFamilies`
                    // still forbids the one change that cannot work: a rollout is
                    // only resumable by the family that recorded it.
                    disabled={false}
                    unavailable={catalogUnavailable}
                    onChange={onRuntimeChange}
                  />
                </Box>
                <WorkingStyleTag axis="autonomy" settings={agentSettings} />
              </Stack>
            </Box>
          </Box>
        </Box>
        {selectionContext !== null && (
          <AnalyzerSelectionStrip context={selectionContext} onClear={onClearSelectionContext} />
        )}
        {/* Only the implementer: interrupting the driver has always resumed the
            driver, so saying so adds a line without adding information. */}
        {resumeRole === 'implementer' && (
          <ResumeTargetStrip role={resumeRole} onRelease={onReleaseResumeRole} />
        )}
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            minHeight: 44,
            gap: 0.8,
            p: 0.55,
            pl: 1.1,
            border: `1px solid ${tokens.hair}`,
            borderRadius: 1.15,
            background: tokens.leafbg,
            boxShadow: `0 9px 28px -24px ${withAlpha(tokens.ink, 0.55)}`,
            '&:focus-within': {
              borderColor: withAlpha(tokens.teal, 0.58),
              boxShadow: `0 0 0 2px ${withAlpha(tokens.teal, 0.075)}`,
            },
          }}
        >
          <Box
            component="input"
            ref={inputElement}
            value={draft}
            disabled={inputUnavailable}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Continue the conversation"
            placeholder="Ask a follow-up"
            sx={{
              flex: 1,
              minWidth: 0,
              border: 0,
              outline: 0,
              background: 'transparent',
              color: tokens.ink,
              fontFamily: tokens.body,
              fontSize: 16,
              '&::placeholder': { color: tokens.sub2, opacity: 1 },
            }}
          />
          {streaming ? (
            <>
              {draft.trim() !== '' && (
                <ButtonBase
                  type="submit"
                  disabled={queueFull}
                  aria-label={queueFull ? 'Queue is full' : 'Queue message'}
                  title={
                    queueFull
                      ? `At most ${MAX_QUEUED_MESSAGES} messages can wait`
                      : 'Send after this turn finishes'
                  }
                  sx={{
                    width: 34,
                    height: 34,
                    flex: '0 0 auto',
                    border: `1px solid ${tokens.teal}`,
                    borderRadius: 0.85,
                    background: tokens.leafbg,
                    color: tokens.teal,
                    transition: `transform 120ms ${tokens.ease}, background 120ms ${tokens.ease}`,
                    '&:hover': { background: withAlpha(tokens.teal, 0.08) },
                    '&:active': { transform: 'translateY(1px)' },
                    '&.Mui-disabled': { borderColor: tokens.hair, color: tokens.sub2 },
                    '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
                  }}
                >
                  <PendingActionsRounded sx={{ fontSize: 16 }} />
                </ButtonBase>
              )}
              <ButtonBase
                type="button"
                onClick={onCancel}
                disabled={interrupting}
                aria-label={interruptStopLabel(interrupting, interruptArmed, pendingRole)}
                title={interruptStopLabel(interrupting, interruptArmed, pendingRole)}
                sx={{
                  width: 34,
                  height: 34,
                  flex: '0 0 auto',
                  // Armed reads as pending rather than active: the same stop
                  // mark, drawn as an outline that has not closed yet.
                  border: `1px ${interruptArmed ? 'dashed' : 'solid'} ${tokens.terra}`,
                  borderRadius: 0.85,
                  background: interruptArmed ? withAlpha(tokens.terra, 0.08) : tokens.leafbg,
                  color: tokens.terra,
                  opacity: interruptArmed ? 0.75 : 1,
                  transition: `transform 120ms ${tokens.ease}, background 120ms ${tokens.ease}, opacity 120ms ${tokens.ease}`,
                  '&:hover': { background: withAlpha(tokens.terra, 0.08) },
                  '&:active': { transform: 'translateY(1px)' },
                  '&.Mui-disabled': { borderColor: tokens.hair, color: tokens.sub2 },
                  '&:focus-visible': {
                    outline: `2px solid ${tokens.terra}`,
                    outlineOffset: 1,
                  },
                }}
              >
                <StopRounded sx={{ fontSize: 16 }} />
              </ButtonBase>
            </>
          ) : (
            <>
              {connectionAction !== null && (
                <ButtonBase
                  type="button"
                  onClick={connectionAction.activate}
                  aria-label={connectionAction.label}
                  title={connectionAction.label}
                  sx={{
                    width: 34,
                    height: 34,
                    flex: '0 0 auto',
                    border: `1px solid ${tokens.teal}`,
                    borderRadius: 0.85,
                    color: tokens.teal,
                    '&:hover': { background: withAlpha(tokens.teal, 0.08) },
                    '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
                  }}
                >
                  <ReplayRounded sx={{ fontSize: 17 }} />
                </ButtonBase>
              )}
              <ButtonBase
                type="submit"
                disabled={sendUnavailable || !draft.trim()}
                aria-label="Send follow-up"
                sx={{
                  width: 34,
                  height: 34,
                  flex: '0 0 auto',
                  borderRadius: 0.85,
                  background: tokens.ink,
                  color: tokens.paper,
                  transition: `transform 120ms ${tokens.ease}, background 120ms ${tokens.ease}`,
                  '&:hover': { background: tokens.teal },
                  '&:active': { transform: 'translateY(1px)' },
                  '&.Mui-disabled': { background: tokens.hair, color: tokens.sub2 },
                  '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
                }}
              >
                <ArrowUpwardRounded sx={{ fontSize: 17 }} />
              </ButtonBase>
            </>
          )}
        </Stack>
      </Box>
    </Box>
  );
});
