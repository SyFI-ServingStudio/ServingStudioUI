import KeyboardArrowDownRounded from '@mui/icons-material/KeyboardArrowDownRounded';
import { Box, ButtonBase, Popover, Stack, Typography } from '@mui/material';
import { useState } from 'react';

import { tokens, withAlpha } from '../../theme';
import CatalogTag, { type CatalogTagTone } from './CatalogTag';

/** Shared multi-select column filter for the Page 0 catalogs. */
export default function CatalogColumnFilter({
  label,
  options,
  selected,
  onToggle,
  onClear,
  optionLabel = (value) => value,
  tone,
}: {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  optionLabel?: (value: string) => string;
  tone: CatalogTagTone | ((value: string) => CatalogTagTone);
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = Boolean(anchor);
  return (
    <Box>
      <ButtonBase
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{
          mx: -0.6,
          px: 0.6,
          py: 0.65,
          borderRadius: 0.75,
          color: selected.length > 0 ? tokens.teal : tokens.sub,
          fontFamily: tokens.body,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0,
          textTransform: 'none',
          '&:hover': { background: withAlpha(tokens.teal, 0.055) },
          '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
        }}
      >
        {label}
        {selected.length > 0 && (
          <Box
            component="span"
            sx={{
              ml: 0.65,
              minWidth: 15,
              height: 15,
              px: 0.35,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 999,
              background: tokens.teal,
              color: tokens.tile,
              fontSize: 12,
              letterSpacing: 0,
            }}
          >
            {selected.length}
          </Box>
        )}
        <KeyboardArrowDownRounded
          sx={{
            ml: 0.25,
            fontSize: 14,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: `transform 160ms ${tokens.ease}`,
          }}
        />
      </ButtonBase>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.5,
              width: 250,
              maxHeight: 250,
              p: 1.2,
              borderRadius: 1.25,
              overflowY: 'auto',
              scrollbarWidth: 'thin',
              scrollbarColor: `${tokens.hair} transparent`,
            },
          },
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography
            sx={{
              color: tokens.sub,
              fontFamily: tokens.body,
              fontSize: 12,
              letterSpacing: '.11em',
              textTransform: 'none',
            }}
          >
            {label} options
          </Typography>
          <ButtonBase
            disabled={selected.length === 0}
            onClick={onClear}
            sx={{
              color: tokens.teal,
              fontFamily: tokens.body,
              fontSize: 12,
              '&.Mui-disabled': { color: tokens.sub2, opacity: 0.5 },
            }}
          >
            Clear
          </ButtonBase>
        </Stack>
        <Stack direction="row" useFlexGap flexWrap="wrap" sx={{ gap: 0.65 }}>
          {options.map((option) => {
            const active = selected.includes(option);
            return (
              <ButtonBase
                key={option}
                aria-pressed={active}
                onClick={() => onToggle(option)}
                sx={{
                  borderRadius: 0.75,
                  transition: `transform 200ms ${tokens.ease}, filter 200ms ${tokens.ease}`,
                  '&:hover': { transform: 'translateY(-1px)', filter: 'saturate(1.2)' },
                  '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
                }}
              >
                <CatalogTag
                  tone={typeof tone === 'function' ? tone(option) : tone}
                  selected={active}
                >
                  {optionLabel(option)}
                </CatalogTag>
              </ButtonBase>
            );
          })}
        </Stack>
      </Popover>
    </Box>
  );
}
