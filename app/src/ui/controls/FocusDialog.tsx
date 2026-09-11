import { Box, Dialog, IconButton, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { tokens, colors } from '../theme';
import { useChartFocusDialog } from './ChartFocusContext';
import EChart from './EChart';

/** Zoomed single-chart dialog for the provider-owned, scope-agnostic snapshot. */
export default function FocusDialog() {
  const { focus, closeFocus } = useChartFocusDialog();

  return (
    <Dialog
      open={focus != null}
      onClose={closeFocus}
      maxWidth="lg"
      fullWidth
      fullScreen={focus?.fullScreen === true}
      PaperProps={{
        sx: {
          borderRadius: focus?.fullScreen === true ? 0 : 3,
          p: '24px 26px 22px',
          background: tokens.tile,
          ...(focus?.fullScreen === true ? { display: 'flex', flexDirection: 'column' } : {}),
        },
      }}
    >
      {focus && (
        <>
          <Stack
            direction="row"
            alignItems="flex-start"
            justifyContent="space-between"
            spacing={2.5}
            sx={{ mb: 2 }}
          >
            <Box>
              <Typography
                sx={{
                  fontFamily: tokens.serif,
                  fontWeight: 600,
                  fontSize: 28,
                  letterSpacing: '-.02em',
                  lineHeight: 1.02,
                }}
              >
                {focus.title}
              </Typography>
              {focus.caption && (
                <Typography sx={{ fontSize: 13, color: tokens.sub, mt: 1, maxWidth: 680 }}>
                  {focus.caption}
                </Typography>
              )}
              {focus.interactionHint && (
                <Typography
                  sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.teal, mt: 0.75 }}
                >
                  {focus.interactionHint}
                </Typography>
              )}
            </Box>
            <IconButton
              aria-label="Close expanded chart"
              onClick={closeFocus}
              sx={{
                border: `1px solid ${tokens.hair}`,
                background: tokens.tile2,
                borderRadius: 1.5,
                '&:hover': { background: tokens.terra, color: colors.foregroundOnAccent },
              }}
            >
              <CloseIcon />
            </IconButton>
          </Stack>
          <Box
            sx={
              focus.fullScreen === true ? { flex: 1, minHeight: 0 } : { height: 'min(60vh,540px)' }
            }
          >
            <EChart option={focus.option} ariaLabel={`${focus.title}. ${focus.caption}`} />
          </Box>
        </>
      )}
    </Dialog>
  );
}
