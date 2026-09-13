// src/client/fungible-token-v2-3-sdk.ts
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
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract as ManagedContract,
  ledger,
  type Witnesses as ContractWitnesses,
  type Ledger as ContractLedger,
} from '../../contracts/managed/fungible-token-v2-3/contract/index.js';

/**
 * Off-chain private state holding the caller's authentication secret key.
 */
export interface FungibleTokenV23PrivateState {
  readonly secretKey: Uint8Array;
}

/**
 * Contract ledger type definition.
 */
export type FungibleTokenV23LedgerState = ContractLedger;

/**
 * Type-safe witnesses matching the Compact witness declarations.
 */
export type FungibleTokenV23Witnesses<PS extends FungibleTokenV23PrivateState = FungibleTokenV23PrivateState> = {
  localSecretKey: (context: WitnessContext<ContractLedger, PS>) => [PS, Uint8Array];
};

/**
 * High-level, production-grade TypeScript Client SDK for the fungible-token-v2-3 Compact contract.
 */
export class FungibleTokenV23Client<PS extends FungibleTokenV23PrivateState = FungibleTokenV23PrivateState> {
  protected readonly contract: ManagedContract<PS>;
  public readonly defaultContractSalt: Uint8Array;

  /**
   * Constructs an instance of the FungibleTokenV23Client.
   *
   * @param defaultSecretKey - Default 32-byte secret key for signing calls.
   * @param defaultContractSalt - Default 32-byte deployment salt.
   * @param customWitnesses - Optional customized witness implementations.
   */
  constructor(
    defaultSecretKey: Uint8Array | string = new Uint8Array(32),
    defaultContractSalt: Uint8Array | string = new Uint8Array(32),
    customWitnesses?: Partial<FungibleTokenV23Witnesses<PS>>
  ) {
    this.defaultContractSalt = FungibleTokenV23Client.toBytes32(defaultContractSalt);
    const standardWitnesses = FungibleTokenV23Client.createWitnesses<PS>(defaultSecretKey);
    const finalWitnesses = { ...standardWitnesses, ...customWitnesses } as ContractWitnesses<PS>;
    this.contract = new ManagedContract<PS>(finalWitnesses);
  }

  // ==========================================================================
  // Cryptographic Identity & Account Helpers
  // ==========================================================================

  /**
   * Helper utility to normalize strings or buffers into strict 32-byte Uint8Array arrays.
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
    const skBytes = FungibleTokenV23Client.toBytes32(secretKey);
    const saltBytes = FungibleTokenV23Client.toBytes32(contractSalt);
    const domainTag = new Uint8Array(32);
    domainTag.set(Buffer.from('fungible-token:auth', 'utf-8'));

    try {
      const dummy = new ManagedContract({
        localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
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
   * Instance method to derive an on-chain account using the instance default salt.
   */
  public deriveAccount(
    secretKey: Uint8Array | string,
    contractSalt?: string | Uint8Array
  ): Uint8Array {
    return FungibleTokenV23Client.deriveAccount(
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
    const derived = FungibleTokenV23Client.deriveAccount(secretKey, contractSalt);
    const target = FungibleTokenV23Client.toBytes32(targetAccount);
    if (derived.length !== target.length) return false;
    for (let i = 0; i < derived.length; i++) {
      if (derived[i] !== target[i]) return false;
    }
    return true;
  }

  /**
   * Creates standard witness providers configured with a private key.
   */
  public static createWitnesses<PS extends FungibleTokenV23PrivateState = FungibleTokenV23PrivateState>(
    secretKey: Uint8Array | string
  ): FungibleTokenV23Witnesses<PS> {
    const skBytes = FungibleTokenV23Client.toBytes32(secretKey);
    return {
      localSecretKey: (context: WitnessContext<ContractLedger, PS>): [PS, Uint8Array] => {
        const activeKey = context.privateState?.secretKey ?? skBytes;
        return [context.privateState, activeKey];
      },
    };
  }

  // ==========================================================================
  // Initialization & Construction
  // ==========================================================================

  /**
   * Initializes contract state using the Compact runtime constructor.
   */
  public initialState(
    context: ConstructorContext<PS>,
    salt: Uint8Array | string,
    initialOwner: Uint8Array | string,
    name: string,
    symbol: string,
    decimals: number | bigint,
    maxSupply: number | bigint
  ): ConstructorResult<PS> {
    const saltBytes = FungibleTokenV23Client.toBytes32(salt);
    const ownerBytes = FungibleTokenV23Client.toBytes32(initialOwner);
    return this.contract.initialState(
      context,
      saltBytes,
      ownerBytes,
      name,
      symbol,
      BigInt(decimals),
      BigInt(maxSupply)
    );
  }

  // ==========================================================================
  // Administrative & Emergency Circuits
  // ==========================================================================

  /**
   * Pauses all token transfers, approvals, and minting/burning.
   */
  public pause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    return this.contract.impureCircuits.pause(context, callerBytes);
  }

