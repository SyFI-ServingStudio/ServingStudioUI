import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DataObjectRounded from '@mui/icons-material/DataObjectRounded';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import WrapTextRounded from '@mui/icons-material/WrapTextRounded';
import { Box, ButtonBase, Skeleton, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  fileContentUrl,
  getFileMeta,
  getFileText,
  listDirectory,
  WorkspaceFileError,
  type WorkspaceDirectoryEntry,
  type WorkspaceFileMeta,
  type WorkspaceFileText,
} from '../../application/workspaceFileRepository';
import {
  fileName,
  filePreviewHash,
  pathAncestors,
  type WorkspaceFileRef,
} from '../../domain/workspaceFile';
import MarkdownBody from '../../components/MarkdownBody';
import SurfaceCard from '../../components/SurfaceCard';
import { tokens } from '../../theme';
import CodeView from './CodeView';
import JsonView from './JsonView';
import TableView from './TableView';
import { ansiLines, hasAnsi, stripAnsi } from './ansi';
import { MAX_HIGHLIGHT_LINES, canHighlight, highlightLines } from './highlight';
import { matchingLines, stepMatch } from './search';

function byteLabel(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} kB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ActionButton({
  label,
  icon,
  onClick,
  href,
  active = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  href?: string;
  active?: boolean;
}) {
  return (
    <ButtonBase
      {...(href ? { component: 'a', href, target: '_blank', rel: 'noopener noreferrer' } : {})}
      onClick={onClick}
      aria-label={label}
      aria-pressed={onClick && active ? true : undefined}
      sx={{
        minHeight: 28,
        px: 0.9,
        gap: 0.45,
        flex: '0 0 auto',
        border: `1px solid ${active ? tokens.teal : tokens.hair}`,
        borderRadius: 0.8,
        color: active ? tokens.teal : tokens.sub,
        background: active ? 'rgba(31,111,107,.07)' : tokens.tile,
        fontFamily: tokens.mono,
        fontSize: 9.5,
        '&:hover': { borderColor: tokens.sub2, color: tokens.ink },
        '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
      }}
    >
      {icon}
      {label}
    </ButtonBase>
  );
}

