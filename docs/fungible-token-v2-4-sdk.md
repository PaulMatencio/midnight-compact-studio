# Part 1: Comprehensive SDK Documentation

---

## 1. Contract Overview & Architecture

The `fungible-token-v2-4` smart contract is a privacy-preserving, governance-hardened token implementation designed for the Midnight blockchain using the Compact language ($\ge 0.23$). It combines the safety guarantees of OpenZeppelin-style token patterns with zero-knowledge (ZK) client-side execution, Jubjub Schnorr threshold signatures, and domain-separated account authentication.

```
+-------------------------------------------------------------------------------+
|                               Midnight Ledger                                 |
|                                                                               |
|  _balances: Map<Bytes<32>, Uint<128>>      _totalSupply: Uint<128>            |
|  _allowances: Map<[Bytes<32>, Bytes<32>],  _maxSupply: Uint<128>              |
|                   Uint<128>>               _contractSalt: Bytes<32>           |
|  _paused: Boolean                          _emergencyPauser: Bytes<32>        |
|  _multisigSigners: Set<Bytes<32>>          _multisigThreshold: Uint<8>        |
|  _multisigNonce: Counter                   owner: Bytes<32>                   |
+---------------------------------------+---------------------------------------+
                                        ^
                                        | Verified state transition proof
                                        |
+---------------------------------------+---------------------------------------+
|                         Zero-Knowledge Circuits                               |
|                                                                               |
|  Threshold Multi-Sig (2-of-3)        Standard ERC-20 Style Operations         |
|  - mint(...)                         - transfer(...)                          |
|  - burn(...)                         - approve(...)                           |
|  - setEmergencyPauser(...)           - transferFrom(...)                      |
|                                      - selfBurn(...)                          |
|  Emergency Ops                       - adminReallocate(...)                   |
|  - pause(...) / unpause(...)         - emergencyWithdraw(...)                 |
+---------------------------------------+---------------------------------------+
                                        ^
                                        | Off-chain private witnesses
                                        |
+---------------------------------------+---------------------------------------+
|                    Client Private State & Witnesses                           |
|                                                                               |
|  - localSecretKey(): Bytes<32>       -> Private key for account commitment    |
|  - getSchnorrReduction(c): [F, F]    -> Challenge reduction helper (mod 2^248)|
+-------------------------------------------------------------------------------+
```

### Public Ledger State Schema

| Field Name | Type | Description |
|---|---|---|
| `_balances` | `Map<Bytes<32>, Uint<128>>` | Account balances mapped by 32-byte derived account commitment. |
| `_allowances` | `Map<[Bytes<32>, Bytes<32>], Uint<128>>` | Allowance matrix keyed by `[owner, spender]`. |
| `_totalSupply` | `Uint<128>` | Total circulating supply. |
| `_maxSupply` | `Uint<128>` | Maximum mint cap ($2^{128} - 1$ if unbounded). |
| `_name` | `Opaque<"string">` | Token descriptive name. |
| `_symbol` | `Opaque<"string">` | Token ticker symbol. |
| `_decimals` | `Uint<8>` | Decimal precision. |
| `owner` | `Bytes<32>` | Contract deployer/administrator account commitment. |
| `_contractSalt` | `Bytes<32>` | Unique deployment salt providing cross-contract replay protection. |
| `_paused` | `Boolean` | Circuit execution pause flag. |
| `_emergencyPauser` | `Bytes<32>` | Account commitment authorized to trigger `pause`/`unpause`. |
| `_multisigSigners` | `Set<Bytes<32>>` | Authorized threshold signer commitments (Poseidon Jubjub hashes). |
| `_multisigThreshold` | `Uint<8>` | Required valid signatures (evaluated as $\le 2$). |
| `_multisigSignerCount`| `Uint<8>` | Cardinality of signer set (defaults to 3). |
| `_multisigNonce` | `Counter` | Strictly incrementing replay protection nonce for multi-sig operations. |

### Private State & Witness Specification

1. **`witness localSecretKey(): Bytes<32>`**:
   - Accesses caller's 32-byte secret key off-chain.
   - Proves possession of `account` in `authenticate(account)` without revealing the secret key to the ledger.
