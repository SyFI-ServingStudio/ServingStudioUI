import AddRounded from '@mui/icons-material/AddRounded';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import AdjustRounded from '@mui/icons-material/AdjustRounded';
import BuildOutlined from '@mui/icons-material/BuildOutlined';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import CloseFullscreenRounded from '@mui/icons-material/CloseFullscreenRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import HubOutlined from '@mui/icons-material/HubOutlined';
import KeyboardDoubleArrowLeftRounded from '@mui/icons-material/KeyboardDoubleArrowLeftRounded';
import NorthEastRounded from '@mui/icons-material/NorthEastRounded';
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import PushPinRounded from '@mui/icons-material/PushPinRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { Box, ButtonBase, Skeleton, Stack, Typography } from '@mui/material';
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { analyzerSelectionFromVizState } from '../../application/analyzerSelection';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  resumeConversationTurn,
  sendConversationTurn,
  type Conversation,
  type ConversationMessage,
  type ConversationSummary,
  type ConversationTurnEvent,
} from '../../application/conversationRepository';
import type { AnalyzerSelectionV2 } from '../../domain/analyzerSelection';
import type { AnalyzerTurnContextV2, FrozenCitationV2 } from '../../domain/citation';
import {
  analyzerEvidenceHref,
  analyzerNavigateCommandV2Schema,
  navigationResult,
} from '../../domain/analyzerNavigation';
import { useViz } from '../../store';
import { tokens } from '../../theme';
import { conversationCards } from './conversationTimeline';

type RoleTone = 'orchestrator' | 'implementer' | 'answer' | 'error';

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
  error: {
    color: '#9a4538',
    line: 'rgba(154,69,56,.32)',
    wash: 'rgba(154,69,56,.065)',
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
  if (typeof children === 'string') {
    return <MarkdownBody text={children} citations={[]} compact />;
  }
  return (
    <Typography sx={{ color: tokens.sub, fontSize: 11.5, lineHeight: 1.5 }}>{children}</Typography>
  );
}

function ActivityLine({ text }: { text: string }) {
  const tool = text.match(/^tool:\s*(.+)$/i);
  const command = text.match(/^\$\s*(.+)$/);
  const label = tool ? 'tool call' : command ? 'command' : 'activity';
  const detail = tool?.[1] ?? command?.[1] ?? text;
  return (
    <Stack
      role="status"
      aria-label={`${label}: ${detail}`}
      direction="row"
      alignItems="center"
      sx={{
        gap: 0.75,
        minWidth: 0,
        color: tokens.teal,
        fontFamily: tokens.mono,
        fontSize: 9.5,
        lineHeight: 1.35,
      }}
    >
      <Stack direction="row" sx={{ gap: 0.3, flex: '0 0 auto' }} aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <Box
            key={index}
            sx={{
              width: 3,
              height: 3,
              borderRadius: '50%',
              background: tokens.teal,
              animation: 'agentActivityPulse 1.2s ease-in-out infinite',
              animationDelay: `${index * 160}ms`,
              '@keyframes agentActivityPulse': {
                '0%, 70%, 100%': { opacity: 0.24, transform: 'translateY(0)' },
                '35%': { opacity: 0.9, transform: 'translateY(-1px)' },
              },
            }}
          />
        ))}
      </Stack>
      <Box
        component="span"
        sx={{
          flex: '0 0 auto',
          color: tokens.sub2,
          fontSize: 8,
          fontWeight: 650,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Box>
      <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {detail || 'working…'}
      </Box>
    </Stack>
  );
}

function FailureCard({ text }: { text: string }) {
  return (
    <RoleCard
      tone="error"
      icon={<ErrorOutlineRounded sx={{ fontSize: 15 }} />}
      title="Agent unavailable"
      status="retry"
    >
      <Note>{text}</Note>
    </RoleCard>
  );
}

