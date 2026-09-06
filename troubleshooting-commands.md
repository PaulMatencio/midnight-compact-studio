# Midnight Hello World - Useful Commands & Diagnostics

A curated reference of command-line operations, API queries, and cache inspection commands for the Midnight Hello World DApp.

---

## 1. Local Persistent Caches & Storage

### A. Discover All Cache & Storage Artifacts
Navigate to the project root directory and search for local LevelDB, cache, and deployment files:
```bash
ls -la | grep -E "midnight|\.level|cache|storage|deployment"
```

---

### B. On-Disk LevelDB Cache (`midnight-level-db/`)
* **Location**: [`midnight-level-db/`]  (./midnight-level-db/)
* **Description**: The Midnight Wallet SDK's LevelDB binary store containing indexed cryptographic commitments, Merkle tree checkpoints, and UTXO transaction logs.
* **Inspect Directory**:
  ```bash
  ls -la midnight-level-db/
  ```

---

### C. In-Memory Runtime Cache (`globalThis.__midnightWalletCache`)
* **Source Definition**: [`src/lib/midnight-service.ts`](./src/lib/midnight-service.ts)
* **What it stores**:
  * Active `WalletFacade` instance
  * Derivation key pairs (`Zswap`, `DUST`, `NightExternal`)
  * Persistent WebSocket stream to `wss://indexer.preprod.midnight.network/api/v4/graphql/ws`
  * Confirmed balances across Next.js dev reloads
* **Query Active Cache State**:
  ```bash
  curl -s -X POST http://localhost:3000/api/wallet/status \
    -H "Content-Type: application/json" \
    -d '{"seed":"Wallet seed"}' | jq
  ```

---

