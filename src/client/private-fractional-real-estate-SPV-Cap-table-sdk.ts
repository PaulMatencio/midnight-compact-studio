/**
 * Midnight Compact Client SDK
 * Contract: Private Fractional Real Estate SPV Cap Table
 * Architecture: Nullifier-Commitment UTXO Private Cap Table
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
} from '../../contracts/managed/private-fractional-real-estate-SPV-Cap-table/contract/index.js';

/**
 * Representation of a private shareholding position held off-chain by an investor.
 */
export interface PrivateShareHoldingRecord {
  ownerPk: Uint8Array;
  amount: bigint;
  salt: Uint8Array;
  commitment?: Uint8Array;
}

/**
 * Client private state structure stored securely off-chain.
 */
export interface PrivateFractionalRealEstateSPVCapTablePrivateState {
  readonly secretKey: Uint8Array;
  readonly salts: readonly Uint8Array[];
  readonly knownHoldings?: readonly PrivateShareHoldingRecord[];
}

/**
 * Result structure returned by private share transfers.
 */
export interface TransferOutputResult {
  recipientCommitment: Uint8Array;
  changeCommitment: Uint8Array;
}

/**
 * Type-safe interface for ledger state.
 */
export type PrivateFractionalRealEstateSPVCapTableLedgerState = ContractLedger;

/**
 * Off-chain witness signatures expected by the Compact runtime.
 * Each witness receives a WitnessContext and returns a tuple [NextPrivateState, ReturnValue].
 */
export interface PrivateFractionalRealEstateSPVCapTableWitnesses<
  PS extends PrivateFractionalRealEstateSPVCapTablePrivateState = PrivateFractionalRealEstateSPVCapTablePrivateState
> {
  getSenderSecretKey: (
    context: WitnessContext<ContractLedger, PS>
  ) => [PS, Uint8Array];
  getShareHoldingSalt: (
    context: WitnessContext<ContractLedger, PS>
  ) => [PS, Uint8Array];
}

/**
 * Production Client SDK for Private Fractional Real Estate SPV Cap Table smart contract.
 */
export class PrivateFractionalRealEstateSPVCapTableClient<
  PS extends PrivateFractionalRealEstateSPVCapTablePrivateState = PrivateFractionalRealEstateSPVCapTablePrivateState
> {
  private readonly contract: ManagedContract<PS>;

  /**
   * Initializes the Client SDK with required private state witness handlers.
   * @param witnesses Off-chain witness mapping.
   */
  constructor(witnesses: PrivateFractionalRealEstateSPVCapTableWitnesses<PS>) {
    const contractWitnesses: ContractWitnesses<PS> = {
      getSenderSecretKey: (context: WitnessContext<ContractLedger, PS>) => {
        return witnesses.getSenderSecretKey(context);
      },
      getShareHoldingSalt: (context: WitnessContext<ContractLedger, PS>) => {
        return witnesses.getShareHoldingSalt(context);
      },
    };

    this.contract = new ManagedContract<PS>(contractWitnesses);
  }

  /**
   * Builds the initial contract and private state context during deployment.
   * @param context Constructor context with private state and coin public key.
   * @returns Initial deployment states.
   */
  public initialState(
    context: ConstructorContext<PS>,
    initialManager: Uint8Array = new Uint8Array(32),
    initialPropertyId: Uint8Array = new Uint8Array(32),
    authorizedShares: bigint = 0n
  ): ConstructorResult<PS> {
    return this.contract.initialState(context, initialManager, initialPropertyId, authorizedShares);
  }

  /**
   * Issues private fractional shares to an investor. Only executable by SPV manager.
   * 
   * @param context Circuit execution context.
   * @param managerSk Secret key of the SPV manager for authorization.
   * @param investorPk Public key / address identifier of recipient investor.
   * @param amount Number of fractional shares to issue.
   * @param salt Random salt blinding the holding commitment.
   * @returns Circuit result with newly created commitment hash.
   */
  public issueShares(
    context: CircuitContext<PS>,
    managerSk: Uint8Array,
    investorPk: Uint8Array,
    amount: bigint,
    salt: Uint8Array
  ): CircuitResults<PS, Uint8Array> {
    return this.contract.circuits.issueShares(
      context,
      managerSk,
      investorPk,
      amount,
      salt
    );
  }

  /**
   * Privately transfers fractional shares from caller to recipient using a nullifier-commitment UTXO split.
   * 
   * @param context Circuit execution context.
   * @param senderSk Secret key of the sending investor.
   * @param currentAmount Total shares in the holding being spent.
   * @param currentSalt Salt used in the spent holding.
   * @param transferAmount Shares to transfer to the recipient.
   * @param recipientPk Public key of the recipient investor.
   * @param recipientSalt Blinding salt for recipient's commitment.
   * @param changeSalt Blinding salt for sender's change commitment.
   * @returns Circuit result containing both recipient and change commitments.
   */
  public transferShares(
    context: CircuitContext<PS>,
    senderSk: Uint8Array,
    currentAmount: bigint,
    currentSalt: Uint8Array,
    transferAmount: bigint,
    recipientPk: Uint8Array,
    recipientSalt: Uint8Array,
    changeSalt: Uint8Array
  ): CircuitResults<PS, TransferOutputResult> {
    return this.contract.circuits.transferShares(
      context,
      senderSk,
      currentAmount,
      currentSalt,
      transferAmount,
      recipientPk,
      recipientSalt,
      changeSalt
    );
  }

  /**
   * Proves in zero-knowledge that the caller owns at least `threshold` shares without revealing balance or identity.
   * 
   * @param context Circuit execution context.
   * @param ownerSk Secret key of the share owner.
   * @param amount Exact share quantity in the holding.
   * @param salt Blinding salt of the holding.
   * @param threshold Minimum share threshold required.
   * @returns Circuit result with boolean verification indicator.
   */
  public proveShareThreshold(
    context: CircuitContext<PS>,
    ownerSk: Uint8Array,
    amount: bigint,
    salt: Uint8Array,
    threshold: bigint
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.proveShareThreshold(
      context,
      ownerSk,
      amount,
      salt,
      threshold
    );
  }

  /**
   * Decodes and formats raw on-chain state into strongly-typed ledger state.
   * @param rawState Raw charged state or state value from query context.
   * @returns Typed PrivateFractionalRealEstateSPVCapTableLedgerState object.
   */
  public queryLedgerStateFromRaw(
    rawState: StateValue | ChargedState | unknown
  ): PrivateFractionalRealEstateSPVCapTableLedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }
}