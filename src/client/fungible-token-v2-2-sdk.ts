/**
 * FungibleTokenV22 TypeScript SDK
 * Production client SDK for interacting with the fungible-token-v2-2 Midnight Compact smart contract.
 */

import {
  Contract,
  ledger,
  type Witnesses,
  type Ledger,
} from '../../contracts/managed/fungible-token-v2-2/contract/index.js';
import type {
  CircuitContext,
  WitnessContext,
  StateValue,
  ChargedState,
} from '@midnight-ntwrk/compact-runtime';

export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: bigint;
  maxSupply: bigint;
  totalSupply: bigint;
  owner: Uint8Array;
  paused: boolean;
  emergencyPauser: Uint8Array;
}

export interface ContractAddressParam {
  bytes: Uint8Array;
}

export interface FungibleTokenConfig {
  initialOwner: Uint8Array;
  name: string;
  symbol: string;
  decimals: bigint;
  maxSupply: bigint;
}

export interface ContractProvider<PS = any> {
  getState(): Promise<StateValue | ChargedState>;
  executeCircuit<R>(
    circuitName: string,
    executor: (context: CircuitContext<PS>) => { context: CircuitContext<PS>; result: R }
  ): Promise<R>;
}

export class FungibleTokenSDK<PS = any> {
  private readonly contract: Contract<PS, Witnesses<PS>>;
  private secretKey: Uint8Array;

  /**
   * Initializes the SDK with a caller secret key.
   * @param secretKey 32-byte private key used to satisfy the `localSecretKey` witness.
   */
  constructor(secretKey: Uint8Array) {
    if (secretKey.length !== 32) {
      throw new Error('Secret key must be exactly 32 bytes.');
    }
    this.secretKey = secretKey;

    const witnesses: Witnesses<PS> = {
      localSecretKey: (context: WitnessContext<Ledger, PS>): [PS, Uint8Array] => {
        return [context.privateState, this.secretKey];
      },
    };

    this.contract = new Contract<PS, Witnesses<PS>>(witnesses);
  }

  /**
   * Updates the prover's secret key.
   */
  public setSecretKey(secretKey: Uint8Array): void {
    if (secretKey.length !== 32) {
      throw new Error('Secret key must be exactly 32 bytes.');
    }
    this.secretKey = secretKey;
  }

  /**
   * Returns the underlying contract compiled instance.
   */
  public getContract(): Contract<PS, Witnesses<PS>> {
    return this.contract;
  }

  // ==========================================
  // LEDGER / STATE READERS
  // ==========================================

  /**
   * Parses the complete ledger state from the on-chain state value.
   */
  public parseLedger(state: StateValue | ChargedState): Ledger {
    return ledger(state);
  }

  /**
   * Reads token high-level metadata from the contract state.
   */
  public getMetadata(state: StateValue | ChargedState): TokenMetadata {
    const l = this.parseLedger(state);
    return {
      name: l._name,
      symbol: l._symbol,
      decimals: l._decimals,
      maxSupply: l._maxSupply,
      totalSupply: l._totalSupply,
      owner: l.owner,
      paused: l._paused,
      emergencyPauser: l._emergencyPauser,
    };
  }

  /**
   * Queries balance of an account directly from the ledger state.
   */
  public getBalanceFromState(state: StateValue | ChargedState, account: Uint8Array): bigint {
    const l = this.parseLedger(state);
    if (!l._balances.member(account)) {
      return 0n;
    }
    return l._balances.lookup(account);
  }

  /**
   * Queries allowance for a owner/spender pair directly from the ledger state.
   */
  public getAllowanceFromState(
    state: StateValue | ChargedState,
    ownerAccount: Uint8Array,
    spender: Uint8Array
  ): bigint {
    const l = this.parseLedger(state);
    const key: [Uint8Array, Uint8Array] = [ownerAccount, spender];
    if (!l._allowances.member(key)) {
      return 0n;
    }
    return l._allowances.lookup(key);
  }

