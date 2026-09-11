import type {
  AgentTerminalOutcome,
  ConversationMessage,
  ConversationTurnEvent,
} from './agentTypes';
import { conversationCards, type ConversationCard } from './agentTimeline';

/**
 * The progress rail's index of a conversation.
 *
 * It deliberately derives from `conversationCards` rather than from the raw
 * event stream: the rail and the transcript must never disagree about how the
 * events were split into cards, because every rail entry navigates to a card
 * the transcript rendered. Only the three anchors a reader actually looks for
 * are indexed (orchestrator milestones, managed results, terminal answers);
 * progress chatter, delegated tasks and implementation reports stay in the
 * transcript where they belong.
 */

export type OutlineEntryKind = 'milestone' | 'result' | 'answer' | 'input-needed' | 'stopped';
export type OutlineResultStatus = 'ready' | 'running' | 'failed';

export interface OutlineEntry {
  /** Matches `data-outline-anchor` on the rendered card or milestone note. */
  anchorId: string;
  /** Matches the nearest lazy card block that must mount before the anchor exists. */
  blockId: string;
  /**
   * Persisted turns have an outer lazy message block which exists before the
   * inner card block. Navigation uses it as the first mount waypoint.
   */
  fallbackBlockId?: string;
  kind: OutlineEntryKind;
  label: string;
  /** Second line, currently only used to name a managed result and its state. */
  detail?: string;
  status?: OutlineResultStatus;
}

export interface OutlineGroup {
  /** The lazy block of the user message that opened the turn, when there is one. */
  blockId: string | null;
  question: string;
  entries: readonly OutlineEntry[];
  /** The turn is still streaming, so more entries may arrive. */
  live: boolean;
}

const LABEL_LIMIT = 120;

const managedResultLabels: Record<string, string> = {
  timing_predict: 'Timing prediction',
  kernel_profile: 'Kernel profile',
  kernel_measure: 'Kernel measurement',
};

/**
 * What a job card is called. Shared with the transcript's own job card so the
 * rail entry and the card it navigates to can never name the same result
 * differently.
 */
export function managedResultLabel(card: Extract<ConversationCard, { type: 'job' }>): string {
  if (!card.jobKind || !card.resourceId) return 'Experiment';
  return managedResultLabels[card.jobKind] ?? 'Managed job';
}

/** Shared with the transcript's job card, for the same reason. */
export function managedResultStatus(status: string): OutlineResultStatus {
  if (status === 'ready' || status === 'experiment.ready') return 'ready';
  if (status === 'failed' || status === 'interrupted') return 'failed';
  return 'running';
}

function truncate(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 1).trimEnd()}…` : collapsed;
}

/**
 * Flattens the Markdown subset agents write into one scannable line. The rail
 * shows an excerpt, not a rendered document, so emphasis, code fences, links
 * and list bullets are all noise here.
 *
 * A lone `_` is left alone on purpose: identifiers like `total_tps` and
 * `kernel_profile` are exactly the terms a reader scans this rail for, and
 * treating them as emphasis delimiters would corrupt them.
 */
export function plainTextExcerpt(text: string, limit = LABEL_LIMIT): string {
  return truncate(
    text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/__(.+?)__/g, '$1')
      .replace(/[*~`]/g, ''),
    limit,
  );
}

export function outlineBlockId(messageIndex: number): string {
  return `t${messageIndex}`;
}

export function outlineCardAnchorId(blockId: string, cardIndex: number): string {
  return `${blockId}-c${cardIndex}`;
}

export function outlineNoteAnchorId(cardAnchorId: string, noteIndex: number): string {
  return `${cardAnchorId}-n${noteIndex}`;
}

export const LIVE_OUTLINE_BLOCK_ID = 'live';

/**
 * How a turn's closing card is indexed. A stopped turn is still a place in the
 * transcript worth reaching, so it keeps its entry; what it must not do is
 * take the answer marker and be counted among the answers.
 */
function outlineKindOf(outcome: AgentTerminalOutcome): OutlineEntryKind {
  if (outcome === 'request_user_input') return 'input-needed';
  if (outcome === 'cancelled') return 'stopped';
  return 'answer';
}

