# scripts/fungible-token-v2-install.sh
#!/usr/bin/env bash
set -euo pipefail

echo "Installing Midnight Compact Runtime and TypeScript dependencies..."
npm install @midnight-ntwrk/compact-runtime@^0.8.0
npm install --save-dev typescript@^5.6.0 tsx@^4.19.0 @types/node@^20.0.0
echo "Installation complete."