  /**
   * Queries pause status directly from the ledger state.
   */
  public isPausedFromState(state: StateValue | ChargedState): boolean {
    return this.parseLedger(state)._paused;
  }

  // ==========================================
  // CIRCUIT EXECUTION METHODS
  // ==========================================

  /**
   * Circuit Call: name()
   */
  public async name(provider: ContractProvider<PS>): Promise<string> {
    return provider.executeCircuit('name', (ctx) => this.contract.circuits.name(ctx));
  }

  /**
   * Circuit Call: symbol()
   */
  public async symbol(provider: ContractProvider<PS>): Promise<string> {
    return provider.executeCircuit('symbol', (ctx) => this.contract.circuits.symbol(ctx));
  }

  /**
   * Circuit Call: decimals()
   */
  public async decimals(provider: ContractProvider<PS>): Promise<bigint> {
    return provider.executeCircuit('decimals', (ctx) => this.contract.circuits.decimals(ctx));
  }

  /**
   * Circuit Call: maxSupply()
   */
  public async maxSupply(provider: ContractProvider<PS>): Promise<bigint> {
    return provider.executeCircuit('maxSupply', (ctx) => this.contract.circuits.maxSupply(ctx));
  }

  /**
   * Circuit Call: totalSupply()
   */
  public async totalSupply(provider: ContractProvider<PS>): Promise<bigint> {
    return provider.executeCircuit('totalSupply', (ctx) => this.contract.circuits.totalSupply(ctx));
  }

  /**
   * Circuit Call: balanceOf(account)
   */
  public async balanceOf(provider: ContractProvider<PS>, account: Uint8Array): Promise<bigint> {
    this.assertBytes32(account, 'account');
    return provider.executeCircuit('balanceOf', (ctx) =>
      this.contract.circuits.balanceOf(ctx, account)
    );
  }

  /**
   * Circuit Call: allowance(ownerAccount, spender)
   */
  public async allowance(
    provider: ContractProvider<PS>,
    ownerAccount: Uint8Array,
    spender: Uint8Array
  ): Promise<bigint> {
    this.assertBytes32(ownerAccount, 'ownerAccount');
    this.assertBytes32(spender, 'spender');
    return provider.executeCircuit('allowance', (ctx) =>
      this.contract.circuits.allowance(ctx, ownerAccount, spender)
    );
  }

  /**
   * Circuit Call: paused()
   */
  public async paused(provider: ContractProvider<PS>): Promise<boolean> {
    return provider.executeCircuit('paused', (ctx) => this.contract.circuits.paused(ctx));
  }

  /**
   * Circuit Call: pause(caller)
   */
  public async pause(provider: ContractProvider<PS>, caller: Uint8Array): Promise<boolean> {
    this.assertBytes32(caller, 'caller');
    return provider.executeCircuit('pause', (ctx) => this.contract.circuits.pause(ctx, caller));
  }

  /**
   * Circuit Call: unpause(caller)
   */
  public async unpause(provider: ContractProvider<PS>, caller: Uint8Array): Promise<boolean> {
    this.assertBytes32(caller, 'caller');
    return provider.executeCircuit('unpause', (ctx) => this.contract.circuits.unpause(ctx, caller));
  }

  /**
   * Circuit Call: setEmergencyPauser(caller, newPauser)
   */
  public async setEmergencyPauser(
    provider: ContractProvider<PS>,
    caller: Uint8Array,
    newPauser: Uint8Array
  ): Promise<boolean> {
    this.assertBytes32(caller, 'caller');
    this.assertBytes32(newPauser, 'newPauser');
    return provider.executeCircuit('setEmergencyPauser', (ctx) =>
      this.contract.circuits.setEmergencyPauser(ctx, caller, newPauser)
    );
  }

  /**
   * Circuit Call: transfer(caller, to, value)
   */
  public async transfer(
    provider: ContractProvider<PS>,
    caller: Uint8Array,
    to: Uint8Array,
    value: bigint
  ): Promise<boolean> {
    this.assertBytes32(caller, 'caller');
    this.assertBytes32(to, 'to');
    this.assertPositiveValue(value);
    return provider.executeCircuit('transfer', (ctx) =>
      this.contract.circuits.transfer(ctx, caller, to, value)
    );
  }

