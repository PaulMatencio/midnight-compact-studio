// SPDX-License-Identifier: Apache-2.0
/**
 * Production TypeScript Client SDK for FungibleToken v2.4 (Midnight Network)
 *
 * Provides strongly-typed circuit invocations, cryptographic witness builders,
 * algebraic Poseidon identity derivations, and multi-sig digest utilities.
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
  type JubjubPoint,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract as ManagedContract,
  ledger,
  pureCircuits,
  type Witnesses as ContractWitnesses,
  type Ledger as ContractLedger,
} from '../../contracts/managed/fungible-token-v2-4/contract/index.js';

// ============ Data Types & Interfaces ============

/**
 * Off-chain private state holding caller credentials.
 */
export interface FungibleTokenV24PrivateState {
  readonly secretKey: Uint8Array;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Jubjub curve Schnorr Signature structure matching Compact export struct.
 */
export interface SchnorrSignature {
  announcement: JubjubPoint;
  response: bigint;
}

/**
 * Re-export Contract Ledger matching on-chain storage.
 */
export type FungibleTokenV24LedgerState = ContractLedger;

/**
 * Witness interface parameterizing ContractWitnesses with private state PS.
 */
export type FungibleTokenV24Witnesses<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState> =
  ContractWitnesses<PS>;

// ============ High-Level SDK Client ============

/**
 * Production client SDK for interacting with the FungibleToken v2.4 smart contract.
 */
export class FungibleTokenV24Client<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState> {
  protected readonly contract: ManagedContract<PS>;
  public readonly defaultContractSalt: Uint8Array;

  /**
   * Initializes the FungibleToken v2.4 Client.
   *
   * @param witnesses Concrete witness implementation providing private data
   * @param defaultContractSalt 32-byte deployment salt for domain-separated account derivations
   */
  constructor(
    witnesses: FungibleTokenV24Witnesses<PS>,
    defaultContractSalt: Uint8Array | string = new Uint8Array(32)
  ) {
    this.contract = new ManagedContract(witnesses);
    this.defaultContractSalt = FungibleTokenV24Client.toBytes32(defaultContractSalt);
  }

  // ============ Identity & Cryptographic Helpers ============

