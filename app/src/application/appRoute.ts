export type AppView = 'entry' | 'agent' | 'run' | 'aggregate';

export function appViewFromHash(hash: string): AppView {
  const route = hash.split('?', 1)[0];
  if (route === '#/run') return 'run';
  if (route === '#/aggregate') return 'aggregate';
  if (route === '#/agent') return 'agent';
  return 'entry';
}