2. **`witness getSchnorrReduction(challengeHash: Field): [Field, Field]`**:
   - Computes integer division $\lfloor c_{full} / 2^{248} \rfloor$ and remainder $c_{truncated} = c_{full} \pmod{2^{248}}$.
   - Enforces $q \cdot 2^{248} + c = c_{full}$ in circuit arithmetic, constraining the challenge to the Jubjub scalar field range.

---

## 2. Prerequisites & Installation

To install dependencies for compilation, testing, and SDK runtime, create and execute `scripts/fungible-token-v2-4-install.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Installing Midnight Compact Runtime and TypeScript dependencies..."

npm install --save \
  @midnight-ntwrk/compact-runtime@^0.7.0 \
  @midnight-ntwrk/ledger@^0.7.0

npm install --save-dev \
  typescript@^5.4.0 \
  tsx@^4.7.0 \
  @types/node@^20.11.0 \
  vitest@^1.4.0
```

---

## 3. API Reference & Caller Authentication

### Caller Authentication & Identity Derivation

Compact contracts do not have an implicit, unforgeable `msg.sender` global variable like Ethereum. Authentication is proved via zero-knowledge assertions inside the circuit:

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

1. **Cross-Contract Replay Isolation**:
   Because `_contractSalt` is mixed into the Poseidon hash, a secret key $sk$ derives a unique account commitment $A$ on this specific contract instance:
   $$A = \text{persistentHash}([\text{"fungible-token:auth"}, \text{contractSalt}, sk])$$
   Replaying signatures or proofs across distinct token deployments is cryptographically impossible.
2. **Derivation Algorithm**:
   Never hash secret keys using SHA-256 for account derivation. You must compute the Poseidon hash using the compiled contract's internal `_persistentHash` routine.
3. **Deployment Requirement**:
   When invoking the constructor, `initialOwner` and any initial ledger balances **must** be populated with the derived account commitment (`deriveAccount(ownerSecretKey, contractSalt)`), never raw public keys or arbitrary hex strings.

### Key SDK Methods

```typescript
// Account Derivation
FungibleTokenV24Client.deriveAccount(secretKey: Uint8Array | string, contractSalt?: Uint8Array | string): Uint8Array;
client.getAuthenticatedCaller(secretKey: Uint8Array | string): Uint8Array;
FungibleTokenV24Client.isAuthorized(secretKey: Uint8Array | string, targetAccount: Uint8Array | string, contractSalt: Uint8Array | string): boolean;

// Witness Factory
FungibleTokenV24Client.createWitnesses(secretKey: Uint8Array | string): Witnesses<FungibleTokenV24PrivateState>;

// Multi-Sig Digest Calculation
client.calculateMintDigest(nonce: bigint, to: Uint8Array | string, amount: bigint): Uint8Array;
client.calculateBurnDigest(nonce: bigint, account: Uint8Array | string, amount: bigint): Uint8Array;
client.calculateSetEmergencyPauserDigest(nonce: bigint, newPauser: Uint8Array | string): Uint8Array;

// Ledger Inspections
client.queryLedgerState(rawState: unknown): ContractLedger;
client.getBalanceOf(rawState: unknown, account: Uint8Array | string): bigint;
client.getAllowance(rawState: unknown, owner: Uint8Array | string, spender: Uint8Array | string): bigint;
```

---

## 4. Step-by-Step Quickstart & Usage Walkthrough

Save the following complete runnable script to `examples/fungible-token-v2-4-example.ts`:

