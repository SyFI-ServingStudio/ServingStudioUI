import { Alert, Typography } from '@mui/material';

import { tokens } from '../../theme';

/**
 * What went wrong reading one subject, in the analyzer's or the parser's own
 * words.
 *
 * A schema mismatch names the field it tripped on, and that name is the whole
 * diagnostic — so it is shown rather than summarized into a sentence this file
 * would have had to invent. Rendering nothing instead would make a parse
 * failure look exactly like a bundle that has no such subject.
 */
export default function SubjectError({ error }: { error: unknown }) {
  return (
    <Alert severity="error" sx={{ fontSize: 12 }}>
      <Typography
        component="pre"
        sx={{
          fontFamily: tokens.mono,
          fontSize: 11,
          lineHeight: 1.5,
          m: 0,
          whiteSpace: 'pre-wrap',
          maxHeight: 220,
          overflow: 'auto',
        }}
      >
        {error instanceof Error ? error.message : 'This section could not be read.'}
      </Typography>
    </Alert>
  );
}
