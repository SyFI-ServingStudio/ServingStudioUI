/** How the application names a result: its kind's title and its catalog name. */
import type { ResultKind } from '../location';

/** A result's catalog name without its `YYYYMMDD_N_` prefix. */
export function displayResultName(value: string): string {
  return value.replace(/^\d{8}_\d+_/, '');
}

/** What a result of each kind is called, wherever the application names one. */
export const RESULT_TITLE: Readonly<Record<ResultKind, string>> = {
  sweep: 'Simulation',
  prediction: 'Timing prediction',
  alignment: 'Alignment',
  kernelProfile: 'Kernel profile',
  kernelMeasurement: 'Kernel measurement',
  run: 'Run',
};
