# DocPythia

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An AI-powered documentation management platform that automatically monitors community discussions, identifies documentation gaps, and generates update proposals.

## Features

- **Multi-Source Ingestion**: Connect to Zulip, Telegram, Discord, or import from CSV files
- **AI-Powered Analysis**: Uses Google Gemini to classify messages and identify documentation opportunities
- **RAG-Based Context**: Vector similarity search to find relevant existing documentation
- **Proposal Generation**: Automatically generates documentation update proposals with suggested text
- **Admin Dashboard**: Review, edit, and approve documentation changes
- **PR Generation**: Create GitHub pull requests directly from approved proposals
- **Multi-Tenant**: Support multiple projects/instances with isolated configurations

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+ with pgvector extension
- Google Gemini API key (for AI analysis)

### Installation

```bash
# Clone the repository
git clone https://github.com/Lionscraft-io/DocPythia.git
cd docpythia

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Configure your environment variables (see Configuration below)

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate deploy

# Start development server
npm run dev
```

The application will be available at `http://localhost:3762`.

### Docker

```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build manually
docker build -t docpythia .
docker run -p 3762:8080 --env-file .env docpythia
```

See [DOCKER.md](./DOCKER.md) for detailed Docker deployment instructions.

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `GEMINI_API_KEY` | Google Gemini API key for AI analysis |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3762` |
| `NODE_ENV` | Environment mode | `development` |
| `WIDGET_DOMAIN` | Domain for embedded widget | `http://localhost:3762` |

### Stream Configuration

Configure message sources in `config/<instance>/instance.json`:

```json
{
  "project": {
    "name": "My Project",
    "shortName": "myproject"
  },
  "streams": [
    {
      "streamId": "zulip-community",
      "type": "zulipchat",
      "enabled": true
    }
  ]
}
```

See `config/instance.example.json` for the full configuration schema.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         DocPythia Platform                          │
├─────────────────────────────────────────────────────────────────┤
│  Message Sources          Processing Pipeline        Outputs     │
│  ┌─────────────┐         ┌─────────────────┐      ┌──────────┐  │
│  │   Zulip     │────────▶│  Stream Manager │─────▶│ Proposals│  │
│  │   Telegram  │         │  ┌───────────┐  │      │          │  │
│  │   Discord   │         │  │ Classifier│  │      │  GitHub  │  │
│  │   CSV       │         │  │   (LLM)   │  │      │   PRs    │  │
│  └─────────────┘         │  └───────────┘  │      └──────────┘  │
│                          │  ┌───────────┐  │      ┌──────────┐  │
│                          │  │    RAG    │  │      │  Admin   │  │
│                          │  │  Context  │  │      │Dashboard │  │
│                          │  └───────────┘  │      └──────────┘  │
│                          └─────────────────┘                     │
├─────────────────────────────────────────────────────────────────┤
│  PostgreSQL + pgvector          React + Tailwind                 │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

**Backend:**
- Express.js with TypeScript
- Prisma ORM with PostgreSQL
- pgvector for embeddings
- Google Gemini for AI analysis

**Frontend:**
- React 18 with TypeScript
- Tailwind CSS 4
- Radix UI components
- TanStack Query

## Development

```bash
# Run development server with hot reload
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type check
npm run check

# Lint code
npm run lint

# Format code
npm run format

# Build for production
npm run build
```

## Documentation

- [Docker Deployment](./DOCKER.md)
- [AWS Deployment Guide](./docs/AWS-DEPLOYMENT-GUIDE.md)
- [Design Guidelines](./docs/design_guidelines.md)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Security

For security issues, please see [SECURITY.md](./SECURITY.md).

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