  /**
   * Resumes contract operations when paused.
   */
  public unpause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    return this.contract.impureCircuits.unpause(context, callerBytes);
  }

  /**
   * Assigns a designated emergency pauser role.
   */
  public setEmergencyPauser(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    newPauser: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    const pauserBytes = FungibleTokenV23Client.toBytes32(newPauser);
    return this.contract.impureCircuits.setEmergencyPauser(context, callerBytes, pauserBytes);
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
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    const trappedBytes = FungibleTokenV23Client.toBytes32(trappedAccount);
    const targetBytes = FungibleTokenV23Client.toBytes32(targetSpendableAccount);
    return this.contract.impureCircuits.adminReallocate(
      context,
      callerBytes,
      trappedBytes,
      targetBytes,
      BigInt(amount)
    );
  }

  /**
   * Emergency withdrawal of contract balances directly to the owner.
   */
  public emergencyWithdraw(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    tokenAddress: string | Uint8Array | { bytes: Uint8Array },
    amount: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    let tokenParam: { bytes: Uint8Array };
    if (typeof tokenAddress === 'object' && tokenAddress !== null && 'bytes' in tokenAddress) {
      tokenParam = tokenAddress as { bytes: Uint8Array };
    } else {
      tokenParam = { bytes: FungibleTokenV23Client.toBytes32(tokenAddress as string | Uint8Array) };
    }
    return this.contract.impureCircuits.emergencyWithdraw(
      context,
      callerBytes,
      tokenParam,
      BigInt(amount)
    );
  }

  // ==========================================================================
  // Core Token Circuits
  // ==========================================================================

  /**
   * Transfers tokens from the caller to a recipient.
   */
  public transfer(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    to: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    const toBytes = FungibleTokenV23Client.toBytes32(to);
    return this.contract.impureCircuits.transfer(context, callerBytes, toBytes, BigInt(value));
  }

  /**
   * Approves a spender to transfer tokens on caller's behalf.
   */
  public approve(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    spender: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    const spenderBytes = FungibleTokenV23Client.toBytes32(spender);
    return this.contract.impureCircuits.approve(context, callerBytes, spenderBytes, BigInt(value));
  }

  /**
   * Executes an allowance-backed transfer on behalf of another account.
   */
  public transferFrom(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    fromAccount: Uint8Array | string,
    to: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    const fromBytes = FungibleTokenV23Client.toBytes32(fromAccount);
    const toBytes = FungibleTokenV23Client.toBytes32(to);
    return this.contract.impureCircuits.transferFrom(
      context,
      callerBytes,
      fromBytes,
      toBytes,
      BigInt(value)
    );
  }

  /**
   * Mints new tokens to the target address (Owner only).
   */
  public mint(
    context: CircuitContext<PS>,
    to: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const toBytes = FungibleTokenV23Client.toBytes32(to);
    return this.contract.impureCircuits.mint(context, toBytes, BigInt(value));
  }

  /**
   * Burns tokens from the caller's account.
   */
  public burn(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    return this.contract.impureCircuits.burn(context, callerBytes, BigInt(value));
  }

  // ==========================================================================
  // Ledger Queries
  // ==========================================================================

  /**
   * Decodes raw on-chain state into strongly typed ledger accessors.
   */
  public queryLedgerStateFromRaw(
    rawState: StateValue | ChargedState | unknown
  ): FungibleTokenV23LedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }

  /**
   * Queries the typed ledger state from a circuit QueryContext.
   */
  public queryLedgerState(context: QueryContext): FungibleTokenV23LedgerState {
    return ledger(context.state);
  }
}

// SDK Class Export Alias
export { FungibleTokenV23Client as FungibleTokenV23SDK };