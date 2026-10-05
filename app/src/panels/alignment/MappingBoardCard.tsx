import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { alignmentSequenceRef, useArtifacts, type AlignmentSequenceRef } from '../../artifacts';
import type { ResultRef } from '../../location';
import SurfaceCard from '../../ui/controls/SurfaceCard';
import type {
  AlignmentBreakdown,
  AlignmentIterationReport,
  AlignmentSequence,
  AlignmentIterationSeries,
} from '../../artifacts/schema/alignmentTypes';
import { tokens } from '../../ui/theme';
import { fmtInt, fmtMs, fmtPct } from './format';
import {
  barWidthPct,
  boardHighlight,
  joinIsActive,
  modelledRowGaps as computeModelledRowGaps,
  nextSelection,
  sameGeometry,
  type BoardGeometry,
} from './mappingBoardLayout';
import MappingBoardRibbons from './mappingBoardRibbons';
import {
  boardCoverage,
  boardJoins,
  boardLanes,
  boardSequenceCatalog,
  defaultPhase,
  defaultSequenceKeys,
  sequenceOptionsForPhase,
  sequenceKeysForIteration,
  type BoardGroup,
} from './mappingBoardModel';

/**
 * §02 — the label file as a board.
 *
 * Two named lists, not two timelines: every measured kernel and every modelled
 * slot is a card carrying its own name, cost and fold, so nothing has to be
 * looked up elsewhere on the page. The measured program is on the left in the
 * order it ran — the capture's phases concatenated — the modelled slots on the
 * right, and a ribbon in the gutter wherever the label file already ties the
 * two together. Click reads a card, ctrl-click builds a selection across both
 * lists.
 */

const GUTTER_WIDTH = 132;
const CARD_HEIGHT = 26;
const CARD_GAP = 3;
const GROUP_HEADER_HEIGHT = 21;
const EMPTY_GEOMETRY: BoardGeometry = { measuredCenterY: [], modelledCenterY: [], height: 0 };
const NO_SELECTION = new Set<string>();

