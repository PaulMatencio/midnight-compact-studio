/**
 * Quickstart Example: FungibleTokenV2 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-example.ts
 */

import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV2Client,
  type FungibleTokenV2PrivateState,
} from '../src/client/fungible-token-v2-sdk.js';

function createMockBytes32(byteVal: number): Uint8Array {
  const arr = new Uint8Array(32);
  arr.fill(byteVal);
  return arr;
}

async function main(): Promise<void> {
  console.log('--- Initializing FungibleTokenV2 Client ---');

  // Initialize SDK Client
  const client = new FungibleTokenV2Client<FungibleTokenV2PrivateState>();

  // Setup mock addresses & keys (32-byte hex strings in Midnight.js runtime)
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);

  const ownerBytes = createMockBytes32(1);
  const aliceBytes = createMockBytes32(2);
  const bobBytes = createMockBytes32(3);

  let privateState: FungibleTokenV2PrivateState = {};

  // 1. Initialize Contract State via ConstructorContext
  console.log('\n[1] Executing Contract Constructor...');
  const constructorCtx = CompactRuntime.createConstructorContext(
    ownerBytes,
    privateState,
    coinPublicKey,
  );

  const initResult = client.initialState(constructorCtx);
  let currentChargedState = initResult.currentContractState.data;
  privateState = initResult.currentPrivateState;

  console.log('Contract constructor successfully executed.');

  // 2. Initialize Token Metadata (initialize circuit)
  console.log('\n[2] Initializing Token Metadata...');
  let circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState,
  );

  const initCircuitResult = client.initialize(
    circuitCtx,
    'Midnight Sample Token',
    'MST',
    18n,
  );
  currentChargedState = initCircuitResult.context.currentQueryContext.state;
  privateState = initCircuitResult.context.privateState;
  console.log('Token initialized: Midnight Sample Token (MST), 18 decimals');

  // 3. Mint Tokens to Alice (Caller = Owner)
  console.log('\n[3] Minting 1,000 MST to Alice...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState,
  );

  const mintResult = client.mint(circuitCtx, ownerBytes, aliceBytes, 1000n * 10n ** 18n);
  currentChargedState = mintResult.context.currentQueryContext.state;
  privateState = mintResult.context.privateState;
  console.log(`Mint successful: ${mintResult.result}`);

  // 4. Alice Approves Bob to spend 250 MST
  console.log('\n[4] Alice Approving Bob for 250 MST...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState,
  );

  const approveResult = client.approve(
    circuitCtx,
    aliceBytes,
    bobBytes,
    250n * 10n ** 18n,
  );
  currentChargedState = approveResult.context.currentQueryContext.state;
  privateState = approveResult.context.privateState;
  console.log(`Approve successful: ${approveResult.result}`);

  // 5. Bob transfers 100 MST from Alice to Owner
  console.log('\n[5] Bob Executing transferFrom(Alice -> Owner, 100 MST)...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState,
  );

  const transferFromResult = client.transferFrom(
    circuitCtx,
    bobBytes,
    aliceBytes,
    ownerBytes,
    100n * 10n ** 18n,
  );
  currentChargedState = transferFromResult.context.currentQueryContext.state;
  privateState = transferFromResult.context.privateState;
  console.log(`TransferFrom successful: ${transferFromResult.result}`);

  // 6. Query Ledger State and Verify Balances
  console.log('\n[6] Inspecting Final Ledger State...');
  const ledgerState = client.queryLedgerStateFromRaw(currentChargedState);

  console.log(`Token Name:         ${ledgerState._name}`);
  console.log(`Token Symbol:       ${ledgerState._symbol}`);
  console.log(`Decimals:           ${ledgerState._decimals.toString()}`);
  console.log(`Total Supply:       ${(ledgerState._totalSupply / 10n ** 18n).toString()} MST`);
  console.log(`Alice Balance:      ${(ledgerState._balances.lookup(aliceBytes) / 10n ** 18n).toString()} MST`);
  console.log(`Owner Balance:      ${(ledgerState._balances.lookup(ownerBytes) / 10n ** 18n).toString()} MST`);
  console.log(`Remaining Allowance (Alice -> Bob): ${(ledgerState._allowances.lookup(aliceBytes).lookup(bobBytes) / 10n ** 18n).toString()} MST`);

  console.log('\n--- Quickstart Run Completed Successfully ---');
}

main().catch((err) => {
  console.error('Error executing quickstart walkthrough:', err);
  process.exit(1);
});