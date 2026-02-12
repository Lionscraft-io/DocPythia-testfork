# Tests

This directory contains unit and integration tests.

## Structure

```
/tests/
  /unit/          - Unit tests for individual functions/components
  /integration/   - Integration tests for workflows
  /e2e/           - End-to-end tests
  /fixtures/      - Test data and fixtures
```

## Running Tests

```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests only
```

## Standards

- All new features require tests
- Maintain test coverage above 80%
- Tests must pass before merging to main
