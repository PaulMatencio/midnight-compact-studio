/**
 * Quickstart Example: FungibleTokenV22 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-2-example.ts
 */

import { CompactRuntime } from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV22Client,
  type FungibleTokenV22PrivateState,
} from '../src/client/fungible-token-v2-2-sdk.js';

async function main() {
  console.log('=== FungibleTokenV22 SDK Quickstart Execution ===\n');

  // 1. Setup deterministic keys and contract deployment parameters
  const contractSalt = new Uint8Array(32);
  contractSalt.set(Buffer.from('token-salt-v2-2-demo-00000000001', 'utf-8'));

  const ownerSecretKey = new Uint8Array(32);
  ownerSecretKey.fill(0xaa);

  const aliceSecretKey = new Uint8Array(32);
  aliceSecretKey.fill(0xbb);

  const bobSecretKey = new Uint8Array(32);
  bobSecretKey.fill(0xcc);

  // Derive on-chain account commitments
  const ownerAccount = FungibleTokenV22Client.deriveAccount(ownerSecretKey, contractSalt);
  const aliceAccount = FungibleTokenV22Client.deriveAccount(aliceSecretKey, contractSalt);
  const bobAccount = FungibleTokenV22Client.deriveAccount(bobSecretKey, contractSalt);

  console.log('Derived Owner Account Commitment:', Buffer.from(ownerAccount).toString('hex'));
  console.log('Derived Alice Account Commitment:', Buffer.from(aliceAccount).toString('hex'));
  console.log('Derived Bob Account Commitment:  ', Buffer.from(bobAccount).toString('hex'));

  // 2. Setup mock contract addresses and coin public keys (32-byte hex strings)
  const contractAddress = '00'.repeat(32);
  const coinPublicKey = '01'.repeat(32);

  // 3. Initialize Contract State via Constructor Context
  const ownerPrivateState: FungibleTokenV22PrivateState = { secretKey: ownerSecretKey };
  const constructorCtx = CompactRuntime.createConstructorContext(ownerPrivateState, coinPublicKey);

  const client = new FungibleTokenV22Client(ownerPrivateState, contractSalt);

  const name = 'PrivacyUSD';
  const symbol = 'pUSD';
  const decimals = 6n;
  const maxSupply = 1_000_000_000_000n; // 1,000,000 pUSD (at 6 decimals)

  const initResult = client.initialState(
    constructorCtx,
    contractSalt,
    ownerAccount,
    name,
    symbol,
    decimals,
    maxSupply,
  );

  let currentChargedState = initResult.currentContractState.data;
  console.log('\nContract successfully initialized.');

  // 4. Mint tokens to Alice (executed by Owner)
  let circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    ownerPrivateState,
  );

  const mintAmount = 500_000_000n; // 500 pUSD
  console.log(`\nOwner minting ${mintAmount / 1_000_000n} pUSD to Alice...`);
  const mintResult = client.mint(circuitCtx, aliceAccount, mintAmount);
  currentChargedState = mintResult.context.currentQueryContext.state;

  // 5. Query Alice's balance
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    ownerPrivateState,
  );
  const aliceBalanceResult = client.balanceOf(circuitCtx, aliceAccount);
  console.log(`Alice Balance: ${aliceBalanceResult.result} base units`);

  // 6. Alice transfers 100 pUSD to Bob
  const alicePrivateState: FungibleTokenV22PrivateState = { secretKey: aliceSecretKey };
  const aliceClient = new FungibleTokenV22Client(alicePrivateState, contractSalt);

  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    alicePrivateState,
  );

  const transferAmount = 100_000_000n; // 100 pUSD
  console.log(`\nAlice transferring ${transferAmount / 1_000_000n} pUSD to Bob...`);
  const transferResult = aliceClient.transfer(circuitCtx, aliceAccount, bobAccount, transferAmount);
  currentChargedState = transferResult.context.currentQueryContext.state;

  // 7. Verify updated balances from Ledger State directly
  const finalLedger = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('\n=== Ledger State Snapshot ===');
  console.log('Total Supply:', finalLedger._totalSupply.toString());
  console.log('Contract Paused:', finalLedger._paused);
  console.log('Alice Balance in Ledger:', finalLedger._balances.lookup(aliceAccount).toString());
  console.log('Bob Balance in Ledger:  ', finalLedger._balances.lookup(bobAccount).toString());
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});