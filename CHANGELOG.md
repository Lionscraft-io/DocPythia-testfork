# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Open source release preparation
- MIT License
- Contributing guidelines (CONTRIBUTING.md)
- Security policy (SECURITY.md)
- GitHub Actions CI/CD workflow
- Issue and PR templates
- Dependabot configuration
- ESLint and Prettier configuration
- Comprehensive README documentation

### Changed
- Password hashing upgraded from SHA256 to bcrypt
- Removed hardcoded AWS App Runner domain from Dockerfile
- Improved .gitignore with comprehensive exclusions

### Security
- Environment files (.env) now properly excluded from version control
- Secure password hashing with bcrypt (cost factor 12)
- Legacy SHA256 hash support for migration period

## [1.0.0] - 2025-01-01

### Added
- Multi-source message ingestion (Zulip, Telegram, Discord, CSV)
- AI-powered message classification using Google Gemini
- RAG-based documentation context retrieval with pgvector
- Automatic documentation update proposal generation
- Admin dashboard for reviewing and approving proposals
- GitHub PR generation from approved proposals
- Multi-tenant instance configuration
- Batch processing with watermark tracking
- Conversation threading and grouping
- Real-time processing status monitoring

### Technical
- Express.js backend with TypeScript
- React 18 frontend with Tailwind CSS
- PostgreSQL with Prisma ORM
- pgvector for embedding storage
- Docker support with multi-stage builds

[Unreleased]: https://github.com/Lionscraft-io/DocPythia/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Lionscraft-io/DocPythia/releases/tag/v1.0.0
