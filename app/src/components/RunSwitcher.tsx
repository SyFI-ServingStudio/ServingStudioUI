import { Autocomplete, Box, Stack, TextField, Typography } from '@mui/material';

import { useRunListQuery } from '../application/queries';
import { useViz } from '../store';
import { tokens } from '../theme';

export default function RunSwitcher() {
  const runId = useViz((state) => state.runId);
  const setRun = useViz((state) => state.setRun);
  const runs = useRunListQuery();
  const selectedRun = runs.data?.find((run) => run.runId === runId);

  return (
    <Stack spacing={1} sx={{ minWidth: { xs: '100%', sm: 460 }, maxWidth: 680 }}>
      <Typography
        sx={{
          fontFamily: tokens.mono,
          fontSize: 10,
          letterSpacing: '.22em',
          textTransform: 'uppercase',
          color: tokens.sub,
        }}
      >
        Simulation folder
      </Typography>
      {selectedRun ? (
        <Autocomplete
          disableClearable
          options={runs.data ?? []}
          value={selectedRun}
          getOptionLabel={(run) => run.runId}
          isOptionEqualToValue={(option, value) => option.runId === value.runId}
          onChange={(_, run) => setRun(run.runId)}
          noOptionsText="No simulation folders"
          renderOption={(props, run) => (
            <Box
              component="li"
              {...props}
              key={run.runId}
              sx={{ display: 'block !important', py: '9px !important' }}
            >
              <Typography sx={{ fontFamily: tokens.mono, fontSize: 11.5, color: tokens.ink }}>
                {run.runId}
              </Typography>
              <Typography
                sx={{ mt: 0.25, fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub }}
              >
                {run.deployment?.toUpperCase() ?? 'simulation'} · {run.lifecycle.analysis} analysis
                {run.provenance?.source === 'fixture'
                  ? run.provenance.synthetic
                    ? ' · synthetic fixture'
                    : ' · real analyzer fixture'
                  : ''}
              </Typography>
            </Box>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              helperText={selectedRun.modelName}
              inputProps={{ ...params.inputProps, 'aria-label': 'Simulation folder' }}
              sx={{
                '& .MuiInputBase-root': {
                  background: tokens.tile,
                  fontFamily: tokens.mono,
                  fontSize: 11.5,
                },
                '& .MuiFormHelperText-root': {
                  mx: 0,
                  fontFamily: tokens.mono,
                  fontSize: 9.5,
                  color: tokens.sub,
                },
              }}
            />
          )}
        />
      ) : (
        <TextField
          disabled
          error={runs.isError}
          value={
            runs.isError
              ? 'Run index unavailable'
              : runs.isPending
                ? 'Loading simulation folders…'
                : 'No simulation folders'
          }
          helperText={
            runs.isError
              ? 'Could not load the simulation-folder index.'
              : 'Waiting for a repository run descriptor.'
          }
          inputProps={{ 'aria-label': 'Simulation folder' }}
          sx={{
            '& .MuiInputBase-root': {
              background: tokens.tile,
              fontFamily: tokens.mono,
              fontSize: 11.5,
            },
            '& .MuiFormHelperText-root': {
              mx: 0,
              fontFamily: tokens.mono,
              fontSize: 9.5,
              color: tokens.sub,
            },
          }}
        />
      )}
    </Stack>
  );
}
