/**
 * Quickstart Example: FungibleTokenV24 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-4-example.ts
 */

import {
  CompactRuntime,
  type ConstructorContext,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV24Client,
  type FungibleTokenV24PrivateState,
} from '../src/client/fungible-token-v2-4-sdk.js';

async function main() {
  console.log('--- Initializing FungibleTokenV24 Contract ---');

  // 1. Mock context identifiers (32-byte hex strings in Midnight.js runtime)
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);

  // 2. Secret keys and salt
  const ownerSk = new Uint8Array(32).fill(0xaa);
  const aliceSk = new Uint8Array(32).fill(0xbb);
  const contractSalt = new Uint8Array(32).fill(0x11);

  // 3. Derive on-chain identities using persistentHash
  const ownerAccount = FungibleTokenV24Client.deriveAccount(ownerSk, contractSalt);
  const aliceAccount = FungibleTokenV24Client.deriveAccount(aliceSk, contractSalt);

  console.log('Owner Account Commitment:', Buffer.from(ownerAccount).toString('hex'));
  console.log('Alice Account Commitment:', Buffer.from(aliceAccount).toString('hex'));

  // 4. Initial multi-sig signer commitments (mock)
  const mockSigners = [
    new Uint8Array(32).fill(0x01),
    new Uint8Array(32).fill(0x02),
    new Uint8Array(32).fill(0x03),
  ];

  // 5. Build constructor context and initialize state
  let privateState: FungibleTokenV24PrivateState = { secretKey: ownerSk };
  const constructorCtx = CompactRuntime.createConstructorContext(privateState, coinPublicKey);

  const client = new FungibleTokenV24Client({
    secretKey: ownerSk,
    defaultContractSalt: contractSalt,
    contractAddress,
    coinPublicKey,
  });

  const initResult = client.initialState(
    constructorCtx,
    contractSalt,
    ownerAccount,
    'Privacy Midnight Token',
    'PMT',
    8n,
    1_000_000_00000000n, // Max supply
    mockSigners,
    2n // Threshold = 2
  );

  let currentChargedState = initResult.currentContractState.data;
  privateState = initResult.currentPrivateState;

  // 6. Inspect initialized ledger state
  let ledgerState = client.queryLedgerState(currentChargedState);
  console.log('Token Name:', ledgerState._name);
  console.log('Token Symbol:', ledgerState._symbol);
  console.log('Total Supply:', ledgerState._totalSupply);
  console.log('Threshold:', client.getMultisigThreshold(ledgerState));

  // 7. Demonstrate Pause Circuit Execution
  console.log('\n--- Executing Pause Circuit ---');
  let circuitCtx: CircuitContext<FungibleTokenV24PrivateState> =
    CompactRuntime.createCircuitContext(
      contractAddress,
      coinPublicKey,
      currentChargedState,
      privateState
    );

  const pauseResult = client.pause(circuitCtx, ownerAccount);
  currentChargedState = pauseResult.context.currentQueryContext.state;
  privateState = pauseResult.context.currentPrivateState;

  ledgerState = client.queryLedgerState(currentChargedState);
  console.log('Is Paused after pause():', ledgerState._paused);

  // 8. Demonstrate Unpause Circuit Execution
  console.log('\n--- Executing Unpause Circuit ---');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );

  const unpauseResult = client.unpause(circuitCtx, ownerAccount);
  currentChargedState = unpauseResult.context.currentQueryContext.state;
  privateState = unpauseResult.context.currentPrivateState;

  ledgerState = client.queryLedgerState(currentChargedState);
  console.log('Is Paused after unpause():', ledgerState._paused);
  console.log('\nContract executed successfully!');
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});