  /**
   * Converts a hex string or byte array into a strictly validated 32-byte Uint8Array.
   */
  public static toBytes32(input: Uint8Array | string): Uint8Array {
    if (typeof input === 'string') {
      const sanitized = input.startsWith('0x') ? input.slice(2) : input;
      if (sanitized.length !== 64) {
        throw new Error(`Expected 32-byte hex string (64 characters), got length ${sanitized.length}`);
      }
      const out = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        out[i] = parseInt(sanitized.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
    if (input.length !== 32) {
      throw new Error(`Expected 32-byte Uint8Array, received length ${input.length}`);
    }
    return new Uint8Array(input);
  }

  /**
   * Derives an on-chain account commitment using the algebraic Poseidon hash
   * computed inside the Compact circuit:
   * persistentHash([pad(32, "fungible-token:auth"), contractSalt, secretKey])
   *
   * @param secretKey 32-byte private secret key
   * @param contractSalt 32-byte contract deployment salt
   * @returns 32-byte derived public account commitment
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
        getSchnorrReduction: (ctx: any) => [ctx.privateState, [0n, 0n]],
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
    } catch (err) {
      throw new Error(`Failed to resolve Compact persistentHash for account derivation: ${String(err)}`);
    }

    throw new Error('Failed to resolve Compact persistentHash for account derivation');
  }

  /**
   * Instance method deriving an account commitment using the configured default contract salt.
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
   * Retrieves the on-chain account corresponding to the supplied secret key.
   */
  public getAuthenticatedCaller(
    secretKey: Uint8Array | string,
    contractSalt?: string | Uint8Array
  ): Uint8Array {
    return this.deriveAccount(secretKey, contractSalt);
  }

  /**
   * Verifies if a secret key matches a target on-chain account commitment.
   */
  public static isAuthorized(
    secretKey: Uint8Array | string,
    targetAccount: Uint8Array | string,
    contractSalt: string | Uint8Array
  ): boolean {
    const derived = FungibleTokenV24Client.deriveAccount(secretKey, contractSalt);
    const target = FungibleTokenV24Client.toBytes32(targetAccount);
    for (let i = 0; i < 32; i++) {
      if (derived[i] !== target[i]) return false;
    }
    return true;
  }

  /**
   * Factory producing canonical witness implementations for FungibleToken v2.4.
   */
  public static createWitnesses<P extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState>(
    secretKey: Uint8Array | string
  ): FungibleTokenV24Witnesses<P> {
    const skBytes = FungibleTokenV24Client.toBytes32(secretKey);

    return {
      localSecretKey: (context: WitnessContext<ContractLedger, P>): [P, Uint8Array] => {
        return [context.privateState, context.privateState?.secretKey ?? skBytes];
      },
      getSchnorrReduction: (
        context: WitnessContext<ContractLedger, P>,
        challengeHash: bigint
      ): [P, [bigint, bigint]] => {
        const TWO_248 = 1n << 248n;
        const q = challengeHash / TWO_248;
        const r = challengeHash % TWO_248;
        return [context.privateState, [q, r]];
      },
    };
  }

  // ============ Multi-Sig Domain Digest Helpers ============

  /**
   * Calculates a multi-sig signer commitment via pure circuit export:
   * persistentHash([pad(32, "multisig:signer:"), salt, pk_x, pk_y])
   */
  public calculateSignerCommitment(
    pk: JubjubPoint,
    salt: Uint8Array | string = this.defaultContractSalt
  ): Uint8Array {
    const saltBytes = FungibleTokenV24Client.toBytes32(salt);
    return pureCircuits.calculateSignerCommitment(pk, saltBytes);
  }

  /**
   * Computes the domain-separated message hash for multi-sig token minting:
   * persistentHash([pad(32, "multisig:mint:"), contractAddress, nonce, to, amount])
   */
  public static calculateMintDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    to: Uint8Array | string,
    amount: bigint | number
  ): Uint8Array {
    const dummy = new ManagedContract({
      localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
      getSchnorrReduction: (ctx: any) => [ctx.privateState, [0n, 0n]],
    } as any);

    const domainTag = new Uint8Array(32);
    domainTag.set(Buffer.from('multisig:mint:', 'utf-8'));

    const contractBytes = FungibleTokenV24Client.toBytes32(contractAddress);
    const nonceBytes = new Uint8Array(32);
    new DataView(nonceBytes.buffer).setBigUint64(24, BigInt(nonce), false);

    const toBytes = FungibleTokenV24Client.toBytes32(to);
    const amountBytes = new Uint8Array(32);
    new DataView(amountBytes.buffer).setBigUint64(24, BigInt(amount), false);

    const hashInput = [domainTag, contractBytes, nonceBytes, toBytes, amountBytes];
    return (dummy as any)._persistentHash_2
      ? (dummy as any)._persistentHash_2(hashInput)
      : (dummy as any)._persistentHash_0(hashInput);
  }

  /**
   * Computes the domain-separated message hash for multi-sig token burning:
   * persistentHash([pad(32, "multisig:burn:"), contractAddress, nonce, account, amount])
   */
  public static calculateBurnDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    account: Uint8Array | string,
    amount: bigint | number
  ): Uint8Array {
    const dummy = new ManagedContract({
      localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
      getSchnorrReduction: (ctx: any) => [ctx.privateState, [0n, 0n]],
    } as any);

    const domainTag = new Uint8Array(32);
    domainTag.set(Buffer.from('multisig:burn:', 'utf-8'));

    const contractBytes = FungibleTokenV24Client.toBytes32(contractAddress);
    const nonceBytes = new Uint8Array(32);
    new DataView(nonceBytes.buffer).setBigUint64(24, BigInt(nonce), false);

    const accountBytes = FungibleTokenV24Client.toBytes32(account);
    const amountBytes = new Uint8Array(32);
    new DataView(amountBytes.buffer).setBigUint64(24, BigInt(amount), false);

    const hashInput = [domainTag, contractBytes, nonceBytes, accountBytes, amountBytes];
    return (dummy as any)._persistentHash_2
      ? (dummy as any)._persistentHash_2(hashInput)
      : (dummy as any)._persistentHash_0(hashInput);
  }

