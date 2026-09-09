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
  createDefaultWitnesses,
} from '../src/client/fungible-token-v2-2-sdk.js';

async function main() {
  console.log('=== FungibleTokenV22 Client SDK Walkthrough ===\n');

  // 1. Setup mock keys and 32-byte addresses
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);

  const ownerSecretKey = new Uint8Array(32).fill(0xaa);
  const userSecretKey = new Uint8Array(32).fill(0xbb);

  // In production, derive public identity using persistentHash([pad(32, "fungible-token:auth"), contractAddress, sk])
  // For simulation, we assign deterministic 32-byte account representations:
  const ownerAddress = new Uint8Array(32).fill(0x11);
  const userAddress = new Uint8Array(32).fill(0x22);

  // 2. Initialize private state and SDK Client
  let ownerPrivateState: FungibleTokenV22PrivateState = {
    localSecretKey: ownerSecretKey,
  };

  let userPrivateState: FungibleTokenV22PrivateState = {
    localSecretKey: userSecretKey,
  };

  const client = new FungibleTokenV22Client(createDefaultWitnesses());

  // 3. Initialize Contract (Constructor)
  console.log('1. Deploying contract...');
  const constructorCtx: ConstructorContext<FungibleTokenV22PrivateState> =
    CompactRuntime.createConstructorContext(ownerPrivateState, coinPublicKey);

  const initResult = client.initialState(
    constructorCtx,
    ownerAddress,
    'Midnight Shield Token',
    'MST',
    18n,
    1_000_000_000n * 10n ** 18n // 1 Billion cap
  );

  let currentChargedState = initResult.currentContractState.data;
  ownerPrivateState = initResult.currentPrivateState;

  let ledgerState = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('   Token Name    :', ledgerState._name);
  console.log('   Token Symbol  :', ledgerState._symbol);
  console.log('   Total Supply  :', ledgerState._totalSupply.toString());

  // 4. Mint Tokens as Owner
  console.log('\n2. Minting 1,000 MST to User...');
  let circuitCtx: CircuitContext<FungibleTokenV22PrivateState> =
    CompactRuntime.createCircuitContext(
      contractAddress,
      coinPublicKey,
      currentChargedState,
      ownerPrivateState
    );

  const mintAmount = 1000n * 10n ** 18n;
  const mintResult = client.mint(circuitCtx, userAddress, mintAmount);

  currentChargedState = mintResult.context.currentQueryContext.state;
  ownerPrivateState = mintResult.context.currentPrivateState;

  ledgerState = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('   Total Supply After Mint:', ledgerState._totalSupply.toString());

  // 5. Transfer Tokens (User -> Owner)
  console.log('\n3. User transferring 250 MST back to Owner...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    userPrivateState
  );

  const transferAmount = 250n * 10n ** 18n;
  const transferResult = client.transfer(circuitCtx, userAddress, ownerAddress, transferAmount);

  currentChargedState = transferResult.context.currentQueryContext.state;
  userPrivateState = transferResult.context.currentPrivateState;

  // 6. Inspect Balances
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    userPrivateState
  );

  const userBalResult = client.balanceOf(circuitCtx, userAddress);
  const ownerBalResult = client.balanceOf(userBalResult.context, ownerAddress);

  console.log('   User Balance :', userBalResult.result.toString());
  console.log('   Owner Balance:', ownerBalResult.result.toString());
  console.log('\n=== Walkthrough completed successfully ===');
}

main().catch(console.error);