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
  // Read-Only & Inspection Helpers (Direct Public Ledger State Queries)
  // ===========================================================================

  private getState(stateOrContext: StateValue | ChargedState | CircuitContext<PS> | unknown): FungibleTokenV22LedgerState {
    if (stateOrContext && typeof stateOrContext === 'object' && 'currentQueryContext' in (stateOrContext as any)) {
      return ledger((stateOrContext as CircuitContext<PS>).currentQueryContext.state);
    }
    return ledger(stateOrContext as StateValue | ChargedState);
  }

  public contractSalt(stateOrContext: StateValue | ChargedState | CircuitContext<PS> | unknown): Uint8Array {
    return this.getState(stateOrContext)._contractSalt;
  }

  public name(stateOrContext: StateValue | ChargedState | CircuitContext<PS> | unknown): string {
    return this.getState(stateOrContext)._name;
  }

  public symbol(stateOrContext: StateValue | ChargedState | CircuitContext<PS> | unknown): string {
    return this.getState(stateOrContext)._symbol;
  }

  public decimals(stateOrContext: StateValue | ChargedState | CircuitContext<PS> | unknown): bigint {
    return this.getState(stateOrContext)._decimals;
  }

  public maxSupply(stateOrContext: StateValue | ChargedState | CircuitContext<PS> | unknown): bigint {
    return this.getState(stateOrContext)._maxSupply;
  }

  public totalSupply(stateOrContext: StateValue | ChargedState | CircuitContext<PS> | unknown): bigint {
    return this.getState(stateOrContext)._totalSupply;
  }

  public paused(stateOrContext: StateValue | ChargedState | CircuitContext<PS> | unknown): boolean {
    return this.getState(stateOrContext)._paused;
  }

  public isPaused(stateOrContext: StateValue | ChargedState | CircuitContext<PS> | unknown): boolean {
    return this.getState(stateOrContext)._paused;
  }

  public balanceOf(
    stateOrContext: StateValue | ChargedState | CircuitContext<PS> | unknown,
    account: Uint8Array | string,
  ): bigint {
    const accountBytes = FungibleTokenV22Client.toBytes32(account);
    const l = this.getState(stateOrContext);
    return l._balances.member(accountBytes) ? l._balances.lookup(accountBytes) : 0n;
  }

  public allowance(
    stateOrContext: StateValue | ChargedState | CircuitContext<PS> | unknown,
    ownerAccount: Uint8Array | string,
    spenderAccount: Uint8Array | string,
  ): bigint {
    const ownerBytes = FungibleTokenV22Client.toBytes32(ownerAccount);
    const spenderBytes = FungibleTokenV22Client.toBytes32(spenderAccount);
    const l = this.getState(stateOrContext);
    const key: [Uint8Array, Uint8Array] = [ownerBytes, spenderBytes];
    return l._allowances.member(key) ? l._allowances.lookup(key) : 0n;
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
    tokenContractAddress: string | Uint8Array | { bytes: Uint8Array },
    amount: bigint | number,
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV22Client.toBytes32(caller);
    let tokenParam: { bytes: Uint8Array };
    if (typeof tokenContractAddress === 'object' && tokenContractAddress !== null && 'bytes' in tokenContractAddress) {
      tokenParam = tokenContractAddress as { bytes: Uint8Array };
    } else {
      tokenParam = { bytes: FungibleTokenV22Client.toBytes32(tokenContractAddress as string | Uint8Array) };
    }
    return this.contract.circuits.emergencyWithdraw(
      context,
      callerBytes,
      tokenParam,
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