function Breadcrumbs({ workspaceId, path }: { workspaceId: string; path: string }) {
  const ancestors = pathAncestors(path);
  if (ancestors.length === 0) return null;
  return (
    <Stack direction="row" flexWrap="wrap" sx={{ gap: 0.35, alignItems: 'baseline' }}>
      {ancestors.map((ancestor) => (
        <Box key={ancestor.path} sx={{ display: 'contents' }}>
          <ButtonBase
            onClick={() => {
              window.location.hash = filePreviewHash({
                workspaceId,
                path: ancestor.path,
                line: null,
              });
            }}
            sx={{
              color: tokens.sub,
              fontFamily: tokens.mono,
              fontSize: 9,
              '&:hover': { color: tokens.teal, textDecoration: 'underline' },
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          >
            {ancestor.label}
          </ButtonBase>
          <Box component="span" sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 9 }}>
            /
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

function Notice({ tone, children }: { tone: 'muted' | 'error'; children: React.ReactNode }) {
  return (
    <Typography
      role={tone === 'error' ? 'alert' : undefined}
      sx={{
        p: 2,
        color: tone === 'error' ? tokens.terra : tokens.sub,
        fontFamily: tokens.mono,
        fontSize: 11,
      }}
    >
      {children}
    </Typography>
  );
}

function DirectoryView({
  workspaceId,
  entries,
}: {
  workspaceId: string;
  entries: readonly WorkspaceDirectoryEntry[];
}) {
  if (entries.length === 0) return <Notice tone="muted">This directory is empty.</Notice>;
  return (
    <Stack component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {entries.map((entry) => (
        <Box component="li" key={entry.path}>
          <ButtonBase
            onClick={() => {
              window.location.hash = filePreviewHash({
                workspaceId,
                path: entry.path,
                line: null,
              });
            }}
            sx={{
              width: '100%',
              px: 1.4,
              py: 0.7,
              gap: 0.8,
              justifyContent: 'flex-start',
              borderBottom: `1px solid ${tokens.hair}`,
              color: tokens.ink,
              fontFamily: tokens.mono,
              fontSize: 11,
              '&:hover': { background: 'rgba(31,111,107,.05)' },
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: -2 },
            }}
          >
            {entry.isDir ? (
              <FolderOutlined sx={{ fontSize: 14, color: tokens.gold }} />
            ) : (
              <InsertDriveFileOutlined sx={{ fontSize: 14, color: tokens.sub2 }} />
            )}
            <Box component="span" sx={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
              {entry.name}
              {entry.isDir ? '/' : ''}
            </Box>
            {!entry.isDir && (
              <Box component="span" sx={{ color: tokens.sub2, fontSize: 9 }}>
                {byteLabel(entry.size)}
              </Box>
            )}
          </ButtonBase>
        </Box>
      ))}
    </Stack>
  );
}

function SearchBar({
  query,
  onQuery,
  matchCount,
  matchIndex,
  onStep,
  onClose,
}: {
  query: string;
  onQuery: (value: string) => void;
  matchCount: number;
  matchIndex: number;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  const field = useRef<HTMLInputElement | null>(null);
  // Focused on open rather than through autoFocus: the bar appears only in
  // response to the reader pressing Find, so moving focus is expected, and the
  // static prop would move it on any render.
  useEffect(() => field.current?.focus(), []);

  return (
    <Stack
      direction="row"
      alignItems="center"
      sx={{ mt: 0.9, gap: 0.5, flexWrap: 'wrap' }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Enter') {
          event.preventDefault();
          onStep(event.shiftKey ? -1 : 1);
        }
      }}
    >
      <Box
        component="input"
        ref={field}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Find in file"
        aria-label="Find in file"
        sx={{
          minWidth: 0,
          flex: '1 1 160px',
          px: 0.9,
          py: 0.5,
          border: `1px solid ${tokens.hair}`,
          borderRadius: 0.8,
          background: tokens.leafbg,
          color: tokens.ink,
          fontFamily: tokens.mono,
          fontSize: 10.5,
          '&:focus': { outline: `2px solid ${tokens.teal}`, outlineOffset: -1 },
        }}
      />
      <Typography
        aria-live="polite"
        sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 9, minWidth: 64 }}
      >
        {query.trim() === ''
          ? ''
          : matchCount === 0
            ? 'no matches'
            : `${matchIndex + 1} of ${matchCount} lines`}
      </Typography>
      <ActionButton
        label="Previous"
        icon={<ArrowBackRounded sx={{ fontSize: 13 }} />}
        onClick={() => onStep(-1)}
      />
      <ActionButton
        label="Next"
        icon={<ArrowForwardRounded sx={{ fontSize: 13 }} />}
        onClick={() => onStep(1)}
      />
      <ActionButton label="Close" icon={<CloseRounded sx={{ fontSize: 13 }} />} onClick={onClose} />
    </Stack>
  );
}

type StructuredView = { kind: 'json' | 'table' | 'markdown'; label: string };

/** The richer-than-text view a file qualifies for, if any. */
function structuredViewFor(meta: WorkspaceFileMeta): StructuredView | null {
  if (meta.previewKind !== 'text') return null;
  if (meta.language === 'json') return { kind: 'json', label: 'Tree' };
  if (meta.language === 'markdown') return { kind: 'markdown', label: 'Rendered' };
  return /\.(csv|tsv)$/i.test(meta.path) ? { kind: 'table', label: 'Table' } : null;
}

/**
 * Preview one workspace file beside the Agent conversation.
 *
 * Loads metadata first and only then the body, so clicking a multi-gigabyte
 * parquet costs one stat rather than a download. The backend's `previewKind`
 * decides the renderer — the browser does not re-sniff the file.
 */
export default function FilePreviewPage({ fileRef }: { fileRef: WorkspaceFileRef }) {
  const { workspaceId, path, line } = fileRef;
  const [meta, setMeta] = useState<WorkspaceFileMeta | null>(null);
  const [body, setBody] = useState<WorkspaceFileText | null>(null);
  const [entries, setEntries] = useState<readonly WorkspaceDirectoryEntry[] | null>(null);
  const [failure, setFailure] = useState<{ status: number; message: string } | null>(null);
  const [highlighted, setHighlighted] = useState<readonly string[] | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [matchIndex, setMatchIndex] = useState(0);
  // JSON, delimited data and Markdown each read far better as themselves than
  // as text; source is always one toggle away.
  const structured = meta === null ? null : structuredViewFor(meta);

  useEffect(() => {
    let active = true;
    setMeta(null);
    setBody(null);
    setEntries(null);
    setFailure(null);
    setHighlighted(null);
    setShowSource(false);
    setQuery(null);
    void (async () => {
      try {
        const loaded = await getFileMeta(workspaceId, path);
        if (!active) return;
        setMeta(loaded);
        if (loaded.previewKind === 'text') {
          const text = await getFileText(workspaceId, loaded.path);
          if (!active) return;
          setBody(text);
          // The text is already on screen; colour arrives after the grammar
          // chunk loads, and a highlighter failure must not blank the preview.
          // A file carrying its own terminal colour is coloured by that instead.
          if (canHighlight(loaded.language) && !hasAnsi(text.text)) {
            const lines = await highlightLines(text.text, loaded.language).catch(() => null);
            if (active) setHighlighted(lines);
          }
        } else if (loaded.previewKind === 'directory') {
          const listing = await listDirectory(workspaceId, loaded.path);
          if (active) setEntries(listing);
        }
      } catch (reason: unknown) {
        if (!active) return;
        setFailure({
          status: reason instanceof WorkspaceFileError ? reason.status : 0,
          message: reason instanceof Error ? reason.message : String(reason),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [path, workspaceId]);

  const copyPath = useCallback(() => {
    void navigator.clipboard?.writeText(path).then(() => setCopied(true));
  }, [path]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  // Logs come off a tty with SGR escapes in them. Everything downstream — the
  // gutter, search, the structured views — works on the text a reader can see,
  // and the colour rides alongside as per-line markup.
  const ansi = body !== null && hasAnsi(body.text);
  const displayText = useMemo(
    () => (body === null ? '' : ansi ? stripAnsi(body.text) : body.text),
    [ansi, body],
  );
  const ansiMarkup = useMemo(() => {
    if (body === null || !ansi) return null;
    // Same ceiling as syntax highlighting. Past it the escapes are still
    // removed, so the worst case is a clean but colourless log, never a dirty
    // one.
    if (displayText.split('\n', MAX_HIGHLIGHT_LINES + 1).length > MAX_HIGHLIGHT_LINES) return null;
    return ansiLines(body.text);
  }, [ansi, body, displayText]);

  const matches = useMemo(
    () => (query === null ? [] : matchingLines(displayText, query)),
    [displayText, query],
  );
  useEffect(() => setMatchIndex(0), [query]);

  const contentUrl = fileContentUrl(workspaceId, path);
  return (
    <Stack sx={{ gap: 1.2, p: { xs: 1.2, md: 2 }, minWidth: 0 }}>
      <SurfaceCard sx={{ p: 1.4 }}>
        <Stack direction="row" alignItems="center" sx={{ gap: 1.1, flexWrap: 'wrap' }}>
          <DescriptionOutlined sx={{ color: tokens.teal, fontSize: 18, flex: '0 0 auto' }} />
          <Box sx={{ minWidth: 0, flex: '1 1 200px' }}>
            <Typography
              component="h2"
              noWrap
              sx={{ m: 0, color: tokens.ink, fontSize: 15, fontWeight: 700 }}
            >
              {fileName(path)}
            </Typography>
            <Breadcrumbs workspaceId={workspaceId} path={path} />
          </Box>
          <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
            {structured && (
              <ActionButton
                label={showSource ? structured.label : 'Source'}
                icon={<DataObjectRounded sx={{ fontSize: 13 }} />}
                onClick={() => setShowSource((current) => !current)}
              />
            )}
            {meta?.previewKind === 'text' && (!structured || showSource) && (
              <ActionButton
                label="Find"
                icon={<SearchRounded sx={{ fontSize: 13 }} />}
                onClick={() => setQuery((current) => (current === null ? '' : null))}
                active={query !== null}
              />
            )}
            {meta?.previewKind === 'text' && (!structured || showSource) && (
              <ActionButton
                label={wrap ? 'No wrap' : 'Wrap'}
                icon={<WrapTextRounded sx={{ fontSize: 13 }} />}
                onClick={() => setWrap((current) => !current)}
                active={wrap}
              />
            )}
            <ActionButton
              label={copied ? 'Copied' : 'Copy path'}
              icon={<ContentCopyRounded sx={{ fontSize: 13 }} />}
              onClick={copyPath}
            />
            <ActionButton
              label="Raw"
              icon={<OpenInNewRounded sx={{ fontSize: 13 }} />}
              href={contentUrl}
            />
            <ActionButton
              label="Back"
              icon={<ArrowBackRounded sx={{ fontSize: 13 }} />}
              onClick={() => window.history.back()}
            />
          </Stack>
        </Stack>
        {query !== null && (
          <SearchBar
            query={query}
            onQuery={setQuery}
            matchCount={matches.length}
            matchIndex={matchIndex}
            onStep={(delta) =>
              setMatchIndex((current) => stepMatch(matches.length, current, delta))
            }
            onClose={() => setQuery(null)}
          />
        )}
        {meta && (
          <Typography sx={{ mt: 0.6, color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}>
            {meta.isDir ? 'directory' : `${meta.previewKind} · ${byteLabel(meta.size)}`}
            {meta.language ? ` · ${meta.language}` : ''}
            {ansi ? ' · terminal colour' : ''}
            {body?.truncated ? ` · truncated to ${byteLabel(body.text.length)}` : ''}
          </Typography>
        )}
      </SurfaceCard>

      <SurfaceCard accent={tokens.sub2} sx={{ minWidth: 0, overflow: 'hidden' }}>
        {failure ? (
          <Notice tone="error">
            {failure.status === 403
              ? `This file is outside what the browser may read: ${failure.message}`
              : failure.status === 404
                ? `No such file in this workspace: ${path}`
                : failure.message}
          </Notice>
        ) : !meta ? (
          <Box sx={{ p: 1.4 }}>
            <Skeleton variant="rounded" height={280} />
          </Box>
        ) : meta.previewKind === 'image' ? (
          <Box
            component="img"
            src={contentUrl}
            alt={meta.name}
            sx={{ display: 'block', maxWidth: '100%', height: 'auto', background: tokens.leafbg }}
          />
        ) : meta.previewKind === 'directory' ? (
          entries === null ? (
            <Box sx={{ p: 1.4 }}>
              <Skeleton variant="rounded" height={180} />
            </Box>
          ) : (
            <DirectoryView workspaceId={workspaceId} entries={entries} />
          )
        ) : meta.previewKind === 'binary' ? (
          <Stack sx={{ p: 2, gap: 1.2, alignItems: 'flex-start' }}>
            <Notice tone="muted">
              {meta.name} is a binary artifact ({byteLabel(meta.size)}). It has no text preview.
            </Notice>
            <Box sx={{ pl: 2 }}>
              <ActionButton
                label="Download"
                icon={<DownloadRounded sx={{ fontSize: 13 }} />}
                href={contentUrl}
              />
            </Box>
          </Stack>
        ) : body === null ? (
          <Box sx={{ p: 1.4 }}>
            <Skeleton variant="rounded" height={280} />
          </Box>
        ) : structured && !showSource ? (
          structured.kind === 'json' ? (
            <JsonView text={displayText} />
          ) : structured.kind === 'table' ? (
            <TableView text={displayText} path={meta.path} truncated={body.truncated} />
          ) : (
            <Box sx={{ p: 1.6, minWidth: 0, overflow: 'auto' }}>
              <MarkdownBody text={displayText} citations={[]} workspaceId={workspaceId} />
            </Box>
          )
        ) : (
          <Box sx={{ minWidth: 0, overflow: 'auto', py: 0.8 }}>
            <CodeView
              text={displayText}
              highlightLine={line}
              wrap={wrap}
              highlightedLines={ansiMarkup ?? highlighted}
              matchLines={matches}
              activeMatchLine={matches[matchIndex] ?? null}
            />
          </Box>
        )}
      </SurfaceCard>
    </Stack>
  );
}