  /**
   * Computes the domain-separated message hash for multi-sig pauser rotation:
   * persistentHash([pad(32, "multisig:set-pauser:"), contractAddress, nonce, newPauser])
   */
  public static calculateSetEmergencyPauserDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    newPauser: Uint8Array | string
  ): Uint8Array {
    const dummy = new ManagedContract({
      localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
      getSchnorrReduction: (ctx: any) => [ctx.privateState, [0n, 0n]],
    } as any);

    const domainTag = new Uint8Array(32);
    domainTag.set(Buffer.from('multisig:set-pauser:', 'utf-8'));

    const contractBytes = FungibleTokenV24Client.toBytes32(contractAddress);
    const nonceBytes = new Uint8Array(32);
    new DataView(nonceBytes.buffer).setBigUint64(24, BigInt(nonce), false);

    const pauserBytes = FungibleTokenV24Client.toBytes32(newPauser);

    const hashInput = [domainTag, contractBytes, nonceBytes, pauserBytes];
    return (dummy as any)._persistentHash_3
      ? (dummy as any)._persistentHash_3(hashInput)
      : (dummy as any)._persistentHash_0(hashInput);
  }

  // ============ Contract Construction ============

  /**
   * Evaluates the contract constructor and returns the initial state values.
   */
  public initialState(
    context: ConstructorContext<PS>,
    salt: Uint8Array | string,
    initialOwner: Uint8Array | string,
    name: string,
    symbol: string,
    decimals: number | bigint,
    maxSupply: bigint | number,
    initialSigners: (Uint8Array | string)[],
    threshold: number | bigint
  ): ConstructorResult<PS> {
    const saltBytes = FungibleTokenV24Client.toBytes32(salt);
    const ownerBytes = FungibleTokenV24Client.toBytes32(initialOwner);
    const signersBytes = initialSigners.map((s) => FungibleTokenV24Client.toBytes32(s));

    if (signersBytes.length !== 3) {
      throw new Error(`Constructor requires exactly 3 initial signers; got ${signersBytes.length}`);
    }

    return this.contract.initialState(
      context,
      saltBytes,
      ownerBytes,
      name,
      symbol,
      BigInt(decimals),
      BigInt(maxSupply),
      signersBytes,
      BigInt(threshold)
    );
  }

  // ============ Circuit Invocations ============

  /**
   * Executes standard token transfer.
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
   * Approves spending allowance for a third-party spender.
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
   * Transfers tokens on behalf of another account using prior allowance.
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
   * Voluntary self-burn for token holders destroying their own balance.
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

  /**
   * Governed mint operation authorized via 2-of-N Schnorr threshold signatures.
   */
  public mint(
    context: CircuitContext<PS>,
    to: Uint8Array | string,
    value: bigint | number,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    if (pubkeys.length !== 2 || signatures.length !== 2) {
      throw new Error('mint requires exactly 2 signers and signatures for threshold verification');
    }
    return this.contract.circuits.mint(
      context,
      FungibleTokenV24Client.toBytes32(to),
      BigInt(value),
      pubkeys,
      signatures
    );
  }

