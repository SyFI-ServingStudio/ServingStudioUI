export type AppView =
  | 'entry'
  | 'agent'
  | 'run'
  | 'aggregate'
  | 'prediction'
  | 'kernel-profile'
  | 'kernel-measurement'
  | 'file';

export function appViewFromHash(hash: string): AppView {
  const route = hash.split('?', 1)[0];
  if (route === '#/run') return 'run';
  if (route === '#/aggregate') return 'aggregate';
  if (route === '#/prediction') return 'prediction';
  if (route === '#/kernel-profile') return 'kernel-profile';
  if (route === '#/kernel-measurement') return 'kernel-measurement';
  if (route === '#/file') return 'file';
  if (route === '#/agent') return 'agent';
  return 'entry';
}

function resourceIdFromHash(hash: string, view: AppView, key: string, pattern: RegExp): string | null {
  if (appViewFromHash(hash) !== view) return null;
  const value = new URLSearchParams(hash.split('?', 2)[1] ?? '').get(key);
  return value !== null && pattern.test(value) ? value : null;
}

/** A timing prediction is a first-class Analyzer resource, just like a run. */
export function predictionIdFromHash(hash: string): string | null {
  return resourceIdFromHash(hash, 'prediction', 'prediction', /^p_[a-z0-9_]{1,64}$/);
}

export function kernelProfileIdFromHash(hash: string): string | null {
  return resourceIdFromHash(hash, 'kernel-profile', 'profile', /^kp_[a-z0-9_]{1,96}$/);
}

export function kernelMeasurementIdFromHash(hash: string): string | null {
  return resourceIdFromHash(
    hash,
    'kernel-measurement',
    'measurement',
    /^km_[a-z0-9_]{1,96}$/,
  );
}
