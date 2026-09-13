/**
 * Quickstart Example: FungibleTokenV23 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-3-example.ts
 */

import { CompactRuntime } from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV23Client,
  type FungibleTokenV23PrivateState
} from '../src/client/fungible-token-v2-3-sdk.js';

async function main() {
  console.log('--- Initializing FungibleToken V2.3 SDK Example ---');

  // 1. Setup Mock Identifiers (32-byte hex strings)
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);
  const contractSalt = new Uint8Array(32).fill(7);

  // 2. Setup Secret Keys
  const ownerSk = new Uint8Array(32).fill(1);
  const aliceSk = new Uint8Array(32).fill(2);

  // 3. Derive Account Commitments using Contract Salt
  const ownerAccount = FungibleTokenV23Client.deriveAccount(ownerSk, contractSalt);
  const aliceAccount = FungibleTokenV23Client.deriveAccount(aliceSk, contractSalt);

  console.log('Owner Account:', Buffer.from(ownerAccount).toString('hex'));
  console.log('Alice Account:', Buffer.from(aliceAccount).toString('hex'));

  // 4. Initialize Contract State
  const client = new FungibleTokenV23Client(ownerSk, contractSalt);
  let privateState: FungibleTokenV23PrivateState = { secretKey: ownerSk };

  const constructorCtx = CompactRuntime.createConstructorContext(privateState, coinPublicKey);
  const initResult = client.initialState(
    constructorCtx,
    contractSalt,
    ownerAccount,
    'Midnight Shield Dollar',
    'MSD',
    6,
    1_000_000_000_000n // Max supply
  );

  let currentChargedState = initResult.currentContractState.data;
  privateState = initResult.currentPrivateState;
  console.log('Contract state initialized successfully.');

  // 5. Mint Tokens to Owner
  let circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );

  console.log('Minting 500,000 tokens to Owner...');
  const mintResult = client.mint(circuitCtx, ownerAccount, 500_000n);
  currentChargedState = mintResult.context.currentQueryContext.state;
  privateState = mintResult.context.currentPrivateState;

  // 6. Query Initial Ledger State
  let state = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('Total Supply:', state._totalSupply);
  console.log('Owner Balance:', state._balances.lookup(ownerAccount));

  // 7. Transfer Tokens to Alice
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );

  console.log('Transferring 10,000 tokens from Owner to Alice...');
  const transferResult = client.transfer(circuitCtx, ownerAccount, aliceAccount, 10_000n);
  currentChargedState = transferResult.context.currentQueryContext.state;

  // 8. Verify Balances
  state = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('Owner Balance after transfer:', state._balances.lookup(ownerAccount));
  console.log('Alice Balance after transfer:', state._balances.lookup(aliceAccount));

  // 9. Pause Contract
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );
  console.log('Triggering emergency pause...');
  const pauseResult = client.pause(circuitCtx, ownerAccount);
  currentChargedState = pauseResult.context.currentQueryContext.state;

  state = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('Is Contract Paused?:', state._paused);
  console.log('--- Example Completed Successfully ---');
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});