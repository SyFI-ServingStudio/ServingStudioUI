/** View-model types shared by the unchanged Agent transcript and outline. */
export interface ConversationTokens {
  readonly read: number;
  readonly prefill: number;
  readonly output: number;
}

export type CommentaryLevel = 'progress' | 'milestone';
export type AgentTerminalOutcome = 'final_answer' | 'request_user_input' | 'cancelled';

export type CodexServiceTier = 'default' | 'fast';

export interface CodexRoleRuntime {
  readonly provider?: string;
  readonly model: string;
  readonly effort: string;
  readonly serviceTier: CodexServiceTier;
}

export interface CodexRuntimeSelection {
  readonly orchestrator: CodexRoleRuntime;
  readonly implementer: CodexRoleRuntime;
  readonly assistant: CodexRoleRuntime;
}

export type AgentMode = 'orchestrated' | 'single';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface AgentSettings {
  readonly sandbox: SandboxMode;
  readonly agentMode: AgentMode;
  readonly autonomous: boolean;
}

export interface CodexModelOption {
  readonly id: string;
  readonly label: string;
  readonly family: string;
  readonly familyLabel: string;
  readonly efforts: readonly string[];
  readonly defaultEffort: string;
  readonly serviceTiers: readonly CodexServiceTier[];
  readonly defaultServiceTier: CodexServiceTier;
  readonly available: boolean;
}

export type ConversationTurnEvent =
  | {
      readonly kind: 'intermediate_output';
      readonly role: string;
      readonly model?: string;
      readonly effort?: string;
      readonly level?: CommentaryLevel;
      readonly text: string;
    }
  | {
      readonly kind: 'usage';
      readonly role: string;
      readonly model?: string;
      readonly effort?: string;
      readonly duration_ms: number;
      readonly tokens: ConversationTokens;
    }
  | { readonly kind: 'decision'; readonly action: string; readonly task: string }
  | { readonly kind: 'implementer'; readonly text: string }
  | {
      readonly kind: 'job';
      readonly workspaceId: string;
      readonly status: string;
      readonly experimentId: string;
      readonly experimentPath: string;
      readonly jobId: string;
      readonly jobKind?: string;
      readonly resourceId?: string;
      readonly analyzerResourceId?: string;
      readonly artifactPath?: string;
      readonly descriptor?: Record<string, unknown>;
      readonly summary?: Record<string, unknown> | null;
    }
  | { readonly kind: 'error'; readonly text: string }
  | {
      readonly kind: 'final';
      readonly text: string;
      readonly outcome?: AgentTerminalOutcome;
    };

export interface ConversationMessage {
  readonly role: string;
  readonly content: string;
  readonly activity?: readonly ConversationTurnEvent[] | null;
  readonly citations?: readonly AgentCitation[] | null;
  readonly failure?: { readonly message: string } | null;
}

export interface AgentCitation {
  readonly protocol: string;
  readonly token: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly displayLabel: string;
  readonly target: unknown;
}

export type ConversationUpdatedAt = number | string | undefined;

export interface AgentConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly updated_at?: ConversationUpdatedAt;
}

/** Another workspace's conversations, listed so the history rail can jump there. */
export interface AgentWorkspaceConversations {
  readonly id: string;
  readonly label: string;
  readonly conversations: readonly AgentConversationSummary[];
}
