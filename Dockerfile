# Multi-stage build for optimal production image
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma Client from schema
RUN npx prisma generate

# Set production environment for build
ENV NODE_ENV=production

# Build argument for widget domain (set via environment or build args)
ARG WIDGET_DOMAIN=http://localhost:3762
ENV VITE_WIDGET_DOMAIN=$WIDGET_DOMAIN

# Build the application (use production vite config, then esbuild with config)
RUN npx vite build --config vite.config.production.ts && \
    node esbuild.config.js

# Production stage
FROM node:20-alpine AS production

# Install git for documentation repository cloning
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy Prisma schema and migrations for database initialization
COPY prisma ./prisma

# Install only production dependencies (ignore scripts to skip husky)
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Generate Prisma Client in production stage
RUN npx prisma generate

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy server scripts for potential runtime initialization
COPY server ./server
COPY shared ./shared

# Copy instance configuration files (multi-tenant setup)
COPY config ./config

# Create a non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Create cache directories for LLM responses and documentation sync
# Instance-specific cache directories are created dynamically based on config
RUN mkdir -p /cache/llm && \
    mkdir -p /var/cache/docs && \
    mkdir -p /tmp/uploads && \
    chown -R nextjs:nodejs /cache && \
    chown -R nextjs:nodejs /var/cache && \
    chown -R nextjs:nodejs /tmp/uploads

# Change ownership of the app directory
RUN chown -R nextjs:nodejs /app

USER nextjs

# Expose the port that App Runner expects
EXPOSE 8080

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080
# WIDGET_DOMAIN should be set via environment variable at runtime

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Start the application
# Note: Migrations should be run manually or via CI/CD pipeline due to DATABASE_URL containing
# special characters that require URL encoding for Prisma CLI but not for the runtime connection
CMD ["node", "dist/index.js"]