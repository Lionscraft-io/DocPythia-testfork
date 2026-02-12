# Docker Setup for DocPythia

This document explains how to build and deploy the DocPythia application using Docker for AWS App Runner.

## Files

- `Dockerfile` - Multi-stage build configuration optimized for production
- `.dockerignore` - Excludes unnecessary files from build context
- `test-docker.sh` - Local testing script
- `.env.example` - Example environment variables

## Prerequisites

- Docker installed and running
- AWS CLI configured with appropriate permissions
- ECR repository created (e.g., `<AWS_ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/docpythia`)

## Local Testing

1. **Test the Docker build:**
   ```bash
   ./test-docker.sh
   ```

2. **Manual build and run:**
   ```bash
   # Build
   docker build -t docpythia .

   # Run with environment file
   cp .env.example .env
   # Edit .env with your values
   docker run -p 3000:8080 --env-file .env docpythia
   ```

3. **Test endpoints:**
   - Health check: http://localhost:3000/api/health
   - Main app: http://localhost:3000/

## AWS Deployment

Deployments are handled by GitHub Actions CI/CD. See [AWS Deployment Guide](docs/AWS-DEPLOYMENT-GUIDE.md) for full setup.

## Environment Variables

Required environment variables for production:

```bash
# Database (required)
DATABASE_URL=postgresql://username:password@host:port/database

# Admin access (required)
ADMIN_TOKEN=your_secure_admin_token

# Optional features
SCHEDULER_ENABLED=false
GOOGLE_AI_API_KEY=your_api_key
OPENAI_API_KEY=your_api_key
```

## App Runner Configuration

When creating the App Runner service:

- **Source**: Amazon ECR
- **Image**: `<AWS_ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/docpythia:latest`
- **Port**: 8080
- **Environment variables**: Set from AWS Secrets Manager or directly in console

## Troubleshooting

1. **Build fails**: Check that all dependencies are properly listed in package.json
2. **Health check fails**: Verify DATABASE_URL and other required environment variables
3. **App Runner deployment issues**: Check AWS CloudWatch logs for detailed error messages

## Architecture

The Dockerfile uses a multi-stage build:

1. **Builder stage**: Installs all dependencies and builds the application
2. **Production stage**: Creates minimal image with only runtime dependencies and built assets

This results in a smaller, more secure production image.