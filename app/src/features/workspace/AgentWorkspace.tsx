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
import { type FormEvent, type ReactNode, useState } from 'react';

import { analyzerSelectionFromVizState } from '../../application/analyzerSelection';
import type { AnalyzerSelectionV1 } from '../../domain/analyzerSelection';
import { useViz } from '../../store';
import { tokens } from '../../theme';

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

function EvidenceLink({ onActivate }: { onActivate: () => void }) {
  return (
    <ButtonBase
      onClick={onActivate}
      sx={{
        mt: 1.1,
        px: 0.15,
        pb: 0.15,
        borderBottom: `1px solid ${tokens.teal}`,
        color: tokens.teal,
        fontFamily: tokens.body,
        fontSize: 11.5,
        fontWeight: 650,
        '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 2 },
      }}
    >
      Open Total throughput evidence
    </ButtonBase>
  );
}

export function AgentConversation({
  prompt,
  onEvidence,
}: {
  prompt: string;
  onEvidence: () => void;
}) {
  return (
    <Stack sx={{ gap: 1.1 }}>
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
        }}
      >
        {prompt}
      </Box>
      <RoleCard
        tone="orchestrator"
        icon={<HubOutlined sx={{ fontSize: 15 }} />}
        title="Orchestrator"
        round={1}
        status="done"
      >
        <Note>
          Read the active experiment and identify the smallest comparison that answers the question.
        </Note>
      </RoleCard>
      <Handoff from="Orchestrator" to="Implementer">
        Compare the available request-rate and tensor-parallel coordinates. Check throughput first,
        then verify TTFT and TPOT.
      </Handoff>
      <RoleCard
        tone="implementer"
        icon={<BuildOutlined sx={{ fontSize: 15 }} />}
        title="Implementer"
        round={1}
        status="done"
      >
        <Note>
          Queried the aggregate metric panels and checked the selected coordinates against latency.
        </Note>
      </RoleCard>
      <Handoff from="Implementer" to="Orchestrator">
        The aggregate evidence is ready. The throughput panel is the clearest starting point.
      </Handoff>
      <RoleCard
        tone="answer"
        icon={<CheckCircleOutlineRounded sx={{ fontSize: 15 }} />}
        title="Answer"
        status="ready"
      >
        <Note>
          Start with throughput, then use TTFT and TPOT to verify that the faster configuration does
          not trade away request latency.
        </Note>
        <EvidenceLink onActivate={onEvidence} />
      </RoleCard>
    </Stack>
  );
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
      </Stack>
    </Box>
  );
}

export default function AgentPane({
  prompt,
  onClose,
  onFold,
  onToggleFull,
  onEvidence,
  full = false,
  expanded = false,
  showSelectionContext = false,
}: {
  prompt: string;
  onClose?: () => void;
  onFold?: () => void;
  onToggleFull?: () => void;
  onEvidence: () => void;
  full?: boolean;
  expanded?: boolean;
  showSelectionContext?: boolean;
}) {
  const [input, setInput] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setInput('');
  };
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
        <AgentConversation prompt={prompt} onEvidence={onEvidence} />
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
            disabled={!input.trim()}
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
