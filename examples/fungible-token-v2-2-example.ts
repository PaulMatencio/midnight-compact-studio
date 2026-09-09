/**
 * Quickstart Example: FungibleTokenV22 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-2-example.ts
 */

import {
  CompactRuntime,
  type ConstructorContext,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV22Client,
  type FungibleTokenV22PrivateState,
  type FungibleTokenV22Witnesses,
} from '../src/client/fungible-token-v2-2-sdk.js';

// Setup Mock Addresses and Keys (32-byte hex strings)
const coinPublicKey = '01'.repeat(32);
const contractAddress = '00'.repeat(32);

// Mock private state holding caller secret keys
const ownerSecretKey = new Uint8Array(32).fill(0xaa);
const aliceSecretKey = new Uint8Array(32).fill(0xbb);

let privateState: FungibleTokenV22PrivateState = {
  secretKey: ownerSecretKey,
};

// Implement witnesses
const witnesses: FungibleTokenV22Witnesses<FungibleTokenV22PrivateState> = {
  localSecretKey: ({ privateState }) => [privateState, privateState.secretKey],
};

async function main() {
  console.log('--- Initializing FungibleTokenV22 Contract ---');
  const client = new FungibleTokenV22Client(witnesses);

  // 1. Initialize Contract State
  const initialOwnerAddress = new Uint8Array(32).fill(0x11);
  const constructorCtx: ConstructorContext<FungibleTokenV22PrivateState> =
    CompactRuntime.createConstructorContext(privateState, coinPublicKey);

  const initResult = client.initialState(
    constructorCtx,
    initialOwnerAddress,
    'Midnight USD',
    'MUSD',
    18n
  );

  privateState = initResult.currentPrivateState;
  let currentChargedState = initResult.currentContractState.data;

  console.log('Contract successfully initialized.');
  let ledgerState = client.queryLedgerStateFromRaw(currentChargedState);
  console.log(`Token Name: ${ledgerState._name}`);
  console.log(`Token Symbol: ${ledgerState._symbol}`);
  console.log(`Decimals: ${ledgerState._decimals}`);
  console.log(`Initial Total Supply: ${ledgerState._totalSupply}`);

  // 2. Query Metadata Circuit
  let circuitCtx: CircuitContext<FungibleTokenV22PrivateState> =
    CompactRuntime.createCircuitContext(
      contractAddress,
      coinPublicKey,
      currentChargedState,
      privateState
    );

  const nameResult = client.name(circuitCtx);
  currentChargedState = nameResult.context.currentQueryContext.state;
  console.log(`Queried name() circuit: ${nameResult.result}`);

  // 3. Query Balance
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );
  const aliceAddress = new Uint8Array(32).fill(0x22);
  const balResult = client.balanceOf(circuitCtx, aliceAddress);
  currentChargedState = balResult.context.currentQueryContext.state;
  console.log(`Alice Balance: ${balResult.result}`);
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});