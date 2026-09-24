#!/usr/bin/env bash
# scripts/fungible-token-v2-4-install.sh
set -euo pipefail

npm install --save \
  @midnight-ntwrk/compact-runtime \
  @midnight-ntwrk/ledger \
  rxjs

npm install --save-dev \
  typescript \
  tsx \
  @types/node \
  vitest