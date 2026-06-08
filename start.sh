#!/bin/bash
set -e
cd "$(dirname "$0")"
git pull origin main
npm install --silent
npm run server &
npm run oracle &
npm run dev
