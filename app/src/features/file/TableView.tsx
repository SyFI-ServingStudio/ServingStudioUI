import { Box, Stack, Typography } from '@mui/material';
import { useMemo } from 'react';

import { tokens } from '../../theme';
import { delimiterFor, parseDelimitedText } from './delimitedText';

/** Enough to see the shape of a run's CSV without laying out a huge table. */
const MAX_ROWS = 1000;

function looksNumeric(value: string): boolean {
  return value !== '' && Number.isFinite(Number(value));
}

export default function TableView({ text, path }: { text: string; path: string }) {
  const table = useMemo(() => parseDelimitedText(text, delimiterFor(path), MAX_ROWS), [path, text]);

  if (table === null) {
    return (
      <Typography sx={{ p: 2, color: tokens.sub, fontFamily: tokens.mono, fontSize: 11 }}>
        This file has no rows to tabulate.
      </Typography>
    );
  }

  return (
    <Stack sx={{ minWidth: 0 }}>
      <Box sx={{ overflow: 'auto', maxHeight: '70vh' }}>
        <Box
          component="table"
          aria-label="File contents as a table"
          sx={{
            borderCollapse: 'collapse',
            width: '100%',
            fontFamily: tokens.mono,
            fontSize: 10.5,
            fontVariantNumeric: 'tabular-nums',
            '& th, & td': {
              px: 1,
              py: 0.45,
              borderBottom: `1px solid ${tokens.hair}`,
              whiteSpace: 'nowrap',
            },
            '& th': {
              position: 'sticky',
              top: 0,
              zIndex: 1,
              color: tokens.ink,
              background: tokens.tile2,
              fontWeight: 700,
              textAlign: 'left',
            },
          }}
        >
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ color: `${tokens.sub2} !important` }}>
                #
              </Box>
              {table.header.map((column, index) => (
                <Box component="th" key={`${column}-${index}`}>
                  {column}
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {table.rows.map((row, rowIndex) => (
              <Box
                component="tr"
                key={rowIndex}
                sx={{ '&:hover td': { background: tokens.tile2 } }}
              >
                <Box
                  component="td"
                  sx={{ color: tokens.sub2, textAlign: 'right', userSelect: 'none' }}
                >
                  {rowIndex + 1}
                </Box>
                {table.header.map((_, columnIndex) => {
                  const cell = row[columnIndex] ?? '';
                  return (
                    <Box
                      component="td"
                      key={columnIndex}
                      sx={{
                        color: cell === '' ? tokens.sub2 : tokens.ink,
                        textAlign: looksNumeric(cell) ? 'right' : 'left',
                      }}
                    >
                      {cell}
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
      <Typography
        sx={{
          px: 1.2,
          py: 0.6,
          borderTop: `1px solid ${tokens.hair}`,
          color: tokens.sub2,
          fontFamily: tokens.mono,
          fontSize: 9,
        }}
      >
        {table.rows.length} of {table.totalRows} rows · {table.header.length} columns
        {table.totalRows > table.rows.length ? ' · switch to Source for the rest' : ''}
      </Typography>
    </Stack>
  );
}
