import { Box, ButtonBase, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';

import { classifyLinkTarget, detectPathToken, filePreviewHash, type LinkTarget } from '../filePath';
import { fileContentUrl } from '../../session/workspaceFiles';
import { tokens, withAlpha } from '../../ui/theme';

/**
 * Renders the Markdown subset that Agent turns and workspace documents use:
 * headings, lists, tables, fenced code, images, links, and frozen Analyzer
 * citations.
 *
 * Shared by the conversation transcript and the file preview, so a relative
 * link inside a README behaves exactly like one the Agent wrote — which is why
 * this lives in components/ rather than inside either feature.
 */

export type NavigationStatus = 'opening' | 'ok' | 'not-found' | 'unavailable';

export interface MarkdownCitation {
  readonly token: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly displayLabel: string;
  readonly target: unknown;
}

export type OpenEvidence = (target: unknown, onStatus: (status: NavigationStatus) => void) => void;

/**
 * A workspace file the Agent referenced, opened in the preview pane.
 *
 * Deliberately not an `<a target="_blank">`: the file opens beside the
 * conversation, which folds the Agent panel from full to docked and keeps the
 * turn mounted. A new tab would lose both.
 */
function FileLink({
  workspaceId,
  target,
  label,
  onOpenFile,
  mono = false,
}: {
  workspaceId: string;
  target: Extract<LinkTarget, { kind: 'workspace-file' }>;
  label: string;
  onOpenFile?: (workspaceId: string, path: string, line: number | null) => void;
  mono?: boolean;
}) {
  return (
    <ButtonBase
      onClick={() => {
        if (onOpenFile) {
          onOpenFile(workspaceId, target.path, target.line);
          return;
        }
        window.location.hash = filePreviewHash({
          workspaceId,
          path: target.path,
          line: target.line,
        });
      }}
      title={target.line === null ? target.path : `${target.path}:${target.line}`}
      sx={{
        display: 'inline',
        px: 0.3,
        borderRadius: 0.35,
        border: `1px solid ${tokens.teal}2e`,
        background: withAlpha(tokens.teal, 0.06),
        color: tokens.teal,
        font: 'inherit',
        fontFamily: mono ? tokens.mono : 'inherit',
        fontSize: mono ? '.9em' : 'inherit',
        fontWeight: 600,
        lineHeight: 'inherit',
        verticalAlign: 'baseline',
        '&:hover': { background: withAlpha(tokens.teal, 0.13) },
        '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
      }}
    >
      {label}
    </ButtonBase>
  );
}

export default function MarkdownBody({
  text,
  citations,
  workspaceId,
  compact = false,
  onOpenEvidence,
  onOpenFile,
}: {
  text: string;
  citations: readonly MarkdownCitation[];
  workspaceId?: string;
  compact?: boolean;
  onOpenEvidence?: OpenEvidence;
  onOpenFile?: (workspaceId: string, path: string, line: number | null) => void;
}) {
  const [statuses, setStatuses] = useState<Record<number, NavigationStatus>>({});
  const workspace = workspaceId ?? 'w_main';
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
    // Link destinations are matched loosely and classified afterwards: a
    // relative or `/workspace/...` path is a file the UI can open, not a site
    // URL, and only `classifyLinkTarget` can tell those apart.
    const pattern =
      /(!\[[^\]\n]*\]\([^)]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)|\*[^*\n]+\*)/g;
    let sourceCursor = 0;
    let match = pattern.exec(source);
    while (match) {
      if (match.index > sourceCursor) nodes.push(source.slice(sourceCursor, match.index));
      const value = match[0];
      if (value.startsWith('![')) {
        const image = value.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        const source = image?.[2] ?? '';
        const imageSource = /^(https?:|data:|\/api\/file)/i.test(source)
          ? source
          : fileContentUrl(workspace, source);
        nodes.push(
          <Box
            component="img"
            key={`${keyPrefix}-${match.index}`}
            src={imageSource}
            alt={image?.[1] ?? ''}
            loading="lazy"
            sx={{
              display: 'block',
              maxWidth: '100%',
              height: 'auto',
              my: compact ? 0.65 : 0.9,
              border: `1px solid ${tokens.hair}`,
              borderRadius: 0.75,
              background: tokens.tile,
            }}
          />,
        );
      } else if (value.startsWith('**')) {
        nodes.push(
          <Box component="strong" key={`${keyPrefix}-${match.index}`} sx={{ color: tokens.ink }}>
            {value.slice(2, -2)}
          </Box>,
        );
      } else if (value.startsWith('[')) {
        const link = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        const label = link?.[1] ?? value;
        const target = classifyLinkTarget(link?.[2] ?? '');
        const key = `${keyPrefix}-${match.index}`;
        nodes.push(
          target.kind === 'workspace-file' ? (
            <FileLink
              key={key}
              workspaceId={workspace}
              target={target}
              label={label}
              onOpenFile={onOpenFile}
            />
          ) : (
            <Box
              component="a"
              key={key}
              href={
                target.kind === 'external' ? target.href : target.kind === 'app' ? target.hash : '#'
              }
              {...(target.kind === 'external'
                ? { target: '_blank', rel: 'noopener noreferrer' }
                : {})}
              sx={{
                color: tokens.teal,
                textDecorationColor: withAlpha(tokens.teal, 0.42),
                textUnderlineOffset: '2px',
              }}
            >
              {label}
            </Box>
          ),
        );
      } else if (value.startsWith('*')) {
        nodes.push(
          <Box component="em" key={`${keyPrefix}-${match.index}`}>
            {value.slice(1, -1)}
          </Box>,
        );
      } else {
        // Agents cite files as often in backticks as in Markdown links, so a
        // path-shaped code span becomes a link too. `detectPathToken` is the
        // conservative half of that judgement.
        const code = value.slice(1, -1);
        const target = detectPathToken(code);
        nodes.push(
          target.kind === 'workspace-file' ? (
            <FileLink
              key={`${keyPrefix}-${match.index}`}
              workspaceId={workspace}
              target={target}
              label={code}
              onOpenFile={onOpenFile}
              mono
            />
          ) : (
            <Box
              component="code"
              key={`${keyPrefix}-${match.index}`}
              sx={{
                px: 0.35,
                borderRadius: 0.35,
                background: withAlpha(tokens.sub, 0.08),
                color: tokens.ink,
                fontFamily: tokens.mono,
                fontSize: '.9em',
              }}
            >
              {code}
            </Box>
          ),
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
            onOpenEvidence?.(citation.target, (next) =>
              setStatuses((current) => ({ ...current, [citationIndex]: next })),
            )
          }
          disabled={onOpenEvidence === undefined}
          title={
            status === 'not-found'
              ? 'Evidence is no longer available'
              : status === 'unavailable'
                ? 'Evidence is not ready'
                : citation.token
          }
          sx={{
            display: 'inline',
            maxWidth: '100%',
            overflowWrap: 'anywhere',
            textAlign: 'inherit',
            px: 0.2,
            borderRadius: 0.35,
            borderBottom: `1px solid ${tokens.teal}`,
            color: status === 'not-found' || status === 'unavailable' ? tokens.terra : tokens.teal,
            font: 'inherit',
            fontWeight: 650,
            lineHeight: 'inherit',
            verticalAlign: 'baseline',
            '&:hover': { background: withAlpha(tokens.teal, 0.08) },
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
            background: withAlpha(tokens.sub, 0.055),
            color: tokens.ink,
            fontFamily: tokens.mono,
            fontSize: compact ? 12 : 13,
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
              fontSize: 13,
              fontWeight: 700,
            },
            '& td': { color: tokens.sub, fontSize: 13 },
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
            fontSize: 13,
            lineHeight: 1.7,
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
          fontSize: heading ? 17 : 14,
          fontWeight: heading ? 650 : 400,
          lineHeight: 1.7,
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
