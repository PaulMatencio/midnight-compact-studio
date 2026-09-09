import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Ledger } from "../../contracts/managed/fungible-token-v2-2/contract/index.js";

/**
 * Off-chain private state holding the user's secret key.
 */
export interface FungibleTokenPrivateState {
  readonly secretKey: Uint8Array; // 32-byte secret key
}

/**
 * Helper to initialize the private state.
 */
export const createFungibleTokenPrivateState = (
  secretKey: Uint8Array
): FungibleTokenPrivateState => ({
  secretKey,
});

/**
 * Type definition for the witness implementations.
 */
export interface FungibleTokenWitnesses {
  localSecretKey: (
    context: WitnessContext<Ledger, FungibleTokenPrivateState>
  ) => [FungibleTokenPrivateState, Uint8Array];
}

/**
 * Default witness implementation providing the off-chain secret key.
 */
export const witnesses: FungibleTokenWitnesses = {
  localSecretKey: ({
    privateState,
  }: WitnessContext<Ledger, FungibleTokenPrivateState>): [
    FungibleTokenPrivateState,
    Uint8Array,
  ] => {
    if (privateState.secretKey.length !== 32) {
      throw new Error("Secret key must be exactly 32 bytes");
    }
    return [privateState, privateState.secretKey];
  },
};