// src/client/fungible-token-v2-4-sdk.ts
// SPDX-License-Identifier: MIT

import {
  type CircuitContext,
  type QueryContext,
  type WitnessContext,
  type ConstructorContext,
  type ConstructorResult,
  type CircuitResults,
  type StateValue,
  type ChargedState,
  type JubjubPoint,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract as ManagedContract,
  ledger,
  pureCircuits,
  type Witnesses as ContractWitnesses,
  type Ledger as ContractLedger,
  type SchnorrSignature,
} from '../../contracts/managed/fungible-token-v2-4/contract/index.js';

export type { SchnorrSignature, JubjubPoint };

/**
 * Off-chain private state holding the caller's authentication secret key.
 */
export interface FungibleTokenV24PrivateState {
  readonly secretKey: Uint8Array;
}

/**
 * Contract ledger type definition.
 */
export type FungibleTokenV24LedgerState = ContractLedger;

/**
 * Type-safe witnesses matching the Compact contract witness declarations.
 */
export type FungibleTokenV24Witnesses<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState> = {
  localSecretKey: (context: WitnessContext<ContractLedger, PS>) => [PS, Uint8Array];
  getSchnorrReduction: (
    context: WitnessContext<ContractLedger, PS>,
    challengeHash: bigint
  ) => [PS, [bigint, bigint]];
};

/**
 * Production-grade TypeScript Client SDK for the FungibleToken v2.4 Compact contract
 * with privacy-preserving threshold multi-sig governance and Schnorr verification.
 */
export class FungibleTokenV24Client<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState> {
  protected readonly contract: ManagedContract<PS>;
  public readonly defaultContractSalt: Uint8Array;

  /**
   * Constructs an instance of the FungibleTokenV24Client.
   *
   * @param defaultSecretKey - Default 32-byte secret key for caller authentication.
   * @param defaultContractSalt - Default 32-byte deployment salt.
   * @param customWitnesses - Optional customized witness overrides.
   */
  constructor(
    defaultSecretKey: Uint8Array | string = new Uint8Array(32),
    defaultContractSalt: Uint8Array | string = new Uint8Array(32),
    customWitnesses?: Partial<FungibleTokenV24Witnesses<PS>>
  ) {
    this.defaultContractSalt = FungibleTokenV24Client.toBytes32(defaultContractSalt);
    const standardWitnesses = FungibleTokenV24Client.createWitnesses<PS>(defaultSecretKey);
    const finalWitnesses = { ...standardWitnesses, ...customWitnesses } as ContractWitnesses<PS>;
    this.contract = new ManagedContract<PS>(finalWitnesses);
  }

  // ==========================================================================
  // Cryptographic Identity & Account Helpers
  // ==========================================================================

  /**
   * Normalizes strings or buffers into strict 32-byte Uint8Array arrays.
   */
  public static toBytes32(input: Uint8Array | string): Uint8Array {
    if (typeof input === 'string') {
      const cleanHex = input.startsWith('0x') ? input.slice(2) : input;
      if (cleanHex.length === 64) {
        return new Uint8Array(Buffer.from(cleanHex, 'hex'));
      }
      const buffer = new Uint8Array(32);
      const encoded = Buffer.from(input, 'utf-8');
      buffer.set(encoded.subarray(0, Math.min(encoded.length, 32)));
      return buffer;
    }
    if (input instanceof Uint8Array) {
      if (input.length === 32) {
        return input;
      }
      const result = new Uint8Array(32);
      result.set(input.subarray(0, Math.min(input.length, 32)));
      return result;
    }
    throw new TypeError('Invalid input: expected Uint8Array or hex/utf-8 string');
  }

  /**
   * Converts a bigint or number into a 32-byte big-endian Uint8Array.
   */
  public static toUint256Bytes(value: bigint | number): Uint8Array {
    const bi = BigInt(value);
    const buffer = new Uint8Array(32);
    let temp = bi;
    for (let i = 31; i >= 0; i--) {
      buffer[i] = Number(temp & 0xffn);
      temp >>= 8n;
    }
    return buffer;
  }

