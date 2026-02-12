// Database seeding - Prisma
// Migrated from Drizzle ORM
//
// NOTE: This file contains example seed data for demonstration purposes.
// For production use, documentation should be imported from your Git repository
// using the RAG documentation retrieval system (see docs/specs/rag-documentation-retrieval.md)
// or through the admin interface.
//
// This seed data is protocol-agnostic and should be replaced with your actual documentation.
import { db } from './db';
import type { Prisma } from '@prisma/client';

const sections: Prisma.DocumentationSectionCreateInput[] = [
  {
    sectionId: 'overview',
    title: 'Example Documentation',
    content:
      'This is example documentation seed data. In production, documentation should be imported from your Git repository using the RAG system configured in config/instance.json. Replace this with your actual documentation content.',
    level: 1,
    type: null,
    orderIndex: 0,
  },

  // Example Section
  {
    sectionId: 'getting-started',
    title: 'Getting Started',
    content:
      "Replace this section with your project's getting started guide. Documentation is automatically synced from the Git repository configured in config/instance.json.",
    level: 2,
    type: null,
    orderIndex: 1,
  },
  {
    sectionId: 'example-info',
    title: 'Configuration Notice',
    content:
      'This is example seed data. Your actual documentation should be synced from the Git repository specified in config/instance.json using the RAG documentation retrieval system.',
    type: 'info',
    orderIndex: 2,
  },
];

async function seed() {
  console.log('Seeding documentation sections...');

  for (const section of sections) {
    await db.documentationSection.create({ data: section });
  }

  console.log(`Seeded ${sections.length} documentation sections`);
  process.exit(0);
}

seed().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
