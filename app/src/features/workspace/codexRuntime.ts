import type { CodexRuntimeSelection } from '../../application/conversationRepository';

/** Placeholder until the catalog answers; the picker renders nothing for it. */
export const EMPTY_RUNTIME_SELECTION: CodexRuntimeSelection = {
  orchestrator: { model: '', effort: '', serviceTier: 'default' },
  implementer: { model: '', effort: '', serviceTier: 'default' },
  assistant: { model: '', effort: '', serviceTier: 'default' },
};
