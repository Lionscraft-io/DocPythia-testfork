import type { PendingUpdate } from '@shared/schema';

export interface ConversationData {
  conversation_id: string;
  category: string;
  message_count: number;
  messages: any[];
  rag_context?: any;
  proposals: any[];
  created_at: string;
}

export interface FlattenedUpdate extends PendingUpdate {
  page?: string; // For PRPreviewModal compatibility
  conversationContext: {
    conversation_id: string;
    category: string;
    messages: any[];
  };
}

export function flattenConversations(
  conversations: ConversationData[] | undefined
): FlattenedUpdate[] {
  const flattened: FlattenedUpdate[] = [];

  if (!conversations || !Array.isArray(conversations)) {
    return flattened;
  }

  for (const conv of conversations) {
    if (!conv || !conv.proposals) {
      continue;
    }

    for (const proposal of conv.proposals || []) {
      flattened.push({
        id: proposal.id.toString(),
        sectionId: proposal.page || 'Unknown section',
        page: proposal.page, // For PRPreviewModal compatibility
        type: mapUpdateType(proposal.update_type || proposal.updateType),
        summary: proposal.reasoning || 'Documentation update',
        source: `Conversation ${conv.conversation_id.substring(0, 8)}`,
        status: mapStatus(proposal.status),
        diffBefore: null,
        diffAfter:
          proposal.edited_text ||
          proposal.suggested_text ||
          proposal.editedText ||
          proposal.suggestedText,
        createdAt: proposal.created_at || proposal.createdAt || conv.created_at,
        reviewedAt: proposal.admin_reviewed_at || proposal.adminReviewedAt,
        reviewedBy: proposal.admin_reviewed_by || proposal.adminReviewedBy,
        conversationContext: {
          conversation_id: conv.conversation_id,
          category: conv.category,
          messages: conv.messages || [],
        },
      });
    }
  }

  return flattened;
}

function mapUpdateType(updateType: string): 'minor' | 'major' | 'add' | 'delete' {
  const mapping: Record<string, 'minor' | 'major' | 'add' | 'delete'> = {
    INSERT: 'add',
    UPDATE: 'major',
    DELETE: 'delete',
    NONE: 'minor',
  };
  return mapping[updateType] || 'major';
}

function mapStatus(status: string): 'pending' | 'approved' | 'rejected' | 'auto-applied' {
  const mapping: Record<string, 'pending' | 'approved' | 'rejected' | 'auto-applied'> = {
    pending: 'pending',
    approved: 'approved',
    ignored: 'rejected',
  };
  return mapping[status] || 'pending';
}
