-- Setup Telegram Bot Stream
-- Registers the Telegram bot adapter in the database
-- Run this after adding TELEGRAM_BOT_TOKEN to .env

-- Date: 2025-11-04

-- Insert Telegram bot stream configuration
INSERT INTO stream_configs (stream_id, adapter_type, config, enabled)
VALUES (
  'telegram-bot',
  'telegram-bot',
  jsonb_build_object(
    'botToken', 'YOUR_TELEGRAM_BOT_TOKEN',
    'mode', 'polling',
    'pollingInterval', 3000,
    'allowedChats', '[]'::jsonb,  -- Empty array = allow all chats
    'ignoreOldMessages', true,
    'processCommands', true,
    'saveRawUpdates', true
  ),
  true
)
ON CONFLICT (stream_id) DO UPDATE SET
  config = EXCLUDED.config,
  adapter_type = EXCLUDED.adapter_type,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

-- Verify insertion
SELECT
  stream_id,
  adapter_type,
  enabled,
  config->'mode' as mode,
  config->'processCommands' as commands_enabled,
  created_at
FROM stream_configs
WHERE stream_id = 'telegram-bot';

-- Show current streams
SELECT stream_id, adapter_type, enabled FROM stream_configs ORDER BY created_at;
