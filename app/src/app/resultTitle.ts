/** How the application names a result: its kind's title and its catalog name. */

/** A result's catalog name without its `YYYYMMDD_N_` prefix. */
export function displayResultName(value: string): string {
  return value.replace(/^\d{8}_\d+_/, '');
}

/** What a result of each kind is called. */
export const RESULT_TITLE = {
  sweep: 'Sweep',
  prediction: 'Timing prediction',
  alignment: 'Alignment',
  kernelProfile: 'Kernel profile',
  kernelMeasurement: 'Kernel measurement',
  run: 'Run',
} as const;