function resultEntry(
  card: Extract<ConversationCard, { type: 'job' }>,
  anchorId: string,
  blockId: string,
  fallbackBlockId?: string,
): OutlineEntry {
  const kindLabel = managedResultLabel(card);
  const status = managedResultStatus(card.status);
  return {
    anchorId,
    blockId,
    ...(fallbackBlockId ? { fallbackBlockId } : {}),
    kind: 'result',
    // An artifact path is not Markdown; run it through the plain truncator so
    // its punctuation survives intact.
    label: truncate(card.artifactPath || card.experimentPath || kindLabel, LABEL_LIMIT),
    detail: `${kindLabel.toLocaleLowerCase()} · ${status}`,
    status,
  };
}

/**
 * Indexes one assistant turn. `blockId` is the turn's own lazy block; each card
 * inside it owns a nested block sharing the card's anchor id.
 */
function turnEntries(
  events: readonly ConversationTurnEvent[],
  turnBlockId: string,
): readonly OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  conversationCards(events).forEach((card, cardIndex) => {
    const anchorId = outlineCardAnchorId(turnBlockId, cardIndex);
    const fallbackBlockId = turnBlockId === LIVE_OUTLINE_BLOCK_ID ? undefined : turnBlockId;
    if (card.type === 'role') {
      // Milestones come from whichever role drives the turn — the orchestrator
      // in the two-agent cast, the assistant in the single-agent one. Only the
      // implementer's commentary is a handoff detail rather than a milestone.
      if (card.role === 'implementer') return;
      card.notes.forEach((note, noteIndex) => {
        if (note.level !== 'milestone') return;
        const label = plainTextExcerpt(note.text);
        if (!label) return;
        entries.push({
          anchorId: outlineNoteAnchorId(anchorId, noteIndex),
          blockId: anchorId,
          ...(fallbackBlockId ? { fallbackBlockId } : {}),
          kind: 'milestone',
          label,
        });
      });
      return;
    }
    if (card.type === 'job') {
      entries.push(resultEntry(card, anchorId, anchorId, fallbackBlockId));
      return;
    }
    if (card.type === 'response') {
      entries.push({
        anchorId,
        blockId: anchorId,
        ...(fallbackBlockId ? { fallbackBlockId } : {}),
        kind: outlineKindOf(card.outcome),
        label: plainTextExcerpt(card.text),
      });
    }
  });
  return entries;
}

/**
 * Groups the indexed anchors under the user question that prompted them.
 * A conversation resumed mid-history can start with assistant messages, which
 * land in a leading group with no question of their own.
 */
export function conversationOutline(
  messages: readonly ConversationMessage[],
  messageStartIndex: number,
  liveEvents: readonly ConversationTurnEvent[],
  streaming: boolean,
): readonly OutlineGroup[] {
  interface DraftGroup {
    blockId: string | null;
    question: string;
    entries: OutlineEntry[];
    live: boolean;
  }
  const groups: DraftGroup[] = [];
  const openGroup = (blockId: string | null, question: string): DraftGroup => {
    const group: DraftGroup = { blockId, question, entries: [], live: false };
    groups.push(group);
    return group;
  };
  const lastGroup = (): DraftGroup => groups[groups.length - 1] ?? openGroup(null, '');
  messages.forEach((message, index) => {
    const blockId = outlineBlockId(messageStartIndex + index);
    if (message.role === 'user') {
      openGroup(blockId, plainTextExcerpt(message.content, 90));
      return;
    }
    lastGroup().entries.push(
      ...turnEntries(
        message.activity?.length ? message.activity : [{ kind: 'final', text: message.content }],
        blockId,
      ),
    );
  });
  if (streaming) {
    const group = lastGroup();
    group.entries.push(...turnEntries(liveEvents, LIVE_OUTLINE_BLOCK_ID));
    group.live = true;
  }
  return groups.filter((group) => group.entries.length > 0 || group.live);
}

export function outlineEntryCounts(groups: readonly OutlineGroup[]): {
  milestones: number;
  results: number;
  answers: number;
} {
  const entries = groups.flatMap((group) => group.entries);
  return {
    milestones: entries.filter((entry) => entry.kind === 'milestone').length,
    results: entries.filter((entry) => entry.kind === 'result').length,
    answers: entries.filter((entry) => entry.kind === 'answer' || entry.kind === 'input-needed')
      .length,
  };
}
