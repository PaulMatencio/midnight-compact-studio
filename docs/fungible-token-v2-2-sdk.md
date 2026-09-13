# Part 1: Technical SDK & Architecture Documentation

## 1. Contract Overview & Architecture

The **FungibleTokenV22** smart contract (`fungible-token-v2-2.compact`) is a privacy-preserving, zero-knowledge fungible token standard written in Compact for the Midnight blockchain. It implements zero-knowledge identity authentication, deterministic account derivation, ERC-20 style operations (balances, transfers, allowances, minting, burning), role-based access controls (owner and emergency pauser), and emergency stop capabilities.

```
+-------------------------------------------------------------------------------+
|                             FungibleTokenV22 Architecture                    |
+-------------------------------------------------------------------------------+
|                                                                               |
|  [ Private Caller Secret Key (sk) ]                                          |
|                 │                                                             |
|                 ▼ (localSecretKey witness)                                    |
|   ┌───────────────────────────────┐                                           |
|   │     authenticate(account)     │ ◄─── persistentHash([tag, salt, sk])      |
|   └───────────────┬───────────────┘                                           |
|                   │                                                           |
|         ┌─────────┴─────────┐                                                 |
|         ▼                   ▼                                                 |
|   [ whenNotPaused ]   [ onlyOwner / onlyPauser ]                             |
|         │                   │                                                 |
|         ▼                   ▼                                                 |
|   ┌───────────────┐   ┌─────────────────────────────┐                         |
|   │ transfer      │   │ pause / unpause             │                         |
|   │ approve       │   │ setEmergencyPauser          │                         |
|   │ transferFrom  │   │ mint (owner only)           │                         |
|   │ burn          │   │ emergencyWithdraw           │                         |
|   └───────┬───────┘   └──────────────┬──────────────┘                         |
|           │                          │                                        |
|           ▼                          ▼                                        |
|   +───────────────────────────────────────────────────+                       |
|   |             On-Chain Public Ledger                |                       |
|   |  • _balances: Map<Bytes<32>, Uint<128>>           |                       |
|   |  • _allowances: Map<[Bytes<32>, Bytes<32>], Uint> |                       |
|   |  • _totalSupply, _maxSupply, _decimals, _name     |                       |
|   |  • owner, _contractSalt, _paused, _emergencyPauser|                       |
|   +───────────────────────────────────────────────────+                       |
+-------------------------------------------------------------------------------+
```

### Public Ledger State Schema (`export ledger`)

| Ledger Field | Compact Type | Description |
|---|---|---|
| `_balances` | `Map<Bytes<32>, Uint<128>>` | Mapping of 32-byte account commitments to token balances. |
| `_allowances` | `Map<[Bytes<32>, Bytes<32>], Uint<128>>` | Mapping from `[ownerAccount, spenderAccount]` to authorized spend limit. |
| `_totalSupply` | `Uint<128>` | Current aggregate minted token supply. |
| `_maxSupply` | `Uint<128>` | Maximum cap on total token supply ($2^{128} - 1$ if uncapped). |
| `_name` | `Opaque<"string">` | Token descriptive name. |
| `_symbol` | `Opaque<"string">` | Token trading symbol. |
| `_decimals` | `Uint<8>` | Decimals of precision (standard: 6, 8, or 18). |
| `owner` | `Bytes<32>` | On-chain account commitment of the contract administrator. |
| `_contractSalt` | `Bytes<32>` | Fixed salt assigned at deployment for cross-contract replay protection. |
| `_paused` | `Boolean` | Circuit execution gate (`true` disables transfers, approvals, mints, burns). |
| `_emergencyPauser` | `Bytes<32>` | Account commitment authorized to pause/unpause alongside `owner`. |

### Private State & Witness Specification

- **`witness localSecretKey(): Bytes<32>`**: An off-chain private computation executed inside the prover runtime. It fetches the caller's 32-byte private key from `context.privateState` to prove identity in zero-knowledge without revealing `sk` to the public network or ledger.

