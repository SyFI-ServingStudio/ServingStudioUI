export type AppView = 'entry' | 'agent' | 'run' | 'aggregate' | 'prediction' | 'job';

export function appViewFromHash(hash: string): AppView {
  const route = hash.split('?', 1)[0];
  if (route === '#/run') return 'run';
  if (route === '#/aggregate') return 'aggregate';
  if (route === '#/prediction') return 'prediction';
  if (route === '#/job') return 'job';
  if (route === '#/agent') return 'agent';
  return 'entry';
}

/** A timing prediction is a first-class Analyzer resource, just like a run. */
export function predictionIdFromHash(hash: string): string | null {
  if (appViewFromHash(hash) !== 'prediction') return null;
  const query = new URLSearchParams(hash.split('?', 2)[1] ?? '');
  const predictionId = query.get('prediction');
  return predictionId !== null && /^p_[a-z0-9_]{1,64}$/.test(predictionId) ? predictionId : null;
}
