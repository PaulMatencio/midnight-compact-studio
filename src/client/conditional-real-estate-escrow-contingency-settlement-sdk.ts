/**
 * Production TypeScript Client SDK for Conditional Real Estate Escrow Contingency Settlement.
 * Compact Language Version: >= 0.23
 *
 * Provides a strongly-typed, ZK-proof orchestrator for the real estate escrow contract.
 */

import {
  type CircuitContext,
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
} from '../../contracts/managed/conditional-real-estate-escrow-contingency-settlement/contract/index.js';

/**
 * Enumeration of on-chain escrow lifecycle states matching the Compact contract.
 */
export enum EscrowStatus {
  Created = 0,
  Funded = 1,
  Settled = 2,
  Refunded = 3,
}

/**
 * Strongly typed interface for the off-chain private state container.
 */
export interface ConditionalRealEstateEscrowContingencySettlementPrivateState {
  readonly buyerSecret?: Uint8Array;
  readonly sellerSecret?: Uint8Array;
  readonly inspectorSecret?: Uint8Array;
  readonly titleAgentSecret?: Uint8Array;
}

/**
 * Public Ledger State representation derived from compiled Compact artifacts.
 */
export type ConditionalRealEstateEscrowContingencySettlementLedgerState = ContractLedger;

/**
 * Type-safe interface for off-chain witness functions adhering to Midnight SDK conventions.
 * Every witness takes a WitnessContext<ContractLedger, PS> and returns [PS, T].
 */
export type ConditionalRealEstateEscrowContingencySettlementWitnesses<
  PS extends ConditionalRealEstateEscrowContingencySettlementPrivateState = ConditionalRealEstateEscrowContingencySettlementPrivateState,
> = ContractWitnesses<PS>;

/**
 * Default witness implementation providing extraction from the local private state container.
 */
export function createDefaultWitnesses<
  PS extends ConditionalRealEstateEscrowContingencySettlementPrivateState,
>(): ConditionalRealEstateEscrowContingencySettlementWitnesses<PS> {
  return {
    getBuyerSecret(context: WitnessContext<ContractLedger, PS>): [PS, Uint8Array] {
      const secret = context.privateState.buyerSecret ?? new Uint8Array(32);
      return [context.privateState, secret];
    },
    getSellerSecret(context: WitnessContext<ContractLedger, PS>): [PS, Uint8Array] {
      const secret = context.privateState.sellerSecret ?? new Uint8Array(32);
      return [context.privateState, secret];
    },
    getInspectorSecret(context: WitnessContext<ContractLedger, PS>): [PS, Uint8Array] {
      const secret = context.privateState.inspectorSecret ?? new Uint8Array(32);
      return [context.privateState, secret];
    },
    getTitleAgentSecret(context: WitnessContext<ContractLedger, PS>): [PS, Uint8Array] {
      const secret = context.privateState.titleAgentSecret ?? new Uint8Array(32);
      return [context.privateState, secret];
    },
  };
}

/**
 * Production Client SDK for interacting with the ConditionalRealEstateEscrowContingencySettlement smart contract.
 */
export class ConditionalRealEstateEscrowContingencySettlementClient<
  PS extends ConditionalRealEstateEscrowContingencySettlementPrivateState = ConditionalRealEstateEscrowContingencySettlementPrivateState,