function Handoff({
  from,
  to,
  text,
}: {
  from: 'Orchestrator' | 'Implementer';
  to: 'Orchestrator' | 'Implementer';
  text: string;
}) {
  const isImplementationReport = from === 'Implementer';
  const style = roleStyle[isImplementationReport ? 'implementer' : 'orchestrator'];
  return (
    <Box
      component="section"
      aria-label={isImplementationReport ? 'Implementation report' : 'Delegated task'}
      sx={{
        p: 1.35,
        border: `1px solid ${style.line}`,
        borderLeft: `2px solid ${style.color}`,
        borderRadius: 1.2,
        background: style.wash,
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ gap: 0.85 }}>
        <Box
          sx={{
            width: 27,
            height: 27,
            flex: '0 0 auto',
            display: 'grid',
            placeItems: 'center',
            border: `1px solid ${style.line}`,
            borderRadius: 0.75,
            color: style.color,
            background: tokens.tile,
          }}
        >
          {isImplementationReport ? (
            <BuildOutlined sx={{ fontSize: 14 }} />
          ) : (
            <NorthEastRounded sx={{ fontSize: 14 }} />
          )}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ color: tokens.ink, fontSize: 12, fontWeight: 700 }}>
            {isImplementationReport ? 'Implementation report' : 'Delegated task'}
          </Typography>
          <Typography noWrap sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.25 }}>
            {from} to {to}
          </Typography>
        </Box>
      </Stack>
      <Box
        sx={{
          mt: 1,
          pt: 1,
          borderTop: `1px solid ${style.line}`,
          '& .agent-markdown > :first-of-type': { mt: 0 },
        }}
      >
        <MarkdownBody text={text} citations={[]} compact />
      </Box>
    </Box>
  );
}

type NavigationStatus = 'opening' | 'ok' | 'not-found' | 'unavailable';

function navigateToFrozenEvidence(
  target: FrozenCitationV2['target'],
  onStatus: (status: NavigationStatus) => void,
): void {
  const requestId = globalThis.crypto?.randomUUID?.() ?? `evidence-${Date.now()}`;
  const command = analyzerNavigateCommandV2Schema.parse({
    protocol: 'vibesim.analyzer/v2',
    requestId,
    type: 'navigate',
    target,
  });
  const destination = new URL(window.location.href);
  destination.search = '';
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

function MarkdownBody({
  text,
  citations,
  compact = false,
}: {
  text: string;
  citations: readonly FrozenCitationV2[];
  compact?: boolean;
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
    const pattern =
      /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/|\/)[^)\n]+\)|\*[^*\n]+\*)/g;
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
      } else if (value.startsWith('[')) {
        const link = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        nodes.push(
          <Box
            component="a"
            key={`${keyPrefix}-${match.index}`}
            href={link?.[2] ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              color: tokens.teal,
              textDecorationColor: 'rgba(31,111,107,.42)',
              textUnderlineOffset: '2px',
            }}
          >
            {link?.[1] ?? value}
          </Box>,
        );
      } else if (value.startsWith('*')) {
        nodes.push(
          <Box component="em" key={`${keyPrefix}-${match.index}`}>
            {value.slice(1, -1)}
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
    const codeFence = line.text.match(/^\s*```([\w.+-]+)?\s*$/);
    if (codeFence) {
      const codeLines: string[] = [];
      lineIndex += 1;
      while (lineIndex < lines.length && !/^\s*```\s*$/.test(lines[lineIndex]!.text)) {
        codeLines.push(lines[lineIndex]!.text);
        lineIndex += 1;
      }
      if (lineIndex < lines.length) lineIndex += 1;
      blocks.push(
        <Box
          component="pre"
          key={`code-${line.start}`}
          data-language={codeFence[1] || undefined}
          sx={{
            m: 0,
            mb: compact ? 0.7 : 1,
            px: 1,
            py: 0.8,
            overflowX: 'auto',
            border: `1px solid ${tokens.hair}`,
            borderRadius: 0.75,
            background: 'rgba(91,82,71,.055)',
            color: tokens.ink,
            fontFamily: tokens.mono,
            fontSize: compact ? 9 : 10,
            lineHeight: 1.5,
            whiteSpace: 'pre',
          }}
        >
          <code>{codeLines.join('\n')}</code>
        </Box>,
      );
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
          sx={{
            my: compact ? 0.55 : 0.8,
            pl: 2.25,
            color: tokens.sub,
            fontSize: 11.5,
            lineHeight: 1.55,
          }}
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
          mb: compact ? 0.5 : 0.8,
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
  return (
    <Box
      className="agent-markdown"
      sx={{
        minWidth: 0,
        overflowX: 'auto',
        '& > :last-child': { mb: 0 },
      }}
    >
      {blocks}
    </Box>
  );
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
  if (message?.failure) {
    return <FailureCard text={message.failure.message} />;
  }
  if (streaming && cards.length === 0) {
    return (
      <RoleCard
        tone="orchestrator"
        icon={<HubOutlined sx={{ fontSize: 15 }} />}
        title="Orchestrator"
        round={1}
        status="working"
      >
        <ActivityLine text={progress || 'Preparing the inquiry workspace…'} />
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
          text={card.text}
        />
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
            {!card.done && streaming && progress && <ActivityLine text={progress} />}
          </Stack>
        </RoleCard>
      );
    }
    if (card.type === 'job') {
      const ready = card.status === 'ready' || card.status === 'experiment.ready';
      const failed = card.status === 'failed' || card.status === 'interrupted';
      return (
        <ButtonBase
          key={index}
          disabled={!ready}
          onClick={() => {
            window.location.hash = analyzerEvidenceHref({
              protocol: 'vibesim.analyzer/v2',
              kind: 'aggregate',
              workspaceId: card.workspaceId,
              experimentId: card.experimentId,
            });
          }}
          sx={{
            width: '100%',
            p: 1.25,
            justifyContent: 'flex-start',
            border: `1px solid ${
              failed ? 'rgba(154,69,56,.3)' : ready ? 'rgba(31,111,107,.34)' : tokens.hair
            }`,
            borderLeft: `2px solid ${failed ? '#9a4538' : tokens.teal}`,
            borderRadius: 1.1,
            background: ready ? 'rgba(31,111,107,.055)' : 'rgba(91,82,71,.035)',
            textAlign: 'left',
            '&:hover': ready ? { background: 'rgba(31,111,107,.09)' } : undefined,
            '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
          }}
        >
          <Stack direction="row" alignItems="center" sx={{ width: '100%', minWidth: 0, gap: 1 }}>
            {failed ? (
              <ErrorOutlineRounded sx={{ color: '#9a4538', fontSize: 16 }} />
            ) : ready ? (
              <CheckCircleOutlineRounded sx={{ color: tokens.teal, fontSize: 16 }} />
            ) : (
              <AdjustRounded sx={{ color: tokens.gold, fontSize: 16 }} />
            )}
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ color: tokens.ink, fontSize: 11.5, fontWeight: 700 }}>
                {ready ? 'Experiment ready' : failed ? 'Experiment stopped' : 'Simulation running'}
              </Typography>
              <Typography
                noWrap
                sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}
              >
                {card.experimentPath}
              </Typography>
            </Box>
            {ready && <NorthEastRounded sx={{ ml: 'auto', color: tokens.teal, fontSize: 15 }} />}
          </Stack>
        </ButtonBase>
      );
    }
    if (card.type === 'error') {
      return <FailureCard key={index} text={card.text} />;
    }
    return (
      <RoleCard
        key={index}
        tone="answer"
        icon={<CheckCircleOutlineRounded sx={{ fontSize: 15 }} />}
        title="Answer"
        status="ready"
      >
        <MarkdownBody text={card.text} citations={message?.citations ?? []} />
      </RoleCard>
    );
  });
}

