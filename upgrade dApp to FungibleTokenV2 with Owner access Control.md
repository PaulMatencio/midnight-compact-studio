# Upgrade DApp to FungibleTokenV2 with Owner Access Control

## Overview
Upgrade the Midnight Fungible Token DApp to **`fungible-token-v2`** on a new Git branch (`v2`). 
The v2 contract introduces contract ownership (`export ledger owner: Bytes<32>`) and enforces strict on-chain circuit access control:
- **`mint(caller, to, value)`**: Restricts token creation strictly to the contract owner (`assert(disclose(caller) == owner)`).
- **`burn(caller, value)`**: Restricts burning strictly to the contract owner (`assert(disclose(caller) == owner)`).
- **`constructor(initialOwner: Bytes<32>)`**: Initializes `owner = disclose(initialOwner)`.
- **New On-Chain Deployed Contract Address**: `2ba6e7b59d3a904a1c132ad80652635ee9fcaa89890e5b30dcec74b5d5de9dfb` (Preprod block #2433638).

---

## User Review Required

> [!IMPORTANT]
> **Branch Strategy**: As specified in `fungible-token-v2/GEMINI_DAPP_PROMPT.md`, all changes will be committed to a new branch: **`v2`**, and pushed to GitHub tracking `origin/v2`. The existing `main` branch remains intact as v1.

> [!IMPORTANT]
> **Constructor Change**: In v2, `initialState` requires `initialOwner: Uint8Array` (32 bytes). In simulated test mode and local resets, the deployer / connected user / Alice will default as the `initialOwner`. On the live Preprod network, the owner is permanently set to the deployer account specified at deployment.

---

## Proposed Changes

### 1. Git Branch Management
- Create and switch to new branch `v2`:
  ```bash
  git checkout -b v2
  ```

---

### 2. Contract Artifacts & Deployment Config

#### [MODIFY] [deployment.config.json](file:///home/paul/compact/fungible-token/deployment.config.json)
- Update `contractName` to `"fungible-token-v2"`.
- Update `contractAddress` to `"2ba6e7b59d3a904a1c132ad80652635ee9fcaa89890e5b30dcec74b5d5de9dfb"`.

#### [REPLACE] `contract/index.js` & `contract/index.d.ts`
- Replace with `fungible-token-v2/contract/index.js` and `index.d.ts` (compiled v2 runtime).
- Synchronize `src/contracts/fungible-token/contract/index.js` and `index.d.ts`.

#### [NEW / UPDATE] `contracts/fungible-token-v2.compact`
- Copy `fungible-token-v2/contracts/fungible-token-v2.compact` to `contracts/`.

#### [REPLACE] `zkir/` and `public/zkir/fungible-token/`
- Replace with the 12 compiled `.zkir` circuit files from `fungible-token-v2/zkir/`:
  `allowance.zkir`, `approve.zkir`, `balanceOf.zkir`, `burn.zkir`, `decimals.zkir`, `initialize.zkir`, `mint.zkir`, `name.zkir`, `symbol.zkir`, `totalSupply.zkir`, `transfer.zkir`, `transferFrom.zkir`.

---

### 3. TypeScript Client SDK

#### [MODIFY] [src/client/fungible-token-sdk.ts](file:///home/paul/compact/fungible-token/src/client/fungible-token-sdk.ts) & [sdk/fungible-token-sdk.ts](file:///home/paul/compact/fungible-token/sdk/fungible-token-sdk.ts)
- Update `initialState(context, initialOwner: Uint8Array = new Uint8Array(32))` signature.
- Update `FungibleTokenLedgerState` to include `readonly owner: Uint8Array`.
- Update `mint(context, caller, to, value)` and `burn(context, caller, value)` circuit callers to match v2 provable circuits.

---

### 4. DApp State Hook & Indexer Client

#### [MODIFY] [src/presentation/hooks/useFungibleToken.ts](file:///home/paul/compact/fungible-token/src/presentation/hooks/useFungibleToken.ts)
- Update `TokenMetadata` interface to include:
  - `owner: string` (hex)
  - `ownerBech32: string` (Bech32m)
  - `isCallerOwner: boolean`
- Update `initialState` in `resetContractCache` to pass `initialOwnerKeyBytes`.
- Update `mint` and `burn` circuit executions to disclose `caller` and pass `caller` as first argument to `contract.circuits.mint` / `contract.circuits.burn`.
- Add pre-flight validation in `mint` and `burn` functions: if `!isCallerOwner`, warn the user and prevent unnecessary failed transactions.

#### [MODIFY] [src/infrastructure/midnight/midnight-indexer-client.ts](file:///home/paul/compact/fungible-token/src/infrastructure/midnight/midnight-indexer-client.ts)
- Include `owner` and `ownerBech32` in `IndexerTokenReport`.
- In `resolveAccountLabel`, identify the contract owner with an `(Owner)` badge.

---

### 5. Presentation Layer & UI/UX

#### [MODIFY] [src/presentation/components/TokenActions.tsx](file:///home/paul/compact/fungible-token/src/presentation/components/TokenActions.tsx)
- **Mint Card**:
  - Add an **"Owner Only"** badge header.
  - If the connected account is NOT the owner:
    - Display an amber warning box: *"Only the contract owner can mint new tokens. Connected: {account} | Owner: {owner}"*.
    - Disable the "Mint Tokens" button.
  - If the connected account IS the owner:
    - Display an emerald verified badge: *"Verified Contract Owner: You have permission to mint."*
    - Enable the "Mint Tokens" button.
- **Burn Card**:
  - Add an **"Owner Only"** badge header.
  - If the connected account is NOT the owner:
    - Display an amber warning box: *"Only the contract owner can burn tokens."*
    - Disable the "Burn Tokens" button.
  - If the connected account IS the owner:
    - Display emerald verified badge and enable button.

#### [MODIFY] [src/presentation/components/ContractOverview.tsx](file:///home/paul/compact/fungible-token/src/presentation/components/ContractOverview.tsx)
- Add a new dedicated card in the overview grid: **"Contract Owner"**.
- Displays the owner's Bech32m address, quick-copy button, and explorer link.
- Displays an indicator: *"You own this contract"* or *"Read-only account"*.

#### [MODIFY] [src/presentation/components/AccountSharesViewer.tsx](file:///home/paul/compact/fungible-token/src/presentation/components/AccountSharesViewer.tsx)
- Highlight the Contract Owner in the holders distribution table with a distinct badge: `Owner`.

---

### 6. Automated Testing & Verification

#### [MODIFY] [tests/fungible-token.test.ts](file:///home/paul/compact/fungible-token/tests/fungible-token.test.ts)
- Replace with the comprehensive v2 test suite from `fungible-token-v2/tests/fungible-token-v2.test.ts`, testing:
  - Constructor with `initialOwner`.
  - Owner-restricted `mint` (owner succeeds, non-owner throws `'FungibleToken: caller is not the owner'`).
  - Owner-restricted `burn` (owner succeeds, non-owner throws `'FungibleToken: caller is not the owner'`).
  - `transfer`, `approve`, `transferFrom`, `allowance`, `balanceOf`.

#### [MODIFY] [tests/modules.test.ts](file:///home/paul/compact/fungible-token/tests/modules.test.ts)
- Update Module E and Module G tests to pass `initialOwner` and test owner decoding from ledger.

#### Commands to Run:
```bash
npx tsc --noEmit
npx vitest run
```

---

### 7. Git Commit & Push
- Commit all changes to branch `v2`:
  ```bash
  git add .
  git commit -m "feat(v2): upgrade to fungible-token-v2 with owner access control and updated contract address"
  git push -u origin v2
  ```
