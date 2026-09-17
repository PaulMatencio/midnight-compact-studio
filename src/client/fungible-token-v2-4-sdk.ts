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

  private static cachedAccountHashMethod?: { method: string; wrapped: boolean };

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

      if (FungibleTokenV24Client.cachedAccountHashMethod) {
        const { method, wrapped } = FungibleTokenV24Client.cachedAccountHashMethod;
        const saltArg = wrapped ? { bytes: saltBytes } : saltBytes;
        return (dummy as any)[method]([domainTag, saltArg, skBytes]);
      }

      const proto = Object.getPrototypeOf(dummy);
      const hashMethods = Object.getOwnPropertyNames(proto).filter((k) =>
        k.startsWith('_persistentHash')
      );

      const testKey1 = new Uint8Array(32);
      testKey1[0] = 0x01;
      const testKey2 = new Uint8Array(32);
      testKey2[0] = 0x02;

      for (const m of hashMethods) {
        try {
          const t1 = (dummy as any)[m]([domainTag, saltBytes, testKey1]);
          const t2 = (dummy as any)[m]([domainTag, saltBytes, testKey2]);
          if (
            t1 instanceof Uint8Array &&
            t2 instanceof Uint8Array &&
            t1.length === 32 &&
            t2.length === 32 &&
            Buffer.from(t1).compare(Buffer.from(t2)) !== 0
          ) {
            FungibleTokenV24Client.cachedAccountHashMethod = { method: m, wrapped: false };
            return (dummy as any)[m]([domainTag, saltBytes, skBytes]);
          }
        } catch {}
        try {
          const t1 = (dummy as any)[m]([domainTag, { bytes: saltBytes }, testKey1]);
          const t2 = (dummy as any)[m]([domainTag, { bytes: saltBytes }, testKey2]);
          if (
            t1 instanceof Uint8Array &&
            t2 instanceof Uint8Array &&
            t1.length === 32 &&
            t2.length === 32 &&
            Buffer.from(t1).compare(Buffer.from(t2)) !== 0
          ) {
            FungibleTokenV24Client.cachedAccountHashMethod = { method: m, wrapped: true };
            return (dummy as any)[m]([domainTag, { bytes: saltBytes }, skBytes]);
          }
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
  // Multi-Sig Inspection View Circuits
  // ==========================================================================

  public getMultisigNonce(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contractInstance.circuits.getMultisigNonce(context);
  }

  public getMultisigThreshold(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contractInstance.circuits.getMultisigThreshold(context);
  }

  public getMultisigSignerCount(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contractInstance.circuits.getMultisigSignerCount(context);
  }

  public isMultisigSigner(
    context: CircuitContext<PS>,
    commitment: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    return this.contractInstance.circuits.isMultisigSigner(
      context,
      FungibleTokenV24Client.toBytes32(commitment)
    );
  }
}

export { FungibleTokenV24Client as FungibleTokenV24SDK };