```typescript
/**
 * Quickstart Example: FungibleTokenV24 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-4-example.ts
 */

import {
  CompactRuntime,
  type CircuitContext,
  type ConstructorContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV24Client,
  type FungibleTokenV24PrivateState,
} from '../src/client/fungible-token-v2-4-sdk.js';

async function main() {
  console.log('--- 1. Initializing Cryptographic Context & Secrets ---');
  const contractSalt = new Uint8Array(32);
  contractSalt.fill(0xaa);

  const ownerSK = new Uint8Array(32);
  ownerSK.fill(0x01);

  const aliceSK = new Uint8Array(32);
  aliceSK.fill(0x02);

  const ownerAccount = FungibleTokenV24Client.deriveAccount(ownerSK, contractSalt);
  const aliceAccount = FungibleTokenV24Client.deriveAccount(aliceSK, contractSalt);

  console.log('Owner Account Commitment:', Buffer.from(ownerAccount).toString('hex'));
  console.log('Alice Account Commitment:', Buffer.from(aliceAccount).toString('hex'));

  // Multi-sig signer place-holders (3 initial registered signers)
  const signer1 = new Uint8Array(32).fill(0x11);
  const signer2 = new Uint8Array(32).fill(0x22);
  const signer3 = new Uint8Array(32).fill(0x33);

  console.log('\n--- 2. Instantiating SDK & Deploying Contract Initial State ---');
  let currentOwnerPrivateState: FungibleTokenV24PrivateState = { secretKey: ownerSK };
  const witnesses = FungibleTokenV24Client.createWitnesses(ownerSK);
  const sdk = new FungibleTokenV24Client(witnesses, contractSalt);

  // Addresses in Midnight.js runtime are 32-byte hex strings
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);

  const constructorContext: ConstructorContext<FungibleTokenV24PrivateState> =
    CompactRuntime.createConstructorContext(currentOwnerPrivateState, coinPublicKey);

  const initResult = sdk.initialState(
    constructorContext,
    contractSalt,
    ownerAccount,
    'Shielded Token',
    'SHIELD',
    18n,
    1_000_000n * 10n ** 18n,
    [signer1, signer2, signer3],
    2n
  );

  let currentChargedState = initResult.currentContractState.data;
  currentOwnerPrivateState = initResult.currentPrivateState;

  let ledgerView = sdk.queryLedgerState(currentChargedState);
  console.log('Contract Initialized:');
  console.log('- Total Supply:', ledgerView._totalSupply);
  console.log('- Multisig Threshold:', ledgerView._multisigThreshold);
  console.log('- Multisig Signer Count:', ledgerView._multisigSignerCount);
  console.log('- Is Paused:', ledgerView._paused);

  console.log('\n--- 3. Direct State Execution: Pause Circuit ---');
  let circuitContext: CircuitContext<FungibleTokenV24PrivateState> =
    CompactRuntime.createCircuitContext(
      contractAddress,
      coinPublicKey,
      currentChargedState,
      currentOwnerPrivateState
    );

  const pauseResult = sdk.pause(circuitContext, ownerAccount);
  currentChargedState = pauseResult.context.currentQueryContext.state;
  currentOwnerPrivateState = pauseResult.context.currentPrivateState;

  ledgerView = sdk.queryLedgerState(currentChargedState);
  console.log('State after pause(): _paused =', ledgerView._paused);

  console.log('\n--- 4. Unpausing Contract ---');
  circuitContext = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    currentOwnerPrivateState
  );

  const unpauseResult = sdk.unpause(circuitContext, ownerAccount);
  currentChargedState = unpauseResult.context.currentQueryContext.state;
  currentOwnerPrivateState = unpauseResult.context.currentPrivateState;

  ledgerView = sdk.queryLedgerState(currentChargedState);
  console.log('State after unpause(): _paused =', ledgerView._paused);

  console.log('\n--- Quickstart Walkthrough Complete ---');
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});
```

---

## 5. Privacy & Security Notes

1. **Private Witnesses & Replay Isolation**:
   - `localSecretKey()` is queried purely off-chain inside the proving environment. The prover satisfies the statement without publishing their key.
   - The contract salt `_contractSalt` ensures identity commitments are non-linkable across multiple deployments even if users reuse their derivation key.
2. **Preventing Information Leaks**:
   - In Compact, all circuit parameters are private by default. Calling `disclose(param)` makes that parameter visible to the verifier and ledger. Keep transfers private where appropriate, but understand that balances in this token contract are public ledger records indexed by hashed identities.
3. **Threshold Schnorr Operations**:
   - `assertApprovals2` validates duplicate-signer resistance ($pk_0 \ne pk_1$) and truncates challenges to 248 bits to guard against Jubjub scalar overflow issues.
   - The operation hash incorporates `kernel.self().bytes` and `_multisigNonce`, ensuring complete mitigation against multi-sig replay across contracts and between transactions.

---

# Part 2: Production TypeScript Client SDK Implementation

Below is the complete implementation for `src/client/fungible-token-v2-4-sdk.ts`.

