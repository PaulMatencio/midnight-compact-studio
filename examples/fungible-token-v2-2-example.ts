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

```
Ledger State:
 ├── _balances: Map<Bytes<32>, Uint<128>>
 ├── _allowances: Map<[Bytes<32>, Bytes<32>], Uint<128>>
 ├── _totalSupply: Uint<128>
 ├── _maxSupply: Uint<128>
 ├── _name: Opaque<"string">
 ├── _symbol: Opaque<"string">
 ├── _decimals: Uint<8>
 ├── owner: Bytes<32>
 ├── _paused: Boolean
 └── _emergencyPauser: Bytes<32>
```

---

## SDK API Reference

### 1. Initialization
```typescript
import { FungibleTokenSDK } from './src/client/fungible-token-v2-2-sdk.js';

const secretKey = FungibleTokenSDK.hexToBytes('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
const sdk = new FungibleTokenSDK(secretKey);
```

### 2. State Accessors

#### `getMetadata(state)`
Reads contract name, symbol, decimals, total supply, max supply, pause state, and ownership identifiers.

#### `getBalanceFromState(state, account)`
Queries token balance for a 32-byte account key.

#### `getAllowanceFromState(state, owner, spender)`
Queries remaining spending allowance.

#### `isPausedFromState(state)`
Returns `true` if contract is paused, `false` otherwise.

### 3. Circuit Invocation Methods

| Method | Parameters | Description |
| :--- | :--- | :--- |
| `mint` | `(provider, to, value)` | Mints new tokens to recipient. Only contract owner. |
| `burn` | `(provider, caller, value)` | Destroys caller's tokens. |
| `transfer` | `(provider, caller, to, value)` | Transfers tokens from caller to recipient. |
| `approve` | `(provider, caller, spender, value)` | Sets allowance for a spender. |
| `transferFrom` | `(provider, caller, from, to, value)` | Spends allowed balance from owner. |
| `pause` | `(provider, caller)` | Halts operations. Caller must be owner or pauser. |
| `unpause` | `(provider, caller)` | Resumes operations. Caller must be owner or pauser. |
| `setEmergencyPauser` | `(provider, caller, newPauser)` | Designates a dedicated pauser key. |
| `emergencyWithdraw` | `(provider, caller, tokenAddress, amount)` | Withdraws locked tokens while paused. |

---

## Security Considerations

1. **Secret Key Safeguard**: The `localSecretKey` witness provides private zero-knowledge identity authentication. Never expose this key outside trusted client memory.
2. **Deterministic Contract Account**: Contract address hash derivation ensures that emergency recovery routes tokens strictly to the registered contract owner address.
3. **Pauser Role Minimization**: Set dedicated pauser keys to mitigate primary owner private key exposure during operational monitoring.
```

```typescript:examples/fungible-token-v2-2-example.ts
/**
 * Quickstart Example: FungibleTokenV22 Client SDK
 * How to run: npx tsx examples/fungible-token-v2-2-example.ts
 */

import { FungibleTokenSDK, type ContractProvider } from '../src/client/fungible-token-v2-2-sdk.js';
import type { CircuitContext, StateValue } from '@midnight-ntwrk/compact-runtime';

// In-memory mock provider simulating ledger state changes for demonstration
class LocalContractExecutionMock<PS = any> implements ContractProvider<PS> {
  private ledgerState: any;

  constructor(initialOwner: Uint8Array, name: string, symbol: string, decimals: bigint, maxSupply: bigint) {
    const balances = new Map<string, bigint>();
    const allowances = new Map<string, bigint>();

    this.ledgerState = {
      _balances: {
        member: (k: Uint8Array) => balances.has(Buffer.from(k).toString('hex')),
        lookup: (k: Uint8Array) => balances.get(Buffer.from(k).toString('hex')) || 0n,
        set: (k: Uint8Array, v: bigint) => balances.set(Buffer.from(k).toString('hex'), v),
      },
      _allowances: {
        member: (k: [Uint8Array, Uint8Array]) =>
          allowances.has(`${Buffer.from(k[0]).toString('hex')}:${Buffer.from(k[1]).toString('hex')}`),
        lookup: (k: [Uint8Array, Uint8Array]) =>
          allowances.get(`${Buffer.from(k[0]).toString('hex')}:${Buffer.from(k[1]).toString('hex')}`) || 0n,
        set: (k: [Uint8Array, Uint8Array], v: bigint) =>
          allowances.set(`${Buffer.from(k[0]).toString('hex')}:${Buffer.from(k[1]).toString('hex')}`, v),
      },
      _totalSupply: 0n,
      _maxSupply: maxSupply === 0n ? 340282366920938463463374607431768211455n : maxSupply,
      _name: name,
      _symbol: symbol,
      _decimals: decimals,
      owner: initialOwner,
      _paused: false,
      _emergencyPauser: initialOwner,
    };
  }

  async getState(): Promise<StateValue> {
    return this.ledgerState;
  }

  async executeCircuit<R>(
    circuitName: string,
    executor: (context: CircuitContext<PS>) => { context: CircuitContext<PS>; result: R }
  ): Promise<R> {
    const mockContext: any = {
      currentQueryContext: {
        state: this.ledgerState,
      },
      costModel: {},
      privateState: {},
    };

    console.log(`[Circuit Exec] Invoking: ${circuitName}...`);
    // In actual network environment, this triggers Midnight JS proof generation & chain submission
    return true as unknown as R;
  }
}

async function main() {
  console.log('=== FungibleTokenV22 SDK Demonstration ===\n');

  // 1. Generate identity keys
  const ownerSecret = new Uint8Array(32).fill(1);
  const ownerAddress = new Uint8Array(32).fill(11);
  const aliceAddress = new Uint8Array(32).fill(22);
  const bobAddress = new Uint8Array(32).fill(33);

  console.log(`Owner Address: ${FungibleTokenSDK.bytesToHex(ownerAddress)}`);
  console.log(`Alice Address: ${FungibleTokenSDK.bytesToHex(aliceAddress)}`);
  console.log(`Bob Address:   ${FungibleTokenSDK.bytesToHex(bobAddress)}\n`);

  // 2. Initialize SDK
  const sdk = new FungibleTokenSDK(ownerSecret);

  // 3. Mock Provider for execution
  const provider = new LocalContractExecutionMock(
    ownerAddress,
    'Midnight Sample Token',
    'MST',
    18n,
    1_000_000_000n * 10n ** 18n
  );

  // 4. Token Operations
  console.log('1. Minting 1,000 MST to Alice...');
  await sdk.mint(provider, aliceAddress, 1000n * 10n ** 18n);

  console.log('2. Alice approves Bob for 250 MST...');
  sdk.setSecretKey(new Uint8Array(32).fill(2)); // Alice's secret key
  await sdk.approve(provider, aliceAddress, bobAddress, 250n * 10n ** 18n);

  console.log('3. Bob transfers 100 MST from Alice...');
  sdk.setSecretKey(new Uint8Array(32).fill(3)); // Bob's secret key
  await sdk.transferFrom(provider, bobAddress, aliceAddress, bobAddress, 100n * 10n ** 18n);

  console.log('4. Emergency Stop Triggered by Owner...');
  sdk.setSecretKey(ownerSecret); // Owner switches back
  await sdk.pause(provider, ownerAddress);

  console.log('5. Verifying Pause State...');
  const isPaused = await sdk.paused(provider);
  console.log(`   Contract Paused: ${isPaused}`);

  console.log('6. Resuming Contract Operations (Unpause)...');
  await sdk.unpause(provider, ownerAddress);

  console.log('\n=== Workflow Completed Successfully ===');
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});