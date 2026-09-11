import BarChartRounded from '@mui/icons-material/BarChartRounded';
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded';
import LightbulbOutlined from '@mui/icons-material/LightbulbOutlined';
import OutlinedFlagRounded from '@mui/icons-material/OutlinedFlagRounded';
import StopRounded from '@mui/icons-material/StopRounded';
import { Box, ButtonBase, Skeleton, Stack, Typography } from '@mui/material';
import { useEffect, useRef, type ReactNode } from 'react';

import { tokens, withAlpha } from '../../ui/theme';
import { outlineEntryCounts, type OutlineEntry, type OutlineGroup } from './agentOutline';

/**
 * The right rail of the full-page Agent surface: an index of the three anchors
 * a reader comes back for, grouped under the question that prompted them.
 *
 * It mirrors the conversation-history rail on the left, down to the header
 * height and the active-row grammar, so the full page reads as one room with
 * two margins rather than as a transcript with a widget bolted on.
 *
 * Colours are the transcript's own, so an entry is recognisable as its
 * destination, but each kind additionally carries its own marker shape: a flag
 * for a milestone reached, bars for a measured result, a bulb for the answer.
 * The transcript can reuse one check mark across all three because every card
 * there is captioned; the rail is not, so shape has to do the work colour
 * cannot.
 */

const FAILED = tokens.terra;

function entryColor(entry: OutlineEntry): string {
  if (entry.kind === 'answer') return tokens.terra;
  if (entry.kind === 'input-needed') return tokens.gold;
  // Grey, and the only grey marker on the rail. A stopped turn is the one
  // entry that reports no state of the work at all.
  if (entry.kind === 'stopped') return tokens.sub;
  if (entry.kind === 'result') {
    if (entry.status === 'failed') return FAILED;
    return entry.status === 'ready' ? tokens.teal : tokens.gold;
  }
  return tokens.teal;
}

/**
 * One silhouette per kind, and the same silhouette for a result whatever its
 * state. Skimming the rail is a question of "what kind of thing is this", so a
 * result that changed shape between running and ready would blur the very
 * distinction the marker exists to make. State rides on the colour and, so that
 * nothing is encoded in colour alone, on the detail line that spells it out.
 */
function EntryIcon({ entry }: { entry: OutlineEntry }): ReactNode {
  const sx = { fontSize: 13, flex: '0 0 auto', mt: '1px', color: entryColor(entry) };
  if (entry.kind === 'result') return <BarChartRounded sx={sx} />;
  if (entry.kind === 'answer') return <LightbulbOutlined sx={sx} />;
  if (entry.kind === 'input-needed') return <HelpOutlineRounded sx={sx} />;
  if (entry.kind === 'stopped') return <StopRounded sx={sx} />;
  return <OutlinedFlagRounded sx={sx} />;
}

/**
 * Milestones and results only. Answers are one per turn and already counted by
 * the group headings, and a third clause would put two separators on a line
 * that has to stay glanceable.
 */
function headerSummary(groups: readonly OutlineGroup[]): string {
  const { milestones, results } = outlineEntryCounts(groups);
  return [
    milestones === 1 ? '1 milestone' : `${milestones} milestones`,
    results === 1 ? '1 result' : `${results} results`,
  ].join(' · ');
}

