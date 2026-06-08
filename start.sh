#!/bin/bash
set -e
cd "$(dirname "$0")"
git pull origin main
if [ ! -d node_modules ] || [ package.json -nt node_modules/.package-lock.json ] 2>/dev/null; then
  npm install --silent
fi
npm run server &
npm run oracle &
npm run dev
