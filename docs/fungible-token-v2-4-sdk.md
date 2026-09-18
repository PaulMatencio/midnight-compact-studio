# Technical Specification & TypeScript SDK: `fungible-token-v2-4`

---

## Part 1: Comprehensive SDK Documentation

### 1. Contract Overview & Architecture

The `fungible-token-v2-4` contract implements an OpenZeppelin-inspired privacy-preserving fungible token on the Midnight blockchain. It introduces a multi-sig governance mechanism powered by 2-of-3 threshold Schnorr signatures on the native Jubjub elliptic curve, caller authentication via zero-knowledge proofs over secret keys, and circuit-level emergency pause controls.

```
                                    +----------------------------------------+
                                    |     Caller Secret Key (Witness)        |
                                    +----------------------------------------+
                                                        |
                                                        v
                                        [ authenticate(account) ]
                                                        |
                                                        v
                                    +----------------------------------------+
                                    | persistentHash([TAG, _contractSalt, sk])|
                                    +----------------------------------------+
                                                        | (verified on-chain)
                                                        v
   +-----------------------+               +--------------------------+
   | Multisig Signers (3)  |               | Public Ledger State      |
   +-----------------------+               +--------------------------+
       | Jubjub Schnorr                    | _balances, _allowances   |
       v                                   | _totalSupply, _maxSupply |
   [ assertApprovals2 ] -----------------> | _paused, _emergencyPauser|
       (mint, burn, setPauser)             | _multisigNonce, owner    |
                                           +--------------------------+
```

#### Public Ledger State Schema

| Field Name | Type | Description |
|---|---|---|
| `_balances` | `Map<Bytes<32>, Uint<128>>` | Mapping from user account commitment to token balance. |
| `_allowances` | `Map<[Bytes<32>, Bytes<32>], Uint<128>>` | Mapping from `[owner, spender]` pairs to granted token allowance. |
| `_totalSupply` | `Uint<128>` | Current circulating token supply. |
| `_maxSupply` | `Uint<128>` | Maximum cap on tokens that can ever be minted. |
| `_name` | `Opaque<"string">` | Token descriptive name. |
| `_symbol` | `Opaque<"string">` | Token trading ticker/symbol. |
| `_decimals` | `Uint<8>` | Unit precision exponent (typically `18` or `6`). |
| `owner` | `Bytes<32>` | Account commitment of the token deployer/administrator. |
| `_contractSalt` | `Bytes<32>` | Unique deployment salt used for domain-separating account hashes. |
| `_paused` | `Boolean` | Circuit breaker status flag; halts transfers, approvals, and mints. |
| `_emergencyPauser` | `Bytes<32>` | Account commitment permitted to trip or reset the pause switch. |
| `_multisigSigners` | `Set<Bytes<32>>` | Set of registered 32-byte signer commitments. |
| `_multisigThreshold` | `Uint<8>` | Threshold of signatures required for governed ops (set to 2). |
| `_multisigSignerCount` | `Uint<8>` | Total registered governance signers (fixed to 3). |
| `_multisigNonce` | `Counter` | Monotonically increasing counter for multi-sig replay defense. |

#### Private State & Witness Specification

1. **`witness localSecretKey(): Bytes<32>`**
   - Supplies the caller's private 32-byte spending or identity key.
   - Evaluated off-chain inside the client's ZK prover environment.
   - Never exposed on-chain. The circuit hashes it inside the zero-knowledge circuit and proves identity equality.

2. **`witness getSchnorrReduction(challengeHash: Field): [Field, Uint<248>]`**
   - Takes the 254/255-bit Poseidon/transient challenge hash $c_{full}$ computed from the Schnorr announcement, public key, and payload message vector.
   - Off-chain computation: divides $c_{full}$ by $2^{248}$, yielding quotient $q$ and remainder $c_{truncated}$.
   - The circuit enforces $q \cdot 2^{248} + c_{truncated} = c_{full}$, ensuring $c_{truncated}$ fits into a 248-bit scalar for Jubjub group operations without field overflows.

---

### 2. Prerequisites & Installation

The SDK requires Node.js (v18 or v20+), `@midnight-ntwrk/compact-runtime`, and the compiled contract artifacts.

To configure and install dependencies for your project, save and run the following script:

```bash
#!/usr/bin/env bash
# scripts/fungible-token-v2-4-install.sh
set -euo pipefail

npm install @midnight-ntwrk/compact-runtime
npm install -D typescript tsx @types/node
```