export default function MappingBoardCard({
  result,
  report,
  series,
  breakdown,
  selectedIterationId,
  onSelectIteration,
}: {
  result: ResultRef & { readonly kind: 'alignment' };
  report: AlignmentIterationReport;
  series: AlignmentIterationSeries;
  /** Timing-predict detail for the real example iteration selected on the
   * page. Passing null deliberately keeps the modelled values empty while it
   * loads; it must not fall back to a whole-capture average. */
  breakdown: AlignmentBreakdown | null;
  selectedIterationId: number | null;
  onSelectIteration: (iterationId: number) => void;
}) {
  const sequences = series.sequences;
  const catalog = useMemo(
    () => (sequences === null ? null : boardSequenceCatalog(sequences, report)),
    [sequences, report],
  );
  const [editedPhase, setEditedPhase] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(NO_SELECTION);

  const phase =
    catalog === null
      ? null
      : editedPhase !== null && catalog.phaseOrder.includes(editedPhase)
        ? editedPhase
        : defaultPhase(catalog);
  const chosenByPhase = useMemo(
    () =>
      catalog === null || sequences === null
        ? {}
        : {
            ...defaultSequenceKeys(catalog),
            ...(selectedIterationId === null
              ? {}
              : sequenceKeysForIteration(sequences, catalog, selectedIterationId)),
          },
    [catalog, selectedIterationId, sequences],
  );
  const sequenceRequests = useMemo(
    () =>
      catalog === null || sequences === null
        ? []
        : Object.entries(chosenByPhase).flatMap(([phase, key]) => {
            const option = catalog.all.find((entry) => entry.key === key);
            if (option === undefined) return [];
            const summary = (sequences.phases[phase] ?? []).find(
              (sequence) => sequence.sequenceId === option.sequenceId,
            );
            const hasProgram = summary?.tracks.every((track) => track.program !== null) === true;
            return hasProgram ? [] : [{ phase, sequenceId: option.sequenceId, key }];
          }),
    [catalog, chosenByPhase, sequences],
  );
  const sequenceRefs: AlignmentSequenceRef[] =
    series.sequenceDetail === null
      ? []
      : sequenceRequests.map((request) =>
          alignmentSequenceRef(result, request.phase, request.sequenceId),
        );
  const sequenceQueries = useArtifacts(sequenceRefs);
  const sequenceDetails = useMemo(() => {
    const details: Record<string, AlignmentSequence> = {};
    sequenceRequests.forEach((request, index) => {
      const detail = sequenceQueries[index];
      if (detail?.status === 'ready') details[request.key] = detail.value;
    });
    return details;
  }, [sequenceQueries, sequenceRequests]);
  const lanes = useMemo(
    () =>
      sequences === null || catalog === null
        ? null
        : boardLanes(sequences, report, chosenByPhase, catalog, breakdown, sequenceDetails),
    [sequences, report, chosenByPhase, catalog, breakdown, sequenceDetails],
  );
  const joins = useMemo(() => (lanes === null ? [] : boardJoins(lanes)), [lanes]);
  const highlight = useMemo(
    () => (lanes === null ? null : boardHighlight(lanes, joins, selected)),
    [lanes, joins, selected],
  );
  const isActive = useMemo(
    () => (lanes === null ? () => false : joinIsActive(lanes, selected)),
    [lanes, selected],
  );

  const gutterRef = useRef<HTMLDivElement | null>(null);
  const measuredColumnRef = useRef<HTMLDivElement | null>(null);
  const modelledColumnRef = useRef<HTMLDivElement | null>(null);
  const cardNodes = useRef(new Map<string, HTMLElement>());
  const [geometry, setGeometry] = useState<BoardGeometry>(EMPTY_GEOMETRY);

  const registerCard = useCallback((id: string, node: HTMLElement | null) => {
    if (node === null) cardNodes.current.delete(id);
    else cardNodes.current.set(id, node);
  }, []);

  const measure = useCallback(() => {
    const gutter = gutterRef.current;
    if (gutter === null || lanes === null) return;
    const origin = gutter.getBoundingClientRect().top;
    const centerOf = (id: string): number | undefined => {
      const node = cardNodes.current.get(id);
      if (node === undefined) return undefined;
      const box = node.getBoundingClientRect();
      return box.top + box.height / 2 - origin;
    };
    const next: BoardGeometry = {
      measuredCenterY: lanes.measured.map((card) => centerOf(card.id)),
      modelledCenterY: lanes.modelled.map((card) => centerOf(card.id)),
      height: Math.max(
        measuredColumnRef.current?.offsetHeight ?? 0,
        modelledColumnRef.current?.offsetHeight ?? 0,
      ),
    };
    setGeometry((previous) => (sameGeometry(previous, next) ? previous : next));
  }, [lanes]);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (measuredColumnRef.current !== null) observer.observe(measuredColumnRef.current);
    if (modelledColumnRef.current !== null) observer.observe(modelledColumnRef.current);
    return () => observer.disconnect();
  }, [measure]);

  const modelledRowGaps = useMemo(
    () =>
      lanes === null
        ? []
        : computeModelledRowGaps(joins, geometry.measuredCenterY, lanes.modelled.length, {
            cardHeight: CARD_HEIGHT,
            cardGap: CARD_GAP,
            groupHeaderHeight: GROUP_HEADER_HEIGHT,
          }),
    [geometry.measuredCenterY, joins, lanes],
  );

  const coverage = boardCoverage(report);

  // Card ids describe positions inside the current example. Retaining them
  // across an iteration change would silently select a different card that
  // happened to reuse m0/s0.
  useEffect(() => setSelected(NO_SELECTION), [selectedIterationId]);

  if (sequences === null || catalog === null || lanes === null || phase === null) {
    return (
      <SurfaceCard sx={{ p: '14px 16px' }}>
        <Typography sx={{ color: tokens.sub, fontFamily: tokens.body, fontSize: 12 }}>
          This capture carries no labelled kernel programs.
        </Typography>
      </SurfaceCard>
    );
  }

  const editedSequence = catalog.all.find((entry) => entry.key === chosenByPhase[phase]);
  const pickCard = (id: string, additive: boolean) =>
    setSelected((current) => nextSelection(current, id, additive));
  const selectedMeasured = lanes.measured.filter((card) => selected.has(card.id));
  const selectedModelled = lanes.modelled.filter((card) => selected.has(card.id));
  const predictionLabel =
    breakdown !== null && breakdown.iterationId === selectedIterationId
      ? `REAL EXAMPLE ITERATION · iteration ${breakdown.iterationId} · timing-predict unit_ms`
      : selectedIterationId !== null
        ? 'REAL EXAMPLE ITERATION · loading selected iteration'
        : 'REAL EXAMPLE ITERATION · no iteration selected';

  return (
    <SurfaceCard>
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.75,
          flexWrap: 'wrap',
          p: '12px 16px 11px',
          borderBottom: `1px solid ${tokens.hair}`,
        }}
      >
        <Typography
          component="h3"
          sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 15.5, m: 0 }}
        >
          Measured kernels against modelled slots
        </Typography>
        <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
          {fmtInt(lanes.measured.length)} measured kernels over {fmtInt(catalog.phaseOrder.length)}{' '}
          phases · {fmtInt(lanes.modelled.length)} modelled slots ·{' '}
          <Box component="span" sx={{ color: tokens.terra, fontWeight: 700 }}>
            {predictionLabel}
          </Box>{' '}
          · editing {phase} / {editedSequence?.sequenceId ?? ''}
        </Typography>
      </Stack>

      <Stack sx={{ gap: 0.9, p: '9px 14px', borderBottom: `1px solid ${tokens.hair}` }}>
        <ChipRow
          note={
            <>
              measured <Strong>{fmtPct(coverage.measuredDurationPct)}</Strong> of kernel time joined
              · modelled <Strong>{fmtPct(coverage.simulatedWorkloadPct)}</Strong> of workload
              claimed
            </>
          }
        >
          {catalog.phaseOrder.map((name) => (
            <Chip
              key={name}
              pressed={name === phase}
              label={name}
              aside={`capture ${fmtMs(catalog.phaseMs[name] ?? 0)}`}
              onPick={() => {
                setEditedPhase(name);
                setSelected(NO_SELECTION);
              }}
            />
          ))}
        </ChipRow>
        <ChipRow
          note={
            <>
              {fmtInt(catalog.omittedSequences)} further sequences ({fmtMs(catalog.omittedMs)}) not
              offered here
            </>
          }
        >
          {sequenceOptionsForPhase(catalog, phase, chosenByPhase[phase]).map((entry) => (
            <Chip
              key={entry.key}
              pressed={entry.key === chosenByPhase[phase]}
              label={entry.shortId}
              aside={`×${fmtInt(entry.iterations)}`}
              title={`${entry.sequenceId} · ${fmtMs(entry.runMs)} over ${fmtInt(entry.iterations)} occurrences`}
              onPick={() => {
                if (entry.representativeIterationId !== null) {
                  onSelectIteration(entry.representativeIterationId);
                }
                setSelected(NO_SELECTION);
              }}
            />
          ))}
        </ChipRow>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            md: `minmax(0, 1.2fr) ${GUTTER_WIDTH}px minmax(0, 1fr)`,
          },
          alignItems: 'start',
          p: '12px 14px 6px',
        }}
        onClick={(event) => {
          // Cards own their selection click. Any other point in this board —
          // the gutter, a spacer, or the empty side of a row — is a clear
          // action, so a reader never has to hunt for the small clear button.
          const target = event.target;
          if (target instanceof HTMLElement && target.closest('button') !== null) return;
          setSelected(NO_SELECTION);
        }}
      >
        <Lane columnRef={measuredColumnRef} groups={lanes.measuredGroups}>
          {(group) =>
            lanes.measured
              .slice(group.from, group.to)
              .map((card) => (
                <BoardRow
                  key={card.id}
                  id={card.id}
                  name={card.name}
                  detail={card.operationLabel}
                  ms={card.ms}
                  timingNote={card.timingNote}
                  repeat={card.repeat}
                  loose={!card.mapped}
                  color={card.color}
                  maximumMs={lanes.maximumMs}
                  selected={selected.has(card.id)}
                  joined={highlight?.joined.has(card.id) === true}
                  dimmed={highlight?.hasSelection === true}
                  onRegister={registerCard}
                  onPick={pickCard}
                />
              ))
          }
        </Lane>

        <Box
          ref={gutterRef}
          sx={{ display: { xs: 'none', md: 'block' }, alignSelf: 'stretch', position: 'relative' }}
        >
          <MappingBoardRibbons
            joins={joins}
            endpoints={geometry}
            height={geometry.height}
            isActive={isActive}
            label={`${fmtInt(joins.length)} joins declared by the label file`}
          />
        </Box>

        <Lane columnRef={modelledColumnRef} groups={lanes.modelledGroups}>
          {(group) =>
            lanes.modelled.slice(group.from, group.to).map((card, groupIndex) => {
              const modelledIndex = group.from + groupIndex;
              return (
                <Box key={card.id} sx={{ mt: `${modelledRowGaps[modelledIndex] ?? 0}px` }}>
                  <BoardRow
                    id={card.id}
                    name={card.slot}
                    detail={card.operationLabel}
                    ms={card.ms}
                    timingNote={card.timingNote}
                    repeat={card.repeat}
                    loose={!card.claimed}
                    color={card.color}
                    maximumMs={lanes.maximumMs}
                    selected={selected.has(card.id)}
                    joined={highlight?.joined.has(card.id) === true}
                    dimmed={highlight?.hasSelection === true}
                    onRegister={registerCard}
                    onPick={pickCard}
                  />
                </Box>
              );
            })
          }
        </Lane>
      </Box>

      <Stack
        direction="row"
        sx={{
          alignItems: 'flex-start',
          gap: 1.75,
          flexWrap: 'wrap',
          p: '11px 14px 12px',
          borderTop: `1px solid ${tokens.hair}`,
        }}
      >
        <Typography
          sx={{
            flex: '1 1 340px',
            fontFamily: tokens.body,
            fontSize: 12,
            color: tokens.sub,
            lineHeight: 1.75,
          }}
        >
          {selected.size === 0 ? (
            <>
              <Strong>click</Strong> a card to select it · <Strong>ctrl-click</Strong> to add
              another, on either side · a card with no ribbon is on one side and not the other,
              which is what the coverage figures above count
            </>
          ) : (
            <>
              <Strong>{fmtInt(selectedMeasured.length)}</Strong> measured ·{' '}
              <Strong>{fmtInt(selectedModelled.length)}</Strong> modelled selected
              {[
                ...selectedMeasured.map((card) => card.name),
                ...selectedModelled.map((card) => card.slot),
              ].map((name) => (
                <Box key={name} component="span" sx={{ display: 'block' }}>
                  {name}
                </Box>
              ))}
            </>
          )}
        </Typography>
        <Box
          component="button"
          type="button"
          aria-label="clear selection"
          onClick={() => setSelected(NO_SELECTION)}
          sx={{
            appearance: 'none',
            fontFamily: tokens.body,
            fontSize: 12,
            padding: '6px 10px',
            borderRadius: '7px',
            cursor: 'pointer',
            border: `1px solid ${tokens.hair}`,
            background: tokens.tile,
            color: tokens.sub,
            transition: `all .24s ${tokens.ease}`,
            '&:hover': { borderColor: tokens.teal, color: tokens.teal },
            '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: '2px' },
          }}
        >
          clear selection
        </Box>
      </Stack>
    </SurfaceCard>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return (
    <Box component="b" sx={{ color: tokens.ink, fontWeight: 600 }}>
      {children}
    </Box>
  );
}

