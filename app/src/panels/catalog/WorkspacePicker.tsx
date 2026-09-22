import SearchRounded from '@mui/icons-material/SearchRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useMemo, useState } from 'react';

import type { ExecutionMode, Workspace, WorkspaceKind } from '../../session/types';
import { tokens, withAlpha } from '../../ui/theme';
import CatalogTag from '../../ui/CatalogTag';
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
 * not thought about execution modes should get. The worktree's sub-line says
 * what it buys and what it costs in the same sentence, because the trade is
 * the whole decision — a real branch on this machine, and no sandbox around
 * the agent.
 */
const CREATABLE = [
  {
    kind: 'copy',
    title: 'Sandboxed copy',
    detail:
      'A container with a copy of the code. Safe to experiment; no kernel profiling or Slurm jobs.',
    execution: 'container',
    note: 'recommended',
  },
  {
    kind: 'worktree',
    title: 'Git worktree',
    detail:
      'A real branch on this machine. Kernel profiling and Slurm work; the agent is not sandboxed.',
    execution: 'host',
    note: '',
  },
] as const satisfies readonly {
  kind: 'copy' | 'worktree';
  title: string;
  detail: string;
  execution: ExecutionMode;
  note: string;
}[];

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
  const columns = { xs: 'minmax(0,1fr) auto', md: 'minmax(0,1fr) 120px 82px' };
  const row = (selected: boolean, enabled = true) => ({
    width: '100%',
    minHeight: 43,
    px: 1.35,
    display: 'grid',
    gridTemplateColumns: columns,
    alignItems: 'center',
    gap: 1.2,
    borderBottom: `1px solid ${tokens.hair}`,
    background: selected ? withAlpha(tokens.teal, 0.065) : 'transparent',
    textAlign: 'left',
    opacity: enabled ? 1 : 0.55,
    '&:hover': { background: withAlpha(tokens.teal, enabled ? 0.045 : 0) },
    '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: -2 },
  });
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <Stack direction="row" alignItems="end" justifyContent="space-between" sx={{ mb: 0.8 }}>
        <Box>
          <Typography
            sx={{
              color: tokens.sub2,
              fontFamily: tokens.body,
              fontSize: 12,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
            }}
          >
            Workspace for this conversation
          </Typography>
          <Typography sx={{ mt: 0.25, color: tokens.sub, fontSize: 12 }}>
            Reuse its files and logs, or begin in a clean workspace.
          </Typography>
        </Box>
        <Typography sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}>
          {visible.length}/{workspaces.length}
        </Typography>
      </Stack>
      <Stack
        direction="row"
        alignItems="center"
        sx={{
          px: 1.1,
          borderTop: `1.5px solid ${tokens.ink}`,
          borderBottom: `1px solid ${tokens.hair}`,
          background: withAlpha(tokens.tile, 0.45),
        }}
      >
        <SearchRounded aria-hidden sx={{ mr: 0.8, color: tokens.sub2, fontSize: 15 }} />
        <Box
          component="input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search workspaces"
          placeholder="Find a workspace by name"
          sx={{
            width: '100%',
            height: 38,
            border: 0,
            outline: 0,
            background: 'transparent',
            color: tokens.ink,
            fontSize: 12,
            '&::placeholder': { color: tokens.sub2 },
          }}
        />
      </Stack>
      <Box
        role="listbox"
        aria-label="Workspace for new conversation"
        sx={{
          maxHeight: 184,
          overflowY: 'auto',
          borderBottom: `1px solid ${tokens.hair}`,
          scrollbarWidth: 'thin',
          scrollbarColor: `${tokens.hair} transparent`,
        }}
      >
        {!search.trim() &&
          offered.map((option) => {
            const enabled = kinds === null || kinds.includes(option.kind);
            const selected = isCreate(selection, option.kind);
            return (
              <ButtonBase
                key={option.kind}
                role="option"
                aria-label={`Create a ${option.title.toLocaleLowerCase()}`}
                aria-selected={selected}
                aria-disabled={!enabled}
                disabled={!enabled}
                onClick={() => onSelect({ create: option.kind })}
                sx={row(selected, enabled)}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ color: tokens.ink, fontSize: 12, fontWeight: 650 }}>
                    {option.title}
                  </Typography>
                  <Typography sx={{ color: tokens.sub2, fontSize: 12 }}>
                    {enabled ? option.detail : 'This server does not offer worktree workspaces.'}
                  </Typography>
                </Box>
                <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                  <CatalogTag tone="axis" selected={selected}>
                    {option.execution}
                  </CatalogTag>
                </Box>
                <Typography
                  sx={{
                    color: tokens.sub2,
                    fontFamily: tokens.body,
                    fontSize: 12,
                    textAlign: 'right',
                  }}
                >
                  {enabled ? option.note : 'unavailable'}
                </Typography>
              </ButtonBase>
            );
          })}
        {visible.map((workspace) => {
          const selected =
            selection !== null && 'existing' in selection && selection.existing === workspace.id;
          return (
            <ButtonBase
              key={workspace.id}
              role="option"
              aria-label={`Select ${workspace.label}`}
              aria-selected={selected}
              onClick={() => onSelect({ existing: workspace.id })}
              sx={{
                ...row(selected),
                color: selected ? tokens.teal : tokens.sub,
                '&:hover': { background: withAlpha(tokens.teal, 0.045), color: tokens.ink },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: -2 },
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ color: 'inherit', fontSize: 12, fontWeight: 620 }}>
                  {workspace.label}
                </Typography>
                {/* The tag column disappears below `md`, and where a workspace
                    runs is now load-bearing rather than decoration: a host
                    workspace has no sandbox around the agent. So the same fact
                    is repeated in the sub-line, which is always visible. */}
                <Typography noWrap sx={{ color: tokens.sub2, fontSize: 12 }}>
                  {workspace.kind} · {workspace.execution}
                </Typography>
              </Box>
              <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                <CatalogTag tone="workspace" selected={selected}>
                  {workspace.execution}
                </CatalogTag>
              </Box>
              <Typography
                sx={{
                  color: tokens.sub2,
                  fontFamily: tokens.body,
                  fontSize: 12,
                  textAlign: 'right',
                }}
              >
                {conversationTimeLabel(workspace.lastAccessedAt)}
              </Typography>
            </ButtonBase>
          );
        })}
        {visible.length === 0 && (
          <Typography role="status" sx={{ px: 1.35, py: 2, color: tokens.sub2, fontSize: 12 }}>
            No workspace matches this search.
          </Typography>
        )}
      </Box>
    </Box>
  );
}