---

### 3. API Reference & Caller Authentication

#### Dedicated Guide: Caller Authentication & Identity Derivation

Compact contracts preserve privacy by decoupling public ledger addresses from raw public keys or wallet seeds. In `fungible-token-v2-4`, callers prove ownership of an account through cryptographic commitment derivation.

```
  Caller Secret Key (sk) [32 bytes]
        |
        +---> Domain Tag: pad(32, "fungible-token:auth")
        |
        +---> Contract Salt: _contractSalt [32 bytes]
        |
        v
  persistentHash([DomainTag, ContractSalt, sk])
        = Derived On-Chain Account Commitment [Bytes<32>]
```

##### Principles
1. **Zero Raw Private Data Exposure**: The secret key $sk$ is supplied exclusively via the `localSecretKey` witness. The circuit asserts that the Poseidon hash of $sk$, the contract salt, and the domain separator equals the `account: Bytes<32>` argument passed into the circuit.
2. **Cross-Contract Replay Isolation**: If a user uses the same secret key across multiple deployments or different Compact contracts, their identity does not correlate. `_contractSalt` is explicitly mixed into the derivation, isolating account commitments across separate contract instances without relying on dynamic `kernel.self()` in the witness.
3. **Deployer Initialization Guard**: When executing the contract constructor, the `initialOwner` parameter **must** be the derived account commitment (`deriveAccount(deployerSecretKey, salt)`). Passing a raw public key or random hex string will cause all subsequent `onlyOwner` calls to fail `authenticate()` checks.

##### Identity Derivation Helper Methods
- `FungibleTokenV24Client.deriveAccount(secretKey, contractSalt)`: Computes the 32-byte Poseidon hash matching the circuit's `authenticate` logic.
- `client.getAuthenticatedCaller(secretKey, [contractSalt])`: Convenience method on the client instance returning the on-chain account for a given secret key.
- `FungibleTokenV24Client.isAuthorized(secretKey, targetAccount, contractSalt)`: Boolean verification helper.
- `FungibleTokenV24Client.createWitnesses(secretKey)`: Generates the `Witnesses` map supplying both `localSecretKey` and `getSchnorrReduction`.

---

### 4. Step-by-Step Quickstart & Usage Walkthrough

Save the following runnable walkthrough script to `examples/fungible-token-v2-4-example.ts`:

