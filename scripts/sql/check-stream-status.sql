-- ==============================================
-- Stream Configuration Diagnostic Queries
-- Run against the docpythia database
-- ==============================================

-- 1. Check what streams are configured
SELECT
  stream_id,
  adapter_type,
  enabled,
  created_at
FROM stream_configs
ORDER BY created_at DESC;

-- 2. Check stream watermarks (shows last fetch status)
SELECT
  stream_id,
  last_processed_time,
  last_processed_id,
  total_processed,
  metadata,
  updated_at
FROM stream_watermarks
ORDER BY updated_at DESC;

-- 3. Count messages by stream and processing status
SELECT
  stream_id,
  processing_status,
  COUNT(*) as count,
  MIN(timestamp) as oldest_message,
  MAX(timestamp) as newest_message
FROM unified_messages
GROUP BY stream_id, processing_status
ORDER BY stream_id, processing_status;

-- 4. Check total messages in system
SELECT
  processing_status,
  COUNT(*) as count
FROM unified_messages
GROUP BY processing_status;

-- 5. Check if there are ANY messages at all
SELECT COUNT(*) as total_messages FROM unified_messages;

-- 6. View recent messages (if any)
SELECT
  id,
  stream_id,
  author,
  LEFT(content, 100) as content_preview,
  timestamp,
  processing_status,
  created_at
FROM unified_messages
ORDER BY timestamp DESC
LIMIT 10;

-- 7. Check message classifications
SELECT
  category,
  COUNT(*) as count
FROM message_classifications
GROUP BY category
ORDER BY count DESC;

-- 8. Check processing watermark (batch processor status)
SELECT
  watermark_time,
  last_processed_batch,
  updated_at
FROM processing_watermarks;

-- 9. Check for any errors in stream metadata
SELECT
  stream_id,
  metadata::text
FROM stream_watermarks
WHERE metadata::text LIKE '%error%'
   OR metadata::text LIKE '%failed%';

-- 10. Check if Zulip stream is enabled
SELECT
  stream_id,
  config::json->>'site' as site,
  config::json->>'channel' as channel,
  enabled
FROM stream_configs
WHERE adapter_type = 'zulip';