function RailEntry({
  entry,
  active,
  onSelect,
}: {
  entry: OutlineEntry;
  active: boolean;
  onSelect: (entry: OutlineEntry) => void;
}) {
  const color = entryColor(entry);
  return (
    <ButtonBase
      onClick={() => onSelect(entry)}
      aria-current={active ? 'true' : undefined}
      data-rail-entry={entry.anchorId}
      title={entry.label}
      sx={{
        width: '100%',
        minHeight: 30,
        py: 0.55,
        pl: 0.9,
        pr: 0.8,
        gap: 0.6,
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        textAlign: 'left',
        borderLeft: `2px solid ${active ? color : 'transparent'}`,
        borderRadius: 0.65,
        background: active ? tokens.selected : 'transparent',
        transition: `background 140ms ${tokens.ease}, border-color 140ms ${tokens.ease}`,
        '&:hover': { background: active ? tokens.selected : tokens.leafbg },
        '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <EntryIcon entry={entry} />
      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            color: tokens.ink,
            fontSize: 12,
            lineHeight: 1.4,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {entry.label}
        </Typography>
        {entry.detail && (
          <Typography noWrap sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}>
            {entry.detail}
          </Typography>
        )}
      </Box>
    </ButtonBase>
  );
}

export default function ConversationProgressRail({
  groups,
  activeAnchorId,
  loading,
  canLoadEarlier,
  loadingEarlier,
  onLoadEarlier,
  onSelect,
}: {
  groups: readonly OutlineGroup[];
  activeAnchorId: string | null;
  loading: boolean;
  canLoadEarlier: boolean;
  loadingEarlier: boolean;
  onLoadEarlier: () => void;
  onSelect: (entry: OutlineEntry) => void;
}) {
  const entryList = useRef<HTMLDivElement>(null);
  // The rail follows the transcript. Opening a long conversation lands the
  // reader at its newest turn, and the index has to be showing that same turn
  // rather than the opening question. `nearest` keeps it still whenever the
  // marked entry is already in view, so ordinary scrolling never fights it.
  useEffect(() => {
    const list = entryList.current;
    if (list === null || activeAnchorId === null) return;
    const row = list.querySelector<HTMLElement>(`[data-rail-entry="${activeAnchorId}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [activeAnchorId]);
  return (
    <Box
      component="section"
      aria-label="Conversation progress"
      data-testid="agent-progress-rail"
      sx={{
        gridRow: 2,
        minWidth: 0,
        minHeight: 0,
        display: 'grid',
        gridTemplateRows: 'auto minmax(0,1fr)',
        borderLeft: `1px solid ${tokens.hair}`,
        background: tokens.tile,
      }}
    >
      <Box sx={{ minHeight: 54, px: 1.5, py: 1, borderBottom: `1px solid ${tokens.hair}` }}>
        <Typography sx={{ color: tokens.ink, fontSize: 12.5, fontWeight: 700 }}>
          Progress
        </Typography>
        <Typography noWrap sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}>
          {headerSummary(groups)}
        </Typography>
      </Box>
      <Box
        component="nav"
        ref={entryList}
        aria-label="Milestones, results and answers"
        sx={{
          minHeight: 0,
          overflowY: 'auto',
          px: 0.9,
          pb: 2,
          // Padding alone would not show here: scrolling an entry into view
          // aligns it to the padding box, so the newest row would end up flush
          // against the rail's edge. Scroll padding is what reserves the gap.
          scrollPaddingBlock: '14px',
          scrollbarWidth: 'thin',
          scrollbarColor: `${tokens.hair} transparent`,
        }}
      >
        {canLoadEarlier && (
          <ButtonBase
            onClick={onLoadEarlier}
            disabled={loadingEarlier}
            title="Earlier messages are not indexed until they are loaded"
            sx={{
              mt: 1,
              mb: 0.35,
              px: 0.9,
              py: 0.45,
              width: '100%',
              border: `1px solid ${tokens.hair}`,
              borderRadius: 0.75,
              color: tokens.sub2,
              fontFamily: tokens.body,
              fontSize: 12,
              '&:hover': { color: tokens.teal, borderColor: withAlpha(tokens.teal, 0.35) },
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          >
            {loadingEarlier ? 'Loading earlier…' : 'Index earlier messages'}
          </ButtonBase>
        )}
        {loading ? (
          <Stack sx={{ gap: 0.5, px: 0.35, pt: 1 }}>
            {[0, 1, 2].map((index) => (
              <Skeleton
                key={index}
                variant="rounded"
                height={30}
                sx={{ bgcolor: withAlpha(tokens.sub, 0.07), borderRadius: 0.65 }}
              />
            ))}
          </Stack>
        ) : groups.length === 0 ? (
          <Box sx={{ px: 1, py: 2.5 }}>
            <Typography sx={{ color: tokens.ink, fontSize: 12, fontWeight: 650 }}>
              No progress yet
            </Typography>
            <Typography sx={{ mt: 0.35, color: tokens.sub2, fontSize: 12, lineHeight: 1.45 }}>
              Milestones, results and answers collect here as the agent works.
            </Typography>
          </Box>
        ) : (
          groups.map((group, groupIndex) => (
            <Box
              key={group.blockId ?? `group-${groupIndex}`}
              sx={{
                pt: 1.4,
                ...(groupIndex > 0 ? { mt: 1.1, borderTop: `1px solid ${tokens.hair}` } : {}),
              }}
            >
              {group.question && (
                <Typography
                  noWrap
                  title={group.question}
                  sx={{ px: 1, pb: 0.5, color: tokens.sub, fontSize: 12, fontWeight: 650 }}
                >
                  {group.question}
                </Typography>
              )}
              <Stack sx={{ gap: 0.15 }}>
                {group.entries.map((entry) => (
                  <RailEntry
                    key={entry.anchorId}
                    entry={entry}
                    active={entry.anchorId === activeAnchorId}
                    onSelect={onSelect}
                  />
                ))}
                {group.live && (
                  <Typography
                    sx={{
                      px: 1.15,
                      pt: 0.4,
                      color: tokens.gold,
                      fontFamily: tokens.body,
                      fontSize: 12,
                    }}
                  >
                    working
                  </Typography>
                )}
              </Stack>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
