/**
 * Quickstart Example: FungibleTokenV24 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-4-example.ts
 */

import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import type {
  ConstructorContext,
  CircuitContext
} from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV24Client,
  type FungibleTokenV24PrivateState
} from '../src/client/fungible-token-v2-4-sdk.js';

async function main(): Promise<void> {
  console.log('=== Initializing FungibleToken v2.4 Walkthrough ===');

  // 1. Setup Identities and Constants (32-byte hex strings)
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);
  const salt = '11'.repeat(32);

  const ownerSecretKey = new Uint8Array(32).fill(0xaa);
  const aliceSecretKey = new Uint8Array(32).fill(0xbb);

  // Derive account commitments
  const ownerAccount = FungibleTokenV24Client.deriveAccount(ownerSecretKey, salt);
  const aliceAccount = FungibleTokenV24Client.deriveAccount(aliceSecretKey, salt);

  console.log('Owner Account Commitment:', Buffer.from(ownerAccount).toString('hex'));
  console.log('Alice Account Commitment:', Buffer.from(aliceAccount).toString('hex'));

  // Multi-sig signer commitments (initialSigners: Vector<3, Bytes<32>>)
  const signer1 = new Uint8Array(32).fill(0x01);
  const signer2 = new Uint8Array(32).fill(0x02);
  const signer3 = new Uint8Array(32).fill(0x03);

  // 2. Initialize Private State & Witnesses
  const initialPrivateState: FungibleTokenV24PrivateState = {
    secretKey: ownerSecretKey
  };

  const witnesses = FungibleTokenV24Client.createWitnesses(ownerSecretKey);
  const client = new FungibleTokenV24Client(witnesses, salt);

  // 3. Deploy / Run Constructor
  const constructorCtx: ConstructorContext<FungibleTokenV24PrivateState> =
    CompactRuntime.createConstructorContext(initialPrivateState, coinPublicKey);

  const name = 'Privacy Governance Token';
  const symbol = 'PGT';
  const decimals = 18n;
  const maxSupply = 1_000_000_000n * 10n ** 18n;
  const initialSigners = [signer1, signer2, signer3];
  const threshold = 2n;

  console.log('Executing contract constructor...');
  const initResult = client.initialState(
    constructorCtx,
    FungibleTokenV24Client.toBytes32(salt),
    ownerAccount,
    name,
    symbol,
    decimals,
    maxSupply,
    initialSigners,
    threshold
  );

  // Track on-chain state transitions
  let currentChargedState = initResult.currentContractState.data;
  let privateState = initResult.currentPrivateState;

  // Inspect deployment ledger state
  let currentLedger = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('Token Initialized:');
  console.log(' - Name:', currentLedger._name);
  console.log(' - Symbol:', currentLedger._symbol);
  console.log(' - Total Supply:', currentLedger._totalSupply.toString());
  console.log(' - Multisig Threshold:', currentLedger._multisigThreshold.toString());

  // 4. Create Circuit Context for Transaction Execution
  let circuitCtx: CircuitContext<FungibleTokenV24PrivateState> =
    CompactRuntime.createCircuitContext(
      contractAddress,
      coinPublicKey,
      currentChargedState,
      privateState
    );

  // 5. Test Pausing the Contract (Owner authorization)
  console.log('\nExecuting emergency pause...');
  const pauseResult = client.pause(circuitCtx, ownerAccount);

  // Update tracking state
  currentChargedState = pauseResult.context.currentQueryContext.state;
  privateState = pauseResult.context.currentPrivateState;
  currentLedger = client.queryLedgerStateFromRaw(currentChargedState);
  console.log(' - Contract Paused State:', currentLedger._paused);

  // 6. Test Unpausing the Contract
  console.log('Executing unpause...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );

  const unpauseResult = client.unpause(circuitCtx, ownerAccount);
  currentChargedState = unpauseResult.context.currentQueryContext.state;
  privateState = unpauseResult.context.currentPrivateState;
  currentLedger = client.queryLedgerStateFromRaw(currentChargedState);
  console.log(' - Contract Paused State after reset:', currentLedger._paused);

  // 7. Query Multi-Sig View Circuits
  console.log('\nQuerying Multi-Sig Circuits...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );

  const nonceResult = client.getMultisigNonce(circuitCtx);
  const thresholdResult = client.getMultisigThreshold(circuitCtx);
  const signerCountResult = client.getMultisigSignerCount(circuitCtx);
  const isSigner1Result = client.isMultisigSigner(circuitCtx, signer1);
  const isUnknownSignerResult = client.isMultisigSigner(circuitCtx, new Uint8Array(32).fill(0xff));

  console.log(' - Multisig Nonce:', nonceResult.result.toString());
  console.log(' - Multisig Threshold:', thresholdResult.result.toString());
  console.log(' - Multisig Signer Count:', signerCountResult.result.toString());
  console.log(' - Signer 1 Registered?:', isSigner1Result.result);
  console.log(' - Unknown Signer Registered?:', isUnknownSignerResult.result);

  console.log('\nWalkthrough completed successfully.');
}

main().catch((err) => {
  console.error('Walkthrough execution failed:', err);
  process.exit(1);
});