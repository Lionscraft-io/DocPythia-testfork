#!/bin/bash

# Test script for Docker build and run
set -e

echo "🧪 Testing Docker build for DocPythia..."

# Build the image
echo "📦 Building Docker image..."
docker build -t docpythia-test .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed"
    exit 1
fi

echo "✅ Docker image built successfully"

# Test the container
echo "🚀 Testing container..."
echo "   Starting container on port 3000 (local test)..."

# Run the container with minimal environment variables for testing
docker run -d \
  --name docpythia-test \
  -p 3000:8080 \
  -e NODE_ENV=production \
  -e PORT=8080 \
  -e DATABASE_URL=postgresql://test:test@localhost:5432/test \
  -e ADMIN_TOKEN=test-token \
  docpythia-test

if [ $? -ne 0 ]; then
    echo "❌ Container failed to start"
    exit 1
fi

echo "⏳ Waiting for container to start..."
sleep 5

# Test health endpoint
echo "🔍 Testing health endpoint..."
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health || echo "000")

if [ "$response" = "200" ]; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed (HTTP $response)"
    echo "📋 Container logs:"
    docker logs docpythia-test
fi

# Test main page
echo "🔍 Testing main page..."
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || echo "000")

if [ "$response" = "200" ]; then
    echo "✅ Main page accessible"
else
    echo "⚠️  Main page returned HTTP $response (may be expected without database)"
fi

echo ""
echo "📋 Container information:"
docker ps --filter name=docpythia-test

echo ""
echo "🧹 Cleaning up..."
docker stop docpythia-test
docker rm docpythia-test

echo ""
echo "🎉 Docker test complete!"
echo ""
echo "💡 To run the container manually:"
echo "   docker run -p 3000:8080 --env-file .env docpythia-test"