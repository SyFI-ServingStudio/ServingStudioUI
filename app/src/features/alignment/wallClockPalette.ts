import { GROUP, type GROUP_ORDER } from '../../domain/cost-tree';
import { tokens } from '../../theme';
import { rotatingOperationColors } from './operationSplitPalette';

/**
 * Every colour §04 draws, derived from the two palettes the app already owns.
 *
 * The card needs more categories than either palette names — fourteen mapped
 * operations, three iteration types, seven classes of host call, three NVTX
 * nesting depths — and inventing hex for them would fork the page's colour
 * language away from the rest of the app. So each family here is a *derivation*
 * of `GROUP` or `tokens`: operations use the shared rotating alignment operation
 * palette, host classes take an ordered slice of the section tokens, and
 * nesting depth is one token at three weights.
 */

export interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

/** Parse a `#rrggbb` token. The inputs are always palette constants, so a
 * malformed one is a programming error rather than user data. */
export function parseColor(color: string): Rgb {
  const value = Number.parseInt(color.slice(1), 16);
  return { red: (value >> 16) & 255, green: (value >> 8) & 255, blue: value & 255 };
}

export function formatRgba(color: Rgb, alpha = 1): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `rgba(${channel(color.red)}, ${channel(color.green)}, ${channel(color.blue)}, ${alpha})`;
}

/** Blend towards paper (`ratio` above zero) or towards ink (below zero). */
export function shade(color: string, ratio: number): string {
  const source = parseColor(color);
  const target = parseColor(ratio >= 0 ? tokens.paper : tokens.ink);
  const weight = Math.abs(ratio);
  return formatRgba({
    red: source.red + (target.red - source.red) * weight,
    green: source.green + (target.green - source.green) * weight,
    blue: source.blue + (target.blue - source.blue) * weight,
  });
}

export function withAlpha(color: string, alpha: number): string {
  return formatRgba(parseColor(color), alpha);
}

export interface OperationIdentity {
  readonly operation: string;
  readonly type: string;
}

/**
 * One rotating-panel colour per mapped operation, shared with the
 * operation-split view. The operation label is the lookup key only; its
 * spelling is not interpreted.
 */
export function operationColors(
  operations: readonly OperationIdentity[],
): Readonly<Record<string, string>> {
  return rotatingOperationColors(operations);
}

/** A kernel or slot the labeler tied to no operation. */
export const unmappedColor = shade(tokens.sub2, 0.35);

/** The five parts the span decomposes into, in span order. `forward` is named
 * apart from the other phases because it is the one the model prices. */
export const DUTY_SEGMENT_COLORS: Readonly<Record<string, string>> = {
  forwardBusy: GROUP.attn.color,
  forwardIdle: tokens.terra,
  otherBusy: shade(tokens.sub2, 0.22),
  otherIdle: shade(tokens.terra, 0.42),
  interPhase: tokens.gold,
};

/**
 * Host call classes, in the analyzer's own `api_classes` order.
 *
 * The order is the analyzer's, so the slice below is positional: `kernel
 * launch` first, `other runtime call` last. A capture that reports more classes
 * than there are tokens wraps, which repeats a colour rather than dropping one.
 */
const API_CLASS_TOKENS = [
  tokens.sectionAnalysis,
  tokens.teal,
  tokens.olive,
  tokens.terra,
  shade(tokens.sub2, 0.38),
  tokens.gold,
  shade(tokens.hair, 0.25),
] as const;

export function apiClassColor(classIndex: number): string {
  return API_CLASS_TOKENS[Math.max(0, classIndex) % API_CLASS_TOKENS.length];
}

/** NVTX nesting reads as one hue getting heavier with depth: an inner range is
 * contained by its outer one, not a different kind of thing. */
export function nvtxDepthColor(depth: number): string {
  const weights = [0.42, 0.18, -0.12];
  return shade(tokens.sub2, weights[Math.min(Math.max(0, depth), weights.length - 1)]);
}

/** Alternating bands so two adjacent phases are distinguishable without a key;
 * the phase names themselves are on the lane rows above. */
export function phaseBandColor(phaseIndex: number): string {
  return phaseIndex % 2 === 0 ? shade(tokens.sub2, 0.46) : shade(tokens.sub2, 0.2);
}

/** Wash behind an empty host lane, so "the scheduler did nothing here" reads as
 * an answer rather than as a missing row. */
export const laneBandColor = withAlpha(tokens.hair, 0.55);

export type KernelFamily = (typeof GROUP_ORDER)[number];