  /**
   * Derives the on-chain account commitment using the contract's authenticating Poseidon curve hash.
   * Bound to _contractSalt for cross-contract replay protection.
   *
   * @param secretKey - The 32-byte private key.
   * @param contractSalt - The 32-byte contract deployment salt.
   * @returns 32-byte derived on-chain public identity.
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
        getSchnorrReduction: (ctx: any, h: any) => [ctx.privateState, [0n, 0n]],
      } as any);

      if (typeof (dummy as any)._persistentHash_3 === 'function') {
        try {
          return (dummy as any)._persistentHash_3([domainTag, saltBytes, skBytes]);
        } catch {
          return (dummy as any)._persistentHash_3([domainTag, { bytes: saltBytes }, skBytes]);
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
   * Instance method to derive an on-chain account using the instance default salt.
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
   * Returns the authenticated on-chain identity for the given secret key.
   */
  public getAuthenticatedCaller(
    secretKey: Uint8Array | string,
    contractSalt?: string | Uint8Array
  ): Uint8Array {
    return this.deriveAccount(secretKey, contractSalt);
  }

  /**
   * Checks whether a private key corresponds to a given on-chain account identity under a salt.
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

  // ==========================================================================
  // Multi-Sig Cryptographic Helpers & Witnesses
  // ==========================================================================

  /**
   * Derives a signer's on-chain commitment from their Jubjub public key.
   * Uses pure circuit calculation matching `calculateSignerCommitment(pk, salt)`.
   */
  public static calculateSignerCommitment(
    pk: JubjubPoint,
    salt: Uint8Array | string = new Uint8Array(32)
  ): Uint8Array {
    const saltBytes = FungibleTokenV24Client.toBytes32(salt);
    return pureCircuits.calculateSignerCommitment(pk, saltBytes);
  }

  /**
   * Instance method to derive a signer commitment using the instance default salt.
   */
  public calculateSignerCommitment(
    pk: JubjubPoint,
    salt?: Uint8Array | string
  ): Uint8Array {
    return FungibleTokenV24Client.calculateSignerCommitment(
      pk,
      salt ?? this.defaultContractSalt
    );
  }

