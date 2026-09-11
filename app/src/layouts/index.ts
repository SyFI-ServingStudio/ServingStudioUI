/**
 * One layout per result kind.
 *
 * A kind with no layout yet returns `null` rather than an empty layout: "this
 * kind has not been ported" and "this kind has no panels" are different
 * answers, and the shell says different things about them.
 */
import type { ResultKind } from '../location';
import { runLayout } from './run';
import { kernelMeasurementLayout } from './kernelMeasurement';
import { kernelProfileLayout } from './kernelProfile';
import { predictionLayout } from './prediction';
import { sweepLayout } from './sweep';
import { alignmentLayout } from './alignment';
import type { LayoutSpec } from './types';

const LAYOUTS: Partial<Record<ResultKind, LayoutSpec>> = {
  run: runLayout,
  kernelProfile: kernelProfileLayout,
  kernelMeasurement: kernelMeasurementLayout,
  prediction: predictionLayout,
  sweep: sweepLayout,
  alignment: alignmentLayout,
};

export function layoutFor(kind: ResultKind): LayoutSpec | null {
  return LAYOUTS[kind] ?? null;
}

export {
  frameOf,
  panelsOf,
  rowsOf,
  sectionsOf,
  type LayoutSpec,
  type Section,
  type SectionControl,
} from './types';