---

## 2. Prerequisites & Installation

### Script: `scripts/fungible-token-v2-2-install.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== Installing Midnight Compact Runtime and TypeScript Dependencies ==="
npm install --save \
  @midnight-ntwrk/compact-runtime \
  @midnight-ntwrk/compact-js

npm install --save-dev \
  typescript \
  tsx \
  @types/node
```

Ensure your `tsconfig.json` targets `ES2022` or `ESNext` with `moduleResolution` set to `NodeNext` or `Bundler`.

---

## 3. Caller Authentication & Account Derivation

### Authentication Circuit Mechanics

Compact circuits execute client-side inside a zero-knowledge prover. To verify caller authorization without exposing private keys on-chain, the contract uses commitment derivation:

```compact
circuit authenticate(account: Bytes<32>): [] {
  const sk = localSecretKey();
  const domainTag = pad(32, "fungible-token:auth");
  const derivedAccount = persistentHash<[Bytes<32>, Bytes<32>, Bytes<32>]>([
    domainTag,
    _contractSalt,
    sk
  ]);
  assert(derivedAccount == account, "FungibleToken: caller authorization failed");
}
```

### Key Principles

1. **Replay Protection via `_contractSalt`**: Including `_contractSalt` in the hash binds the derived account to a single contract deployment. A secret key `sk` generates distinct account identities across different contract instances, preventing cross-contract transaction replay attacks.
2. **Poseidon Cryptographic Hash**: The hashing algorithm uses the native Compact `persistentHash` (Poseidon curve hash), **NOT SHA-256**. The SDK provides `FungibleTokenV22Client.deriveAccount(...)` which queries the compiled contract runtime's native hash function.
3. **Deployment Commitment Warning**:
   > **CRITICAL**: When initializing the contract via `initialState` (or deploying on-chain), the `initialOwner` parameter **MUST** be set to `FungibleTokenV22Client.deriveAccount(ownerSecretKey, contractSalt)`, **NOT** a raw public key, hex address, or random byte array. If initialized with a raw key, no secret key will satisfy `authenticate(owner)` and administrative circuits will be permanently locked.

---

## 4. Step-by-Step Quickstart Walkthrough

Save the following runnable script as `examples/fungible-token-v2-2-example.ts`:

```typescript
/**
 * Quickstart Example: FungibleTokenV22 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-2-example.ts
 */

import { CompactRuntime } from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV22Client,
  type FungibleTokenV22PrivateState,
} from '../src/client/fungible-token-v2-2-sdk.js';

