-- Import testdata.csv to Production Database
-- This script inserts 65 developer community messages for processing
-- Run this on your production RDS instance

-- Step 1: Create CSV stream configuration
INSERT INTO stream_configs (stream_id, adapter_type, config, enabled, created_at, updated_at)
VALUES (
  'csv-dev-community',
  'csv',
  '{"source": "testdata.csv", "channel": "dev-community"}'::jsonb,
  true,
  NOW(),
  NOW()
)
ON CONFLICT (stream_id)
DO UPDATE SET
  adapter_type = EXCLUDED.adapter_type,
  config = EXCLUDED.config,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

-- Step 2: Insert all messages from testdata.csv
INSERT INTO unified_messages (stream_id, message_id, timestamp, author, content, channel, raw_data, processing_status, created_at)
VALUES
  ('csv-dev-community', 'csv-1', '2025-10-28 20:50:00', 'Alex Chen', 'DevHelper: is there anyone looking for dev?', 'dev-community', '{"source": "testdata.csv", "line": 1}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-2', '2025-10-28 20:51:00', 'TechLead', 'TechLead: Yes', 'dev-community', '{"source": "testdata.csv", "line": 2}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-3', '2025-10-28 20:52:00', 'NewUser', 'NewUser: Hello, is here anyone who could help me run a node? I can''t seem to figure it out on my own. I have the hardware necessary to do it, and I have installed Ubuntu on a VM, I just don''t have the necessary skills to figure it out on my own.', 'dev-community', '{"source": "testdata.csv", "line": 3}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-4', '2025-10-28 20:53:00', 'Moderator', 'Moderator: Please be careful of scams', 'dev-community', '{"source": "testdata.csv", "line": 4}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-5', '2025-10-28 20:54:00', 'SupportBot', 'SupportBot: Open a support ticket and we will help you out', 'dev-community', '{"source": "testdata.csv", "line": 5}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-6', '2025-10-28 20:55:00', 'DevExpert', 'DevExpert: Hey NewUser. Check out the developer docs at https://docs.example.org/run-a-node/', 'dev-community', '{"source": "testdata.csv", "line": 6}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-7', '2025-10-28 20:56:00', 'Helper', 'Helper: Also check pinned messages in this channel', 'dev-community', '{"source": "testdata.csv", "line": 7}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-8', '2025-10-28 20:57:00', 'CryptoFan', 'CryptoFan: Hi, do I get it right that a PoS single node needs >1000 tokens to get ~11% APR?', 'dev-community', '{"source": "testdata.csv", "line": 8}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-9', '2025-10-28 20:58:00', 'SupportBot', 'SupportBot: Yes that is correct. A minimum of 1k tokens to stake and the APR is around 11.3%.', 'dev-community', '{"source": "testdata.csv", "line": 9}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-10', '2025-10-28 20:59:00', 'Helper', 'Helper: Average APR is 11.3%, but with only 1000 tokens it''s hard to get voting rights.', 'dev-community', '{"source": "testdata.csv", "line": 10}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-11', '2025-10-28 21:00:00', 'Moderator', 'Moderator: So, real APR will vary', 'dev-community', '{"source": "testdata.csv", "line": 11}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-12', '2025-10-28 21:01:00', 'NodeRunner', 'NodeRunner: Is there some way to prune old blocks? I don''t want to waste 1+TB of NVME just to store blocks that aren''t needed.', 'dev-community', '{"source": "testdata.csv", "line": 12}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-13', '2025-10-28 21:02:00', 'Moderator', 'Moderator: Why are you using a backslash to bypass the link protection', 'dev-community', '{"source": "testdata.csv", "line": 13}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-14', '2025-10-28 21:03:00', 'Moderator', 'Moderator: The two responses are a scam', 'dev-community', '{"source": "testdata.csv", "line": 14}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-15', '2025-10-28 21:04:00', 'Helper', 'Helper: Another one?', 'dev-community', '{"source": "testdata.csv", "line": 15}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-16', '2025-10-28 21:05:00', 'DevExpert', 'DevExpert: @DevHelper', 'dev-community', '{"source": "testdata.csv", "line": 16}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-17', '2025-10-28 21:06:00', 'DevHelper', 'DevHelper: Maybe you should use a light node instead if you are concerned about storage: https://docs.example.org/node-types', 'dev-community', '{"source": "testdata.csv", "line": 17}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-18', '2025-10-28 21:07:00', 'NodeRunner', 'NodeRunner: Light nodes cannot be used in PoS afaik', 'dev-community', '{"source": "testdata.csv", "line": 18}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-19', '2025-10-28 21:08:00', 'NodeRunner', 'NodeRunner: I want to run my PoS node but cannot waste 1+TB of NVME', 'dev-community', '{"source": "testdata.csv", "line": 19}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-20', '2025-10-28 21:09:00', 'NodeRunner', 'NodeRunner: Most chains have a prune function that allows you to delete old blocks and reduce disk usage', 'dev-community', '{"source": "testdata.csv", "line": 20}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-21', '2025-10-28 21:10:00', 'DevExpert', 'DevExpert: From the guide: A PoS node is also a full node. Either a full node or an archive node is fine.', 'dev-community', '{"source": "testdata.csv", "line": 21}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-22', '2025-10-28 21:11:00', 'NodeRunner', 'NodeRunner: No mention of light node', 'dev-community', '{"source": "testdata.csv", "line": 22}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-23', '2025-10-28 21:12:00', 'Helper', 'Helper: You can use btrfs + compression to have more space available', 'dev-community', '{"source": "testdata.csv", "line": 23}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-24', '2025-10-28 21:13:00', 'Helper', 'Helper: Check pinned messages in developers channel', 'dev-community', '{"source": "testdata.csv", "line": 24}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-25', '2025-10-28 21:14:00', 'Helper', 'Helper: developers?', 'dev-community', '{"source": "testdata.csv", "line": 25}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-26', '2025-10-28 21:15:00', 'NodeRunner', 'NodeRunner: Will try, thanks for the info!', 'dev-community', '{"source": "testdata.csv", "line": 26}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-27', '2025-10-28 21:16:00', 'NodeRunner', 'NodeRunner: I hope some prune function is added anyways, as storage will grow overtime', 'dev-community', '{"source": "testdata.csv", "line": 27}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-28', '2025-10-28 21:17:00', 'NodeRunner', 'NodeRunner: Still over a terabyte, will wait until something is done', 'dev-community', '{"source": "testdata.csv", "line": 28}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-29', '2025-10-28 21:18:00', 'DevExpert', 'DevExpert: https://example.com/status/123456789', 'dev-community', '{"source": "testdata.csv", "line": 29}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-30', '2025-10-28 21:19:00', 'ValidatorUser', 'ValidatorUser: Hello everyone, I am running a node since last year and would like to become a solo validator. I read the official documentation but would like CLI documentation.', 'dev-community', '{"source": "testdata.csv", "line": 30}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-31', '2025-10-28 21:20:00', 'BlockchainDev', 'BlockchainDev: For now I can confirm the staking step that references the governance docs.', 'dev-community', '{"source": "testdata.csv", "line": 31}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-32', '2025-10-28 21:21:00', 'BlockchainDev', 'BlockchainDev: This should be the technical docs for the registration step https://docs.example.org/validator-register', 'dev-community', '{"source": "testdata.csv", "line": 32}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-33', '2025-10-28 21:22:00', 'Helper', 'Helper: @ValidatorUser I''m not 100% sure, but I remember reading something about wallet deprecation.', 'dev-community', '{"source": "testdata.csv", "line": 33}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-34', '2025-10-28 21:23:00', 'Helper', 'Helper: Otherwise you can use the RPC API with the SDK', 'dev-community', '{"source": "testdata.csv", "line": 34}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-35', '2025-10-28 21:24:00', 'Helper', 'Helper: I''m not sure if there is direct documentation for RPC API available', 'dev-community', '{"source": "testdata.csv", "line": 35}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-36', '2025-10-28 21:25:00', 'ValidatorUser', 'ValidatorUser: Hi @Helper you mean the software wallet? My plan was to use the RPC API with curl.', 'dev-community', '{"source": "testdata.csv", "line": 36}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-37', '2025-10-28 21:26:00', 'CryptoExpert', 'CryptoExpert: Any cryptocurrency expert here? I got an issue I need assistance with.', 'dev-community', '{"source": "testdata.csv", "line": 37}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-38', '2025-10-28 21:27:00', 'BlockchainDev', 'BlockchainDev: How can we help?', 'dev-community', '{"source": "testdata.csv", "line": 38}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-39', '2025-10-28 21:28:00', 'NewNodeRunner', 'NewNodeRunner: Hello guys. I just downloaded the latest version, extracted the snapshot, but my node doesn''t work at all.', 'dev-community', '{"source": "testdata.csv", "line": 39}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-40', '2025-10-28 21:29:00', 'NewNodeRunner', 'NewNodeRunner: Also, this chat is full of scammers.', 'dev-community', '{"source": "testdata.csv", "line": 40}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-41', '2025-10-28 21:30:00', 'NewNodeRunner', 'NewNodeRunner: I get an error each time I start the node.', 'dev-community', '{"source": "testdata.csv", "line": 41}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-42', '2025-10-28 21:31:00', 'NewNodeRunner', 'NewNodeRunner: I just edited the config file as type of node = full. Nothing else.', 'dev-community', '{"source": "testdata.csv", "line": 42}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-43', '2025-10-28 21:32:00', 'Helper', 'Helper: /pos', 'dev-community', '{"source": "testdata.csv", "line": 43}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-44', '2025-10-28 21:33:00', 'InfoBot', 'InfoBot: Proof-of-Stake FAQ - Frequently Asked Questions', 'dev-community', '{"source": "testdata.csv", "line": 44}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-45', '2025-10-28 21:34:00', 'Helper', 'Helper: What''s your system, OS, hardware?', 'dev-community', '{"source": "testdata.csv", "line": 45}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-46', '2025-10-28 21:35:00', 'NewNodeRunner', 'NewNodeRunner: Solved the problem.', 'dev-community', '{"source": "testdata.csv", "line": 46}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-47', '2025-10-28 21:36:00', 'Helper', 'Helper: What was the solution?', 'dev-community', '{"source": "testdata.csv", "line": 47}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-48', '2025-10-28 21:37:00', 'StakingUser', 'StakingUser: What''s the benefit of being a node to help others stake?', 'dev-community', '{"source": "testdata.csv", "line": 48}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-49', '2025-10-28 21:38:00', 'StakingUser', 'StakingUser: Could you please answer the question I have asked?', 'dev-community', '{"source": "testdata.csv", "line": 49}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-50', '2025-10-28 21:39:00', 'DevExpert', 'DevExpert: When running a node, you can earn staking rewards, support the network''s decentralized security, and have voting rights.', 'dev-community', '{"source": "testdata.csv", "line": 50}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-51', '2025-10-28 21:40:00', 'BlockchainDev', 'BlockchainDev: A PoS pool can take a percentage of earned rewards, so it can be profitable', 'dev-community', '{"source": "testdata.csv", "line": 51}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-52', '2025-10-28 21:41:00', 'BlockchainDev', 'BlockchainDev: A PoS node just allows you the owner to stake', 'dev-community', '{"source": "testdata.csv", "line": 52}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-53', '2025-10-28 21:42:00', 'StakingUser', 'StakingUser: Got it, which means that if there''s more nodes, that would be more decentralized right?', 'dev-community', '{"source": "testdata.csv", "line": 53}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-54', '2025-10-28 21:43:00', 'BlockchainDev', 'BlockchainDev: Absolutely. More nodes is a good thing', 'dev-community', '{"source": "testdata.csv", "line": 54}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-55', '2025-10-28 21:44:00', 'ProtocolUser', 'ProtocolUser: Hello. According to GitHub, the hard fork is scheduled to activate on September 1st, but the page states August 31st. Which one?', 'dev-community', '{"source": "testdata.csv", "line": 55}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-56', '2025-10-28 21:45:00', 'BlockchainDev', 'BlockchainDev: You are right to use the block calculator, it will be more accurate.', 'dev-community', '{"source": "testdata.csv", "line": 56}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-57', '2025-10-28 21:46:00', 'DevHelper', 'DevHelper: Forwarded announcement: v3.0.1 Hardfork - upgrade required.', 'dev-community', '{"source": "testdata.csv", "line": 57}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-58', '2025-10-28 21:47:00', 'NodeOperator', 'NodeOperator: Hi! We''re experiencing sync issues with our mainnet node. The node remains stuck at epoch 130340000.', 'dev-community', '{"source": "testdata.csv", "line": 58}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-59', '2025-10-28 21:48:00', 'Moderator', 'Moderator: Why is this chat full of scams?', 'dev-community', '{"source": "testdata.csv", "line": 59}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-60', '2025-10-28 21:49:00', 'DevExpert', 'DevExpert: Did you upgrade to latest software?', 'dev-community', '{"source": "testdata.csv", "line": 60}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-61', '2025-10-28 21:50:00', 'NodeOperator', 'NodeOperator: Yes using the latest docker image', 'dev-community', '{"source": "testdata.csv", "line": 61}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-62', '2025-10-28 21:51:00', 'Helper', 'Helper: How long did you wait for it to sync? Sometimes the launch can be slow', 'dev-community', '{"source": "testdata.csv", "line": 62}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-63', '2025-10-28 21:52:00', 'NodeOperator', 'NodeOperator: Around 24 hours', 'dev-community', '{"source": "testdata.csv", "line": 63}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-64', '2025-10-28 21:53:00', 'Helper', 'Helper: /pos', 'dev-community', '{"source": "testdata.csv", "line": 64}'::jsonb, 'PENDING', NOW()),
  ('csv-dev-community', 'csv-65', '2025-10-28 21:54:00', 'InfoBot', 'InfoBot: Proof-of-Stake FAQ', 'dev-community', '{"source": "testdata.csv", "line": 65}'::jsonb, 'PENDING', NOW())
ON CONFLICT (stream_id, message_id) DO NOTHING;

-- Verify the import
SELECT
  stream_id,
  COUNT(*) as message_count,
  MIN(timestamp) as earliest_message,
  MAX(timestamp) as latest_message,
  COUNT(CASE WHEN processing_status = 'PENDING' THEN 1 END) as pending_count
FROM unified_messages
WHERE stream_id = 'csv-dev-community'
GROUP BY stream_id;