  /**
   * Governed burn operation authorized via 2-of-N Schnorr threshold signatures.
   */
  public burn(
    context: CircuitContext<PS>,
    account: Uint8Array | string,
    value: bigint | number,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    if (pubkeys.length !== 2 || signatures.length !== 2) {
      throw new Error('burn requires exactly 2 signers and signatures for threshold verification');
    }
    return this.contract.circuits.burn(
      context,
      FungibleTokenV24Client.toBytes32(account),
      BigInt(value),
      pubkeys,
      signatures
    );
  }

  /**
   * Designates a new emergency pauser authorized by threshold multi-sig.
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
    return this.contract.circuits.setEmergencyPauser(
      context,
      FungibleTokenV24Client.toBytes32(newPauser),
      pubkeys,
      signatures
    );
  }

  /**
   * Pauses all token transfers and operations (Owner or Pauser only).
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
   * Resumes contract operations from paused state (Owner or Pauser only).
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
   * Reallocates blocked balances from an inaccessible account (Owner only).
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
   * Recovers trapped funds during emergency pause (Owner only).
   */
  public emergencyWithdraw(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    token: { bytes: Uint8Array },
    amount: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.emergencyWithdraw(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      token,
      BigInt(amount)
    );
  }

  // ============ Ledger State Query Helpers ============

  /**
   * Parses raw state into typed Ledger representation.
   */
  public queryLedgerState(rawState: StateValue | ChargedState | unknown): FungibleTokenV24LedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }

  /**
   * Queries the token balance of an account from typed or raw ledger state.
   */
  public getBalance(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown,
    account: Uint8Array | string
  ): bigint {
    const state = this.ensureLedgerState(ledgerState);
    const key = FungibleTokenV24Client.toBytes32(account);
    return state._balances.member(key) ? state._balances.lookup(key) : 0n;
  }

  /**
   * Queries spending allowance between an owner and a spender.
   */
  public getAllowance(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown,
    ownerAccount: Uint8Array | string,
    spender: Uint8Array | string
  ): bigint {
    const state = this.ensureLedgerState(ledgerState);
    const key: [Uint8Array, Uint8Array] = [
      FungibleTokenV24Client.toBytes32(ownerAccount),
      FungibleTokenV24Client.toBytes32(spender),
    ];
    return state._allowances.member(key) ? state._allowances.lookup(key) : 0n;
  }

  /**
   * Retrieves current multi-sig operation replay nonce.
   */
  public getMultisigNonce(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown
  ): bigint {
    const state = this.ensureLedgerState(ledgerState);
    return state._multisigNonce;
  }

  /**
   * Retrieves current multi-sig required signer threshold.
   */
  public getMultisigThreshold(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown
  ): bigint {
    const state = this.ensureLedgerState(ledgerState);
    return state._multisigThreshold;
  }

  /**
   * Retrieves total count of initial registered multi-sig signers.
   */
  public getMultisigSignerCount(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown
  ): bigint {
    const state = this.ensureLedgerState(ledgerState);
    return state._multisigSignerCount;
  }

  /**
   * Checks if a signer commitment is registered in the on-chain multi-sig signers set.
   */
  public isMultisigSigner(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown,
    signerCommitment: Uint8Array | string
  ): boolean {
    const state = this.ensureLedgerState(ledgerState);
    const commitmentBytes = FungibleTokenV24Client.toBytes32(signerCommitment);
    return state._multisigSigners.member(commitmentBytes);
  }

  /**
   * Checks whether the contract is currently paused.
   */
  public isPaused(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown
  ): boolean {
    const state = this.ensureLedgerState(ledgerState);
    return state._paused;
  }

  /**
   * Helper extracting a typed Ledger state instance.
   */
  private ensureLedgerState(
    state: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown
  ): FungibleTokenV24LedgerState {
    if (state && typeof state === 'object' && '_balances' in state) {
      return state as FungibleTokenV24LedgerState;
    }
    return ledger(state as StateValue | ChargedState);
  }
}

// SDK Alias Export
export { FungibleTokenV24Client as FungibleTokenV24SDK };