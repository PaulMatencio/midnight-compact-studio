#!/usr/bin/env bash
# scripts/fungible-token-v2-install.sh

set -euo pipefail

echo "Installing Midnight Compact Runtime and TypeScript SDK dependencies..."

npm install --save \
  @midnight-ntwrk/compact-runtime \
  @midnight-ntwrk/compact-js

npm install --save-dev \
  typescript \
  tsx \
  @types/node