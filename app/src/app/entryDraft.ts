import { codexRuntimeSelectionSchema, type CodexRuntimeSelection } from '../session/types';

const ENTRY_DRAFT_KEY = 'vibesim.entry.draft';

interface EntryDraft {
  readonly workspace: string;
  readonly prompt: string;
  readonly runtime: CodexRuntimeSelection;
}

export function storeEntryDraft(draft: EntryDraft): void {
  // This is the only handoff for the unsent prompt and runtime. If storage is
  // unavailable, navigation must stop: opening an empty composer would silently
  // discard the reader's question.
  window.sessionStorage.setItem(ENTRY_DRAFT_KEY, JSON.stringify(draft));
}

export function readEntryDraft(workspace: string): EntryDraft | null {
  try {
    const raw = window.sessionStorage.getItem(ENTRY_DRAFT_KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.workspace !== workspace || typeof value.prompt !== 'string') return null;
    const runtime = codexRuntimeSelectionSchema.safeParse(value.runtime);
    return runtime.success ? { workspace, prompt: value.prompt, runtime: runtime.data } : null;
  } catch {
    return null;
  }
}

export function clearEntryDraft(workspace: string): void {
  if (readEntryDraft(workspace) === null) return;
  try {
    window.sessionStorage.removeItem(ENTRY_DRAFT_KEY);
  } catch {
    // The composer already owns the prompt; storage cleanup is optional.
  }
}