```typescript
/**
 * Quickstart Example: FungibleTokenV24 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-4-example.ts
 */

import {
  CompactRuntime,
  type ConstructorContext,
  type CircuitContext
} from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV24Client,
  type FungibleTokenV24PrivateState
} from '../src/client/fungible-token-v2-4-sdk.js';

async function main(): Promise<void> {
  console.log('=== Initializing FungibleToken v2.4 Walkthrough ===');

  // 1. Setup Identities and Constants (32-byte hex strings)
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);
  const salt = '11'.repeat(32);

  const ownerSecretKey = new Uint8Array(32).fill(0xaa);
  const aliceSecretKey = new Uint8Array(32).fill(0xbb);

  // Derive account commitments
  const ownerAccount = FungibleTokenV24Client.deriveAccount(ownerSecretKey, salt);
  const aliceAccount = FungibleTokenV24Client.deriveAccount(aliceSecretKey, salt);

  console.log('Owner Account Commitment:', Buffer.from(ownerAccount).toString('hex'));
  console.log('Alice Account Commitment:', Buffer.from(aliceAccount).toString('hex'));

  // Multi-sig signer commitments (initialSigners: Vector<3, Bytes<32>>)
  const signer1 = new Uint8Array(32).fill(0x01);
  const signer2 = new Uint8Array(32).fill(0x02);
  const signer3 = new Uint8Array(32).fill(0x03);

  // 2. Initialize Private State & Witnesses
  const initialPrivateState: FungibleTokenV24PrivateState = {
    secretKey: ownerSecretKey
  };

  const witnesses = FungibleTokenV24Client.createWitnesses(ownerSecretKey);
  const client = new FungibleTokenV24Client(witnesses, salt);

  // 3. Deploy / Run Constructor
  const constructorCtx: ConstructorContext<FungibleTokenV24PrivateState> =
    CompactRuntime.createConstructorContext(initialPrivateState, coinPublicKey);

  const name = 'Privacy Governance Token';
  const symbol = 'PGT';
  const decimals = 18n;
  const maxSupply = 1_000_000_000n * 10n ** 18n;
  const initialSigners = [signer1, signer2, signer3];
  const threshold = 2n;

  console.log('Executing contract constructor...');
  const initResult = client.initialState(
    constructorCtx,
    FungibleTokenV24Client.toBytes32(salt),
    ownerAccount,
    name,
    symbol,
    decimals,
    maxSupply,
    initialSigners,
    threshold
  );

  // Track on-chain state transitions
  let currentChargedState = initResult.currentContractState.data;
  let privateState = initResult.currentPrivateState;

  // Inspect deployment ledger state
  let currentLedger = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('Token Initialized:');
  console.log(' - Name:', currentLedger._name);
  console.log(' - Symbol:', currentLedger._symbol);
  console.log(' - Total Supply:', currentLedger._totalSupply.toString());
  console.log(' - Multisig Threshold:', currentLedger._multisigThreshold.toString());

  // 4. Create Circuit Context for Transaction Execution
  let circuitCtx: CircuitContext<FungibleTokenV24PrivateState> =
    CompactRuntime.createCircuitContext(
      contractAddress,
      coinPublicKey,
      currentChargedState,
      privateState
    );

  // 5. Test Pausing the Contract (Owner authorization)
  console.log('\nExecuting emergency pause...');
  const pauseResult = client.pause(circuitCtx, ownerAccount);

  // Update tracking state
  currentChargedState = pauseResult.context.currentQueryContext.state;
  privateState = pauseResult.context.currentPrivateState;
  currentLedger = client.queryLedgerStateFromRaw(currentChargedState);
  console.log(' - Contract Paused State:', currentLedger._paused);

  // 6. Test Unpausing the Contract
  console.log('Executing unpause...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );

  const unpauseResult = client.unpause(circuitCtx, ownerAccount);
  currentChargedState = unpauseResult.context.currentQueryContext.state;
  privateState = unpauseResult.context.currentPrivateState;
  currentLedger = client.queryLedgerStateFromRaw(currentChargedState);
  console.log(' - Contract Paused State after reset:', currentLedger._paused);

  console.log('\nWalkthrough completed successfully.');
}

main().catch((err) => {
  console.error('Walkthrough execution failed:', err);
  process.exit(1);
});
```

---

### 5. Privacy & Security Considerations

1. **Secret Key Segregation**: Never reuse a root coin-spending private key as a contract caller secret key. Maintain dedicated application-level secret keys stored strictly within the client's secure local key store.
2. **Deterministic Nonces**: Governed multi-sig operations commit to `_multisigNonce`. Signers must verify the exact nonce included in the digest prior to signing to prevent replay or front-running of outdated operations.
3. **Ephemeral Challenge Reduction**: The `getSchnorrReduction` witness performs Euclidean division over the scalar field modulus. The circuit enforces $q \cdot 2^{248} + c_{truncated} = c_{full}$. Because the witness computation is deterministic, client implementations must never alter the quotient or remainder.

---

## Part 2: Production TypeScript Client SDK Implementation

Below is the complete implementation for `src/client/fungible-token-v2-4-sdk.ts`:

