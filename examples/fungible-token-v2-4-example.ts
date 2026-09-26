/**
 * Quickstart Example: FungibleTokenV24 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-4-example.ts
 */

import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV24Client,
  type FungibleTokenV24PrivateState,
} from '../src/client/fungible-token-v2-4-sdk.js';

async function main() {
  console.log('=== Initializing FungibleToken v2.4 SDK Demonstration ===');

  // 1. Setup deterministic 32-byte hex mock addresses and keys
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);
  const salt = new Uint8Array(32).fill(7);

  // User 1 (Deployer / Owner)
  const ownerSk = new Uint8Array(32).fill(1);
  const ownerAccount = FungibleTokenV24Client.deriveAccount(ownerSk, salt);

  // User 2 (Alice)
  const aliceSk = new Uint8Array(32).fill(2);
  const aliceAccount = FungibleTokenV24Client.deriveAccount(aliceSk, salt);

  // Dummy Multi-Sig Signer Commitments
  const signer1 = new Uint8Array(32).fill(11);
  const signer2 = new Uint8Array(32).fill(22);
  const signer3 = new Uint8Array(32).fill(33);

  console.log('Derived Owner Commitment:', Buffer.from(ownerAccount).toString('hex'));
  console.log('Derived Alice Commitment:', Buffer.from(aliceAccount).toString('hex'));

  // 2. Build Constructor Context
  const initialPrivateState: FungibleTokenV24PrivateState = { secretKey: ownerSk };
  const witnesses = FungibleTokenV24Client.createWitnesses(ownerSk);
  const client = new FungibleTokenV24Client(witnesses, salt);

  const constructorCtx = CompactRuntime.createConstructorContext(
    initialPrivateState,
    coinPublicKey
  );

  const constructorArgs = [
    salt,
    ownerAccount,
    'Midnight Sovereign Token',
    'MST',
    18n,
    1_000_000_000n * 10n ** 18n,
    [signer1, signer2, signer3],
    2n,
  ];

  console.log('Executing contract constructor...');
  const initResult = client.initialState(constructorCtx, ...constructorArgs);

  // 3. Track On-Chain Charged State
  let currentChargedState = initResult.currentContractState.data;
  let currentPrivateState = initResult.currentPrivateState;

  // 4. Query Initial Ledger State
  let ledgerState = client.queryLedgerState(currentChargedState);
  console.log('Token Name:', ledgerState._name);
  console.log('Token Symbol:', ledgerState._symbol);
  console.log('Multi-Sig Threshold:', client.getMultisigThreshold(ledgerState));
  console.log('Multi-Sig Nonce:', client.getMultisigNonce(ledgerState));

  // 5. Simulate Transfer Execution (Owner transfers to Alice)
  console.log('Executing transfer circuit (Owner -> Alice)...');
  let circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    currentPrivateState
  );

  // Authenticate owner and transfer 100 units
  const transferAmount = 100n;
  const transferResult = client.transfer(
    circuitCtx,
    ownerAccount,
    aliceAccount,
    transferAmount
  );

  // Update charged state
  currentChargedState = transferResult.context.currentQueryContext.state;
  currentPrivateState = transferResult.context.currentPrivateState;

  ledgerState = client.queryLedgerState(currentChargedState);
  console.log('Alice Balance after Transfer:', client.getBalance(ledgerState, aliceAccount));
  console.log('Transfer executed successfully.');
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});