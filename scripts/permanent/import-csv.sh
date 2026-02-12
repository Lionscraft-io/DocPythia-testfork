#!/bin/bash

# CSV Import Script
# Usage: ./scripts/permanent/import-csv.sh <path-to-csv-file>
#
# This script:
# 1. Copies CSV file to inbox directory
# 2. Triggers processing via API
# 3. Shows results and processing report

set -e

# Check arguments
if [ $# -eq 0 ]; then
    echo "❌ Error: No CSV file provided"
    echo ""
    echo "Usage: ./scripts/permanent/import-csv.sh <path-to-csv-file>"
    echo ""
    echo "Example:"
    echo "  ./scripts/permanent/import-csv.sh /path/to/messages.csv"
    exit 1
fi

CSV_FILE="$1"

# Check if file exists
if [ ! -f "$CSV_FILE" ]; then
    echo "❌ Error: File not found: $CSV_FILE"
    exit 1
fi

# Configuration
INBOX_DIR="${CSV_INBOX_DIR:-/tmp/csv-test/inbox}"
PROCESSED_DIR="${CSV_PROCESSED_DIR:-/tmp/csv-test/processed}"
API_URL="${API_URL:-http://localhost:3762}"
ADMIN_TOKEN="${ADMIN_TOKEN:-changeme}"
STREAM_ID="${STREAM_ID:-csv-test}"

echo "============================================"
echo "CSV Import Tool"
echo "============================================"
echo ""
echo "File: $CSV_FILE"
echo "Stream: $STREAM_ID"
echo "Inbox: $INBOX_DIR"
echo ""

# Ensure inbox directory exists
mkdir -p "$INBOX_DIR"

# Copy file to inbox
FILENAME=$(basename "$CSV_FILE")
echo "📂 Copying file to inbox..."
cp "$CSV_FILE" "$INBOX_DIR/$FILENAME"
echo "✓ File copied: $INBOX_DIR/$FILENAME"
echo ""

# Trigger processing
echo "⚙️  Triggering processing via API..."
RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"streamId\": \"$STREAM_ID\", \"batchSize\": 100}" \
  "$API_URL/api/admin/stream/process")

echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

# Wait a moment for file to be processed
echo "⏳ Waiting for processing to complete..."
sleep 2

# Check if file was moved to processed directory
if [ -f "$INBOX_DIR/$FILENAME" ]; then
    echo "⚠️  File still in inbox - processing may have failed"
else
    echo "✓ File moved to processed directory"

    # Find and display processing report
    REPORT_FILE=$(ls -t "$PROCESSED_DIR"/*_${FILENAME}.report.json 2>/dev/null | head -1)
    if [ -f "$REPORT_FILE" ]; then
        echo ""
        echo "📊 Processing Report:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        cat "$REPORT_FILE" | jq '.'
        echo ""
    fi
fi

# Get overall statistics
echo "📈 Overall Statistics:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
STATS=$(curl -s \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_URL/api/admin/stream/stats")

echo "$STATS" | jq '.' 2>/dev/null || echo "$STATS"
echo ""

echo "============================================"
echo "Import Complete!"
echo "============================================"
echo ""
echo "View results in admin dashboard:"
echo "  $API_URL/api/admin/stream/messages"
echo ""