function contextValues(selection: AnalyzerSelectionV2 | null): readonly string[] {
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

function conversationTimeLabel(updatedAt: ConversationSummary['updated_at']): string {
  if (updatedAt === undefined || updatedAt === '') return '';
  const numeric = typeof updatedAt === 'number' ? updatedAt : Number(updatedAt);
  const parsed = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(updatedAt));
  if (Number.isNaN(parsed.getTime())) return '';
  const today = new Date();
  if (parsed.toDateString() === today.toDateString()) {
    return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function ConversationHistory({
  open,
  expanded,
  canPersist,
  persistent,
  conversations,
  currentId,
  loading,
  error,
  disabled,
  onClose,
  onTogglePersistent,
  onNew,
  onSelect,
  onDelete,
}: {
  open: boolean;
  expanded: boolean;
  canPersist: boolean;
  persistent: boolean;
  conversations: readonly ConversationSummary[];
  currentId: string | null;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onClose: () => void;
  onTogglePersistent: () => void;
  onNew: () => Promise<void>;
  onSelect: (conversationId: string) => Promise<void>;
  onDelete: (conversationId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleConversations = useMemo(
    () =>
      normalizedQuery
        ? conversations.filter((conversation) =>
            (conversation.title || 'New conversation')
              .toLocaleLowerCase()
              .includes(normalizedQuery),
          )
        : conversations,
    [conversations, normalizedQuery],
  );
  if (!open) return null;
  return (
    <>
      {!persistent && (
        <ButtonBase
          aria-label="Close conversation history"
          onClick={onClose}
          sx={{
            position: 'absolute',
            inset: '54px 0 0',
            zIndex: 4,
            borderRadius: 0,
            background: 'rgba(42,38,34,.12)',
          }}
        />
      )}
      <Box
        component="section"
        aria-label="Conversation history"
        data-history-mode={persistent ? 'persistent' : 'overlay'}
        sx={{
          position: persistent ? 'relative' : 'absolute',
          top: persistent ? 'auto' : 54,
          bottom: persistent ? 'auto' : 0,
          left: persistent ? 'auto' : 0,
          zIndex: persistent ? 1 : 5,
          gridColumn: persistent ? 1 : 'auto',
          gridRow: persistent ? '2 / 4' : 'auto',
          width: persistent ? '100%' : expanded ? 304 : 'min(304px,calc(100% - 16px))',
          minWidth: 0,
          minHeight: 0,
          display: 'grid',
          gridTemplateRows: 'auto auto minmax(0,1fr)',
          borderRight: `1px solid ${tokens.hair}`,
          background: tokens.tile,
          boxShadow: persistent ? 'none' : '16px 0 42px -30px rgba(42,38,34,.5)',
          animation: persistent ? 'none' : 'historyEnter 180ms ease-out',
          '@keyframes historyEnter': {
            from: { opacity: 0, transform: 'translateX(-8px)' },
            to: { opacity: 1, transform: 'translateX(0)' },
          },
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          sx={{ minHeight: 54, px: 1.5, borderBottom: `1px solid ${tokens.hair}` }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: tokens.ink, fontSize: 12.5, fontWeight: 700 }}>
              Conversations
            </Typography>
            <Typography sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}>
              {conversations.length} saved
            </Typography>
          </Box>
          <ButtonBase
            onClick={() => void onNew()}
            disabled={disabled}
            aria-label="New conversation"
            sx={{
              ml: 'auto',
              height: 30,
              px: 1,
              gap: 0.45,
              border: `1px solid ${tokens.hair}`,
              borderRadius: 0.8,
              color: tokens.teal,
              fontSize: 10.5,
              fontWeight: 700,
              '&:hover': { borderColor: tokens.teal, background: 'rgba(31,111,107,.055)' },
              '&:active': { transform: 'translateY(1px)' },
              '&.Mui-disabled': { color: tokens.sub2, opacity: 0.5 },
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          >
            <AddRounded sx={{ fontSize: 15 }} />
            New
          </ButtonBase>
          {canPersist && (
            <ButtonBase
              onClick={onTogglePersistent}
              aria-label={
                persistent ? 'Unpin conversation history' : 'Pin conversation history to the left'
              }
              sx={{
                ml: 0.45,
                width: 30,
                height: 30,
                flex: '0 0 auto',
                border: `1px solid ${persistent ? 'rgba(31,111,107,.42)' : tokens.hair}`,
                borderRadius: 0.8,
                color: persistent ? tokens.teal : tokens.sub2,
                background: persistent ? 'rgba(31,111,107,.055)' : 'transparent',
                '&:hover': { borderColor: tokens.teal, color: tokens.teal },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
              }}
            >
              <PushPinRounded
                sx={{
                  fontSize: 14,
                  transform: persistent ? 'rotate(0deg)' : 'rotate(35deg)',
                  transition: `transform 160ms ${tokens.ease}`,
                }}
              />
            </ButtonBase>
          )}
        </Stack>
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            mx: 1.25,
            my: 1,
            px: 0.85,
            minHeight: 34,
            gap: 0.65,
            border: `1px solid ${tokens.hair}`,
            borderRadius: 0.8,
            background: tokens.leafbg,
            '&:focus-within': {
              borderColor: 'rgba(31,111,107,.58)',
              boxShadow: '0 0 0 2px rgba(31,111,107,.08)',
            },
          }}
        >
          <SearchRounded sx={{ color: tokens.sub2, fontSize: 15 }} />
          <Box
            component="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search conversations"
            placeholder="Search conversations"
            sx={{
              width: '100%',
              minWidth: 0,
              border: 0,
              outline: 0,
              background: 'transparent',
              color: tokens.ink,
              fontFamily: tokens.body,
              fontSize: 11,
              '&::placeholder': { color: tokens.sub2, opacity: 1 },
            }}
          />
        </Stack>
        <Box
          component="nav"
          aria-label="Saved conversations"
          sx={{
            minHeight: 0,
            overflowY: 'auto',
            px: 0.9,
            pb: 1.25,
            scrollbarWidth: 'thin',
            scrollbarColor: `${tokens.hair} transparent`,
          }}
        >
          {loading ? (
            <Stack sx={{ gap: 0.8, px: 0.35 }}>
              {[0, 1, 2, 3].map((index) => (
                <Skeleton
                  key={index}
                  variant="rounded"
                  height={48}
                  sx={{ bgcolor: 'rgba(91,82,71,.07)', borderRadius: 0.8 }}
                />
              ))}
            </Stack>
          ) : error ? (
            <Typography role="alert" sx={{ px: 1, py: 1, color: tokens.terra, fontSize: 10.5 }}>
              {error}
            </Typography>
          ) : visibleConversations.length === 0 ? (
            <Box sx={{ px: 1, py: 2.5 }}>
              <Typography sx={{ color: tokens.ink, fontSize: 11.5, fontWeight: 650 }}>
                {conversations.length === 0 ? 'No conversations yet' : 'No matching conversations'}
              </Typography>
              <Typography sx={{ mt: 0.35, color: tokens.sub2, fontSize: 10.5, lineHeight: 1.45 }}>
                {conversations.length === 0
                  ? 'Start a new conversation to keep its work and results here.'
                  : 'Try a shorter title search.'}
              </Typography>
            </Box>
          ) : (
            <Stack sx={{ gap: 0.35 }}>
              {visibleConversations.map((conversation) => {
                const active = conversation.id === currentId;
                const confirmingDelete = pendingDelete === conversation.id;
                return (
                  <Stack
                    key={conversation.id}
                    direction="row"
                    alignItems="center"
                    sx={{
                      minHeight: 48,
                      borderLeft: `2px solid ${active ? tokens.teal : 'transparent'}`,
                      borderRadius: 0.65,
                      background: active ? 'rgba(31,111,107,.065)' : 'transparent',
                      '&:hover': { background: active ? 'rgba(31,111,107,.085)' : tokens.tile2 },
                      '&:focus-within .conversation-delete': { opacity: 1 },
                    }}
                  >
                    <ButtonBase
                      onClick={() => {
                        if (disabled) return;
                        if (active) {
                          onClose();
                          return;
                        }
                        void onSelect(conversation.id).then(onClose);
                      }}
                      disabled={disabled}
                      aria-current={active ? 'page' : undefined}
                      aria-label={`${active ? 'Current' : 'Open'} ${
                        conversation.title || 'conversation'
                      }`}
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        alignSelf: 'stretch',
                        justifyContent: 'flex-start',
                        px: 1,
                        py: 0.7,
                        borderRadius: 0,
                        textAlign: 'left',
                        '&:focus-visible': {
                          outline: `2px solid ${tokens.teal}`,
                          outlineOffset: -2,
                        },
                      }}
                    >
                      <Box sx={{ minWidth: 0, width: '100%' }}>
                        <Typography
                          noWrap
                          sx={{
                            color: active ? tokens.ink : tokens.sub,
                            fontSize: 11.25,
                            fontWeight: active ? 700 : 540,
                          }}
                        >
                          {conversation.title || 'New conversation'}
                        </Typography>
                        <Typography
                          sx={{
                            mt: 0.1,
                            color: tokens.sub2,
                            fontFamily: tokens.mono,
                            fontSize: 8.25,
                          }}
                        >
                          {conversationTimeLabel(conversation.updated_at)}
                        </Typography>
                      </Box>
                    </ButtonBase>
                    {confirmingDelete ? (
                      <Stack direction="row" sx={{ pr: 0.45, gap: 0.25 }}>
                        <ButtonBase
                          onClick={() => setPendingDelete(null)}
                          sx={{ px: 0.45, py: 0.35, color: tokens.sub2, fontSize: 8.5 }}
                        >
                          Cancel
                        </ButtonBase>
                        <ButtonBase
                          onClick={() => {
                            setPendingDelete(null);
                            void onDelete(conversation.id);
                          }}
                          sx={{ px: 0.45, py: 0.35, color: tokens.terra, fontSize: 8.5 }}
                        >
                          Delete
                        </ButtonBase>
                      </Stack>
                    ) : (
                      <ButtonBase
                        className="conversation-delete"
                        onClick={() => setPendingDelete(conversation.id)}
                        disabled={disabled}
                        aria-label={`Delete ${conversation.title || 'conversation'}`}
                        sx={{
                          mr: 0.45,
                          width: 28,
                          height: 28,
                          flex: '0 0 auto',
                          borderRadius: 0.65,
                          color: tokens.sub2,
                          opacity: active ? 0.72 : 0,
                          '&:hover': { color: tokens.terra, background: 'rgba(168,75,46,.06)' },
                          '&:focus-visible': {
                            opacity: 1,
                            outline: `2px solid ${tokens.terra}`,
                            outlineOffset: 1,
                          },
                        }}
                      >
                        <DeleteOutlineRounded sx={{ fontSize: 15 }} />
                      </ButtonBase>
                    )}
                  </Stack>
                );
              })}
            </Stack>
          )}
        </Box>
      </Box>
    </>
  );
}

const CONVERSATION_ID_KEY_PREFIX = 'vibesim.conversation.id';
const HISTORY_PINNED_KEY = 'vibesim.conversation.history.pinned';

function conversationIdKey(workspaceId: string): string {
  return `${CONVERSATION_ID_KEY_PREFIX}.${workspaceId}`;
}

function savedHistoryPinned(): boolean {
  try {
    return window.localStorage.getItem(HISTORY_PINNED_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveHistoryPinned(pinned: boolean): void {
  try {
    if (pinned) {
      window.localStorage.setItem(HISTORY_PINNED_KEY, 'true');
    } else {
      window.localStorage.removeItem(HISTORY_PINNED_KEY);
    }
  } catch {
    // Storage can be unavailable in privacy-restricted embeds; the current UI state still works.
  }
}

function useAgentConversation(
  workspaceId: string,
  prompt: string,
  analyzerContext: AnalyzerTurnContextV2 | null,
  enabled: boolean,
  requireAnalyzerContext: boolean,
  onInitialPromptStarted?: () => void,
) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly ConversationMessage[]>([]);
  const [liveEvents, setLiveEvents] = useState<readonly ConversationTurnEvent[]>([]);
  const [progress, setProgress] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<readonly ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const streamingRef = useRef(false);
  // StrictMode replays effect setup/cleanup. Both setups must join the same
  // initialization rather than orphaning the just-created conversation.
  const initializationPromise = useRef<Promise<Conversation | null> | null>(null);
  const initialPromptStarted = useRef(false);
  const abortController = useRef<AbortController | null>(null);
  const setStreamingState = useCallback((nextStreaming: boolean) => {
    streamingRef.current = nextStreaming;
    setStreaming(nextStreaming);
  }, []);
  const refreshHistory = useCallback(async (): Promise<readonly ConversationSummary[] | null> => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const nextConversations = await listConversations(workspaceId);
      setConversations(nextConversations);
      return nextConversations;
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : 'Conversation history failed');
      return null;
    } finally {
      setHistoryLoading(false);
    }
  }, [workspaceId]);
  const installConversation = useCallback(
    (conversation: Conversation, markInitialPromptHandled: boolean) => {
      initializationPromise.current = Promise.resolve(conversation);
      window.sessionStorage.setItem(conversationIdKey(workspaceId), conversation.id);
      setConversationId(conversation.id);
      setMessages(conversation.messages);
      setLiveEvents([]);
      setProgress('');
      setError(null);
      if (markInitialPromptHandled) initialPromptStarted.current = true;
    },
    [workspaceId],
  );

  const runTurn = useCallback(
    async (activeConversationId: string, text: string, context: AnalyzerTurnContextV2 | null) => {
      const trimmed = text.trim();
      if (!trimmed || streamingRef.current) return;
      const controller = new AbortController();
      abortController.current = controller;
      setMessages((current) => [...current, { role: 'user', content: trimmed }]);
      setLiveEvents([]);
      setProgress('');
      setError(null);
      setStreamingState(true);
      let completionMessage: ConversationMessage | null = null;
      try {
        await sendConversationTurn(
          workspaceId,
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
                failure: completion.failure,
              };
            },
          },
          controller.signal,
        );
        const refreshed = await getConversation(workspaceId, activeConversationId);
        if (refreshed) setMessages(refreshed.messages);
        else if (completionMessage) setMessages((current) => [...current, completionMessage!]);
        void refreshHistory();
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : 'Conversation turn failed');
        }
      } finally {
        abortController.current = null;
        setStreamingState(false);
        setLiveEvents([]);
        setProgress('');
      }
    },
    [refreshHistory, setStreamingState, workspaceId],
  );

  const selectConversation = useCallback(
    async (nextConversationId: string) => {
      if (streamingRef.current || nextConversationId === conversationId) return;
      try {
        const nextConversation = await getConversation(workspaceId, nextConversationId);
        if (!nextConversation) {
          setHistoryError('That conversation is no longer available.');
          void refreshHistory();
          return;
        }
        installConversation(nextConversation, true);
      } catch (caught) {
        setHistoryError(caught instanceof Error ? caught.message : 'Load conversation failed');
      }
    },
    [conversationId, installConversation, refreshHistory, workspaceId],
  );

  const startConversation = useCallback(async () => {
    if (streamingRef.current) return;
    initializationPromise.current = null;
    initialPromptStarted.current = true;
    window.sessionStorage.removeItem(conversationIdKey(workspaceId));
    setConversationId(null);
    setMessages([]);
    setLiveEvents([]);
    setProgress('');
    setError(null);
  }, [workspaceId]);

  const materializeConversation = useCallback(async (): Promise<Conversation> => {
    const creation = createConversation(workspaceId);
    initializationPromise.current = creation;
    const conversation = await creation;
    installConversation(conversation, true);
    await refreshHistory();
    return conversation;
  }, [installConversation, refreshHistory, workspaceId]);

  const removeConversation = useCallback(
    async (removedConversationId: string) => {
      if (streamingRef.current) return;
      try {
        await deleteConversation(workspaceId, removedConversationId);
        const remainingConversations = await refreshHistory();
        if (removedConversationId !== conversationId || remainingConversations === null) return;
        const replacementSummary = remainingConversations[0];
        if (replacementSummary) {
          const replacement = await getConversation(workspaceId, replacementSummary.id);
          if (replacement) {
            installConversation(replacement, true);
            return;
          }
        }
        initializationPromise.current = null;
        window.sessionStorage.removeItem(conversationIdKey(workspaceId));
        setConversationId(null);
        setMessages([]);
      } catch (caught) {
        setHistoryError(caught instanceof Error ? caught.message : 'Delete conversation failed');
      }
    },
    [conversationId, installConversation, refreshHistory, workspaceId],
  );

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let resumeController: AbortController | null = null;
    if (initializationPromise.current === null) {
      initializationPromise.current = (async () => {
        const rememberedId = window.sessionStorage.getItem(conversationIdKey(workspaceId));
        return rememberedId ? getConversation(workspaceId, rememberedId) : null;
      })();
    }
    const currentInitialization = initializationPromise.current;
    void (async () => {
      try {
        const conversation = await currentInitialization;
        if (disposed) return;
        void refreshHistory();
        if (!conversation) {
          setConversationId(null);
          setMessages([]);
          return;
        }
        installConversation(conversation, false);
        resumeController = new AbortController();
        abortController.current = resumeController;
        setStreamingState(true);
        const resumed = await resumeConversationTurn(
          workspaceId,
          conversation.id,
          {
            progress: setProgress,
            event: (event) => setLiveEvents((current) => [...current, event]),
          },
          resumeController.signal,
        );
        if (disposed) return;
        abortController.current = null;
        setStreamingState(false);
        if (resumed) {
          const refreshed = await getConversation(workspaceId, conversation.id);
          if (refreshed && !disposed) setMessages(refreshed.messages);
          setLiveEvents([]);
        }
      } catch (caught) {
        if (initializationPromise.current === currentInitialization) {
          initializationPromise.current = null;
        }
        if (!disposed) {
          setStreamingState(false);
          setError(caught instanceof Error ? caught.message : 'Conversation initialization failed');
        }
      }
    })();
    return () => {
      disposed = true;
      resumeController?.abort();
    };
  }, [enabled, installConversation, refreshHistory, setStreamingState, workspaceId]);

  useEffect(() => {
    if (
      !enabled ||
      messages.length > 0 ||
      streaming ||
      initialPromptStarted.current ||
      !prompt.trim() ||
      (requireAnalyzerContext && analyzerContext === null)
    ) {
      return;
    }
    initialPromptStarted.current = true;
    onInitialPromptStarted?.();
    void (async () => {
      try {
        const activeConversation = conversationId === null ? await materializeConversation() : null;
        await runTurn(activeConversation?.id ?? conversationId!, prompt, analyzerContext);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Conversation could not be started');
      }
    })();
  }, [
    analyzerContext,
    conversationId,
    enabled,
    messages.length,
    materializeConversation,
    onInitialPromptStarted,
    prompt,
    requireAnalyzerContext,
    runTurn,
    streaming,
  ]);

  return {
    conversationId,
    conversations,
    messages,
    liveEvents,
    progress,
    streaming,
    error,
    historyLoading,
    historyError,
    send: (text: string) =>
      conversationId
        ? runTurn(conversationId, text, analyzerContext)
        : materializeConversation().then((conversation) =>
            runTurn(conversation.id, text, analyzerContext),
          ),
    cancel: () => abortController.current?.abort(),
    selectConversation,
    startConversation,
    removeConversation,
  };
}

