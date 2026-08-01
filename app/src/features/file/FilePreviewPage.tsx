import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import WrapTextRounded from '@mui/icons-material/WrapTextRounded';
import { Box, ButtonBase, Skeleton, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';

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
import SurfaceCard from '../../components/SurfaceCard';
import { tokens } from '../../theme';
import CodeView from './CodeView';

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
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setMeta(null);
    setBody(null);
    setEntries(null);
    setFailure(null);
    void (async () => {
      try {
        const loaded = await getFileMeta(workspaceId, path);
        if (!active) return;
        setMeta(loaded);
        if (loaded.previewKind === 'text') {
          const text = await getFileText(workspaceId, loaded.path);
          if (active) setBody(text);
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

  const contentUrl = fileContentUrl(workspaceId, path);
  return (
    <Stack sx={{ gap: 1.2, p: { xs: 1.2, md: 2 }, minWidth: 0 }}>
      <SurfaceCard sx={{ p: 1.4 }}>
        <Stack direction="row" alignItems="center" sx={{ gap: 1.1, flexWrap: 'wrap' }}>
          <DescriptionOutlined sx={{ color: tokens.teal, fontSize: 18, flex: '0 0 auto' }} />
          <Box sx={{ minWidth: 0, flex: '1 1 200px' }}>
            <Typography noWrap sx={{ color: tokens.ink, fontSize: 15, fontWeight: 700 }}>
              {fileName(path)}
            </Typography>
            <Breadcrumbs workspaceId={workspaceId} path={path} />
          </Box>
          <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
            {meta?.previewKind === 'text' && (
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
        {meta && (
          <Typography sx={{ mt: 0.6, color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}>
            {meta.isDir ? 'directory' : `${meta.previewKind} · ${byteLabel(meta.size)}`}
            {meta.language ? ` · ${meta.language}` : ''}
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
        ) : (
          <Box sx={{ minWidth: 0, overflow: 'auto', py: 0.8 }}>
            <CodeView text={body.text} highlightLine={line} wrap={wrap} />
          </Box>
        )}
      </SurfaceCard>
    </Stack>
  );
}
