/** The alert form of `describeRead`, for panels that have room for one. */
import { Alert } from '@mui/material';

import type { ArtifactResult } from '../artifacts';
import { describeRead } from './readProblem';

export function ReadProblem({ what, result }: { what: string; result: ArtifactResult<unknown> }) {
  const note = describeRead(what, result);
  if (note === null) return null;
  return (
    <Alert severity={note.severity} data-testid="read-problem">
      {note.message}
    </Alert>
  );
}
