#!/bin/bash
# Kill all DocPythia application processes

echo "Killing processes on port 3762..."
lsof -ti :3762 2>/dev/null | xargs -r kill -9 2>/dev/null

echo "Killing tsx server processes..."
pkill -9 -f 'tsx.*server/index' 2>/dev/null

echo "All app processes killed successfully!"
