#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then cp .env.example .env; fi
echo 'ANNON AI OFFICE local demo at http://127.0.0.1:4173'
node --experimental-sqlite src/server.mjs
