import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface EditProposalModalProps {
  proposal: {
    id: number;
    suggested_text?: string;
    edited_text?: string;
    page: string;
    section?: string;
  } | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (proposalId: number, text: string) => void;
  isSaving?: boolean;
}

export function EditProposalModal({
  proposal,
  isOpen,
  onClose,
  onSave,
  isSaving = false,
}: EditProposalModalProps) {
  const [editedText, setEditedText] = useState('');

  useEffect(() => {
    if (proposal) {
      // Use edited_text if available, otherwise use suggested_text
      setEditedText(proposal.edited_text || proposal.suggested_text || '');
    }
  }, [proposal]);

  const handleSave = () => {
    if (proposal && editedText.trim()) {
      onSave(proposal.id, editedText);
    }
  };

  const handleCancel = () => {
    onClose();
    // Reset to original text
    if (proposal) {
      setEditedText(proposal.edited_text || proposal.suggested_text || '');
    }
  };

  if (!proposal) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Proposal Text</DialogTitle>
          <DialogDescription>
            Editing proposal for <strong>{proposal.page}</strong>
            {proposal.section && (
              <>
                {' '}
                &gt; <strong>{proposal.section}</strong>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Suggested Text</label>
            <Textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="min-h-[300px] font-mono text-sm"
              placeholder="Enter the documentation text..."
            />
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <span>{editedText.length.toLocaleString()} characters</span>
              {editedText.length > 10000 && (
                <span className="text-red-600">Maximum 10,000 characters</span>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleCancel} variant="outline" disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !editedText.trim() || editedText.length > 10000}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
