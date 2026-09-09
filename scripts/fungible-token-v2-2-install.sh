#!/usr/bin/env bash
set -euo pipefail

# Ensure package.json exists
if [ ! -f "package.json" ]; then
  npm init -y
fi

# Install runtime dependencies
npm install \
  @midnight-ntwrk/compact-runtime@^0.7.0 \
  @midnight-ntwrk/compact-js@^0.7.0

# Install development dependencies
npm install --save-dev \
  typescript@^5.4.0 \
  tsx@^4.7.0 \
  @types/node@^20.11.0