async function main() {
  console.log('=== FungibleTokenV22 SDK Quickstart Execution ===\n');

  // 1. Setup deterministic keys and contract deployment parameters
  const contractSalt = new Uint8Array(32);
  contractSalt.set(Buffer.from('token-salt-v2-2-demo-00000000001', 'utf-8'));

  const ownerSecretKey = new Uint8Array(32);
  ownerSecretKey.fill(0xaa);

  const aliceSecretKey = new Uint8Array(32);
  aliceSecretKey.fill(0xbb);

  const bobSecretKey = new Uint8Array(32);
  bobSecretKey.fill(0xcc);

  // Derive on-chain account commitments
  const ownerAccount = FungibleTokenV22Client.deriveAccount(ownerSecretKey, contractSalt);
  const aliceAccount = FungibleTokenV22Client.deriveAccount(aliceSecretKey, contractSalt);
  const bobAccount = FungibleTokenV22Client.deriveAccount(bobSecretKey, contractSalt);

  console.log('Derived Owner Account Commitment:', Buffer.from(ownerAccount).toString('hex'));
  console.log('Derived Alice Account Commitment:', Buffer.from(aliceAccount).toString('hex'));
  console.log('Derived Bob Account Commitment:  ', Buffer.from(bobAccount).toString('hex'));

  // 2. Setup mock contract addresses and coin public keys (32-byte hex strings)
  const contractAddress = '00'.repeat(32);
  const coinPublicKey = '01'.repeat(32);

  // 3. Initialize Contract State via Constructor Context
  const ownerPrivateState: FungibleTokenV22PrivateState = { secretKey: ownerSecretKey };
  const constructorCtx = CompactRuntime.createConstructorContext(ownerPrivateState, coinPublicKey);

  const client = new FungibleTokenV22Client(ownerPrivateState, contractSalt);

  const name = 'PrivacyUSD';
  const symbol = 'pUSD';
  const decimals = 6n;
  const maxSupply = 1_000_000_000_000n; // 1,000,000 pUSD (at 6 decimals)

  const initResult = client.initialState(
    constructorCtx,
    contractSalt,
    ownerAccount,
    name,
    symbol,
    decimals,
    maxSupply,
  );

  let currentChargedState = initResult.currentContractState.data;
  console.log('\nContract successfully initialized.');

  // 4. Mint tokens to Alice (executed by Owner)
  let circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    ownerPrivateState,
  );

  const mintAmount = 500_000_000n; // 500 pUSD
  console.log(`\nOwner minting ${mintAmount / 1_000_000n} pUSD to Alice...`);
  const mintResult = client.mint(circuitCtx, aliceAccount, mintAmount);
  currentChargedState = mintResult.context.currentQueryContext.state;

  // 5. Query Alice's balance
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    ownerPrivateState,
  );
  const aliceBalanceResult = client.balanceOf(circuitCtx, aliceAccount);
  console.log(`Alice Balance: ${aliceBalanceResult.result} base units`);

  // 6. Alice transfers 100 pUSD to Bob
  const alicePrivateState: FungibleTokenV22PrivateState = { secretKey: aliceSecretKey };
  const aliceClient = new FungibleTokenV22Client(alicePrivateState, contractSalt);

  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    alicePrivateState,
  );

  const transferAmount = 100_000_000n; // 100 pUSD
  console.log(`\nAlice transferring ${transferAmount / 1_000_000n} pUSD to Bob...`);
  const transferResult = aliceClient.transfer(circuitCtx, aliceAccount, bobAccount, transferAmount);
  currentChargedState = transferResult.context.currentQueryContext.state;

  // 7. Verify updated balances from Ledger State directly
  const finalLedger = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('\n=== Ledger State Snapshot ===');
  console.log('Total Supply:', finalLedger._totalSupply.toString());
  console.log('Contract Paused:', finalLedger._paused);
  console.log('Alice Balance in Ledger:', finalLedger._balances.lookup(aliceAccount).toString());
  console.log('Bob Balance in Ledger:  ', finalLedger._balances.lookup(bobAccount).toString());
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});
```

---

## 5. Privacy & Security Considerations

1. **Private Key Storage**: The `localSecretKey` witness retrieves `secretKey` from local browser storage or an encrypted key-store. Private keys are never serialized into proving keys, transaction payloads, or ledger state.
2. **Commitment Unlinkability Across DApps**: The `persistentHash([pad(32, "fungible-token:auth"), _contractSalt, sk])` construction guarantees that knowing an account address on one contract provides zero information about account addresses on another.
3. **Emergency Pausing**: Calling `pause(caller)` freezes `transfer`, `approve`, `transferFrom`, `mint`, and `burn`. The `emergencyWithdraw` circuit is exclusively unlocked during paused states to permit safe treasury recovery to the registered contract owner.

---

# Part 2: Production TypeScript Client SDK Implementation

```typescript
/**
 * FungibleTokenV22 Production Client SDK
 * File: src/client/fungible-token-v2-2-sdk.ts
 */

import {
  type CircuitContext,
  type QueryContext,
  type WitnessContext,
  type ConstructorContext,
  type ConstructorResult,
  type CircuitResults,
  type StateValue,
  type ChargedState,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract as ManagedContract,
  ledger,
  type Witnesses as ContractWitnesses,
  type Ledger as ContractLedger,
} from '../../contracts/managed/fungible-token-v2-2/contract/index.js';