function ChipRow({ note, children }: { note: React.ReactNode; children: React.ReactNode }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
      <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
        {children}
      </Stack>
      <Typography sx={{ ml: 'auto', fontFamily: tokens.body, fontSize: 12, color: tokens.sub2 }}>
        {note}
      </Typography>
    </Stack>
  );
}

function Chip({
  label,
  aside,
  title,
  pressed,
  onPick,
}: {
  label: string;
  /** The quantity that qualifies the chip, muted so the name stays the thing
   * being chosen. */
  aside?: string;
  title?: string;
  pressed: boolean;
  onPick: () => void;
}) {
  const chip = (
    <Box
      component="button"
      type="button"
      aria-pressed={pressed}
      onClick={onPick}
      sx={{
        appearance: 'none',
        cursor: 'pointer',
        fontFamily: tokens.body,
        fontSize: 12,
        padding: '4px 10px',
        borderRadius: '6px',
        whiteSpace: 'nowrap',
        transition: `all .25s ${tokens.ease}`,
        border: `1px solid ${pressed ? tokens.teal : tokens.hair}`,
        color: pressed ? tokens.teal : tokens.sub,
        background: pressed ? tokens.tile2 : 'transparent',
        '&:hover': { borderColor: tokens.sub2, color: tokens.ink },
        '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: '2px' },
      }}
    >
      {label}
      {aside === undefined ? null : (
        <Box component="span" sx={{ opacity: 0.6, ml: 0.6 }}>
          {aside}
        </Box>
      )}
    </Box>
  );
  return title === undefined ? chip : <Tooltip title={title}>{chip}</Tooltip>;
}

