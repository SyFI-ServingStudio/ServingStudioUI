import { Box } from '@mui/material';
import { Fragment, useEffect, useMemo, useRef } from 'react';

import { tokens } from '../../theme';

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
}: {
  text: string;
  highlightLine: number | null;
  wrap: boolean;
}) {
  const lines = useMemo(() => {
    const split = text.split('\n');
    // A trailing newline is a terminator, not an empty final line.
    if (split.length > 1 && split.at(-1) === '') split.pop();
    return split;
  }, [text]);
  const anchor = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    // Optional call: jsdom and older embedded engines have no scrollIntoView,
    // and a missing scroll must not take the whole preview down with it.
    anchor.current?.scrollIntoView?.({ block: 'center' });
  }, [highlightLine, text]);

  return (
    <Box
      component="pre"
      aria-label="File contents"
      sx={{
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
                background: highlighted ? 'rgba(31,111,107,.12)' : tokens.tile,
                borderRight: `1px solid ${tokens.hair}`,
              }}
            >
              {number}
            </Box>
            <Box
              component="span"
              ref={highlighted ? anchor : undefined}
              data-line={number}
              sx={{
                px: 1.2,
                whiteSpace: wrap ? 'pre-wrap' : 'pre',
                overflowWrap: wrap ? 'anywhere' : 'normal',
                background: highlighted ? 'rgba(31,111,107,.12)' : 'transparent',
              }}
            >
              {line === '' ? ' ' : line}
            </Box>
          </Fragment>
        );
      })}
    </Box>
  );
}
