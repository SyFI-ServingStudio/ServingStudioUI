import type { ThemePalette } from './palettes';

/** Alpha variants follow the central palette instead of duplicating RGB literals. */
export function withAlpha(hex: string, opacity: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${opacity})`;
}

export function mixColor(from: string, to: string, amount: number): string {
  const weight = Math.max(0, Math.min(1, amount));
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  return (
    '#' +
    [16, 8, 0]
      .map((shift) => {
        const start = (a >> shift) & 255;
        return Math.round(start + (((b >> shift) & 255) - start) * weight)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

/** Chart and terminal roles are derived from the selected theme, never copied into components. */
export function createDetailColors(p: ThemePalette, mode: 'dark' | 'light' = 'dark') {
  const dim = (color: string) => mixColor(color, p.background, 0.25);
  const bright = (color: string) => mixColor(color, p.text, 0.3);
  const wash = (color: string) => mixColor(p.surface, color, 0.12);
  return {
    foregroundOnAccent: p.background,
    syntax: {
      comment: p.muted,
      keyword: p.red,
      string: p.green,
      number: p.amber,
      title: p.blue,
      type: p.violet,
      variable: p.blue,
    },
    tooltipText: p.text,
    tooltipBackground: p.elevated,
    borderHover: mixColor(p.border, p.text, 0.12),
    axis: p.border,
    sumSurface: wash(p.green),
    maxSurface: wash(p.amber),
    scaleSurface: wash(p.violet),
    gemm: dim(p.blue),
    attention: dim(p.green),
    collective: dim(p.red),
    normalization: dim(p.amber),
    routing: dim(p.violet),
    other: p.muted,
    hardwareOptimal: p.green,
    hardwareGap: p.blue,
    communication: p.red,
    batching: p.amber,
    imbalance: p.violet,
    idle: p.muted,
    necessary: dim(p.green),
    fusion: p.green,
    excess: bright(p.green),
    redundant: bright(p.green),
    violation: p.red,
    heatLow: wash(p.blue),
    heatMiddle: dim(p.blue),
    sweepLow: wash(p.blue),
    sweepMidLow: mixColor(p.surface, p.blue, 0.35),
    sweepMidHigh: mixColor(p.surface, p.blue, 0.6),
    sweepHigh: p.blue,
    redBright: bright(p.red),
    greenBright: bright(p.green),
    amberBright: bright(p.amber),
    blueBright: bright(p.blue),
    violetBright: bright(p.violet),
    cyanBright: bright(p.blue),
    redWash: wash(p.red),
    greenWash: wash(p.green),
    amberWash: wash(p.amber),
    blueWash: wash(p.blue),
    violetWash: wash(p.violet),
    cyanWash: wash(p.blue),
    operationPanel: [p.blue, p.green, p.red, p.amber, p.violet, p.muted].flatMap((c) => [
      dim(c),
      c,
      bright(c),
    ]),
    // One restrained hue for kernel identities; aggregate overhead uses separate roles.
    kernelLadder: [0.12, 0.42, 0.22, 0.52, 0.32, 0.62].map((amount) =>
      mixColor(p.blue, p.surface, amount),
    ),
    ladderImbalance: dim(p.amber),
    ladderIdle: p.muted,
    ladderNecessary: dim(p.green),
    scrim: 'rgba(0,0,0,.45)',
    shadowLift:
      mode === 'dark' ? '0 12px 32px -20px rgba(0,0,0,.5)' : '0 8px 24px -16px rgba(0,0,0,.18)',
    sidebarShadow: '16px 0 42px -30px rgba(0,0,0,.6)',
  };
}

/** Keep terminal-provided RGB values readable in either theme without changing their hue. */
export function readableTerminalColor(
  red: number,
  green: number,
  blue: number,
  mode: 'dark' | 'light',
): string {
  const channels = [red, green, blue].map((value) => Math.min(255, Math.max(0, value)));
  const luminance = (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255;
  const values =
    mode === 'light'
      ? channels.map((value) => value * (luminance > 0.45 ? 0.45 / luminance : 1))
      : channels.map((value) =>
          luminance < 0.55 ? value + ((255 - value) * (0.55 - luminance)) / (1 - luminance) : value,
        );
  return '#' + values.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('');
}
