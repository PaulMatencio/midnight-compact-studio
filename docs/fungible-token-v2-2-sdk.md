```markdown:docs/fungible-token-v2-2-sdk.md
# Technical Documentation: fungible-token-v2-2 SDK

## Overview
`fungible-token-v2-2` is an enterprise-grade fungible token smart contract implemented in Midnight's Compact language. It provides ERC-20-style balances and allowance mechanisms with Zero-Knowledge verification, combined with an Emergency Stop (circuit breaker) architecture and delegated pauser permissions.

## Key Features
- **Deterministic Identity & Authentication**: Caller authentication using secret key verification with domain-tagged persistent hashes.
- **Zero-Knowledge Minting & Burning**: Controlled supply updates restricted to verified contract owner or authenticated token holders.
- **Emergency Pause & Role Delegation**: Owner or dedicated emergency pausers can pause transfers, approvals, mints, and burns.
- **Emergency Asset Recovery**: When paused, designated owner recovery mechanisms allow token withdrawal to the verified owner address.
- **Safe Math & Boundary Enforcements**: Over/underflow checks and `Uint<128>` maximum supply caps.

---

## Contract State Architecture