  /**
   * Computes the domain-separated message digest for a threshold multi-sig `mint` operation:
   *   persistentHash(["multisig:mint:", contractAddress, nonce, to, amount])
   */
  public static calculateMintDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    to: Uint8Array | string,
    amount: bigint | number
  ): Uint8Array {
    const domain = new Uint8Array(32);
    domain.set(Buffer.from('multisig:mint:', 'utf-8'));
    const addr = FungibleTokenV24Client.toBytes32(contractAddress);
    const n = FungibleTokenV24Client.toUint256Bytes(nonce);
    const recipient = FungibleTokenV24Client.toBytes32(to);
    const val = FungibleTokenV24Client.toUint256Bytes(amount);

    const dummy = new ManagedContract({
      localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
      getSchnorrReduction: (ctx: any, h: any) => [ctx.privateState, [0n, 0n]],
    } as any);

    return (dummy as any)._persistentHash_0([domain, addr, n, recipient, val]);
  }

  /**
   * Computes the domain-separated message digest for a threshold multi-sig `burn` operation:
   *   persistentHash(["multisig:burn:", contractAddress, nonce, account, amount])
   */
  public static calculateBurnDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    account: Uint8Array | string,
    amount: bigint | number
  ): Uint8Array {
    const domain = new Uint8Array(32);
    domain.set(Buffer.from('multisig:burn:', 'utf-8'));
    const addr = FungibleTokenV24Client.toBytes32(contractAddress);
    const n = FungibleTokenV24Client.toUint256Bytes(nonce);
    const acc = FungibleTokenV24Client.toBytes32(account);
    const val = FungibleTokenV24Client.toUint256Bytes(amount);

    const dummy = new ManagedContract({
      localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
      getSchnorrReduction: (ctx: any, h: any) => [ctx.privateState, [0n, 0n]],
    } as any);

    return (dummy as any)._persistentHash_0([domain, addr, n, acc, val]);
  }

  /**
   * Computes the domain-separated message digest for designating an emergency pauser:
   *   persistentHash(["multisig:set-pauser:", contractAddress, nonce, newPauser])
   */
  public static calculateSetEmergencyPauserDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    newPauser: Uint8Array | string
  ): Uint8Array {
    const domain = new Uint8Array(32);
    domain.set(Buffer.from('multisig:set-pauser:', 'utf-8'));
    const addr = FungibleTokenV24Client.toBytes32(contractAddress);
    const n = FungibleTokenV24Client.toUint256Bytes(nonce);
    const pauser = FungibleTokenV24Client.toBytes32(newPauser);

    const dummy = new ManagedContract({
      localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
      getSchnorrReduction: (ctx: any, h: any) => [ctx.privateState, [0n, 0n]],
    } as any);

    return (dummy as any)._persistentHash_1([domain, addr, n, pauser]);
  }

  /**
   * Creates standard production witness implementations for FungibleToken v2.4:
   * - `localSecretKey`: Caller private authentication key.
   * - `getSchnorrReduction`: 248-bit scalar challenge decomposition for Schnorr verification over Jubjub.
   */
  public static createWitnesses<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState>(
    secretKey: Uint8Array | string
  ): FungibleTokenV24Witnesses<PS> {
    const skBytes = FungibleTokenV24Client.toBytes32(secretKey);
    const TWO_248 = 1n << 248n;

    return {
      localSecretKey: (context: WitnessContext<ContractLedger, PS>): [PS, Uint8Array] => {
        const activeKey = context.privateState?.secretKey ?? skBytes;
        return [context.privateState, activeKey];
      },
      getSchnorrReduction: (
        context: WitnessContext<ContractLedger, PS>,
        challengeHash: bigint
      ): [PS, [bigint, bigint]] => {
        const q = challengeHash / TWO_248;
        const r = challengeHash % TWO_248;
        return [context.privateState, [q, r]];
      },
    };
  }

  // ==========================================================================
  // Initialization & Construction
  // ==========================================================================

  /**
   * Initializes contract state with token parameters and registered multi-sig signers.
   */
  public initialState(
    context: ConstructorContext<PS>,
    salt: Uint8Array | string,
    initialOwner: Uint8Array | string,
    name: string,
    symbol: string,
    decimals: number | bigint,
    maxSupply: number | bigint,
    initialSigners: (Uint8Array | string)[],
    threshold: number | bigint
  ): ConstructorResult<PS> {
    const saltBytes = FungibleTokenV24Client.toBytes32(salt);
    const ownerBytes = FungibleTokenV24Client.toBytes32(initialOwner);
    const signersArray = initialSigners.map((s) => FungibleTokenV24Client.toBytes32(s));

    return this.contract.initialState(
      context,
      saltBytes,
      ownerBytes,
      name,
      symbol,
      BigInt(decimals),
      BigInt(maxSupply),
      signersArray,
      BigInt(threshold)
    );
  }

  // ==========================================================================
  // Multi-Sig Governed Operations (2-of-N Threshold)
  // ==========================================================================

  /**
   * Mints tokens to a recipient address, authorized by threshold multi-sig signatures.
   *
   * @param context - Circuit execution context.
   * @param to - Recipient account.
   * @param value - Amount of tokens to mint.
   * @param pubkeys - Array of 2 distinct signer Jubjub public keys.
   * @param signatures - Array of 2 valid Schnorr signatures over the mint digest.
   */
  public mint(
    context: CircuitContext<PS>,
    to: Uint8Array | string,
    value: number | bigint,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    const toBytes = FungibleTokenV24Client.toBytes32(to);
    return this.contract.impureCircuits.mint(
      context,
      toBytes,
      BigInt(value),
      pubkeys,
      signatures
    );
  }

  /**
   * Burns tokens from an account, authorized by threshold multi-sig signatures.
   *
   * @param context - Circuit execution context.
   * @param account - Account from which tokens will be burned.
   * @param value - Amount to burn.
   * @param pubkeys - Array of 2 distinct signer Jubjub public keys.
   * @param signatures - Array of 2 valid Schnorr signatures over the burn digest.
   */
  public burn(
    context: CircuitContext<PS>,
    account: Uint8Array | string,
    value: number | bigint,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    const accountBytes = FungibleTokenV24Client.toBytes32(account);
    return this.contract.impureCircuits.burn(
      context,
      accountBytes,
      BigInt(value),
      pubkeys,
      signatures
    );
  }

  /**
   * Designates a new emergency pauser, authorized by threshold multi-sig signatures.
   *
   * @param context - Circuit execution context.
   * @param newPauser - Address of the new emergency pauser.
   * @param pubkeys - Array of 2 distinct signer Jubjub public keys.
   * @param signatures - Array of 2 valid Schnorr signatures over the set-pauser digest.
   */
  public setEmergencyPauser(
    context: CircuitContext<PS>,
    newPauser: Uint8Array | string,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    const pauserBytes = FungibleTokenV24Client.toBytes32(newPauser);
    return this.contract.impureCircuits.setEmergencyPauser(
      context,
      pauserBytes,
      pubkeys,
      signatures
    );
  }

  // ==========================================================================
  // Token Holder Operations
  // ==========================================================================

  /**
   * Transfers tokens from the caller's account to a recipient.
   */
  public transfer(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    to: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV24Client.toBytes32(caller);
    const toBytes = FungibleTokenV24Client.toBytes32(to);
    return this.contract.impureCircuits.transfer(
      context,
      callerBytes,
      toBytes,
      BigInt(value)
    );
  }

  /**
   * Approves a spender to spend up to `value` tokens from the caller's account.
   */
  public approve(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    spender: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV24Client.toBytes32(caller);
    const spenderBytes = FungibleTokenV24Client.toBytes32(spender);
    return this.contract.impureCircuits.approve(
      context,
      callerBytes,
      spenderBytes,
      BigInt(value)
    );
  }

  /**
   * Transfers tokens from `fromAccount` to `to` using the caller's pre-approved allowance.
   */
  public transferFrom(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    fromAccount: Uint8Array | string,
    to: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV24Client.toBytes32(caller);
    const fromBytes = FungibleTokenV24Client.toBytes32(fromAccount);
    const toBytes = FungibleTokenV24Client.toBytes32(to);
    return this.contract.impureCircuits.transferFrom(
      context,
      callerBytes,
      fromBytes,
      toBytes,
      BigInt(value)
    );
  }

  /**
   * Voluntary burn of caller's own tokens without requiring multi-sig consensus.
   */
  public selfBurn(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV24Client.toBytes32(caller);
    return this.contract.impureCircuits.selfBurn(
      context,
      callerBytes,
      BigInt(value)
    );
  }

  // ==========================================================================
  // Administrative & Emergency Controls
  // ==========================================================================

  /**
   * Pauses all token transfers and governed actions. Authorized by owner or emergency pauser.
   */
  public pause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV24Client.toBytes32(caller);
    return this.contract.impureCircuits.pause(context, callerBytes);
  }

  /**
   * Resumes contract operations when paused. Authorized by owner or emergency pauser.
   */
  public unpause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV24Client.toBytes32(caller);
    return this.contract.impureCircuits.unpause(context, callerBytes);
  }

  /**
   * Rescues tokens from an inaccessible account and reallocates them to a spendable account.
   */
  public adminReallocate(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    trappedAccount: Uint8Array | string,
    targetSpendableAccount: Uint8Array | string,
    amount: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV24Client.toBytes32(caller);
    const trappedBytes = FungibleTokenV24Client.toBytes32(trappedAccount);
    const targetBytes = FungibleTokenV24Client.toBytes32(targetSpendableAccount);
    return this.contract.impureCircuits.adminReallocate(
      context,
      callerBytes,
      trappedBytes,
      targetBytes,
      BigInt(amount)
    );
  }

  /**
   * Emergency withdrawal of contract balance directly to the owner.
   */
  public emergencyWithdraw(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    tokenAddress: string | Uint8Array | { bytes: Uint8Array },
    amount: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV24Client.toBytes32(caller);
    let tokenParam: { bytes: Uint8Array };
    if (typeof tokenAddress === 'object' && tokenAddress !== null && 'bytes' in tokenAddress) {
      tokenParam = tokenAddress as { bytes: Uint8Array };
    } else {
      tokenParam = { bytes: FungibleTokenV24Client.toBytes32(tokenAddress as string | Uint8Array) };
    }
    return this.contract.impureCircuits.emergencyWithdraw(
      context,
      callerBytes,
      tokenParam,
      BigInt(amount)
    );
  }

  // ==========================================================================
  // Multi-Sig State Inspection Circuits
  // ==========================================================================

  /**
   * Returns current multi-sig operation replay protection nonce.
   */
  public getMultisigNonce(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.impureCircuits.getMultisigNonce(context);
  }

  /**
   * Returns required threshold approvals (e.g., 2).
   */
  public getMultisigThreshold(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.impureCircuits.getMultisigThreshold(context);
  }

  /**
   * Returns count of registered signers (e.g., 3).
   */
  public getMultisigSignerCount(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.impureCircuits.getMultisigSignerCount(context);
  }

  /**
   * Checks whether a commitment is a registered multi-sig signer.
   */
  public isMultisigSigner(
    context: CircuitContext<PS>,
    commitment: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    const commBytes = FungibleTokenV24Client.toBytes32(commitment);
    return this.contract.impureCircuits.isMultisigSigner(context, commBytes);
  }

  // ==========================================================================
  // Public Ledger State Queries
  // ==========================================================================

  /**
   * Decodes public ledger state from raw chain state.
   */
  public static queryLedgerStateFromRaw(
    rawState: StateValue | ChargedState | unknown
  ): FungibleTokenV24LedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }

  /**
   * Instance helper to decode public ledger state.
   */
  public queryLedgerState(
    rawState: StateValue | ChargedState | unknown
  ): FungibleTokenV24LedgerState {
    return FungibleTokenV24Client.queryLedgerStateFromRaw(rawState);
  }

  /**
   * Queries balance of an account from ledger state.
   */
  public static getBalance(
    ledgerState: FungibleTokenV24LedgerState,
    account: Uint8Array | string
  ): bigint {
    const accBytes = FungibleTokenV24Client.toBytes32(account);
    return ledgerState._balances.member(accBytes)
      ? ledgerState._balances.lookup(accBytes)
      : 0n;
  }

  /**
   * Queries allowance granted from owner to spender.
   */
  public static getAllowance(
    ledgerState: FungibleTokenV24LedgerState,
    owner: Uint8Array | string,
    spender: Uint8Array | string
  ): bigint {
    const ownerBytes = FungibleTokenV24Client.toBytes32(owner);
    const spenderBytes = FungibleTokenV24Client.toBytes32(spender);
    const key: [Uint8Array, Uint8Array] = [ownerBytes, spenderBytes];
    return ledgerState._allowances.member(key)
      ? ledgerState._allowances.lookup(key)
      : 0n;
  }
}

// Export SDK alias for developer ergonomics
export { FungibleTokenV24Client as FungibleTokenV24SDK };
