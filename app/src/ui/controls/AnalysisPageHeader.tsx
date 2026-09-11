import { Stack, Typography } from '@mui/material';
import { tokens } from '../theme';

/** Shared title hierarchy for standalone Analyzer results. */
export default function AnalysisPageHeader({
  title,
  detail,
}: {
  title: string;
  detail?: string | null;
}) {
  return (
    <Stack sx={{ gap: 1, pb: 1 }}>
      <Typography
        component="h1"
        sx={{ fontSize: 34, fontWeight: 600, letterSpacing: '-.035em', lineHeight: 1.2 }}
      >
        {title}
      </Typography>
      {detail && (
        <Typography
          sx={{ color: tokens.sub, fontSize: 14, overflowWrap: 'anywhere', maxWidth: 1000 }}
        >
          {detail}
        </Typography>
      )}
    </Stack>
  );
}
