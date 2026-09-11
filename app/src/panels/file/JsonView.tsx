import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useState } from 'react';

import { tokens, withAlpha } from '../../ui/theme';

/**
 * A collapsible tree over parsed JSON.
 *
 * Run summaries and manifests are the files most often opened here, and they
 * are deep rather than long — a tree answers "what is in this" far faster than
 * scrolling the source, which stays one toggle away.
 */

/** Containers start collapsed past this depth so a manifest opens readable. */
const AUTO_EXPAND_DEPTH = 2;
/** Rendering every element of a huge array would freeze the pane. */
const MAX_CHILDREN = 500;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function scalarColor(value: JsonValue): string {
  if (typeof value === 'string') return tokens.olive;
  if (typeof value === 'number') return tokens.gold;
  if (typeof value === 'boolean') return tokens.terra;
  return tokens.sub2;
}

function scalarLabel(value: JsonValue): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

function containerSummary(value: JsonValue[] | Record<string, JsonValue>): string {
  if (Array.isArray(value)) {
    return value.length === 1 ? '1 item' : `${value.length} items`;
  }
  const size = Object.keys(value).length;
  return size === 1 ? '1 key' : `${size} keys`;
}

function JsonNode({
  name,
  value,
  depth,
}: {
  name: string | null;
  value: JsonValue;
  depth: number;
}) {
  const isContainer = value !== null && typeof value === 'object';
  const [expanded, setExpanded] = useState(depth < AUTO_EXPAND_DEPTH);

  const label =
    name === null ? null : (
      <Box component="span" sx={{ color: tokens.sectionAnalysis, fontWeight: 600 }}>
        {name}
        <Box component="span" sx={{ color: tokens.sub2, fontWeight: 400 }}>
          :{' '}
        </Box>
      </Box>
    );

  if (!isContainer) {
    return (
      <Box sx={{ pl: depth * 1.6, py: 0.1 }}>
        {label}
        <Box component="span" sx={{ color: scalarColor(value) }}>
          {scalarLabel(value)}
        </Box>
      </Box>
    );
  }

  const container = value as JsonValue[] | Record<string, JsonValue>;
  const entries: readonly [string, JsonValue][] = Array.isArray(container)
    ? container.map((item, index) => [String(index), item])
    : Object.entries(container);
  const shown = entries.slice(0, MAX_CHILDREN);

  return (
    <Box sx={{ pl: depth * 1.6 }}>
      <ButtonBase
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        sx={{
          gap: 0.2,
          py: 0.1,
          justifyContent: 'flex-start',
          font: 'inherit',
          color: tokens.ink,
          '&:hover': { background: withAlpha(tokens.teal, 0.06) },
          '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
        }}
      >
        {expanded ? (
          <ExpandMoreRounded sx={{ fontSize: 13, color: tokens.sub2 }} />
        ) : (
          <ChevronRightRounded sx={{ fontSize: 13, color: tokens.sub2 }} />
        )}
        {label}
        <Box component="span" sx={{ color: tokens.sub2 }}>
          {Array.isArray(container) ? '[' : '{'}
          {expanded ? '' : ` ${containerSummary(container)} `}
          {expanded ? '' : Array.isArray(container) ? ']' : '}'}
        </Box>
      </ButtonBase>
      {expanded && (
        <>
          {shown.map(([key, child]) => (
            <JsonNode key={key} name={key} value={child} depth={depth + 1} />
          ))}
          {entries.length > shown.length && (
            <Box sx={{ pl: (depth + 1) * 1.6, py: 0.1, color: tokens.sub2 }}>
              … {entries.length - shown.length} more not shown
            </Box>
          )}
          <Box sx={{ pl: depth * 1.6, color: tokens.sub2 }}>
            {Array.isArray(container) ? ']' : '}'}
          </Box>
        </>
      )}
    </Box>
  );
}

export default function JsonView({ text }: { text: string }) {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text) as JsonValue;
  } catch (reason: unknown) {
    return (
      <Stack sx={{ p: 2, gap: 0.5 }}>
        <Typography sx={{ color: tokens.terra, fontFamily: tokens.mono, fontSize: 12 }}>
          This file is not valid JSON: {reason instanceof Error ? reason.message : String(reason)}
        </Typography>
        <Typography sx={{ color: tokens.sub, fontFamily: tokens.mono, fontSize: 12 }}>
          Switch to Source to read it as text.
        </Typography>
      </Stack>
    );
  }
  return (
    <Box
      aria-label="JSON tree"
      sx={{
        p: 1.2,
        overflowX: 'auto',
        color: tokens.ink,
        fontFamily: tokens.mono,
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <JsonNode name={null} value={parsed} depth={0} />
    </Box>
  );
}
