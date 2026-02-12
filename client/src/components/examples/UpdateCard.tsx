import { UpdateCard } from '../UpdateCard';

export default function UpdateCardExample() {
  return (
    <div className="max-w-2xl space-y-4">
      <UpdateCard
        id="1"
        type="major"
        section="Validator / Setup"
        summary="Added new hardware requirements based on recent network upgrades"
        source="Zulipchat"
        timestamp="2 hours ago"
        status="pending"
        diff={{
          before: 'Minimum 4 CPU cores required',
          after: 'Minimum 8 CPU cores recommended for optimal performance',
        }}
        onApprove={(id) => console.log('Approved:', id)}
        onReject={(id) => console.log('Rejected:', id)}
      />
      <UpdateCard
        id="2"
        type="minor"
        section="RPC / Configuration"
        summary="Fixed typo in configuration example"
        source="Zulipchat"
        timestamp="1 day ago"
        status="auto-applied"
      />
    </div>
  );
}
