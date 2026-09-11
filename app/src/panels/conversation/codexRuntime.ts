import type { CodexModelOption, CodexRoleRuntime, CodexRuntimeSelection } from './agentTypes';

export function runtimeModel(
  models: readonly CodexModelOption[],
  runtime: CodexRoleRuntime,
): CodexModelOption | undefined {
  const matches = models.filter(
    (model) =>
      model.id === runtime.model &&
      (runtime.provider === undefined || model.family === runtime.provider),
  );
  // Old histories omit the connection; ambiguous IDs must not select another account.
  return matches.length === 1 ? matches[0] : undefined;
}

/** Placeholder until the catalog answers; the picker renders nothing for it. */
export const EMPTY_RUNTIME_SELECTION: CodexRuntimeSelection = {
  orchestrator: { model: '', effort: '', serviceTier: 'default' },
  implementer: { model: '', effort: '', serviceTier: 'default' },
  assistant: { model: '', effort: '', serviceTier: 'default' },
};
