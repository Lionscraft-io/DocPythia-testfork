#!/bin/sh

# Startup script for production deployment
# Runs database migrations and starts the server

set -e

echo "========================================="
echo "Starting DocPythia"
echo "========================================="
echo ""

# Always run migrations (prisma migrate deploy is idempotent)
if [ -z "$DATABASE_URL" ]; then
    echo "⚠️  Warning: DATABASE_URL not set, skipping migrations"
else
    echo "📥 Running database migrations..."
    npx prisma migrate deploy
    echo "✓ Migrations complete"
fi
echo ""

# Start the application
echo "🚀 Starting server..."
exec node dist/index.js
