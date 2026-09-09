/** Shared reading scale. Keep browser zoom independent of application layout. */
export const metrics = {
  fontScale: 1.125,
  pageWidth: '80%',
  readingWidth: '45rem',
} as const;

// Existing sx numbers use the original 16px design baseline. Converting them
// to rem lets the root reading scale apply consistently, including breakpoints.
export const fontRem = (size: number): string => `${size / 16}rem`;
export const chartFont = (size: number): number => size * metrics.fontScale;
export const pageLayout = { width: metrics.pageWidth, minWidth: 0, mx: 'auto' } as const;
