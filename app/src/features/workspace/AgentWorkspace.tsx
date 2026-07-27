import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import AdjustRounded from '@mui/icons-material/AdjustRounded';
import BuildOutlined from '@mui/icons-material/BuildOutlined';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import CloseFullscreenRounded from '@mui/icons-material/CloseFullscreenRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import HubOutlined from '@mui/icons-material/HubOutlined';
import KeyboardDoubleArrowLeftRounded from '@mui/icons-material/KeyboardDoubleArrowLeftRounded';
import NorthEastRounded from '@mui/icons-material/NorthEastRounded';
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { analyzerSelectionFromVizState } from '../../application/analyzerSelection';
import {
  createConversation,
  getConversation,
  resumeConversationTurn,
  sendConversationTurn,
  type ConversationMessage,
  type ConversationTurnEvent,
} from '../../application/conversationRepository';
import type { AnalyzerSelectionV1 } from '../../domain/analyzerSelection';
import type { AnalyzerTurnContextV1, FrozenCitationV1 } from '../../domain/citation';
import { analyzerNavigateCommandV1Schema, navigationResult } from '../../domain/analyzerNavigation';
import { useViz } from '../../store';
import { tokens } from '../../theme';
import { conversationCards } from './conversationTimeline';

type RoleTone = 'orchestrator' | 'implementer' | 'answer';

const roleStyle: Record<RoleTone, { color: string; line: string; wash: string }> = {
  orchestrator: {
    color: tokens.gold,
    line: 'rgba(128,102,0,.3)',
    wash: 'rgba(128,102,0,.055)',
  },
  implementer: {
    color: tokens.teal,
    line: 'rgba(31,111,107,.3)',
    wash: 'rgba(31,111,107,.055)',
  },
  answer: {
    color: tokens.terra,
    line: 'rgba(168,75,46,.3)',
    wash: 'rgba(168,75,46,.055)',
  },
};

function RoleCard({
  tone,
  icon,
  title,
  round,
  status,
  children,
}: {
  tone: RoleTone;
  icon: ReactNode;
  title: string;
  round?: number;
  status: string;
  children: ReactNode;
}) {
  const style = roleStyle[tone];
  return (
    <Box
      sx={{
        p: 1.35,
        border: `1px solid ${style.line}`,
        borderLeft: `2px solid ${style.color}`,
        borderRadius: 1.2,
        background: style.wash,
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ gap: 0.9 }}>
        <Box
          sx={{
            width: 27,
            height: 27,
            display: 'grid',
            placeItems: 'center',
            border: `1px solid ${style.line}`,
            borderRadius: 0.75,
            color: style.color,
            background: tokens.tile,
          }}
        >
          {icon}
        </Box>
        <Typography sx={{ color: tokens.ink, fontSize: 12.5, fontWeight: 700 }}>{title}</Typography>
        {round !== undefined && (
          <Typography sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 9 }}>
            round {round}
          </Typography>
        )}
        <Typography
          sx={{
            ml: 'auto',
            color: style.color,
            fontFamily: tokens.mono,
            fontSize: 8.5,
            fontWeight: 600,
          }}
        >
          {status}
        </Typography>
      </Stack>
      <Box sx={{ mt: 1.1 }}>{children}</Box>
    </Box>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <Typography sx={{ color: tokens.sub, fontSize: 11.5, lineHeight: 1.5 }}>{children}</Typography>
  );
}

function Handoff({
  from,
  to,
  children,
}: {
  from: 'Orchestrator' | 'Implementer';
  to: 'Orchestrator' | 'Implementer';
  children: ReactNode;
}) {
  return (
    <Box
      sx={{
        mx: 1.2,
        pl: 1.3,
        borderLeft: `1px solid ${tokens.hair}`,
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ gap: 0.55 }}>
        <NorthEastRounded sx={{ color: tokens.sub2, fontSize: 13 }} />
        <Typography sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}>
          {from} to {to}
        </Typography>
      </Stack>
      <Typography sx={{ mt: 0.45, color: tokens.ink, fontSize: 11.5, lineHeight: 1.45 }}>
        {children}
      </Typography>
    </Box>
  );
}

type NavigationStatus = 'opening' | 'ok' | 'not-found' | 'unavailable';

