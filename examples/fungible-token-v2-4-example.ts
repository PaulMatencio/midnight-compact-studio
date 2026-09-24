/**
 * Quickstart Example: FungibleTokenV24 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-4-example.ts
 */

import {
  CompactRuntime,
  type CircuitContext,
  type ConstructorContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV24Client,
  type FungibleTokenV24PrivateState,
} from '../src/client/fungible-token-v2-4-sdk.js';

async function main() {
  console.log('--- 1. Initializing Cryptographic Context & Secrets ---');
  const contractSalt = new Uint8Array(32);
  contractSalt.fill(0xaa);

  const ownerSK = new Uint8Array(32);
  ownerSK.fill(0x01);

  const aliceSK = new Uint8Array(32);
  aliceSK.fill(0x02);

  const ownerAccount = FungibleTokenV24Client.deriveAccount(ownerSK, contractSalt);
  const aliceAccount = FungibleTokenV24Client.deriveAccount(aliceSK, contractSalt);

  console.log('Owner Account Commitment:', Buffer.from(ownerAccount).toString('hex'));
  console.log('Alice Account Commitment:', Buffer.from(aliceAccount).toString('hex'));

  // Multi-sig signer place-holders (3 initial registered signers)
  const signer1 = new Uint8Array(32).fill(0x11);
  const signer2 = new Uint8Array(32).fill(0x22);
  const signer3 = new Uint8Array(32).fill(0x33);

  console.log('\n--- 2. Instantiating SDK & Deploying Contract Initial State ---');
  let currentOwnerPrivateState: FungibleTokenV24PrivateState = { secretKey: ownerSK };
  const witnesses = FungibleTokenV24Client.createWitnesses(ownerSK);
  const sdk = new FungibleTokenV24Client(witnesses, contractSalt);

  // Addresses in Midnight.js runtime are 32-byte hex strings
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);

  const constructorContext: ConstructorContext<FungibleTokenV24PrivateState> =
    CompactRuntime.createConstructorContext(currentOwnerPrivateState, coinPublicKey);

  const initResult = sdk.initialState(
    constructorContext,
    contractSalt,
    ownerAccount,
    'Shielded Token',
    'SHIELD',
    18n,
    1_000_000n * 10n ** 18n,
    [signer1, signer2, signer3],
    2n
  );

  let currentChargedState = initResult.currentContractState.data;
  currentOwnerPrivateState = initResult.currentPrivateState;

  let ledgerView = sdk.queryLedgerState(currentChargedState);
  console.log('Contract Initialized:');
  console.log('- Total Supply:', ledgerView._totalSupply);
  console.log('- Multisig Threshold:', ledgerView._multisigThreshold);
  console.log('- Multisig Signer Count:', ledgerView._multisigSignerCount);
  console.log('- Is Paused:', ledgerView._paused);

  console.log('\n--- 3. Direct State Execution: Pause Circuit ---');
  let circuitContext: CircuitContext<FungibleTokenV24PrivateState> =
    CompactRuntime.createCircuitContext(
      contractAddress,
      coinPublicKey,
      currentChargedState,
      currentOwnerPrivateState
    );

  const pauseResult = sdk.pause(circuitContext, ownerAccount);
  currentChargedState = pauseResult.context.currentQueryContext.state;
  currentOwnerPrivateState = pauseResult.context.currentPrivateState;

  ledgerView = sdk.queryLedgerState(currentChargedState);
  console.log('State after pause(): _paused =', ledgerView._paused);

  console.log('\n--- 4. Unpausing Contract ---');
  circuitContext = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    currentOwnerPrivateState
  );

  const unpauseResult = sdk.unpause(circuitContext, ownerAccount);
  currentChargedState = unpauseResult.context.currentQueryContext.state;
  currentOwnerPrivateState = unpauseResult.context.currentPrivateState;

  ledgerView = sdk.queryLedgerState(currentChargedState);
  console.log('State after unpause(): _paused =', ledgerView._paused);

  console.log('\n--- Quickstart Walkthrough Complete ---');
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});