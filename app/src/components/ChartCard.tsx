import { Box, IconButton, Paper, Stack, Typography } from '@mui/material';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import type { EChartsOption } from 'echarts';
import { useViz } from '../store';
import { tokens } from '../theme';
import EChart from './EChart';

/** Generic chart tile: header (idx · title · sub), a chart (or empty note), an
 *  optional footnote, and a hover-reveal expand button that pushes the chart
 *  into the shared FocusDialog. Used by every scope stage. */
export default function ChartCard({
  idx,
  title,
  sub,
  option,
  note,
  caption,
  empty,
  height = 216,
}: {
  idx?: string;
  title: string;
  sub?: string;
  option: EChartsOption | null;
  note?: string | null;
  caption?: string;
  empty?: string;
  height?: number;
}) {
  const st = useViz();
  return (
    <Paper
      sx={{
        borderRadius: 2,
        p: '16px 16px 14px',
        position: 'relative',
        transition: `box-shadow .4s ${tokens.ease}, border-color .3s ${tokens.ease}`,
        '&:hover': { borderColor: '#d8cfb8', boxShadow: tokens.shadowLift },
        '&:hover .expand': { opacity: 1 },
      }}
    >
      {option && (
        <IconButton
          className="expand"
          size="small"
          onClick={() => st.openFocus({ title, caption: caption ?? note ?? '', option })}
          sx={{
            position: 'absolute',
            top: 12,
            right: 12,
            opacity: 0,
            color: tokens.sub,
            transition: `all .28s ${tokens.ease}`,
            '&:hover': { color: '#fff', background: tokens.teal },
            zIndex: 3,
          }}
        >
          <OpenInFullIcon sx={{ fontSize: 15 }} />
        </IconButton>
      )}
      <Stack
        direction="row"
        alignItems="baseline"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 1, pr: 3.5 }}
      >
        <Typography
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 16,
            letterSpacing: '-.01em',
            display: 'flex',
            alignItems: 'baseline',
            gap: 1.1,
          }}
        >
          {idx && (
            <Box
              component="span"
              sx={{
                fontFamily: tokens.mono,
                fontSize: 10,
                color: tokens.terra,
                letterSpacing: '.1em',
              }}
            >
              {idx}
            </Box>
          )}
          {title}
        </Typography>
        {sub && (
          <Typography
            sx={{
              fontFamily: tokens.mono,
              fontSize: 10,
              color: tokens.sub,
              textAlign: 'right',
              whiteSpace: 'nowrap',
            }}
          >
            {sub}
          </Typography>
        )}
      </Stack>
      <Box sx={{ height }}>
        {option ? (
          <EChart option={option} />
        ) : (
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: tokens.sub,
              fontFamily: tokens.mono,
              fontSize: 11,
              textAlign: 'center',
              px: 2,
            }}
          >
            {empty ?? note}
          </Box>
        )}
      </Box>
      {option && note && (
        <Typography
          sx={{
            fontFamily: tokens.mono,
            fontSize: 10,
            color: tokens.sub,
            mt: 0.75,
            letterSpacing: '.03em',
          }}
        >
          {note}
        </Typography>
      )}
    </Paper>
  );
}