/**
 * Off-chain private state stored on the client machine / wallet.
 */
export interface FungibleTokenV22PrivateState {
  readonly secretKey: Uint8Array;
}

/**
 * Strongly-typed public ledger schema matching the Compact contract.
 */
export type FungibleTokenV22LedgerState = ContractLedger;

/**
 * Witness interface mapping to Compact witness declarations.
 */
export type FungibleTokenV22Witnesses<PS extends FungibleTokenV22PrivateState = FungibleTokenV22PrivateState> =
  ContractWitnesses<PS>;

/**
 * High-level TypeScript SDK Client for FungibleTokenV22 smart contract.
 */
export class FungibleTokenV22Client<PS extends FungibleTokenV22PrivateState = FungibleTokenV22PrivateState> {
  public readonly contract: ManagedContract<PS>;
  public readonly defaultContractSalt: Uint8Array;

  /**
   * Initializes the client with optional private state and default salt.
   *
   * @param initialPrivateState - Optional initial private state containing the caller secret key.
   * @param defaultContractSalt - Optional 32-byte contract salt for identity derivation.
   * @param customWitnesses - Optional custom witness overrides.
   */
  constructor(
    initialPrivateState?: PS,
    defaultContractSalt?: Uint8Array | string,
    customWitnesses?: Partial<FungibleTokenV22Witnesses<PS>>,
  ) {
    this.defaultContractSalt = defaultContractSalt
      ? FungibleTokenV22Client.toBytes32(defaultContractSalt)
      : new Uint8Array(32);

    const defaultWitnesses = initialPrivateState?.secretKey
      ? FungibleTokenV22Client.createWitnesses<PS>(initialPrivateState.secretKey)
      : FungibleTokenV22Client.createWitnesses<PS>(new Uint8Array(32));

    this.contract = new ManagedContract<PS>({
      ...defaultWitnesses,
      ...(customWitnesses ?? {}),
    } as ContractWitnesses<PS>);
  }

  // ===========================================================================
  // Utility & Conversion Helpers
  // ===========================================================================

  /**
   * Normalizes hex string or Uint8Array to a strict 32-byte Uint8Array.
   */
  public static toBytes32(input: Uint8Array | string): Uint8Array {
    if (typeof input === 'string') {
      const cleanHex = input.startsWith('0x') ? input.slice(2) : input;
      if (cleanHex.length === 64) {
        return Uint8Array.from(Buffer.from(cleanHex, 'hex'));
      }
      const buf = new Uint8Array(32);
      const strBytes = Buffer.from(input, 'utf-8');
      buf.set(strBytes.subarray(0, 32));
      return buf;
    }
    if (input.length === 32) {
      return input;
    }
    const buf = new Uint8Array(32);
    buf.set(input.subarray(0, 32));
    return buf;
  }

  // ===========================================================================
  // Cryptographic Account Derivation & Identity Checks
  // ===========================================================================

