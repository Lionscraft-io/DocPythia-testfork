import { DocContent } from '../DocContent';

export default function DocContentExample() {
  const sections = [
    {
      id: 'intro',
      title: 'Getting Started',
      content: 'This guide will help you set up a validator node.',
      level: 1,
    },
    {
      id: 'requirements',
      title: 'Hardware Requirements',
      content:
        'Ensure your system meets the minimum specifications:\n\n• 8-Core CPU\n• 16GB RAM\n• 500GB SSD',
      level: 2,
    },
    {
      id: 'warning',
      title: 'Important',
      content: 'Make sure to backup your validator keys regularly.',
      type: 'warning' as const,
    },
  ];

  return (
    <div className="max-w-3xl">
      <DocContent sections={sections} />
    </div>
  );
}
