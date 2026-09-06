/**
 * Confidential Sealed-Bid Real Estate Auctions Client SDK
 *
 * Provides strongly-typed zero-knowledge circuit bindings, ledger decoding,
 * and witness providers for confidential-sealed-bid-realestate-auctions.compact.
 *
 * @packageDocumentation
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
} from '../../contracts/managed/confidential-sealed-bid-realestate-auctions/contract/index.js';

/**
 * Enumeration representing the phases of the auction.
 */
export enum AuctionState {
  Bidding = 0,
  Revealing = 1,
  Finalized = 2,
}

/**
 * Representation of a private bid commitment structure.
 */
export interface BidCommitment {
  /** 32-byte public key of the bidder */
  bidderPk: Uint8Array;
  /** Unsigned 64-bit integer bid value */
  bidAmount: bigint;
  /** 32-byte cryptographic random salt */
  salt: Uint8Array;
}

/**
 * Private off-chain state retained locally by the bidder.
 */
export interface ConfidentialSealedBidRealestateAuctionsPrivateState {
  /** Optional stored active bid details */
  readonly bidCommitment?: BidCommitment;
  /** Optional extensible arbitrary private storage */
  readonly [key: string]: unknown;
}

/**
 * Ledger state projection for the auction contract.
 */
export type ConfidentialSealedBidRealestateAuctionsLedgerState = ContractLedger;

/**
 * Strongly-typed witness providers required by the auction circuit runtime.
 */
export interface ConfidentialSealedBidRealestateAuctionsWitnesses<
  PS extends ConfidentialSealedBidRealestateAuctionsPrivateState = ConfidentialSealedBidRealestateAuctionsPrivateState,
> {
  /**
   * Retrieves the bidder's private bid parameters to construct the ZK reveal proof.
   *
   * @param context - The execution witness context including local private state.
   * @returns A 2-element tuple of `[nextPrivateState, BidCommitment]`.
   */
  getBidDetails: (
    context: WitnessContext<ContractLedger, PS>
  ) => [PS, BidCommitment] | Promise<[PS, BidCommitment]>;
}

/**
 * Production-grade Client SDK for the Confidential Sealed-Bid Real Estate Auction smart contract.
 */
export class ConfidentialSealedBidRealestateAuctionsClient<
  PS extends ConfidentialSealedBidRealestateAuctionsPrivateState = ConfidentialSealedBidRealestateAuctionsPrivateState,
> {
  /** Underlying managed contract instance */
  private readonly contract: ManagedContract<PS>;

  /**
   * Constructs a new auction client instance.
   *
   * @param witnesses - Implementation of off-chain witness functions.
   */
  constructor(witnesses: ConfidentialSealedBidRealestateAuctionsWitnesses<PS>) {
    // Map SDK witness interface to runtime expected witnesses
    const contractWitnesses: ContractWitnesses<PS> = {
      getBidDetails: (context: any) => {
        return witnesses.getBidDetails(context) as any;
      },
    };

    this.contract = new ManagedContract<PS>(contractWitnesses);
  }

  /**
   * Initializes the contract state via the constructor context.
   *
   * @param context - The constructor context containing initial private state and deployment keys.
   * @returns Constructor execution result with initial contract and private states.
   */
  public initialState(
    context: ConstructorContext<PS>,
    sellerPk: Uint8Array = new Uint8Array(32),
    propertyIdentifier: Uint8Array = new Uint8Array(32),
    reservePrice: bigint = 0n
  ): ConstructorResult<PS> {
    return this.contract.initialState(context, sellerPk, propertyIdentifier, reservePrice);
  }

  /**
   * Submits a sealed-bid commitment to the auction ledger during the Bidding phase.
   *
   * @param context - Circuit execution context.
   * @param bidderId - 32-byte identifier/public key of the bidder.
   * @param commitment - 32-byte persistent hash of the BidCommitment.
   * @returns Circuit execution result with unit return value `[]`.
   */
  public submitBid(
    context: CircuitContext<PS>,
    bidderId: Uint8Array,
    commitment: Uint8Array
  ): CircuitResults<PS, []> {
    return this.contract.circuits.submitBid(context, bidderId, commitment);
  }

  /**
   * Closes the bidding phase and transitions the auction to the Revealing phase.
   *
   * @param context - Circuit execution context.
   * @returns Circuit execution result with unit return value `[]`.
   */
  public closeBidding(context: CircuitContext<PS>): CircuitResults<PS, []> {
    return this.contract.circuits.closeBidding(context);
  }

  /**
   * Proves the validity of a submitted commitment in zero-knowledge and reveals the bid.
   * If the revealed bid exceeds the current highest bid, the winning bidder is updated.
   *
   * @param context - Circuit execution context.
   * @param bidderId - 32-byte identifier/public key of the bidder.
   * @returns Circuit execution result with unit return value `[]`.
   */
  public revealBid(
    context: CircuitContext<PS>,
    bidderId: Uint8Array
  ): CircuitResults<PS, []> {
    return this.contract.circuits.revealBid(context, bidderId);
  }

  /**
   * Finalizes the auction once all bids have been revealed, locking in the winner.
   *
   * @param context - Circuit execution context.
   * @returns Circuit execution result with unit return value `[]`.
   */
  public finalizeAuction(context: CircuitContext<PS>): CircuitResults<PS, []> {
    return this.contract.circuits.finalizeAuction(context);
  }

  /**
   * Decodes and parses raw contract state into typed public ledger state.
   *
   * @param rawState - Raw ledger state or charged state representation.
   * @returns Typed `ConfidentialSealedBidRealestateAuctionsLedgerState`.
   */
  public queryLedgerStateFromRaw(
    rawState: StateValue | ChargedState | unknown
  ): ConfidentialSealedBidRealestateAuctionsLedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }
}