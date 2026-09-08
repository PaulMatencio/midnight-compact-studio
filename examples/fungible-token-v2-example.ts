/**
 * Quickstart Example: FungibleTokenV2 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-example.ts
 */

import { CompactRuntime } from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV2Client,
  type FungibleTokenV2PrivateState,
  hexToUint8Array,
  uint8ArrayToHex,
} from '../src/client/fungible-token-v2-sdk.js';

async function main() {
  console.log('=== FungibleTokenV2 SDK Walkthrough ===\n');

  // 1. Setup mock keys (32-byte hex strings for Midnight.js runtime contexts)
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);

  // Setup account byte representations (Uint8Array for contract circuits)
  const ownerBytes = hexToUint8Array('aa'.repeat(32));
  const aliceBytes = hexToUint8Array('bb'.repeat(32));
  const bobBytes = hexToUint8Array('cc'.repeat(32));

  // 2. Initialize private state & instantiate SDK client
  let privateState: FungibleTokenV2PrivateState = {
    userSecretKey: hexToUint8Array('11'.repeat(32)),
  };

  const client = new FungibleTokenV2Client<FungibleTokenV2PrivateState>();

  // 3. Initialize Contract via Constructor Context
  console.log('1. Deploying / Initializing contract state...');
  const constructorCtx = CompactRuntime.createConstructorContext(privateState, coinPublicKey);
  const initResult = client.initialState(constructorCtx, ownerBytes);

  privateState = initResult.currentPrivateState;
  let currentChargedState = initResult.currentContractState.data;

  // Inspect initial ledger
  let ledgerState = client.queryLedgerStateFromRaw(currentChargedState);
  console.log(`   Owner: 0x${uint8ArrayToHex(ledgerState.owner)}`);
  console.log(`   Initialized: ${ledgerState._isInitialized}`);

  // 4. Initialize token metadata (owner only)
  console.log('\n2. Initializing token metadata (Midnight DUST, Symbol: DUST, Decimals: 6)...');
  let circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );
  
  let result = client.initialize(circuitCtx, ownerBytes, 'Midnight DUST', 'DUST', 6n);
  privateState = result.context.currentPrivateState;
  currentChargedState = result.context.currentQueryContext.state;

  ledgerState = client.queryLedgerStateFromRaw(currentChargedState);
  console.log(`   Token Name:     ${ledgerState._name}`);
  console.log(`   Token Symbol:   ${ledgerState._symbol}`);
  console.log(`   Token Decimals: ${ledgerState._decimals}`);

  // 5. Mint tokens to Alice
  console.log('\n3. Minting 1,000,000 DUST tokens to Alice...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );

  const mintAmount = 1_000_000n;
  const mintResult = client.mint(circuitCtx, ownerBytes, aliceBytes, mintAmount);
  privateState = mintResult.context.currentPrivateState;
  currentChargedState = mintResult.context.currentQueryContext.state;

  // 6. Query Alice's Balance
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );
  const aliceBalanceResult = client.balanceOf(circuitCtx, aliceBytes);
  console.log(`   Alice Balance: ${aliceBalanceResult.result} DUST`);

  // 7. Alice transfers 250,000 DUST to Bob
  console.log('\n4. Alice transfers 250,000 DUST to Bob...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );

  const transferAmount = 250_000n;
  const transferResult = client.transfer(circuitCtx, aliceBytes, bobBytes, transferAmount);
  privateState = transferResult.context.currentPrivateState;
  currentChargedState = transferResult.context.currentQueryContext.state;

  // 8. Bob approves Alice to spend 50,000 DUST
  console.log('\n5. Bob approves Alice for 50,000 DUST allowance...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );
  const allowanceAmount = 50_000n;
  const approveResult = client.approve(circuitCtx, bobBytes, aliceBytes, allowanceAmount);
  privateState = approveResult.context.currentPrivateState;
  currentChargedState = approveResult.context.currentQueryContext.state;

  // 9. Alice transfers 20,000 DUST from Bob to Alice via transferFrom
  console.log('\n6. Alice executes transferFrom(Bob -> Alice, 20,000)...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );
  const transferFromResult = client.transferFrom(circuitCtx, aliceBytes, bobBytes, aliceBytes, 20_000n);
  privateState = transferFromResult.context.currentPrivateState;
  currentChargedState = transferFromResult.context.currentQueryContext.state;

  // 10. Query final ledger state
  ledgerState = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('\n=== Final Token State ===');
  console.log(`Total Supply: ${ledgerState._totalSupply}`);
  console.log(`Alice Balance: ${ledgerState._balances.lookup(aliceBytes)}`);
  console.log(`Bob Balance:   ${ledgerState._balances.lookup(bobBytes)}`);
  console.log(`Bob -> Alice Remaining Allowance: ${ledgerState._allowances.lookup(bobBytes).lookup(aliceBytes)}`);
  console.log('\nWalkthrough completed successfully!');
}

main().catch((err) => {
  console.error('Walkthrough failed:', err);
  process.exit(1);
});