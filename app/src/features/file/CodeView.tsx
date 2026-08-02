import { Box } from '@mui/material';
import { Fragment, useEffect, useMemo, useRef } from 'react';

import { tokens } from '../../theme';
import { highlightSx } from './highlight';

/**
 * A gutter-numbered text body with one optionally highlighted line.
 *
 * Rendered as a two-column grid of whole lines rather than a `<pre>` with a
 * floating gutter, so a highlighted line spans the full row and the numbers
 * stay aligned when soft wrap is on.
 */
export default function CodeView({
  text,
  highlightLine,
  wrap,
  highlightedLines,
  matchLines,
  activeMatchLine = null,
}: {
  text: string;
  highlightLine: number | null;
  wrap: boolean;
  /** Per-line HTML from `highlightLines`, or null to render plain text. */
  highlightedLines?: readonly string[] | null;
  /** 1-indexed lines containing the current search query. */
  matchLines?: readonly number[];
  /** The match the reader is currently stepped onto. */
  activeMatchLine?: number | null;
}) {
  const lines = useMemo(() => {
    const split = text.split('\n');
    // A trailing newline is a terminator, not an empty final line.
    if (split.length > 1 && split.at(-1) === '') split.pop();
    return split;
  }, [text]);
  const matched = useMemo(() => new Set(matchLines ?? []), [matchLines]);
  const anchor = useRef<HTMLSpanElement | null>(null);
  // An active search match takes the reader's attention from the deep-linked
  // line; falling back keeps `?line=` working when nothing is being searched.
  const focusLine = activeMatchLine ?? highlightLine;

  useEffect(() => {
    // Optional call: jsdom and older embedded engines have no scrollIntoView,
    // and a missing scroll must not take the whole preview down with it.
    anchor.current?.scrollIntoView?.({ block: 'center' });
  }, [focusLine, text]);

  return (
    <Box
      component="pre"
      aria-label="File contents"
      sx={{
        ...highlightSx,
        m: 0,
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0,1fr)',
        alignItems: 'start',
        overflowX: wrap ? 'hidden' : 'auto',
        color: tokens.ink,
        fontFamily: tokens.mono,
        fontSize: 11.5,
        lineHeight: 1.65,
        tabSize: 4,
      }}
    >
      {lines.map((line, index) => {
        const number = index + 1;
        const highlighted = number === highlightLine;
        const isActiveMatch = number === activeMatchLine;
        const isMatch = matched.has(number);
        const rowBackground = isActiveMatch
          ? 'rgba(128,102,0,.2)'
          : isMatch
            ? 'rgba(128,102,0,.09)'
            : highlighted
              ? 'rgba(31,111,107,.12)'
              : null;
        // highlight.js escapes the source before wrapping it in spans, so its
        // per-line fragment carries no markup from the file itself.
        const markup = highlightedLines?.[index];
        return (
          <Fragment key={number}>
            <Box
              component="span"
              aria-hidden="true"
              sx={{
                px: 1.2,
                position: 'sticky',
                left: 0,
                color: highlighted ? tokens.teal : tokens.sub2,
                fontWeight: highlighted ? 700 : 400,
                fontVariantNumeric: 'tabular-nums',
                textAlign: 'right',
                userSelect: 'none',
                background: rowBackground ?? tokens.tile,
                borderRight: `1px solid ${tokens.hair}`,
              }}
            >
              {number}
            </Box>
            <Box
              component="span"
              ref={number === focusLine ? anchor : undefined}
              data-line={number}
              data-match={isMatch ? (isActiveMatch ? 'active' : 'yes') : undefined}
              sx={{
                px: 1.2,
                whiteSpace: wrap ? 'pre-wrap' : 'pre',
                overflowWrap: wrap ? 'anywhere' : 'normal',
                background: rowBackground ?? 'transparent',
              }}
              {...(markup === undefined
                ? { children: line === '' ? ' ' : line }
                : { dangerouslySetInnerHTML: { __html: markup === '' ? ' ' : markup } })}
            />
          </Fragment>
        );
      })}
    </Box>
  );
}