  /**
   * Circuit Call: approve(caller, spender, value)
   */
  public async approve(
    provider: ContractProvider<PS>,
    caller: Uint8Array,
    spender: Uint8Array,
    value: bigint
  ): Promise<boolean> {
    this.assertBytes32(caller, 'caller');
    this.assertBytes32(spender, 'spender');
    this.assertPositiveValue(value);
    return provider.executeCircuit('approve', (ctx) =>
      this.contract.circuits.approve(ctx, caller, spender, value)
    );
  }

  /**
   * Circuit Call: transferFrom(caller, fromAccount, to, value)
   */
  public async transferFrom(
    provider: ContractProvider<PS>,
    caller: Uint8Array,
    fromAccount: Uint8Array,
    to: Uint8Array,
    value: bigint
  ): Promise<boolean> {
    this.assertBytes32(caller, 'caller');
    this.assertBytes32(fromAccount, 'fromAccount');
    this.assertBytes32(to, 'to');
    this.assertPositiveValue(value);
    return provider.executeCircuit('transferFrom', (ctx) =>
      this.contract.circuits.transferFrom(ctx, caller, fromAccount, to, value)
    );
  }

  /**
   * Circuit Call: mint(to, value)
   */
  public async mint(
    provider: ContractProvider<PS>,
    to: Uint8Array,
    value: bigint
  ): Promise<boolean> {
    this.assertBytes32(to, 'to');
    this.assertPositiveValue(value);
    return provider.executeCircuit('mint', (ctx) =>
      this.contract.circuits.mint(ctx, to, value)
    );
  }

  /**
   * Circuit Call: burn(caller, value)
   */
  public async burn(
    provider: ContractProvider<PS>,
    caller: Uint8Array,
    value: bigint
  ): Promise<boolean> {
    this.assertBytes32(caller, 'caller');
    this.assertPositiveValue(value);
    return provider.executeCircuit('burn', (ctx) =>
      this.contract.circuits.burn(ctx, caller, value)
    );
  }

  /**
   * Circuit Call: emergencyWithdraw(caller, token, amount)
   */
  public async emergencyWithdraw(
    provider: ContractProvider<PS>,
    caller: Uint8Array,
    tokenAddress: Uint8Array,
    amount: bigint
  ): Promise<boolean> {
    this.assertBytes32(caller, 'caller');
    this.assertPositiveValue(amount);
    const tokenParam: ContractAddressParam = { bytes: tokenAddress };
    return provider.executeCircuit('emergencyWithdraw', (ctx) =>
      this.contract.circuits.emergencyWithdraw(ctx, caller, tokenParam, amount)
    );
  }

  // ==========================================
  // UTILITIES & VALIDATORS
  // ==========================================

  private assertBytes32(bytes: Uint8Array, paramName: string): void {
    if (!bytes || bytes.length !== 32) {
      throw new Error(`Invalid parameter ${paramName}: Expected 32 bytes Uint8Array.`);
    }
  }

  private assertPositiveValue(val: bigint): void {
    if (val < 0n) {
      throw new Error(`Amount/value cannot be negative: received ${val}`);
    }
  }

  /**
   * Utility to convert hex string (with or without 0x) to Uint8Array.
   */
  public static hexToBytes(hex: string): Uint8Array {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (cleanHex.length % 2 !== 0) {
      throw new Error('Invalid hex string length');
    }
    const arr = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
      arr[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
    }
    return arr;
  }

  /**
   * Utility to convert Uint8Array to hex string.
   */
  public static bytesToHex(bytes: Uint8Array): string {
    return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Creates a padded 32-byte array from an ASCII string.
   */
  public static stringToPaddedBytes32(str: string): Uint8Array {
    const out = new Uint8Array(32);
    const enc = new TextEncoder().encode(str);
    out.set(enc.slice(0, 32));
    return out;
  }
}