export default function AgentPane({
  workspaceId = 'w_main',
  workspaceName,
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
  onInitialPromptStarted,
}: {
  workspaceId?: string;
  workspaceName?: string;
  prompt: string;
  onClose?: () => void;
  onFold?: () => void;
  onToggleFull?: () => void;
  analyzerContext?: AnalyzerTurnContextV2 | null;
  enabled?: boolean;
  requireAnalyzerContext?: boolean;
  full?: boolean;
  expanded?: boolean;
  showSelectionContext?: boolean;
  onInitialPromptStarted?: () => void;
}) {
  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPinned, setHistoryPinned] = useState(savedHistoryPinned);
  const conversation = useAgentConversation(
    workspaceId,
    prompt,
    analyzerContext,
    enabled,
    requireAnalyzerContext,
    onInitialPromptStarted,
  );
  // A persistent rail belongs to the roomy agent surfaces. Docked mode keeps the saved
  // preference but uses the overlay so history never consumes most of the analysis column.
  const persistentHistory = historyPinned && (full || expanded);
  const historyVisible = persistentHistory || historyOpen;
  const readingColumnWidth = full || expanded ? 'min(720px,calc(100% - 40px))' : '100%';
  const activeConversationTitle =
    conversation.conversations.find((item) => item.id === conversation.conversationId)?.title ??
    'New conversation';
  const scrollRef = useRef<HTMLDivElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = input.trim();
    if (!message) return;
    setInput('');
    void conversation.send(message);
  };
  const toggleHistoryPinned = () => {
    const nextPinned = !historyPinned;
    setHistoryPinned(nextPinned);
    saveHistoryPinned(nextPinned);
    setHistoryOpen(!nextPinned);
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
        gridTemplateColumns: persistentHistory
          ? 'clamp(232px,22vw,272px) minmax(0,1fr)'
          : 'minmax(0,1fr)',
        gridTemplateRows: 'auto minmax(0,1fr) auto',
        position: 'relative',
        overflow: 'hidden',
        background: full || expanded ? tokens.paper : '#eee7da',
        transition: `grid-template-columns 190ms ${tokens.ease}`,
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          gridColumn: '1 / -1',
          gridRow: 1,
          minHeight: 54,
          px: 2,
          borderBottom: `1px solid ${tokens.hair}`,
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1, mr: 1 }}>
          <Typography
            sx={{ color: tokens.ink, fontFamily: tokens.serif, fontSize: 16, fontWeight: 600 }}
          >
            VibeSim Agent
          </Typography>
          <Typography noWrap sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}>
            {workspaceName
              ? `${workspaceName} · ${activeConversationTitle}`
              : activeConversationTitle}
          </Typography>
        </Box>
        <Stack direction="row" sx={{ gap: 0.55 }}>
          <ButtonBase
            onClick={() => {
              if (persistentHistory) {
                setHistoryPinned(false);
                saveHistoryPinned(false);
                return;
              }
              setHistoryOpen((current) => !current);
            }}
            aria-label={
              persistentHistory ? 'Hide conversation history' : 'Open conversation history'
            }
            aria-expanded={historyVisible}
            sx={{
              width: 32,
              height: 32,
              border: `1px solid ${historyVisible ? 'rgba(31,111,107,.42)' : tokens.hair}`,
              borderRadius: 0.85,
              color: historyVisible ? tokens.teal : tokens.sub,
              background: historyVisible ? 'rgba(31,111,107,.055)' : 'transparent',
              '&:hover': { borderColor: tokens.teal, color: tokens.teal },
              '&:active': { transform: 'translateY(1px)' },
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          >
            <HistoryRounded sx={{ fontSize: 17 }} />
          </ButtonBase>
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
      <ConversationHistory
        open={historyVisible}
        expanded={full || expanded}
        canPersist={full || expanded}
        persistent={persistentHistory}
        conversations={conversation.conversations}
        currentId={conversation.conversationId}
        loading={conversation.historyLoading}
        error={conversation.historyError}
        disabled={conversation.streaming}
        onClose={() => setHistoryOpen(false)}
        onTogglePersistent={toggleHistoryPinned}
        onNew={async () => {
          await conversation.startConversation();
          if (!persistentHistory) setHistoryOpen(false);
        }}
        onSelect={conversation.selectConversation}
        onDelete={conversation.removeConversation}
      />
      <Box
        ref={scrollRef}
        data-testid="agent-message-column"
        sx={{
          gridColumn: persistentHistory ? 2 : 1,
          gridRow: 2,
          width: readingColumnWidth,
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
        sx={{
          gridColumn: persistentHistory ? 2 : 1,
          gridRow: 3,
          borderTop: `1px solid ${tokens.hair}`,
        }}
      >
        <Box
          data-testid="agent-composer-column"
          sx={{ width: readingColumnWidth, mx: 'auto', px: 2, py: 1.5 }}
        >
          {showSelectionContext && <AnalyzerSelectionStrip />}
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
              boxShadow: '0 9px 28px -24px rgba(42,38,34,.55)',
              '&:focus-within': {
                borderColor: 'rgba(31,111,107,.58)',
                boxShadow: '0 0 0 2px rgba(31,111,107,.075)',
              },
            }}
          >
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
                '&::placeholder': { color: tokens.sub2, opacity: 1 },
              }}
            />
            <ButtonBase
              type="submit"
              disabled={!input.trim() || conversation.streaming}
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
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