> {
  private readonly contract: ManagedContract<PS>;

  /**
   * Constructs an instance of the escrow SDK client.
   *
   * @param customWitnesses - Optional overrides for contract witness generation functions.
   */
  constructor(
    customWitnesses?: Partial<ConditionalRealEstateEscrowContingencySettlementWitnesses<PS>>
  ) {
    const defaultWitnesses = createDefaultWitnesses<PS>();
    const effectiveWitnesses: ConditionalRealEstateEscrowContingencySettlementWitnesses<PS> = {
      ...defaultWitnesses,
      ...customWitnesses,
    };
    this.contract = new ManagedContract<PS>(effectiveWitnesses);
  }

  /**
   * Initializes the contract state via the constructor context.
   *
   * @param context - The Midnight constructor execution context.
   * @returns ConstructorResult containing initial contract and private states.
   */
  public initialState(
    context: ConstructorContext<PS>,
    buyerPk: Uint8Array = new Uint8Array(32),
    sellerPk: Uint8Array = new Uint8Array(32),
    inspectorPk: Uint8Array = new Uint8Array(32),
    titleAgentPk: Uint8Array = new Uint8Array(32),
    propertyHash: Uint8Array = new Uint8Array(32),
    purchasePrice: bigint = 0n,
    escrowDeposit: bigint = 0n
  ): ConstructorResult<PS> {
    return this.contract.initialState(
      context,
      buyerPk,
      sellerPk,
      inspectorPk,
      titleAgentPk,
      propertyHash,
      purchasePrice,
      escrowDeposit
    );
  }

  /**
   * Executes the `depositEarnestMoney` circuit.
   *
   * @param context - Circuit execution context with current state and private state.
   * @param amount - Earnest deposit amount to commit.
   * @returns Circuit execution result containing the updated context and unit return `[]`.
   */
  public depositEarnestMoney(
    context: CircuitContext<PS>,
    amount: bigint
  ): CircuitResults<PS, []> {
    return this.contract.circuits.depositEarnestMoney(context, amount);
  }

  /**
   * Executes the `submitInspectionReport` circuit by the authorized inspector.
   *
   * @param context - Circuit execution context.
   * @param passed - True if inspection passes, false otherwise.
   * @returns Circuit execution result containing the updated context and unit return `[]`.
   */
  public submitInspectionReport(
    context: CircuitContext<PS>,
    passed: boolean
  ): CircuitResults<PS, []> {
    return this.contract.circuits.submitInspectionReport(context, passed);
  }

  /**
   * Executes the `confirmFinancingApproval` circuit by the buyer.
   *
   * @param context - Circuit execution context.
   * @param approved - True if financing/mortgage is cleared, false otherwise.
   * @returns Circuit execution result containing the updated context and unit return `[]`.
   */
  public confirmFinancingApproval(
    context: CircuitContext<PS>,
    approved: boolean
  ): CircuitResults<PS, []> {
    return this.contract.circuits.confirmFinancingApproval(context, approved);
  }

  /**
   * Executes the `submitTitleClearance` circuit by the title agent.
   *
   * @param context - Circuit execution context.
   * @param cleared - True if title search and clearance is verified.
   * @returns Circuit execution result containing the updated context and unit return `[]`.
   */
  public submitTitleClearance(
    context: CircuitContext<PS>,
    cleared: boolean
  ): CircuitResults<PS, []> {
    return this.contract.circuits.submitTitleClearance(context, cleared);
  }

  /**
   * Executes the `settleEscrow` circuit when all conditions are met.
   *
   * @param context - Circuit execution context.
   * @returns Circuit execution result containing the updated context and unit return `[]`.
   */
  public settleEscrow(context: CircuitContext<PS>): CircuitResults<PS, []> {
    return this.contract.circuits.settleEscrow(context);
  }

  /**
   * Executes the `cancelAndRefund` circuit if contingencies fail.
   *
   * @param context - Circuit execution context.
   * @returns Circuit execution result containing the updated context and unit return `[]`.
   */
  public cancelAndRefund(context: CircuitContext<PS>): CircuitResults<PS, []> {
    return this.contract.circuits.cancelAndRefund(context);
  }

  /**
   * Decodes and parses raw contract state into the typed Compact Ledger state interface.
   *
   * @param rawState - The raw state or charged state returned from query contexts.
   * @returns Strongly-typed ledger state object.
   */
  public queryLedgerStateFromRaw(
    rawState: StateValue | ChargedState | unknown
  ): ConditionalRealEstateEscrowContingencySettlementLedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }
}