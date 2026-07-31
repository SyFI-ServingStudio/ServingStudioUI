import type { ConversationSummary } from '../../application/conversationRepository';

export function conversationTimeLabel(updatedAt: ConversationSummary['updated_at']): string {
  if (updatedAt === undefined || updatedAt === '') return '';
  const numeric = typeof updatedAt === 'number' ? updatedAt : Number(updatedAt);
  const parsed = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(updatedAt));
  if (Number.isNaN(parsed.getTime())) return '';
  const today = new Date();
  if (parsed.toDateString() === today.toDateString()) {
    return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