### D. Contract Deployment Record (`deployment.json`)
* **Location**: [`deployment.json`](file:///home/paul/compact/hello-word/deployment.json)
* **Description**: Contains the deployed contract address, deployer seed, and network metadata.
* **Inspect Content**:
  ```bash
  cat deployment.json | jq
  ```

---

## 2. API & Network Queries

### A. Query Wallet Status & Balance (Atomic Units)
```bash
curl -s -X POST http://localhost:3000/api/wallet/status \
  -H "Content-Type: application/json" \
  -d '{"seed":"Wallet seed"}' | jq
```

### B. Formatted Wallet Balance One-Liner
```bash
curl -s -X POST http://localhost:3000/api/wallet/status \
  -H "Content-Type: application/json" \
  -d '{"seed":"Wallet seed"}' \
  | jq -r '"Address: " + .data.address + "\nBalance: " + ((.data.tNightBalance | tonumber) / 1000000 | tostring) + " tNIGHT"'
```

### C. Query Current Contract On-Chain State
```bash
curl -s "http://localhost:3000/api/contract/state?address=7cf30a5f13644e109d7374fe0529f8e4cddc6ee0d4a6eb3013ad6fe291e9c3d9" | jq
```

### D. Query System Health & Proof Server
```bash
curl -s http://localhost:3000/api/system/status | jq
```

### E. Query Contract State by Address
```bash
curl -s "http://localhost:3000/api/contract/state?address=7cf30a5f13644e109d7374fe0529f8e4cddc6ee0d4a6eb3013ad6fe291e9c3d9" | jq
```

### F. Query Wallet Status and Balance (using the seed from the deployment.json file)

```bash
curl -s -X POST http://localhost:3000/api/wallet/status -H "Content-Type: application/json" -d '{"seed":"Wallet seed"}' | jq
```
---

## 3. Direct Indexer GraphQL Queries

### Query Indexer Schema Capabilities
```bash
curl -s -X POST https://indexer.preprod.midnight.network/api/v4/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "query { __schema { queryType { fields { name } } } }"}' | jq
```

## 4. Register for Dust Generation 

DUST registration only depends on your Unshielded Wallet.

- This is an Unshielded Transaction on the Midnight blockchain.
- It takes your available tNIGHT UTXOs and broadcasts an on-chain registration transaction associating them with your DUST public key (derived deterministically from your seed).
- It does not spend existing DUST tokens, so it does not need historical DUST UTXO nullifier trees to be scanned.

```bash 
curl -s -X POST http://localhost:3000/api/wallet/register-dust \
  -H "Content-Type: application/json" \
  -d '{"seed":"Wallet seed"}' | jq
```
{
  "success": true,
  "data": {
    "alreadyRegistered": true,
    "message": "All available tNIGHT UTXOs are already registered for DUST generation. DUST generation is pending epoch distribution."
  }
}

---
## 5. Send a Shielded Transaction (Zswap)

This will spend your tNIGHT and send it to the Hello World contract in a shielded transaction.    

```bash 
curl -s -X POST http://localhost:3000/api/wallet/send-shielded 
  -H "Content-Type: application/json" \
  -d '{
        "seed":"Wallet seed",
        "recipient":"Contract address",
        "amount":"1",
        "targetAddress":"0xa1234567890abcdef1234567890abcdef1234567",
        "memo":"Hello World"
      }' | jq
``` 

---


## 6. Transaction phases 

[ 1. Sync Wallet ] ➔ [ 2. ZK Proof ] ➔ [ 3. Balance DUST ] ➔ [ 4. Block Confirmation ]

For a deep dive into each phase, the specific API calls, wallet state transitions, ZK proof generation mechanisms, and on-chain confirmation timelines, refer to the detailed diagnostics guide.

a. 🔄 Sync Wallet
What happens: The local wallet checks and synchronizes its three state machines (Unshielded, Shielded Zswap, and DUST Engine) with the Midnight Preprod Indexer.
Why: To ensure the transaction builds against the latest block tip, unspent UTXOs, and commitment trees.

b. ⚡ ZK Proof Generation
What happens: The storeMessage circuit logic is computed locally, and a request is sent to the local Midnight Proof Server (http://127.0.0.1:6300).
Why: Generates the cryptographic Zero-Knowledge SNARK proof proving the contract transition is valid without leaking private state.

c. ⛽ Balance DUST (Gas Fee Allocation)
What happens: The wallet calls balanceUnboundTransaction, allocating your accrued DUST coins/UTXOs to pay the network transaction gas fee.
Why: Midnight transactions require DUST as fuel. If DUST balance is 0, the transaction pauses here until sufficient DUST is available.

d. 🔗 Signing, Broadcast & Block Confirmation
What happens:
The balanced transaction recipe is finalized and signed with your derived private keys.
The signed transaction is submitted to the Midnight Preprod Node RPC (https://rpc.preprod.midnight.network).
The DApp waits for the transaction to be mined and confirmed in a new Midnight Preprod block (typically ~15–45 seconds).

## 7. How to Check DUST Generation

### A. Query Midnight Preprod Epoch Progress via GraphQL

On the Midnight v4 indexer, the `currentEpochInfo` schema fields are `epochNo`, `durationSeconds`, and `elapsedSeconds`:

```bash
curl -s -X POST https://indexer.preprod.midnight.network/api/v4/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "query { currentEpochInfo { epochNo durationSeconds elapsedSeconds } }"}' | jq
```

**Expected Response:**
```json
{
  "data": {
    "currentEpochInfo": {
      "epochNo": 993195,
      "durationSeconds": 1800,
      "elapsedSeconds": 1240
    }
  }
}
```

- `epochNo`: Current Midnight network epoch number.
- `durationSeconds`: Epoch length in seconds (1800s = 30 minutes).
- `elapsedSeconds`: Progress in seconds through the current epoch.

### B. Query Local Wallet Live DUST Balance & Sync Progress

```bash
curl -s -X POST http://localhost:3000/api/wallet/status \
  -H "Content-Type: application/json" \
  -d '{"seed":"<WALLET_SEED>"}' | jq
```

### C. Verify All UTXOs Are Registered for DUST Generation

```bash
curl -s -X POST http://localhost:3000/api/wallet/register-dust \
  -H "Content-Type: application/json" \
  -d '{"seed":"<WALLET_SEED>"}' | jq
```

** Expected result: **
```json
{
  "success": true,
  "data": {
    "alreadyRegistered": true,
    "message": "All available tNIGHT UTXOs are already registered for DUST generation. DUST generation is pending epoch distribution."
  }
}
```

This response confirms two important things:

1.Registration is Active On-Chain: All your  tNIGHT UTXOs have been successfully linked to your DUST key on the blockchain.

2.Epoch Distribution: On the Midnight network, after registering UTXOs for DUST or after spending DUST in a transaction:
   - Epochs on Midnight Preprod last 30 minutes (durationSeconds: 1800).
   - The DUST state machine activates the accrual calculation across the epoch boundary and updates the ledger's DUST commitment tree.

---

## 5. Browser Wallet (Lace Extension) Diagnostics & Quick Fixes

### A. Fix Frozen Port Channel (`RemoteApiShutdownError` on `midnight-authenticator`)

If the connection hangs or fails with channel shutdown because an earlier prompt was closed or interrupted:

1. **Reload Lace Extension**: Open `chrome://extensions` in your browser and click the circular **Reload (↻)** button on the Lace card.
2. **Clear Stuck Session State via DevTools**:
   - In `chrome://extensions`, click **`service worker`** under Lace.
   - In the Console, run:
     ```javascript
     chrome.storage.local.get(null, (items) => {
       const keys = Object.keys(items).filter(k => k.toLowerCase().includes('dapp') || k.toLowerCase().includes('midnight'));
       chrome.storage.local.remove(keys, () => console.log('Reset DApp connector channels:', keys));
     });
     ```
3. **Reset Extension Local Settings Cache (Linux Shell, Browser Closed)**:
   ```bash
   rm -rf ~/.config/google-chrome/Default/Local\ Extension\ Settings/gafhhkghbfjjkeiendhlofajokpaflmk/*
   ```

### B. Fix Network ID Mismatch (`Invalid network ID: undefined`)

* Lace's `MidnightWalletApi.connect(networkId)` requires a valid network identifier from:
  `mainnet`, `testnet`, `devnet`, `qanet`, `undeployed`, `preview`, `preprod`.
* Ensure the **Target Network** in **Wallet Studio** is set to **Preprod** (never `'active'` or empty).

### C. Upstream Gateway Outage (`HTTP 502 Bad Gateway` on `blockfrost.lw.iog.io`)

* **Symptoms**:
  * In Lace's Service Worker console (`chrome://extensions` > `service worker`):
    ```text
    WebSocket connection to 'wss://blockfrost.lw.iog.io/midnight-preprod-rpc/ws' failed: Error during WebSocket handshake: Unexpected response code: 502
    ```
    or
    ```text
    RPC-CORE: subscribeRuntimeVersion(): RuntimeVersion:: disconnected from wss://blockfrost.lw.iog.io/...: 1000:: Normal Closure
    ```
  * Lace authorization popups hang or fail to open.
* **Root Cause**: IOG's hosted backend proxy for Lace (`blockfrost.lw.iog.io`) is temporarily unable to reach upstream Midnight nodes during routine node maintenance or network upgrades.
* **Remedy**:
  * **Do NOT reinstall Lace or re-import wallet seed phrases.** Your local wallet data is intact.
  * Lace will automatically recover as soon as IOG's gateway connection to the Preprod RPC node is restored.

