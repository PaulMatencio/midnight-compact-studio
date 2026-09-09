#!/usr/bin/env bash
set -euo pipefail

npm install --save \
  @midnight-ntwrk/compact-runtime \
  @midnight-ntwrk/compact-js

npm install --save-dev \
  typescript \
  tsx \
  @types/node