```typescript
// SPDX-License-Identifier: MIT
/**
 * Production Client SDK for Compact Fungible Token Contract v2.4
 * Supports caller ZK authentication, threshold Schnorr signatures, and pause administration.
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
  type JubjubPoint
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract as ManagedContract,
  pureCircuits,
  ledger,
  type Witnesses as ContractWitnesses,
  type Ledger as ContractLedger
} from '../../contracts/managed/fungible-token-v2-4/contract/index.js';

/**
 * Schnorr signature over Jubjub curve matching Compact struct definition.
 */
export type SchnorrSignature = {
  announcement: JubjubPoint;
  response: bigint;
};

/**
 * Off-chain private state holding secret credentials.
 */
export interface FungibleTokenV24PrivateState {
  readonly secretKey: Uint8Array;
}

/**
 * Contract ledger state matching compiled Compact types.
 */
export type FungibleTokenV24LedgerState = ContractLedger;

/**
 * Strongly-typed witness map for fungible token circuits.
 */
export type FungibleTokenV24Witnesses<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState> = {
  localSecretKey: (context: WitnessContext<ContractLedger, PS>) => [PS, Uint8Array];
  getSchnorrReduction: (
    context: WitnessContext<ContractLedger, PS>,
    challengeHash: bigint
  ) => [PS, [bigint, bigint]];
};

/**
 * Production-ready TypeScript Client for interacting with fungible-token-v2-4.
 */
export class FungibleTokenV24Client<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState> {
  private readonly contractInstance: ManagedContract<PS>;
  public readonly defaultContractSalt: Uint8Array;

  /**
   * Initializes the client with configured witnesses and deployment salt.
   */
  constructor(
    witnesses: FungibleTokenV24Witnesses<PS>,
    contractSalt: string | Uint8Array = new Uint8Array(32)
  ) {
    this.contractInstance = new ManagedContract(witnesses as unknown as ContractWitnesses<PS>);
    this.defaultContractSalt = FungibleTokenV24Client.toBytes32(contractSalt);
  }

  // ==========================================================================
  // Cryptographic & Derivation Utilities
  // ==========================================================================

  /**
   * Normalizes string or byte array input into exactly 32 bytes.
   */
  public static toBytes32(input: string | Uint8Array): Uint8Array {
    if (typeof input === 'string') {
      const cleanHex = input.startsWith('0x') ? input.slice(2) : input;
      if (/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
        return new Uint8Array(Buffer.from(cleanHex, 'hex'));
      }
      const out = new Uint8Array(32);
      const strBytes = Buffer.from(input, 'utf-8');
      out.set(strBytes.subarray(0, Math.min(strBytes.length, 32)));
      return out;
    }
    if (input.length === 32) {
      return input;
    }
    const out = new Uint8Array(32);
    out.set(input.subarray(0, Math.min(input.length, 32)));
    return out;
  }

  /**
   * Derives an on-chain account commitment from a secret key and contract salt using
   * the exact Poseidon hash specification from the Compact contract.
   */
  public static deriveAccount(
    secretKey: Uint8Array | string,
    contractSalt: string | Uint8Array = new Uint8Array(32)
  ): Uint8Array {
    const skBytes = FungibleTokenV24Client.toBytes32(secretKey);
    const saltBytes = FungibleTokenV24Client.toBytes32(contractSalt);
    const domainTag = new Uint8Array(32);
    domainTag.set(Buffer.from('fungible-token:auth', 'utf-8'));

    try {
      const dummy = new ManagedContract({
        localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
        getSchnorrReduction: (ctx: any) => [ctx.privateState, [0n, 0n]]
      } as any);

      if (typeof (dummy as any)._persistentHash_1 === 'function') {
        try {
          return (dummy as any)._persistentHash_1([domainTag, saltBytes, skBytes]);
        } catch {
          return (dummy as any)._persistentHash_1([domainTag, { bytes: saltBytes }, skBytes]);
        }
      }

      const proto = Object.getPrototypeOf(dummy);
      const hashMethods = Object.getOwnPropertyNames(proto).filter((k) =>
        k.startsWith('_persistentHash')
      );
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
    } catch {
      // Pass-through to final error assertion
    }
    throw new Error('Failed to resolve Compact persistentHash for account derivation');
  }

  /**
   * Derives caller's on-chain account commitment bound to this client's salt.
   */
  public deriveAccount(
    secretKey: Uint8Array | string,
    contractSalt?: string | Uint8Array
  ): Uint8Array {
    return FungibleTokenV24Client.deriveAccount(
      secretKey,
      contractSalt ?? this.defaultContractSalt
    );
  }

  /**
   * Retrieves the authenticated on-chain account commitment for a secret key.
   */
  public getAuthenticatedCaller(
    secretKey: Uint8Array | string,
    contractSalt?: string | Uint8Array
  ): Uint8Array {
    return this.deriveAccount(secretKey, contractSalt);
  }

  /**
   * Asserts whether a secret key matches a given on-chain account commitment.
   */
  public static isAuthorized(
    secretKey: Uint8Array | string,
    targetAccount: Uint8Array | string,
    contractSalt: string | Uint8Array
  ): boolean {
    const derived = FungibleTokenV24Client.deriveAccount(secretKey, contractSalt);
    const target = FungibleTokenV24Client.toBytes32(targetAccount);
    if (derived.length !== target.length) return false;
    for (let i = 0; i < derived.length; i++) {
      if (derived[i] !== target[i]) return false;
    }
    return true;
  }

  /**
   * Default witness provider configuring caller secret key and Schnorr reduction.
   */
  public static createWitnesses<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState>(
    secretKey: Uint8Array | string
  ): FungibleTokenV24Witnesses<PS> {
    const skBytes = FungibleTokenV24Client.toBytes32(secretKey);
    return {
      localSecretKey: (
        context: WitnessContext<ContractLedger, PS>
      ): [PS, Uint8Array] => [
        context.privateState,
        context.privateState?.secretKey ?? skBytes
      ],
      getSchnorrReduction: (
        context: WitnessContext<ContractLedger, PS>,
        challengeHash: bigint
      ): [PS, [bigint, bigint]] => {
        const TWO_248 = 1n << 248n;
        const q = challengeHash / TWO_248;
        const r = challengeHash % TWO_248;
        return [context.privateState, [q, r]];
      }
    };
  }

  // ==========================================================================
  // Multi-Sig Digest Builders & Inspection
  // ==========================================================================

  /**
   * Computes a signer commitment off-chain via pure circuit.
   */
  public static calculateSignerCommitment(
    pk: JubjubPoint,
    salt: Uint8Array | string
  ): Uint8Array {
    return pureCircuits.calculateSignerCommitment(pk, FungibleTokenV24Client.toBytes32(salt));
  }

  public calculateSignerCommitment(pk: JubjubPoint, salt?: Uint8Array | string): Uint8Array {
    return FungibleTokenV24Client.calculateSignerCommitment(
      pk,
      salt ?? this.defaultContractSalt
    );
  }

  // ==========================================================================
  // State Initialization & Queries
  // ==========================================================================

  /**
   * Executes the contract constructor to generate initial contract state.
   */
  public initialState(
    context: ConstructorContext<PS>,
    salt: Uint8Array | string,
    initialOwner: Uint8Array | string,
    name: string,
    symbol: string,
    decimals: number | bigint,
    maxSupply: number | bigint,
    initialSigners: Array<Uint8Array | string>,
    threshold: number | bigint
  ): ConstructorResult<PS> {
    if (initialSigners.length !== 3) {
      throw new Error('initialSigners must contain exactly 3 signers');
    }
    const normalizedSigners = initialSigners.map((s) => FungibleTokenV24Client.toBytes32(s));

    return this.contractInstance.initialState(
      context,
      FungibleTokenV24Client.toBytes32(salt),
      FungibleTokenV24Client.toBytes32(initialOwner),
      name,
      symbol,
      BigInt(decimals),
      BigInt(maxSupply),
      normalizedSigners,
      BigInt(threshold)
    );
  }

  /**
   * Decodes raw query or charged state into typed ledger fields.
   */
  public queryLedgerStateFromRaw(
    rawState: StateValue | ChargedState | unknown
  ): FungibleTokenV24LedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }

  // ==========================================================================
  // Multi-Sig Governed Circuits
  // ==========================================================================

  /**
   * Mints new tokens to a recipient, authorized by threshold multi-sig signatures.
   */
  public mint(
    context: CircuitContext<PS>,
    to: Uint8Array | string,
    value: bigint | number,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    if (pubkeys.length !== 2 || signatures.length !== 2) {
      throw new Error('Mint circuit requires exactly 2 signers and signatures');
    }
    return this.contractInstance.circuits.mint(
      context,
      FungibleTokenV24Client.toBytes32(to),
      BigInt(value),
      pubkeys,
      signatures
    );
  }

  /**
   * Burns tokens from an account, authorized by threshold multi-sig signatures.
   */
  public burn(
    context: CircuitContext<PS>,
    account: Uint8Array | string,
    value: bigint | number,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    if (pubkeys.length !== 2 || signatures.length !== 2) {
      throw new Error('Burn circuit requires exactly 2 signers and signatures');
    }
    return this.contractInstance.circuits.burn(
      context,
      FungibleTokenV24Client.toBytes32(account),
      BigInt(value),
      pubkeys,
      signatures
    );
  }

  /**
   * Reassigns emergency pauser, authorized by threshold multi-sig signatures.
   */
  public setEmergencyPauser(
    context: CircuitContext<PS>,
    newPauser: Uint8Array | string,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    if (pubkeys.length !== 2 || signatures.length !== 2) {
      throw new Error('setEmergencyPauser requires exactly 2 signers and signatures');
    }
    return this.contractInstance.circuits.setEmergencyPauser(
      context,
      FungibleTokenV24Client.toBytes32(newPauser),
      pubkeys,
      signatures
    );
  }

  // ==========================================================================
  // Emergency Controls & Administration Circuits
  // ==========================================================================

  /**
   * Halts contract activity. Callable by pauser or owner.
   */
  public pause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    return this.contractInstance.circuits.pause(
      context,
      FungibleTokenV24Client.toBytes32(caller)
    );
  }

  /**
   * Resumes contract activity. Callable by pauser or owner.
   */
  public unpause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    return this.contractInstance.circuits.unpause(
      context,
      FungibleTokenV24Client.toBytes32(caller)
    );
  }

  /**
   * Reallocates trapped tokens. Owner only.
   */
  public adminReallocate(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    trappedAccount: Uint8Array | string,
    targetSpendableAccount: Uint8Array | string,
    amount: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contractInstance.circuits.adminReallocate(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      FungibleTokenV24Client.toBytes32(trappedAccount),
      FungibleTokenV24Client.toBytes32(targetSpendableAccount),
      BigInt(amount)
    );
  }

  /**
   * Emergency withdrawal of trapped contract tokens to owner when paused.
   */
  public emergencyWithdraw(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    tokenAddress: { bytes: Uint8Array } | Uint8Array | string,
    amount: bigint | number
  ): CircuitResults<PS, boolean> {
    let tokenContract: { bytes: Uint8Array };
    if (typeof tokenAddress === 'object' && tokenAddress !== null && 'bytes' in tokenAddress) {
      tokenContract = { bytes: FungibleTokenV24Client.toBytes32(tokenAddress.bytes) };
    } else {
      tokenContract = { bytes: FungibleTokenV24Client.toBytes32(tokenAddress as string | Uint8Array) };
    }

    return this.contractInstance.circuits.emergencyWithdraw(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      tokenContract,
      BigInt(amount)
    );
  }

  // ==========================================================================
  // Standard Token Operations
  // ==========================================================================

  /**
   * Transfers tokens from caller to recipient.
   */
  public transfer(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    to: Uint8Array | string,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contractInstance.circuits.transfer(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      FungibleTokenV24Client.toBytes32(to),
      BigInt(value)
    );
  }

  /**
   * Sets token allowance for spender.
   */
  public approve(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    spender: Uint8Array | string,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contractInstance.circuits.approve(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      FungibleTokenV24Client.toBytes32(spender),
      BigInt(value)
    );
  }

  /**
   * Executes approved token transfer on behalf of fromAccount.
   */
  public transferFrom(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    fromAccount: Uint8Array | string,
    to: Uint8Array | string,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contractInstance.circuits.transferFrom(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      FungibleTokenV24Client.toBytes32(fromAccount),
      FungibleTokenV24Client.toBytes32(to),
      BigInt(value)
    );
  }

  /**
   * Allows caller to voluntarily burn their own tokens.
   */
  public selfBurn(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contractInstance.circuits.selfBurn(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      BigInt(value)
    );
  }

  // ==========================================================================
  // Multi-Sig Ledger State Inspection Queries
  // ==========================================================================

  /**
   * Reads current multi-sig operation nonce directly from public ledger state.
   */
  public getMultisigNonce(ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown): bigint {
    const state = (ledgerState as any)?._multisigNonce !== undefined
      ? (ledgerState as FungibleTokenV24LedgerState)
      : this.queryLedgerStateFromRaw(ledgerState);
    return state._multisigNonce;
  }

  /**
   * Reads multi-sig signature threshold from public ledger state.
   */
  public getMultisigThreshold(ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown): bigint {
    const state = (ledgerState as any)?._multisigThreshold !== undefined
      ? (ledgerState as FungibleTokenV24LedgerState)
      : this.queryLedgerStateFromRaw(ledgerState);
    return state._multisigThreshold;
  }

  /**
   * Reads number of registered multi-sig signers from public ledger state.
   */
  public getMultisigSignerCount(ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown): bigint {
    const state = (ledgerState as any)?._multisigSignerCount !== undefined
      ? (ledgerState as FungibleTokenV24LedgerState)
      : this.queryLedgerStateFromRaw(ledgerState);
    return state._multisigSignerCount;
  }

  /**
   * Checks whether a signer commitment is registered in the multi-sig signers set from public ledger state.
   */
  public isMultisigSigner(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown,
    commitment: Uint8Array | string
  ): boolean {
    const state = (ledgerState as any)?._multisigSigners?.member !== undefined
      ? (ledgerState as FungibleTokenV24LedgerState)
      : this.queryLedgerStateFromRaw(ledgerState);
    return state._multisigSigners.member(FungibleTokenV24Client.toBytes32(commitment));
  }
}

export { FungibleTokenV24Client as FungibleTokenV24SDK };
```