import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useMemo, useState, type ReactNode } from 'react';

import type { ExecutionMode, Workspace, WorkspaceKind } from '../../session/types';
import { tokens, withAlpha } from '../../ui/theme';
import { conversationTimeLabel } from '../../ui/format';

/**
 * What the reader picked: an existing workspace, or a kind to create.
 *
 * A union rather than the old `string | null`, because "create" is no longer
 * one thing. A null id could say *that* a workspace should be made but not
 * which sort, and the two sorts differ in where the agent's turns run.
 */
export type WorkspaceChoice = { existing: string } | { create: 'copy' | 'worktree' };

function isCreate(choice: WorkspaceChoice | null, kind: 'copy' | 'worktree'): boolean {
  return choice !== null && 'create' in choice && choice.create === kind;
}

/**
 * The two creatable kinds, in the order they are offered.
 *
 * The copy comes first and is marked recommended: it is what a reader who has
 * not thought about execution modes should get. Each card states what the
 * kind buys and what it costs as separate lines, because the trade is the
 * whole decision — a real branch on this machine, and no sandbox around the
 * agent.
 */
const CREATABLE = [
  {
    kind: 'copy',
    title: 'Sandboxed copy',
    detail: 'A container with a copy of the code. Safe to experiment in.',
    where: 'Runs in a container',
    gains: 'Isolated from your checkout',
    costs: 'No kernel profiling or Slurm jobs',
    recommended: true,
  },
  {
    kind: 'worktree',
    title: 'Git worktree',
    detail: 'A new branch checked out on this machine, beside your own.',
    where: 'Runs on this machine',
    gains: 'Kernel profiling and Slurm work',
    costs: 'The agent is not sandboxed',
    recommended: false,
  },
] as const satisfies readonly {
  kind: 'copy' | 'worktree';
  title: string;
  detail: string;
  where: string;
  gains: string;
  costs: string;
  recommended: boolean;
}[];

/** A container workspace is the safe default; a host one is worth a second look. */
function executionColor(execution: ExecutionMode): string {
  return execution === 'host' ? tokens.gold : tokens.teal;
}