/** One column: a heading per group, then that group's cards. */
function Lane({
  columnRef,
  groups,
  children,
}: {
  columnRef: React.MutableRefObject<HTMLDivElement | null>;
  groups: readonly BoardGroup[];
  children: (group: BoardGroup) => React.ReactNode;
}) {
  return (
    <Stack ref={columnRef} sx={{ gap: `${CARD_GAP}px`, minWidth: 0 }}>
      {groups.map((group) => (
        <Stack key={group.label} sx={{ gap: `${CARD_GAP}px`, minWidth: 0 }}>
          <Stack
            direction="row"
            sx={{
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              height: `${GROUP_HEADER_HEIGHT}px`,
              borderBottom: `1px solid ${tokens.hair}`,
            }}
          >
            <Typography
              sx={{
                fontFamily: tokens.body,
                fontSize: 12,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color: tokens.sub,
              }}
            >
              {group.label}
            </Typography>
            <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub2 }}>
              {group.note}
            </Typography>
          </Stack>
          {children(group)}
        </Stack>
      ))}
    </Stack>
  );
}

/** One card of either lane. Both sides carry the same five columns because
 * they are the same five questions, and reading one against the other is the
 * whole point of the board. */
function BoardRow({
  id,
  name,
  detail,
  ms,
  timingNote,
  repeat,
  loose,
  color,
  maximumMs,
  selected,
  joined,
  dimmed,
  onRegister,
  onPick,
}: {
  id: string;
  name: string;
  detail: string;
  ms: number | null;
  timingNote: string;
  repeat: number | null;
  loose: boolean;
  color: string;
  maximumMs: number;
  selected: boolean;
  joined: boolean;
  dimmed: boolean;
  onRegister: (id: string, node: HTMLElement | null) => void;
  onPick: (id: string, additive: boolean) => void;
}) {
  const lit = selected || joined;
  return (
    <Tooltip title={`${name} · ${timingNote}`} placement="top">
      <Box
        component="button"
        type="button"
        ref={(node: HTMLElement | null) => onRegister(id, node)}
        aria-pressed={selected}
        aria-label={`${name}, ${detail}`}
        onClick={(event: React.MouseEvent) =>
          onPick(id, event.ctrlKey || event.metaKey || event.shiftKey)
        }
        sx={{
          position: 'relative',
          appearance: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '9px minmax(0, 1fr) auto 52px 24px',
          alignItems: 'center',
          gap: 1,
          height: `${CARD_HEIGHT}px`,
          padding: '0 8px',
          borderRadius: '6px',
          border: `1px ${loose ? 'dashed' : 'solid'} ${loose ? tokens.terra : selected ? tokens.ink : tokens.hair}`,
          boxShadow: selected ? `inset 0 0 0 1px ${tokens.ink}` : 'none',
          background: loose ? tokens.tile2 : tokens.leafbg,
          fontFamily: tokens.body,
          fontSize: 12,
          color: tokens.ink,
          overflow: 'hidden',
          opacity: dimmed && !lit ? 0.45 : 1,
          transition: `opacity .2s ${tokens.ease}`,
          '&:hover': { borderColor: tokens.sub2 },
          '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: '1px' },
        }}
      >
        <Box
          aria-hidden="true"
          sx={{
            width: 9,
            height: 9,
            borderRadius: '2px',
            background: loose ? 'transparent' : color,
            border: loose ? `1px dashed ${tokens.terra}` : 'none',
          }}
        />
        <Box
          component="span"
          sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {name}
        </Box>
        <Box
          component="span"
          sx={{
            fontSize: 12,
            color: loose ? tokens.terra : tokens.sub,
            whiteSpace: 'nowrap',
            maxWidth: 190,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {detail}
        </Box>
        <Box
          component="span"
          sx={{
            fontSize: 12,
            color: tokens.sub,
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {ms === null ? '—' : fmtMs(ms)}
        </Box>
        <Box component="span" sx={{ fontSize: 12, color: tokens.sub2, textAlign: 'right' }}>
          {repeat !== null && repeat > 1 ? `×${fmtInt(repeat)}` : ''}
        </Box>
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            height: 2,
            width: `${barWidthPct(ms, maximumMs)}%`,
            background: loose ? tokens.terra : color,
            opacity: loose ? 0.35 : 0.55,
          }}
        />
      </Box>
    </Tooltip>
  );
}