  /**
   * Derives on-chain account commitment from a secret key and contract salt
   * using the native Compact persistentHash algorithm.
   *
   * @param secretKey - The 32-byte private secret key.
   * @param contractSalt - The 32-byte contract salt.
   * @returns The 32-byte derived account commitment.
   */
  public static deriveAccount(
    secretKey: Uint8Array | string,
    contractSalt: string | Uint8Array = new Uint8Array(32),
  ): Uint8Array {
    const skBytes = FungibleTokenV22Client.toBytes32(secretKey);
    const saltBytes = FungibleTokenV22Client.toBytes32(contractSalt);
    const domainTag = new Uint8Array(32);
    domainTag.set(Buffer.from('fungible-token:auth', 'utf-8'));

    try {
      const dummy = new ManagedContract({
        localSecretKey: (ctx: WitnessContext<ContractLedger, any>) => [ctx.privateState, new Uint8Array(32)],
      } as any);

      if (typeof (dummy as any)._persistentHash_1 === 'function') {
        try {
          return (dummy as any)._persistentHash_1([domainTag, saltBytes, skBytes]);
        } catch {
          return (dummy as any)._persistentHash_1([domainTag, { bytes: saltBytes }, skBytes]);
        }
      }

      const proto = Object.getPrototypeOf(dummy);
      const hashMethods = Object.getOwnPropertyNames(proto).filter((k) => k.startsWith('_persistentHash'));
      for (const m of hashMethods) {
        try {
          const r = (dummy as any)[m]([domainTag, saltBytes, skBytes]);
          if (r instanceof Uint8Array && r.length === 32) return r;
        } catch {}
        try {
          const r = (dummy as any)[m]([domainTag, { bytes: saltBytes }, skBytes]);
          if (r instanceof Uint8Array && r.length === 32) return r;
        } catch {}
      }
    } catch {}

    throw new Error('Failed to resolve Compact persistentHash for account derivation');
  }

  /**
   * Instance method to derive account commitment using this client's configured salt.
   */
  public deriveAccount(secretKey: Uint8Array | string, contractSalt?: string | Uint8Array): Uint8Array {
    return FungibleTokenV22Client.deriveAccount(secretKey, contractSalt ?? this.defaultContractSalt);
  }

  /**
   * Returns authenticated caller's account commitment.
   */
  public getAuthenticatedCaller(secretKey: Uint8Array | string, contractSalt?: string | Uint8Array): Uint8Array {
    return this.deriveAccount(secretKey, contractSalt);
  }

  /**
   * Verifies whether a private secret key maps to a target on-chain account commitment.
   */
  public static isAuthorized(
    secretKey: Uint8Array | string,
    targetAccount: Uint8Array | string,
    contractSalt: string | Uint8Array,
  ): boolean {
    const derived = FungibleTokenV22Client.deriveAccount(secretKey, contractSalt);
    const target = FungibleTokenV22Client.toBytes32(targetAccount);
    if (derived.length !== target.length) return false;
    for (let i = 0; i < derived.length; i++) {
      if (derived[i] !== target[i]) return false;
    }
    return true;
  }

  /**
   * Creates default witness implementations bound to a given caller secret key.
   */
  public static createWitnesses<PS extends FungibleTokenV22PrivateState = FungibleTokenV22PrivateState>(
    secretKey: Uint8Array | string,
  ): FungibleTokenV22Witnesses<PS> {
    const skBytes = FungibleTokenV22Client.toBytes32(secretKey);
    return {
      localSecretKey: (context: WitnessContext<ContractLedger, PS>): [PS, Uint8Array] => {
        const activeKey = context.privateState?.secretKey ?? skBytes;
        return [context.privateState, activeKey];
      },
    };
  }

  // ===========================================================================
  // Contract Initialization
  // ===========================================================================

  /**
   * Constructs the initial contract state.
   */
  public initialState(
    context: ConstructorContext<PS>,
    salt: Uint8Array | string,
    initialOwner: Uint8Array | string,
    name: string,
    symbol: string,
    decimals: bigint | number,
    maxSupply: bigint | number,
  ): ConstructorResult<PS> {
    const saltBytes = FungibleTokenV22Client.toBytes32(salt);
    const ownerBytes = FungibleTokenV22Client.toBytes32(initialOwner);
    const decimalsBig = BigInt(decimals);
    const maxSupplyBig = BigInt(maxSupply);

    return this.contract.initialState(
      context,
      saltBytes,
      ownerBytes,
      name,
      symbol,
      decimalsBig,
      maxSupplyBig,
    );
  }

  // ===========================================================================
  // Read-Only & Inspection Circuits
  // ===========================================================================

  public contractSalt(context: CircuitContext<PS>): CircuitResults<PS, Uint8Array> {
    return this.contract.circuits.contractSalt(context);
  }