export default function WorkspacePicker({
  workspaces,
  kinds,
  selection,
  onSelect,
}: {
  workspaces: readonly Workspace[];
  /**
   * What this backend can create, or null when it does not say.
   *
   * Three states, and they need three treatments. Null is a backend from
   * before the axis: offer only the copy, exactly as this page used to. A list
   * without `worktree` is a backend that has the axis switched off, and that
   * one is worth showing as refused rather than hidden — otherwise a reader
   * who was told the feature exists finds nothing to click and no reason why.
   */
  kinds: readonly WorkspaceKind[] | null;
  selection: WorkspaceChoice | null;
  onSelect: (choice: WorkspaceChoice) => void;
}) {
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...workspaces]
      .filter(
        (workspace) =>
          !query ||
          workspace.label.toLocaleLowerCase().includes(query) ||
          workspace.id.toLocaleLowerCase().includes(query),
      )
      .sort(
        (left, right) =>
          right.lastAccessedAt - left.lastAccessedAt || left.label.localeCompare(right.label),
      );
  }, [search, workspaces]);
  const offered = kinds === null ? CREATABLE.slice(0, 1) : CREATABLE;
  return (
    <Box sx={{ width: '100%' }}>
      <SectionHeading>Start in a new workspace</SectionHeading>
      <Box
        role="listbox"
        aria-label="New workspace"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 1.25,
        }}
      >
        {offered.map((option) => {
          const enabled = kinds === null || kinds.includes(option.kind);
          const selected = isCreate(selection, option.kind);
          const accent = option.kind === 'worktree' ? tokens.gold : tokens.teal;
          return (
            <ButtonBase
              key={option.kind}
              role="option"
              aria-label={`Create a ${option.title.toLocaleLowerCase()}`}
              aria-selected={selected}
              aria-disabled={!enabled}
              disabled={!enabled}
              onClick={() => onSelect({ create: option.kind })}
              sx={{
                position: 'relative',
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                p: 2,
                textAlign: 'left',
                border: `1px solid ${selected ? tokens.teal : tokens.hair}`,
                borderRadius: '10px',
                background: selected ? withAlpha(tokens.teal, 0.07) : 'transparent',
                opacity: enabled ? 1 : 0.5,
                transition: `border-color 170ms ${tokens.ease}, background-color 170ms ${tokens.ease}`,
                '&:hover': { borderColor: selected ? tokens.teal : tokens.sub2 },
                '&:active': { transform: 'translateY(1px)' },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 2 },
              }}
            >
              <Box sx={{ position: 'absolute', top: 18, right: 16 }}>
                <SelectionMark selected={selected} />
              </Box>
              <Stack
                direction="row"
                alignItems="baseline"
                flexWrap="wrap"
                columnGap={1}
                sx={{ pr: 3.5 }}
              >
                <Typography sx={{ color: tokens.ink, fontSize: 15, fontWeight: 600 }}>
                  {option.title}
                </Typography>
                {option.recommended && (
                  <Typography sx={{ color: tokens.teal, fontSize: 12, fontWeight: 500 }}>
                    Recommended
                  </Typography>
                )}
              </Stack>
              <Typography sx={{ mt: 0.6, color: tokens.sub, fontSize: 13, lineHeight: 1.55 }}>
                {enabled ? option.detail : 'This server does not offer worktree workspaces.'}
              </Typography>
              <Box
                sx={{
                  mt: 1.6,
                  pt: 1.3,
                  borderTop: `1px solid ${tokens.hair}`,
                  display: 'grid',
                  gap: 0.55,
                }}
              >
                <Fact color={accent} dot>
                  {option.where}
                </Fact>
                <Fact color={tokens.sub} icon={<CheckRounded sx={{ fontSize: 14 }} />}>
                  {option.gains}
                </Fact>
                <Fact
                  color={option.kind === 'worktree' ? tokens.gold : tokens.sub2}
                  icon={
                    option.kind === 'worktree' ? (
                      <WarningAmberRounded sx={{ fontSize: 14 }} />
                    ) : (
                      <CloseRounded sx={{ fontSize: 14 }} />
                    )
                  }
                >
                  {option.costs}
                </Fact>
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
      {workspaces.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            justifyContent="space-between"
            gap={1}
            sx={{ mb: 1 }}
          >
            <SectionHeading flush>
              Or continue in an existing one
              <Box component="span" sx={{ ml: 1, color: tokens.sub2, fontWeight: 400 }}>
                {workspaces.length}
              </Box>
            </SectionHeading>
            <Stack
              direction="row"
              alignItems="center"
              sx={{
                width: { xs: '100%', sm: 260 },
                px: 1,
                height: 32,
                border: `1px solid ${tokens.hair}`,
                borderRadius: '7px',
                transition: `border-color 170ms ${tokens.ease}`,
                '&:focus-within': { borderColor: tokens.teal },
              }}
            >
              <SearchRounded aria-hidden sx={{ mr: 0.75, color: tokens.sub2, fontSize: 16 }} />
              <Box
                component="input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search workspaces"
                placeholder="Search by name"
                sx={{
                  width: '100%',
                  border: 0,
                  outline: 0,
                  background: 'transparent',
                  color: tokens.ink,
                  fontFamily: tokens.body,
                  fontSize: 13,
                  '&::placeholder': { color: tokens.sub2 },
                }}
              />
            </Stack>
          </Stack>
          <Box
            role="listbox"
            aria-label="Existing workspaces"
            sx={{
              maxHeight: 290,
              overflowY: 'auto',
              border: `1px solid ${tokens.hair}`,
              borderRadius: '10px',
            }}
          >
            {visible.map((workspace, index) => {
              const selected =
                selection !== null &&
                'existing' in selection &&
                selection.existing === workspace.id;
              return (
                <ButtonBase
                  key={workspace.id}
                  role="option"
                  aria-label={`Select ${workspace.label}`}
                  aria-selected={selected}
                  onClick={() => onSelect({ existing: workspace.id })}
                  sx={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: 'minmax(0,1fr) auto',
                      sm: 'minmax(0,1fr) auto auto',
                    },
                    alignItems: 'center',
                    columnGap: 1.75,
                    px: 1.75,
                    py: 1.15,
                    textAlign: 'left',
                    borderTop: index === 0 ? 0 : `1px solid ${tokens.hair}`,
                    background: selected ? withAlpha(tokens.teal, 0.07) : 'transparent',
                    boxShadow: selected ? `inset 2px 0 0 ${tokens.teal}` : 'none',
                    transition: `background-color 170ms ${tokens.ease}`,
                    '&:hover': {
                      background: withAlpha(tokens.teal, selected ? 0.07 : 0.035),
                    },
                    '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: -2 },
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      noWrap
                      sx={{
                        color: selected ? tokens.teal : tokens.ink,
                        fontSize: 14,
                        fontWeight: 500,
                      }}
                    >
                      {workspace.label}
                    </Typography>
                    {/* Where a workspace runs is load-bearing rather than
                        decoration: a host workspace has no sandbox around the
                        agent. The dot carries it at a glance, the words for
                        anyone who does not read colour. */}
                    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.25 }}>
                      <Dot color={executionColor(workspace.execution)} />
                      <Typography noWrap sx={{ color: tokens.sub2, fontSize: 12 }}>
                        {[workspace.kind, workspace.execution, workspace.branch]
                          .filter(Boolean)
                          .join(' · ')}
                      </Typography>
                    </Stack>
                  </Box>
                  <Typography
                    sx={{
                      color: tokens.sub2,
                      fontSize: 12,
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {conversationTimeLabel(workspace.lastAccessedAt)}
                  </Typography>
                  {/* Below `sm` the name needs the width more; the tint and the
                      coloured name still mark the choice. */}
                  <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
                    <SelectionMark selected={selected} />
                  </Box>
                </ButtonBase>
              );
            })}
            {visible.length === 0 && (
              <Typography role="status" sx={{ px: 1.75, py: 2, color: tokens.sub2, fontSize: 13 }}>
                No workspace matches this search.
              </Typography>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function SectionHeading({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  return (
    <Typography
      component="h3"
      sx={{ mb: flush ? 0 : 1, color: tokens.ink, fontSize: 13, fontWeight: 600 }}
    >
      {children}
    </Typography>
  );
}

/** A radio-style ring, filled when chosen: the selection reads without colour. */
function SelectionMark({ selected }: { selected: boolean }) {
  return (
    <Box
      aria-hidden
      sx={{
        flex: 'none',
        width: 16,
        height: 16,
        borderRadius: '50%',
        border: `1.5px solid ${selected ? tokens.teal : tokens.sub2}`,
        display: 'grid',
        placeItems: 'center',
        transition: `border-color 170ms ${tokens.ease}`,
        '&::after': {
          content: '""',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: tokens.teal,
          transform: selected ? 'scale(1)' : 'scale(0)',
          transition: `transform 170ms ${tokens.ease}`,
        },
      }}
    />
  );
}

function Dot({ color }: { color: string }) {
  return (
    <Box
      aria-hidden
      sx={{ flex: 'none', width: 6, height: 6, borderRadius: '50%', background: color }}
    />
  );
}

function Fact({
  color,
  icon,
  dot = false,
  children,
}: {
  color: string;
  icon?: ReactNode;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.9} sx={{ color }}>
      <Box sx={{ width: 14, display: 'grid', placeItems: 'center', flex: 'none' }}>
        {dot ? <Dot color={color} /> : icon}
      </Box>
      <Typography
        sx={{ color: dot ? tokens.ink : 'inherit', fontSize: 12.5, fontWeight: dot ? 500 : 400 }}
      >
        {children}
      </Typography>
    </Stack>
  );
}
