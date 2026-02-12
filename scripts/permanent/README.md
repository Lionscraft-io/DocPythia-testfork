# Permanent Scripts

Long-term utility scripts for DocPythia operations.

## Scripts

### kill-port.sh

Kills all running DocPythia application processes.

```bash
# Via npm (recommended)
npm run kill-port

# Direct
bash scripts/permanent/kill-port.sh
```

### startup.sh

Application startup entrypoint. Runs database migrations then starts the server.

### setup-telegram-bot.sql

SQL commands to configure a Telegram bot stream in the database.

### import-csv.sh / import-csv.ts

Import CSV data into the system via the admin API.

```bash
# Shell version
ADMIN_TOKEN=your_token bash scripts/permanent/import-csv.sh path/to/file.csv

# TypeScript version
ADMIN_TOKEN=your_token npx tsx scripts/permanent/import-csv.ts path/to/file.csv
```

## See Also

- `scripts/sql/` — SQL utilities (test data, stream status checks)
