import { type Witnesses } from '../../contracts/managed/fungible-token-v2-2/contract/index.js';

export interface PrivateState {
  secretKey: Uint8Array; // 32-byte secret key
}

export const witnesses: Witnesses<PrivateState> = {
  localSecretKey: ({ privateState }: { privateState: PrivateState }) => {
    // Return [nextPrivateState, witnessValue]
    return [privateState, privateState.secretKey];
  },
};