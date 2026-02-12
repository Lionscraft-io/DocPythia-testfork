import { TableOfContents } from '../TableOfContents';

export default function TableOfContentsExample() {
  const items = [
    { id: 'intro', title: 'Introduction', level: 2 },
    { id: 'setup', title: 'Setup', level: 2 },
    { id: 'config', title: 'Configuration', level: 3 },
    { id: 'running', title: 'Running the Node', level: 2 },
  ];

  return (
    <div className="max-w-xs">
      <TableOfContents items={items} activeId="setup" />
    </div>
  );
}