```typescript
// SPDX-License-Identifier: MIT
/**
 * FungibleTokenV24 Client SDK
 * Production-grade TypeScript SDK for the fungible-token-v2-4 Compact smart contract.
 *
 * Implements full client-side circuit execution, witness resolution, Jubjub Schnorr
 * multi-sig governance workflows, and Poseidon-compatible caller authentication.
 */

import {
  type CircuitContext,
  type ConstructorContext,
  type ConstructorResult,
  type CircuitResults,
  type StateValue,
  type ChargedState,
  type WitnessContext,
  type JubjubPoint,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract as ManagedContract,
  ledger,
  pureCircuits,
  type Witnesses as ContractWitnesses,
  type Ledger as ContractLedger,
} from '../../contracts/managed/fungible-token-v2-4/contract/index.js';

/**
 * Jubjub-based Schnorr signature representation.
 */
export interface SchnorrSignature {
  announcement: JubjubPoint;
  response: bigint;
}

/**
 * Off-chain private state retained by the local wallet/client.
 */
export interface FungibleTokenV24PrivateState {
  /** 32-byte secret key used for account commitment derivation */
  readonly secretKey: Uint8Array;
  /** Optional auxiliary store for custom caller workflows */
  readonly customData?: Record<string, unknown>;
}

/**
 * Complete witness interface expected by the fungible-token-v2-4 contract.
 */
export type FungibleTokenV24Witnesses<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState> =
  ContractWitnesses<PS>;

/**
 * Strongly-typed representation of on-chain ledger state.
 */
export type FungibleTokenV24LedgerState = ContractLedger;

/**
 * Production Client SDK for fungible-token-v2-4.
 */
export class FungibleTokenV24Client<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState> {
  public readonly contract: ManagedContract<PS>;
  public readonly defaultContractSalt: Uint8Array;

  /**
   * Constructs an instance of the FungibleTokenV24Client.
   *
   * @param witnesses - The witness functions fulfilling `localSecretKey` and `getSchnorrReduction`.
   * @param defaultContractSalt - Optional 32-byte salt deployed with the contract.
   */
  public constructor(
    witnesses: FungibleTokenV24Witnesses<PS>,
    defaultContractSalt?: Uint8Array | string
  ) {
    this.contract = new ManagedContract(witnesses);
    this.defaultContractSalt = defaultContractSalt
      ? FungibleTokenV24Client.toBytes32(defaultContractSalt)
      : new Uint8Array(32);
  }

  // ===========================================================================
  // Utility & Conversion Helpers
  // ===========================================================================

  /**
   * Normalizes arbitrary hex strings or byte arrays to a strict 32-byte Uint8Array.
   */
  public static toBytes32(input: Uint8Array | string): Uint8Array {
    if (typeof input === 'string') {
      const cleanHex = input.startsWith('0x') ? input.slice(2) : input;
      if (cleanHex.length !== 64) {
        throw new Error(`Expected 32-byte hex string (64 characters), received ${cleanHex.length}`);
      }
      return Buffer.from(cleanHex, 'hex');
    }
    if (input.length !== 32) {
      throw new Error(`Expected Uint8Array of length 32, received length ${input.length}`);
    }
    return input;
  }

  /**
   * Converts a BigInt or number to an exact 32-byte big-endian representation.
   */
  public static bigIntToBytes32(value: bigint | number): Uint8Array {
    const val = BigInt(value);
    const buf = Buffer.alloc(32);
    let hex = val.toString(16);
    if (hex.length % 2 !== 0) {
      hex = '0' + hex;
    }
    const valBuf = Buffer.from(hex, 'hex');
    valBuf.copy(buf, 32 - valBuf.length);
    return new Uint8Array(buf);
  }

  /**
   * Creates a 32-byte space- or null-padded ASCII domain tag.
   */
  public static padDomainTag(tag: string): Uint8Array {
    const out = new Uint8Array(32);
    const encoded = Buffer.from(tag, 'utf-8');
    if (encoded.length > 32) {
      throw new Error(`Domain tag '${tag}' exceeds 32 bytes`);
    }
    out.set(encoded);
    return out;
  }

  // ===========================================================================
  // Identity & Account Authentication
  // ===========================================================================

  /**
   * Derives the public 32-byte account commitment corresponding to a private secret key.
   * Uses the contract's internal Poseidon persistentHash implementation:
   * persistentHash([pad(32, "fungible-token:auth"), contractSalt, secretKey])
   */
  public static deriveAccount(
    secretKey: Uint8Array | string,
    contractSalt: string | Uint8Array = new Uint8Array(32)
  ): Uint8Array {
    const skBytes = FungibleTokenV24Client.toBytes32(secretKey);
    const saltBytes = FungibleTokenV24Client.toBytes32(contractSalt);
    const domainTag = FungibleTokenV24Client.padDomainTag('fungible-token:auth');

    try {
      const dummy = new ManagedContract({
        localSecretKey: (ctx: WitnessContext<ContractLedger, any>) => [ctx.privateState, new Uint8Array(32)],
        getSchnorrReduction: (ctx: WitnessContext<ContractLedger, any>, c: bigint) => [ctx.privateState, [0n, c]],
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
    } catch (err) {
      throw new Error(`Failed to resolve Compact persistentHash for account derivation: ${String(err)}`);
    }

    throw new Error('Failed to derive account commitment: persistentHash resolver unavailable');
  }

  /**
   * Derives caller account commitment using this client's configured default contract salt.
   */
  public deriveAccount(secretKey: Uint8Array | string, contractSalt?: string | Uint8Array): Uint8Array {
    return FungibleTokenV24Client.deriveAccount(secretKey, contractSalt ?? this.defaultContractSalt);
  }

  /**
   * Helper to retrieve the authenticated caller identity for a given secret key.
   */
  public getAuthenticatedCaller(secretKey: Uint8Array | string, contractSalt?: string | Uint8Array): Uint8Array {
    return this.deriveAccount(secretKey, contractSalt);
  }

  /**
   * Checks whether a private secret key corresponds to a targeted public account commitment.
   */
  public static isAuthorized(
    secretKey: Uint8Array | string,
    targetAccount: Uint8Array | string,
    contractSalt: string | Uint8Array
  ): boolean {
    const derived = FungibleTokenV24Client.deriveAccount(secretKey, contractSalt);
    const target = FungibleTokenV24Client.toBytes32(targetAccount);
    if (derived.length !== target.length) return false;
    return derived.every((byte, i) => byte === target[i]);
  }

  /**
   * Generates a standard default witness mapping configured with a caller secret key.
   */
  public static createWitnesses<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState>(
    secretKey: Uint8Array | string
  ): FungibleTokenV24Witnesses<PS> {
    const skBytes = FungibleTokenV24Client.toBytes32(secretKey);

    return {
      localSecretKey: (context: WitnessContext<ContractLedger, PS>): [PS, Uint8Array] => {
        const activeSK = context.privateState?.secretKey ?? skBytes;
        return [context.privateState, activeSK];
      },
      getSchnorrReduction: (
        context: WitnessContext<ContractLedger, PS>,
        challengeHash: bigint
      ): [PS, [bigint, bigint]] => {
        const TWO_248 = 1n << 248n;
        const q = challengeHash / TWO_248;
        const r = challengeHash % TWO_248;
        return [context.privateState, [q, r]];
      },
    };
  }

  // ===========================================================================
  // Multi-Sig Digest Calculation Helpers
  // ===========================================================================

  /**
   * Computes the operation digest for `mint`.
   */
  public calculateMintDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    to: Uint8Array | string,
    amount: bigint | number
  ): Uint8Array {
    const prefix = FungibleTokenV24Client.padDomainTag('multisig:mint:');
    const contractBytes = FungibleTokenV24Client.toBytes32(contractAddress);
    const nonceBytes = FungibleTokenV24Client.bigIntToBytes32(nonce);
    const toBytes = FungibleTokenV24Client.toBytes32(to);
    const amountBytes = FungibleTokenV24Client.bigIntToBytes32(amount);

    return (this.contract as any)._persistentHash_1([
      prefix,
      contractBytes,
      nonceBytes,
      toBytes,
      amountBytes,
    ]);
  }

  /**
   * Computes the operation digest for `burn`.
   */
  public calculateBurnDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    account: Uint8Array | string,
    amount: bigint | number
  ): Uint8Array {
    const prefix = FungibleTokenV24Client.padDomainTag('multisig:burn:');
    const contractBytes = FungibleTokenV24Client.toBytes32(contractAddress);
    const nonceBytes = FungibleTokenV24Client.bigIntToBytes32(nonce);
    const accountBytes = FungibleTokenV24Client.toBytes32(account);
    const amountBytes = FungibleTokenV24Client.bigIntToBytes32(amount);

    return (this.contract as any)._persistentHash_1([
      prefix,
      contractBytes,
      nonceBytes,
      accountBytes,
      amountBytes,
    ]);
  }

  /**
   * Computes the operation digest for `setEmergencyPauser`.
   */
  public calculateSetEmergencyPauserDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    newPauser: Uint8Array | string
  ): Uint8Array {
    const prefix = FungibleTokenV24Client.padDomainTag('multisig:set-pauser:');
    const contractBytes = FungibleTokenV24Client.toBytes32(contractAddress);
    const nonceBytes = FungibleTokenV24Client.bigIntToBytes32(nonce);
    const pauserBytes = FungibleTokenV24Client.toBytes32(newPauser);

    return (this.contract as any)._persistentHash_1([
      prefix,
      contractBytes,
      nonceBytes,
      pauserBytes,
    ]);
  }

  /**
   * Computes signer commitment off-chain using the contract's pure circuit.
   */
  public static calculateSignerCommitment(pk: JubjubPoint, salt: Uint8Array | string): Uint8Array {
    const saltBytes = FungibleTokenV24Client.toBytes32(salt);
    return pureCircuits.calculateSignerCommitment(pk, saltBytes);
  }

  // ===========================================================================
  // State Initialization & Queries
  // ===========================================================================

  /**
   * Generates initial state transitions and on-chain ledger records via the constructor.
   */
  public initialState(
    context: ConstructorContext<PS>,
    salt: Uint8Array | string,
    initialOwner: Uint8Array | string,
    name: string,
    symbol: string,
    decimals: bigint | number,
    maxSupply: bigint | number,
    initialSigners: [Uint8Array | string, Uint8Array | string, Uint8Array | string],
    threshold: bigint | number
  ): ConstructorResult<PS> {
    const saltBytes = FungibleTokenV24Client.toBytes32(salt);
    const ownerBytes = FungibleTokenV24Client.toBytes32(initialOwner);
    const signersVector = [
      FungibleTokenV24Client.toBytes32(initialSigners[0]),
      FungibleTokenV24Client.toBytes32(initialSigners[1]),
      FungibleTokenV24Client.toBytes32(initialSigners[2]),
    ];

    return this.contract.initialState(
      context,
      saltBytes,
      ownerBytes,
      name,
      symbol,
      BigInt(decimals),
      BigInt(maxSupply),
      signersVector,
      BigInt(threshold)
    );
  }

  /**
   * Parses raw blockchain state into a strongly-typed FungibleTokenV24LedgerState object.
   */
  public queryLedgerState(rawState: StateValue | ChargedState | unknown): FungibleTokenV24LedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }

  /**
   * Reads the current balance for an account commitment from ledger state.
   */
  public getBalanceOf(rawState: unknown, account: Uint8Array | string): bigint {
    const state = this.queryLedgerState(rawState);
    const accBytes = FungibleTokenV24Client.toBytes32(account);
    const member = (state._balances as any)?.member?.(accBytes);
    if (!member) {
      return 0n;
    }
    return BigInt((state._balances as any)?.lookup?.(accBytes) ?? 0n);
  }

  /**
   * Reads an allowance for an owner-spender tuple from ledger state.
   */
  public getAllowance(rawState: unknown, ownerAccount: Uint8Array | string, spender: Uint8Array | string): bigint {
    const state = this.queryLedgerState(rawState);
    const key = [FungibleTokenV24Client.toBytes32(ownerAccount), FungibleTokenV24Client.toBytes32(spender)];
    const member = (state._allowances as any)?.member?.(key);
    if (!member) {
      return 0n;
    }
    return BigInt((state._allowances as any)?.lookup?.(key) ?? 0n);
  }

  /**
   * Reads the active multi-sig governance nonce.
   */
  public getMultisigNonce(rawState: unknown): bigint {
    const state = this.queryLedgerState(rawState);
    return BigInt(state._multisigNonce ?? 0n);
  }

  /**
   * Reads the multi-sig approval threshold.
   */
  public getMultisigThreshold(rawState: unknown): bigint {
    const state = this.queryLedgerState(rawState);
    return BigInt(state._multisigThreshold ?? 0n);
  }

  /**
   * Checks whether a signer commitment is an authorized multi-sig participant.
   */
  public isMultisigSigner(rawState: unknown, commitment: Uint8Array | string): boolean {
    const state = this.queryLedgerState(rawState);
    const commBytes = FungibleTokenV24Client.toBytes32(commitment);
    return Boolean((state._multisigSigners as any)?.member?.(commBytes));
  }

  // ===========================================================================
  // Token Operations (Circuits)
  // ===========================================================================

  /**
   * Transfers tokens from caller's derived identity to recipient.
   */
  public transfer(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    to: Uint8Array | string,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.transfer(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      FungibleTokenV24Client.toBytes32(to),
      BigInt(value)
    );
  }

  /**
   * Approves spender to withdraw up to value tokens.
   */
  public approve(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    spender: Uint8Array | string,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.approve(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      FungibleTokenV24Client.toBytes32(spender),
      BigInt(value)
    );
  }

  /**
   * Transfers tokens using an approved allowance.
   */
  public transferFrom(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    fromAccount: Uint8Array | string,
    to: Uint8Array | string,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.transferFrom(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      FungibleTokenV24Client.toBytes32(fromAccount),
      FungibleTokenV24Client.toBytes32(to),
      BigInt(value)
    );
  }

  /**
   * Burns tokens directly from caller's balance.
   */
  public selfBurn(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.selfBurn(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      BigInt(value)
    );
  }

  // ===========================================================================
  // Threshold Governed Operations (Circuits)
  // ===========================================================================

  /**
   * Mints tokens to `to`, authorized by 2 threshold signatures.
   */
  public mint(
    context: CircuitContext<PS>,
    to: Uint8Array | string,
    value: bigint | number,
    pubkeys: [JubjubPoint, JubjubPoint],
    signatures: [SchnorrSignature, SchnorrSignature]
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.mint(
      context,
      FungibleTokenV24Client.toBytes32(to),
      BigInt(value),
      pubkeys,
      signatures
    );
  }

  /**
   * Burns tokens from `account`, authorized by 2 threshold signatures.
   */
  public burn(
    context: CircuitContext<PS>,
    account: Uint8Array | string,
    value: bigint | number,
    pubkeys: [JubjubPoint, JubjubPoint],
    signatures: [SchnorrSignature, SchnorrSignature]
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.burn(
      context,
      FungibleTokenV24Client.toBytes32(account),
      BigInt(value),
      pubkeys,
      signatures
    );
  }

  /**
   * Designates a new emergency pauser address, authorized by threshold signatures.
   */
  public setEmergencyPauser(
    context: CircuitContext<PS>,
    newPauser: Uint8Array | string,
    pubkeys: [JubjubPoint, JubjubPoint],
    signatures: [SchnorrSignature, SchnorrSignature]
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.setEmergencyPauser(
      context,
      FungibleTokenV24Client.toBytes32(newPauser),
      pubkeys,
      signatures
    );
  }

  // ===========================================================================
  // Emergency Controls & Admin Circuits
  // ===========================================================================

  /**
   * Halts contract operations (can be called by owner or emergency pauser).
   */
  public pause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.pause(
      context,
      FungibleTokenV24Client.toBytes32(caller)
    );
  }

  /**
   * Resumes contract operations (can be called by owner or emergency pauser).
   */
  public unpause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.unpause(
      context,
      FungibleTokenV24Client.toBytes32(caller)
    );
  }

  /**
   * Allows contract owner to reallocate blocked funds.
   */
  public adminReallocate(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    trappedAccount: Uint8Array | string,
    targetSpendableAccount: Uint8Array | string,
    amount: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.adminReallocate(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      FungibleTokenV24Client.toBytes32(trappedAccount),
      FungibleTokenV24Client.toBytes32(targetSpendableAccount),
      BigInt(amount)
    );
  }

  /**
   * Owner emergency withdrawal of trapped funds while paused.
   */
  public emergencyWithdraw(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    tokenAddress: string | { bytes: Uint8Array },
    amount: bigint | number
  ): CircuitResults<PS, boolean> {
    const formattedTokenAddress =
      typeof tokenAddress === 'string'
        ? { bytes: FungibleTokenV24Client.toBytes32(tokenAddress) }
        : tokenAddress;

    return this.contract.circuits.emergencyWithdraw(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      formattedTokenAddress as any,
      BigInt(amount)
    );
  }
}

/**
 * Backward-compatible alias for FungibleTokenV24Client.
 */
export { FungibleTokenV24Client as FungibleTokenV24SDK };
```