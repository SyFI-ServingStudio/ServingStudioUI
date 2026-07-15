export const DEPLOYMENTS = ['unified', 'pd', 'afd'] as const;

export type Deployment = (typeof DEPLOYMENTS)[number];
