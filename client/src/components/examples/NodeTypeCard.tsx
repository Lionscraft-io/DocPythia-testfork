import { NodeTypeCard } from '../NodeTypeCard';
import { Server } from 'lucide-react';

export default function NodeTypeCardExample() {
  return (
    <div className="max-w-sm">
      <NodeTypeCard
        title="Validator Node"
        description="Participate in consensus and produce blocks and chunks on the network."
        icon={Server}
        href="/validator"
      />
    </div>
  );
}
