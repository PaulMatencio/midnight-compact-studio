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