import type { Run } from './domain/run';

export const fmtInt = (n: number): string => n.toLocaleString('en-US');

export function shortName(r: Run): string {
  const modelFile = r.model.split('/').pop() ?? r.model;
  const modelStem = modelFile.replace(/\.json$/i, '').replace(/[_-]+/g, ' ');
  return `${modelStem} · ${r.deployment.toUpperCase()}`;
}