  public name(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contract.circuits.name(context);
  }

  public symbol(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contract.circuits.symbol(context);
  }

  public decimals(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.decimals(context);
  }

  public maxSupply(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.maxSupply(context);
  }

  public totalSupply(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.totalSupply(context);
  }

  public paused(context: CircuitContext<PS>): CircuitResults<PS, boolean> {
    return this.contract.circuits.paused(context);
  }

  public balanceOf(
    context: CircuitContext<PS>,
    account: Uint8Array | string,
  ): CircuitResults<PS, bigint> {
    const accountBytes = FungibleTokenV22Client.toBytes32(account);
    return this.contract.circuits.balanceOf(context, accountBytes);
  }

  public allowance(
    context: CircuitContext<PS>,
    ownerAccount: Uint8Array | string,
    spenderAccount: Uint8Array | string,
  ): CircuitResults<PS, bigint> {
    const ownerBytes = FungibleTokenV22Client.toBytes32(ownerAccount);
    const spenderBytes = FungibleTokenV22Client.toBytes32(spenderAccount);
    return this.contract.circuits.allowance(context, ownerBytes, spenderBytes);
  }

  // ===========================================================================
  // State Mutating Circuits
  // ===========================================================================

  public transfer(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    to: Uint8Array | string,
    value: bigint | number,
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV22Client.toBytes32(caller);
    const toBytes = FungibleTokenV22Client.toBytes32(to);
    return this.contract.circuits.transfer(context, callerBytes, toBytes, BigInt(value));
  }

  public approve(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    spender: Uint8Array | string,
    value: bigint | number,
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV22Client.toBytes32(caller);
    const spenderBytes = FungibleTokenV22Client.toBytes32(spender);
    return this.contract.circuits.approve(context, callerBytes, spenderBytes, BigInt(value));
  }

  public transferFrom(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    fromAccount: Uint8Array | string,
    to: Uint8Array | string,
    value: bigint | number,
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV22Client.toBytes32(caller);
    const fromBytes = FungibleTokenV22Client.toBytes32(fromAccount);
    const toBytes = FungibleTokenV22Client.toBytes32(to);
    return this.contract.circuits.transferFrom(context, callerBytes, fromBytes, toBytes, BigInt(value));
  }

  public mint(
    context: CircuitContext<PS>,
    to: Uint8Array | string,
    value: bigint | number,
  ): CircuitResults<PS, boolean> {
    const toBytes = FungibleTokenV22Client.toBytes32(to);
    return this.contract.circuits.mint(context, toBytes, BigInt(value));
  }

  public burn(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    value: bigint | number,
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV22Client.toBytes32(caller);
    return this.contract.circuits.burn(context, callerBytes, BigInt(value));
  }

  public pause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV22Client.toBytes32(caller);
    return this.contract.circuits.pause(context, callerBytes);
  }

  public unpause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV22Client.toBytes32(caller);
    return this.contract.circuits.unpause(context, callerBytes);
  }

  public setEmergencyPauser(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    newPauser: Uint8Array | string,
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV22Client.toBytes32(caller);
    const pauserBytes = FungibleTokenV22Client.toBytes32(newPauser);
    return this.contract.circuits.setEmergencyPauser(context, callerBytes, pauserBytes);
  }

  public emergencyWithdraw(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    tokenContractAddress: string,
    amount: bigint | number,
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV22Client.toBytes32(caller);
    return this.contract.circuits.emergencyWithdraw(
      context,
      callerBytes,
      tokenContractAddress,
      BigInt(amount),
    );
  }

  // ===========================================================================
  // Ledger Parsing & Inspection
  // ===========================================================================

  /**
   * Parses raw query context or charged state into typed Ledger fields.
   */
  public queryLedgerStateFromRaw(rawState: StateValue | ChargedState | unknown): FungibleTokenV22LedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }
}

// SDK Alias Export
export { FungibleTokenV22Client as FungibleTokenV22SDK };
```