function navigateToFrozenEvidence(
  target: FrozenCitationV1['target'],
  onStatus: (status: NavigationStatus) => void,
): void {
  const requestId = globalThis.crypto?.randomUUID?.() ?? `evidence-${Date.now()}`;
  const command = analyzerNavigateCommandV1Schema.parse({
    protocol: 'vibesim.analyzer/v1',
    requestId,
    type: 'navigate',
    target,
  });
  const destination = new URL(window.location.href);
  destination.search = '?workspace=1&agent=1';
  window.history.replaceState(null, '', destination);
  onStatus('opening');
  const receiveResult = (event: MessageEvent<unknown>) => {
    if (event.origin !== window.location.origin) return;
    const parsed = navigationResult(requestId, 'ok');
    const candidate = event.data as Partial<typeof parsed>;
    if (
      candidate.protocol !== parsed.protocol ||
      candidate.type !== parsed.type ||
      candidate.requestId !== requestId ||
      !['ok', 'not-found', 'unavailable'].includes(String(candidate.status))
    ) {
      return;
    }
    window.removeEventListener('message', receiveResult);
    onStatus(candidate.status as Exclude<NavigationStatus, 'opening'>);
  };
  window.addEventListener('message', receiveResult);
  window.postMessage(command, window.location.origin);
}

