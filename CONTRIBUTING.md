# Contributing to DocPythia

Thank you for your interest in contributing to DocPythia! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/Lionscraft-io/DocPythia/issues)
2. If not, create a new issue using the bug report template
3. Include:
   - Clear description of the bug
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, Node version, etc.)
   - Screenshots if applicable

### Suggesting Features

1. Check existing issues and discussions for similar suggestions
2. Create a new issue using the feature request template
3. Describe the use case and expected behavior
4. Explain why this would benefit other users

### Pull Requests

1. Fork the repository
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Make your changes following our coding standards
4. Write or update tests as needed
5. Ensure all tests pass:
   ```bash
   npm test
   ```
6. Commit with clear, descriptive messages
7. Push to your fork and create a pull request

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR-USERNAME/docpythia.git
cd docpythia

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Start PostgreSQL (Docker recommended)
docker-compose up -d db

# Run migrations
npx prisma migrate deploy

# Start development server
npm run dev
```

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Avoid `any` types; use proper typing
- Document complex functions with JSDoc comments

### Code Style

- Use ESLint and Prettier for formatting
- Run `npm run lint` before committing
- Follow existing patterns in the codebase

### File Organization

```
server/           # Backend code
  routes/         # API route handlers
  services/       # Business logic
  stream/         # Message stream processing
  auth/           # Authentication utilities
client/           # Frontend React code
  components/     # React components
  pages/          # Page components
  hooks/          # Custom React hooks
tests/            # Test files
docs/             # Documentation
```

### Commit Messages

Use clear, descriptive commit messages:

```
feat: Add Discord stream adapter
fix: Resolve authentication token expiry issue
docs: Update installation instructions
test: Add unit tests for proposal service
refactor: Extract LLM logic into separate module
```

### Testing

- Write tests for new features
- Maintain or improve test coverage
- Use descriptive test names
- Test edge cases and error conditions

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- tests/your-test.test.ts
```

## Pull Request Process

1. **Title**: Use a clear, descriptive title
2. **Description**: Explain what changes you made and why
3. **Tests**: Ensure all tests pass
4. **Documentation**: Update docs if needed
5. **Review**: Address reviewer feedback promptly

### PR Checklist

- [ ] Tests pass locally
- [ ] Code follows project style guidelines
- [ ] Documentation updated (if applicable)
- [ ] No console.log statements (use logger)
- [ ] No hardcoded credentials or secrets

## Getting Help

- Check existing documentation in `/docs`
- Search closed issues for similar questions
- Open a discussion for general questions

## Recognition

Contributors will be recognized in our release notes and contributor list.

Thank you for contributing to DocPythia!
