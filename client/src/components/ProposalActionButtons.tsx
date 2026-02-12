import { Button } from '@/components/ui/button';
import { Edit, CheckCircle, XCircle, Undo } from 'lucide-react';

interface ProposalActionButtonsProps {
  proposalId: number;
  status: 'pending' | 'approved' | 'ignored';
  onEdit: () => void;
  onApprove: () => void;
  onIgnore: () => void;
  onReset: () => void;
  disabled?: boolean;
}

export function ProposalActionButtons({
  proposalId: _proposalId,
  status,
  onEdit,
  onApprove,
  onIgnore,
  onReset,
  disabled = false,
}: ProposalActionButtonsProps) {
  if (status === 'pending') {
    return (
      <div className="flex items-center gap-2">
        <Button
          onClick={onEdit}
          variant="outline"
          size="sm"
          disabled={disabled}
          className="text-xs"
        >
          <Edit className="w-3 h-3 mr-1" />
          Edit
        </Button>
        <Button
          onClick={onApprove}
          variant="default"
          size="sm"
          disabled={disabled}
          className="bg-green-600 hover:bg-green-700 text-white text-xs"
        >
          <CheckCircle className="w-3 h-3 mr-1" />
          Add to Changeset
        </Button>
        <Button
          onClick={onIgnore}
          variant="default"
          size="sm"
          disabled={disabled}
          className="bg-red-600 hover:bg-red-700 text-white text-xs"
        >
          <XCircle className="w-3 h-3 mr-1" />
          Discard
        </Button>
      </div>
    );
  }

  // For approved or ignored status, show reset button
  return (
    <Button
      onClick={onReset}
      variant="default"
      size="sm"
      disabled={disabled}
      className={`text-xs ${
        status === 'approved'
          ? 'bg-orange-600 hover:bg-orange-700 text-white'
          : 'bg-blue-600 hover:bg-blue-700 text-white'
      }`}
    >
      <Undo className="w-3 h-3 mr-1" />
      Remove from {status === 'approved' ? 'Changeset' : 'Discarded'}
    </Button>
  );
}