function FrozenAnswer({
  text,
  citations,
}: {
  text: string;
  citations: readonly FrozenCitationV1[];
}) {
  const [statuses, setStatuses] = useState<Record<number, NavigationStatus>>({});
  const ordered = [...citations]
    .filter(
      (citation) =>
        citation.sourceStart >= 0 &&
        citation.sourceEnd <= text.length &&
        citation.sourceStart < citation.sourceEnd,
    )
    .sort((left, right) => left.sourceStart - right.sourceStart);
  const renderPlainInline = (source: string, keyPrefix: string): ReactNode[] => {
    const nodes: ReactNode[] = [];
    const pattern = /(\*\*[^*]+\*\*|`[^`\n]+`)/g;
    let sourceCursor = 0;
    let match = pattern.exec(source);
    while (match) {
      if (match.index > sourceCursor) nodes.push(source.slice(sourceCursor, match.index));
      const value = match[0];
      if (value.startsWith('**')) {
        nodes.push(
          <Box component="strong" key={`${keyPrefix}-${match.index}`} sx={{ color: tokens.ink }}>
            {value.slice(2, -2)}
          </Box>,
        );
      } else {
        nodes.push(
          <Box
            component="code"
            key={`${keyPrefix}-${match.index}`}
            sx={{
              px: 0.35,
              borderRadius: 0.35,
              background: 'rgba(91,82,71,.08)',
              color: tokens.ink,
              fontFamily: tokens.mono,
              fontSize: '.9em',
            }}
          >
            {value.slice(1, -1)}
          </Box>,
        );
      }
      sourceCursor = match.index + value.length;
      match = pattern.exec(source);
    }
    if (sourceCursor < source.length) nodes.push(source.slice(sourceCursor));
    return nodes;
  };

  const renderInlineRange = (start: number, end: number, keyPrefix: string): ReactNode[] => {
    const pieces: ReactNode[] = [];
    let cursor = start;
    ordered.forEach((citation, citationIndex) => {
      if (
        citation.sourceStart < start ||
        citation.sourceEnd > end ||
        citation.sourceStart < cursor
      ) {
        return;
      }
      pieces.push(
        ...renderPlainInline(
          text.slice(cursor, citation.sourceStart),
          `${keyPrefix}-plain-${citationIndex}`,
        ),
      );
      const status = statuses[citationIndex];
      pieces.push(
        <ButtonBase
          key={`${citation.sourceStart}-${citation.token}`}
          onClick={() =>
            navigateToFrozenEvidence(citation.target, (next) =>
              setStatuses((current) => ({ ...current, [citationIndex]: next })),
            )
          }
          title={
            status === 'not-found'
              ? 'Evidence is no longer available'
              : status === 'unavailable'
                ? 'Evidence is not ready'
                : citation.token
          }
          sx={{
            display: 'inline',
            px: 0.2,
            borderRadius: 0.35,
            borderBottom: `1px solid ${tokens.teal}`,
            color: status === 'not-found' || status === 'unavailable' ? tokens.terra : tokens.teal,
            font: 'inherit',
            fontWeight: 650,
            lineHeight: 'inherit',
            verticalAlign: 'baseline',
            '&:hover': { background: 'rgba(31,111,107,.08)' },
            '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
          }}
        >
          {citation.displayLabel}
          <Box component="sup" sx={{ ml: 0.2, fontFamily: tokens.mono, fontSize: '0.68em' }}>
            {citationIndex + 1}
          </Box>
        </ButtonBase>,
      );
      cursor = citation.sourceEnd;
    });
    pieces.push(...renderPlainInline(text.slice(cursor, end), `${keyPrefix}-tail`));
    return pieces;
  };

  const lines = (() => {
    let offset = 0;
    return text.split('\n').map((line) => {
      const result = { text: line, start: offset, end: offset + line.length };
      offset += line.length + 1;
      return result;
    });
  })();
  const isTableDivider = (line: string) => /^\s*\|?\s*:?-{3,}/.test(line) && line.includes('|');
  const tableCells = (line: (typeof lines)[number]) => {
    const pipePositions: number[] = [];
    for (let index = 0; index < line.text.length; index += 1) {
      if (line.text[index] === '|') pipePositions.push(index);
    }
    const boundaries = [
      ...(pipePositions[0] === 0 ? [] : [-1]),
      ...pipePositions,
      ...(pipePositions.at(-1) === line.text.length - 1 ? [] : [line.text.length]),
    ];
    return boundaries.slice(0, -1).flatMap((left, index) => {
      const right = boundaries[index + 1]!;
      const rawStart = left + 1;
      const rawEnd = right;
      const source = line.text.slice(rawStart, rawEnd);
      const leading = source.length - source.trimStart().length;
      const trailing = source.length - source.trimEnd().length;
      const start = line.start + rawStart + leading;
      const end = line.start + rawEnd - trailing;
      return end > start ? [{ start, end }] : [];
    });
  };

  const blocks: ReactNode[] = [];
  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex]!;
    if (!line.text.trim()) {
      lineIndex += 1;
      continue;
    }
    if (
      lineIndex + 1 < lines.length &&
      line.text.includes('|') &&
      isTableDivider(lines[lineIndex + 1]!.text)
    ) {
      const tableLines = [line];
      lineIndex += 2;
      while (lineIndex < lines.length && lines[lineIndex]!.text.includes('|')) {
        tableLines.push(lines[lineIndex]!);
        lineIndex += 1;
      }
      blocks.push(
        <Box
          component="table"
          key={`table-${line.start}`}
          sx={{
            width: '100%',
            my: 1,
            borderCollapse: 'collapse',
            fontVariantNumeric: 'tabular-nums',
            '& th, & td': {
              px: 0.7,
              py: 0.55,
              borderBottom: `1px solid ${tokens.hair}`,
              textAlign: 'left',
              verticalAlign: 'top',
            },
            '& th': {
              color: tokens.ink,
              fontFamily: tokens.mono,
              fontSize: 9,
              fontWeight: 700,
            },
            '& td': { color: tokens.sub, fontSize: 10.5 },
          }}
        >
          <Box component="thead">
            <Box component="tr">
              {tableCells(tableLines[0]!).map((cell, index) => (
                <Box component="th" key={index}>
                  {renderInlineRange(cell.start, cell.end, `th-${line.start}-${index}`)}
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {tableLines.slice(1).map((tableLine) => (
              <Box component="tr" key={tableLine.start}>
                {tableCells(tableLine).map((cell, index) => (
                  <Box component="td" key={index}>
                    {renderInlineRange(cell.start, cell.end, `td-${tableLine.start}-${index}`)}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>,
      );
      continue;
    }
    const orderedItem = line.text.match(/^\s*\d+\.\s+/);
    const bulletItem = line.text.match(/^\s*[-*]\s+/);
    if (orderedItem || bulletItem) {
      const listLines: typeof lines = [];
      const orderedList = Boolean(orderedItem);
      while (lineIndex < lines.length) {
        const candidate = lines[lineIndex]!;
        const prefix = orderedList
          ? candidate.text.match(/^\s*\d+\.\s+/)
          : candidate.text.match(/^\s*[-*]\s+/);
        if (!prefix) break;
        listLines.push({
          ...candidate,
          start: candidate.start + prefix[0].length,
        });
        lineIndex += 1;
      }
      blocks.push(
        <Box
          component={orderedList ? 'ol' : 'ul'}
          key={`list-${line.start}`}
          sx={{ my: 0.8, pl: 2.25, color: tokens.sub, fontSize: 11.5, lineHeight: 1.55 }}
        >
          {listLines.map((item) => (
            <li key={item.start}>{renderInlineRange(item.start, item.end, `li-${item.start}`)}</li>
          ))}
        </Box>,
      );
      continue;
    }
    const heading = line.text.match(/^(#{1,4})\s+/);
    const contentStart = line.start + (heading?.[0].length ?? 0);
    blocks.push(
      <Typography
        component={heading ? 'h4' : 'p'}
        key={line.start}
        sx={{
          m: 0,
          mb: 0.8,
          color: heading ? tokens.ink : tokens.sub,
          fontFamily: heading ? tokens.serif : tokens.body,
          fontSize: heading ? 13 : 11.5,
          fontWeight: heading ? 650 : 400,
          lineHeight: 1.55,
        }}
      >
        {renderInlineRange(contentStart, line.end, `line-${line.start}`)}
      </Typography>,
    );
    lineIndex += 1;
  }
  return <Box sx={{ minWidth: 0, overflowX: 'auto' }}>{blocks}</Box>;
}

function UserMessage({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        maxWidth: '82%',
        alignSelf: 'flex-end',
        px: 1.3,
        py: 1,
        border: `1px solid ${tokens.hair}`,
        borderRadius: '10px 10px 3px 10px',
        background: tokens.tile,
        color: tokens.ink,
        fontSize: 11.5,
        lineHeight: 1.45,
        whiteSpace: 'pre-wrap',
      }}
    >
      {children}
    </Box>
  );
}

function AssistantTimeline({
  message,
  events,
  streaming,
  progress,
}: {
  message?: ConversationMessage;
  events: readonly ConversationTurnEvent[];
  streaming: boolean;
  progress: string;
}) {
  const cards = conversationCards(events);
  if (streaming && cards.length === 0) {
    return (
      <RoleCard
        tone="orchestrator"
        icon={<HubOutlined sx={{ fontSize: 15 }} />}
        title="Orchestrator"
        round={1}
        status="working"
      >
        <Note>{progress || 'Preparing the inquiry workspace…'}</Note>
      </RoleCard>
    );
  }
  return cards.map((card, index) => {
    if (card.type === 'handoff') {
      return (
        <Handoff
          key={index}
          from={card.variant === 'delegated-task' ? 'Orchestrator' : 'Implementer'}
          to={card.variant === 'delegated-task' ? 'Implementer' : 'Orchestrator'}
        >
          {card.text}
        </Handoff>
      );
    }
    if (card.type === 'role') {
      const implementer = card.role === 'implementer';
      return (
        <RoleCard
          key={index}
          tone={card.role}
          icon={
            implementer ? (
              <BuildOutlined sx={{ fontSize: 15 }} />
            ) : (
              <HubOutlined sx={{ fontSize: 15 }} />
            )
          }
          title={implementer ? 'Implementer' : 'Orchestrator'}
          round={card.round}
          status={!card.done && streaming ? 'working' : 'done'}
        >
          <Stack sx={{ gap: 0.65 }}>
            {card.notes.map((note, noteIndex) => (
              <Note key={noteIndex}>{note}</Note>
            ))}
            {!card.done && streaming && progress && <Note>{progress}</Note>}
          </Stack>
        </RoleCard>
      );
    }
    return (
      <RoleCard
        key={index}
        tone="answer"
        icon={<CheckCircleOutlineRounded sx={{ fontSize: 15 }} />}
        title="Answer"
        status="ready"
      >
        <FrozenAnswer text={card.text} citations={message?.citations ?? []} />
      </RoleCard>
    );
  });
}

function contextValues(selection: AnalyzerSelectionV1 | null): readonly string[] {
  if (selection === null) return [];
  if (selection.kind === 'aggregate') {
    return [
      'aggregate',
      ...(selection.panelId ? [selection.panelId] : []),
      ...(selection.metricKey && selection.metricKey !== selection.panelId
        ? [selection.metricKey]
        : []),
      ...(selection.statistic ? [selection.statistic] : []),
      ...Object.entries(selection.coordinates ?? {}).map(
        ([axis, value]) => `${axis}=${Array.isArray(value) ? value.join('+') : String(value)}`,
      ),
    ];
  }
  return [
    'run',
    ...(selection.panelId ? [selection.panelId] : []),
    selection.scope,
    ...(selection.poolRole ? [`pool=${selection.poolRole}`] : []),
    ...(selection.workerKey ? [`worker=${selection.workerKey}`] : []),
    ...(selection.leafId !== null ? [`kernel=${selection.leafId}`] : []),
    ...(selection.parId !== null ? [`parallel=${selection.parId}`] : []),
  ];
}

function AnalyzerSelectionStrip() {
  const selection = useViz(analyzerSelectionFromVizState);
  const [expanded, setExpanded] = useState(false);
  const values = contextValues(selection);
  const identity = JSON.stringify(selection);
  return (
    <Box
      role="status"
      aria-label="Active Analyzer selection"
      aria-live="polite"
      sx={{
        mb: 1.15,
        px: 0.85,
        py: 0.7,
        border: `1px solid rgba(31,111,107,.22)`,
        borderRadius: 0.85,
        background: 'rgba(31,111,107,.045)',
      }}
    >
      <Stack direction="row" alignItems="center" useFlexGap sx={{ gap: 0.65 }}>
        <AdjustRounded sx={{ flex: '0 0 auto', color: tokens.teal, fontSize: 13 }} />
        <Typography
          sx={{
            flex: '0 0 auto',
            color: tokens.teal,
            fontFamily: tokens.mono,
            fontSize: 7.8,
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
            <Typography sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}>
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
                  border: `1px solid ${index === 0 ? 'rgba(31,111,107,.25)' : tokens.hair}`,
                  borderRadius: 0.55,
                  background: index === 0 ? 'rgba(31,111,107,.08)' : tokens.tile,
                  color: index === 0 ? tokens.teal : tokens.sub,
                  fontFamily: tokens.mono,
                  fontSize: 8,
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
        {selection && (
          <ButtonBase
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            sx={{
              ml: 'auto',
              flex: '0 0 auto',
              color: tokens.teal,
              fontFamily: tokens.mono,
              fontSize: 8,
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          >
            {expanded ? 'hide JSON' : 'view JSON'}
          </ButtonBase>
        )}
      </Stack>
      {expanded && selection && (
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
            fontFamily: tokens.mono,
            fontSize: 8,
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
          }}
        >
          {JSON.stringify(selection, null, 2)}
        </Box>
      )}
    </Box>
  );
}

const CONVERSATION_ID_KEY = 'vibesim.conversation.id';

function useAgentConversation(
  prompt: string,
  analyzerContext: AnalyzerTurnContextV1 | null,
  enabled: boolean,
  requireAnalyzerContext: boolean,
) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly ConversationMessage[]>([]);
  const [liveEvents, setLiveEvents] = useState<readonly ConversationTurnEvent[]>([]);
  const [progress, setProgress] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);
  const initialPromptStarted = useRef(false);
  const abortController = useRef<AbortController | null>(null);

  const runTurn = useCallback(
    async (activeConversationId: string, text: string, context: AnalyzerTurnContextV1 | null) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      const controller = new AbortController();
      abortController.current = controller;
      setMessages((current) => [...current, { role: 'user', content: trimmed }]);
      setLiveEvents([]);
      setProgress('');
      setError(null);
      setStreaming(true);
      let completionMessage: ConversationMessage | null = null;
      try {
        await sendConversationTurn(
          activeConversationId,
          trimmed,
          context,
          {
            progress: setProgress,
            event: (event) => setLiveEvents((current) => [...current, event]),
            done: (completion) => {
              completionMessage = {
                role: 'assistant',
                content: completion.text,
                activity: [],
                citations: completion.citations,
                citation_dictionary_id: completion.citationDictionaryId,
                citation_dsl_version: completion.citationDslVersion,
              };
            },
          },
          controller.signal,
        );
        const refreshed = await getConversation(activeConversationId);
        if (refreshed) setMessages(refreshed.messages);
        else if (completionMessage) setMessages((current) => [...current, completionMessage!]);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : 'Conversation turn failed');
        }
      } finally {
        abortController.current = null;
        setStreaming(false);
        setLiveEvents([]);
        setProgress('');
      }
    },
    [streaming],
  );

  useEffect(() => {
    if (!enabled || initialized.current) return;
    initialized.current = true;
    let disposed = false;
    void (async () => {
      try {
        const rememberedId = window.sessionStorage.getItem(CONVERSATION_ID_KEY);
        let conversation = rememberedId ? await getConversation(rememberedId) : null;
        if (!conversation) {
          conversation = await createConversation();
          window.sessionStorage.setItem(CONVERSATION_ID_KEY, conversation.id);
        }
        if (disposed) return;
        setConversationId(conversation.id);
        setMessages(conversation.messages);
        const resumeController = new AbortController();
        abortController.current = resumeController;
        setStreaming(true);
        const resumed = await resumeConversationTurn(
          conversation.id,
          {
            progress: setProgress,
            event: (event) => setLiveEvents((current) => [...current, event]),
          },
          resumeController.signal,
        );
        if (disposed) return;
        abortController.current = null;
        setStreaming(false);
        if (resumed) {
          const refreshed = await getConversation(conversation.id);
          if (refreshed && !disposed) setMessages(refreshed.messages);
          setLiveEvents([]);
        }
      } catch (caught) {
        if (!disposed) {
          setError(caught instanceof Error ? caught.message : 'Conversation initialization failed');
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [analyzerContext, enabled, prompt, runTurn]);

  useEffect(() => {
    if (
      !enabled ||
      conversationId === null ||
      messages.length > 0 ||
      streaming ||
      initialPromptStarted.current ||
      !prompt.trim() ||
      (requireAnalyzerContext && analyzerContext === null)
    ) {
      return;
    }
    initialPromptStarted.current = true;
    void runTurn(conversationId, prompt, analyzerContext);
  }, [
    analyzerContext,
    conversationId,
    enabled,
    messages.length,
    prompt,
    requireAnalyzerContext,
    runTurn,
    streaming,
  ]);

  return {
    conversationId,
    messages,
    liveEvents,
    progress,
    streaming,
    error,
    send: (text: string) =>
      conversationId ? runTurn(conversationId, text, analyzerContext) : Promise.resolve(),
    cancel: () => abortController.current?.abort(),
  };
}

export default function AgentPane({
  prompt,
  onClose,
  onFold,
  onToggleFull,
  analyzerContext = null,
  enabled = true,
  requireAnalyzerContext = false,
  full = false,
  expanded = false,
  showSelectionContext = false,
}: {
  prompt: string;
  onClose?: () => void;
  onFold?: () => void;
  onToggleFull?: () => void;
  analyzerContext?: AnalyzerTurnContextV1 | null;
  enabled?: boolean;
  requireAnalyzerContext?: boolean;
  full?: boolean;
  expanded?: boolean;
  showSelectionContext?: boolean;
}) {
  const [input, setInput] = useState('');
  const conversation = useAgentConversation(
    prompt,
    analyzerContext,
    enabled,
    requireAnalyzerContext,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = input.trim();
    if (!message) return;
    setInput('');
    void conversation.send(message);
  };
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    if (typeof scrollElement.scrollTo === 'function') {
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior: conversation.streaming ? 'auto' : 'smooth',
      });
    } else {
      scrollElement.scrollTop = scrollElement.scrollHeight;
    }
  }, [conversation.liveEvents, conversation.messages, conversation.streaming]);
  return (
    <Box
      component="aside"
      aria-label="VibeSim Agent"
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'grid',
        gridTemplateRows: 'auto minmax(0,1fr) auto',
        background: full || expanded ? tokens.paper : '#eee7da',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ minHeight: 54, px: 2, borderBottom: `1px solid ${tokens.hair}` }}
      >
        <Box>
          <Typography
            sx={{ color: tokens.ink, fontFamily: tokens.serif, fontSize: 16, fontWeight: 600 }}
          >
            VibeSim Agent
          </Typography>
          <Typography sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}>
            Inquiry workspace
          </Typography>
        </Box>
        <Stack direction="row" sx={{ gap: 0.55 }}>
          {onToggleFull && (
            <ButtonBase
              onClick={(event) => {
                event.stopPropagation();
                onToggleFull();
              }}
              aria-label={expanded ? 'Return Agent to split view' : 'Expand Agent to full page'}
              sx={{
                width: 32,
                height: 32,
                border: `1px solid ${tokens.hair}`,
                borderRadius: 0.85,
                color: tokens.sub,
                '&:hover': { borderColor: tokens.sub2, color: tokens.ink },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
              }}
            >
              {expanded ? (
                <CloseFullscreenRounded sx={{ fontSize: 16 }} />
              ) : (
                <OpenInFullRounded sx={{ fontSize: 15 }} />
              )}
            </ButtonBase>
          )}
          {onFold && (
            <ButtonBase
              onClick={(event) => {
                event.stopPropagation();
                onFold();
              }}
              aria-label="Fold Agent"
              sx={{
                width: 32,
                height: 32,
                border: `1px solid ${tokens.hair}`,
                borderRadius: 0.85,
                color: tokens.sub,
                '&:hover': { borderColor: tokens.sub2, color: tokens.ink },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
              }}
            >
              <KeyboardDoubleArrowLeftRounded sx={{ fontSize: 18 }} />
            </ButtonBase>
          )}
          {onClose && (
            <ButtonBase
              onClick={onClose}
              aria-label="Close Agent"
              sx={{
                width: 32,
                height: 32,
                border: `1px solid ${tokens.hair}`,
                borderRadius: 0.85,
                color: tokens.sub,
                '&:hover': { borderColor: tokens.sub2, color: tokens.ink },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
              }}
            >
              <CloseRounded sx={{ fontSize: 17 }} />
            </ButtonBase>
          )}
        </Stack>
      </Stack>
      <Box
        ref={scrollRef}
        sx={{
          width: full || expanded ? 'min(720px,calc(100% - 40px))' : '100%',
          mx: 'auto',
          minHeight: 0,
          overflowY: 'auto',
          px: 2,
          py: full || expanded ? 5 : 2.5,
          scrollbarWidth: 'thin',
          scrollbarColor: `${tokens.hair} transparent`,
        }}
      >
        <Stack sx={{ gap: 1.1 }}>
          {conversation.messages.map((message, index) =>
            message.role === 'user' ? (
              <UserMessage key={index}>{message.content}</UserMessage>
            ) : (
              <AssistantTimeline
                key={index}
                message={message}
                events={
                  message.activity?.length
                    ? message.activity
                    : [{ kind: 'final', text: message.content }]
                }
                streaming={false}
                progress=""
              />
            ),
          )}
          {conversation.streaming && (
            <AssistantTimeline
              events={conversation.liveEvents}
              streaming
              progress={conversation.progress}
            />
          )}
          {conversation.error && (
            <Typography
              role="alert"
              sx={{ color: tokens.terra, fontFamily: tokens.mono, fontSize: 9.5 }}
            >
              {conversation.error}
            </Typography>
          )}
        </Stack>
      </Box>
      <Box
        component="form"
        onSubmit={submit}
        sx={{ px: 2, py: 1.5, borderTop: `1px solid ${tokens.hair}` }}
      >
        {showSelectionContext && <AnalyzerSelectionStrip />}
        <Stack direction="row" alignItems="center" sx={{ gap: 1 }}>
          <Box
            component="input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
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
              fontSize: 11.5,
            }}
          />
          <ButtonBase
            type="submit"
            disabled={!input.trim() || conversation.streaming || !conversation.conversationId}
            aria-label="Send follow-up"
            sx={{
              width: 32,
              height: 32,
              borderRadius: 0.8,
              background: tokens.ink,
              color: tokens.paper,
              '&.Mui-disabled': { background: tokens.hair, color: tokens.sub2 },
            }}
          >
            <ArrowUpwardRounded sx={{ fontSize: 16 }} />
          </ButtonBase>
        </Stack>
      </Box>
    </Box>
  );
}
