# Implementation Plan: Implement Contract Actions & Minting in Fungible Token Frontend

Update the `fungible-token` frontend application to make all smart contract actions (`mint`, `transfer`, `approve`, `transferFrom`, `burn`, `pause`, `unpause`, `setEmergencyPauser`, and `emergencyWithdraw`) fully operational with live on-chain and simulated circuit execution.

## Background & Root Cause Analysis

In the Midnight Compact contract `fungible-token-v2-2.compact`:
```compact
circuit authenticate(account: Bytes<32>): [] {
  const sk = localSecretKey();
  const domainTag = pad(32, "fungible-token:auth");
  const derivedAccount = persistentHash<[Bytes<32>, Bytes<32>, Bytes<32>]>([
    domainTag,
    _contractSalt,
    sk
  ]);
  assert(derivedAccount == account, "FungibleToken: caller authorization failed");
}

export circuit mint(to: Bytes<32>, value: Uint<128>): Boolean {
  authenticate(owner);
  whenNotPaused();
  _mint(to, value);
  return true;
}
```

1. **Why `mint` previously failed**:
   - `mint` enforces `authenticate(owner)`.
   - The witness `localSecretKey()` must return the 32-byte private key $sk$ such that $\text{persistentHash}([\text{"fungible-token:auth"}, \_contractSalt, sk]) == owner$.
   - For the deployed Preprod contract (`8cefec943e9f715f21f766edb501ea1fb12a9e8a69c4a3281a133cac6b5ee271`), the on-chain owner is:
     `bd536a17777d8b5e9572411c181eb1f355e6ba3e9509eaab4144f1659e54f3df`.
   - Through cryptographic inspection of the deployment keystore, the matching Owner Secret Key is:
     `e6cd62ba8eb1f8aad56eb24ce77b6f7e63a8d1261f8c70b0040b587a529239e0`.
   - In `useFungibleToken.ts`, `executeCircuit` was overwriting `privateState.secretKey` with the user's unshielded Lace address bytes, which do NOT hash to `owner`.
   - `TokenActions.tsx` lacked an input field or mechanism for providing or selecting the Owner Secret Key, and blocked non-owners with an unbypassable banner.

2. **Why caller-authorized actions (`transfer`, `approve`, `transferFrom`, `burn`, `pause`, `unpause`) need updates**:
   - Each caller action enforces `authenticate(caller)`.
   - In both Test Mode and Lace Mode, the caller's private state must provide the secret key matching `caller`, and `executeCircuit` must bind this secret key to the runtime context.

---

## User Review Required

> [!IMPORTANT]
> The known Owner Secret Key for the active preprod contract `8cefec94...` is `e6cd62ba8eb1f8aad56eb24ce77b6f7e63a8d1261f8c70b0040b587a529239e0`.
> We will configure this key as the default in `deployment.config.json` and persist it in `localStorage` per contract address, while also allowing the user to view, edit, or enter any custom key directly in the UI with instant on-chain salt validation.

---

## Proposed Changes

### Configuration Layer

#### [MODIFY] [deployment.config.json](file:///home/paul/compact/fungible-token/deployment.config.json)
- Add `ownerSecretKey: "e6cd62ba8eb1f8aad56eb24ce77b6f7e63a8d1261f8c70b0040b587a529239e0"` and `owner: "bd536a17777d8b5e9572411c181eb1f355e6ba3e9509eaab4144f1659e54f3df"`.

#### [MODIFY] [dapp.ts](file:///home/paul/compact/fungible-token/src/types/dapp.ts)
- Add `ownerSecretKey?: string;` and `owner?: string;` to `NetworkConfig`.

#### [MODIFY] [midnight-config.ts](file:///home/paul/compact/fungible-token/src/infrastructure/config/midnight-config.ts)
- Include `ownerSecretKey` and `owner` in `MIDNIGHT_CONFIG`.

#### [MODIFY] [ConfigContext.tsx](file:///home/paul/compact/fungible-token/src/presentation/context/ConfigContext.tsx)
- Include `ownerSecretKey` and `owner` in `PRESET_CONFIGS.preprod` and `freshConfig`.

---

### Core Circuit Execution Hook

#### [MODIFY] [useFungibleToken.ts](file:///home/paul/compact/fungible-token/src/presentation/hooks/useFungibleToken.ts)
- Create a client factory `createFungibleTokenClient()` ensuring `clientRef.current` always uses a dynamic `localSecretKey` witness resolver reading from `ctx.privateState.secretKey`.
- Extend `executeCircuit`:
  - Accept `options?: { customSecretKey?: Uint8Array | string; callerAccount?: Uint8Array }`.
  - When `options.customSecretKey` is passed, set `privateStateRef.current.secretKey = hexToBytes(customSecretKey)`.
  - If not passed and circuit is `mint`, auto-resolve the stored or configured `ownerSecretKey`.
- Update `mint(accountHex: string, amount: bigint | number, optionalOwnerKeyHex?: string)`:
  - Pass the owner secret key into `executeCircuit`.
- Update `transfer`, `approve`, `transferFrom`, `burn`:
  - Allow passing an optional caller secret key and ensure `callerAccount = deriveAccount(callerSK, salt)`.
- Update `pause`, `unpause`, `setEmergencyPauser`, `emergencyWithdraw`:
  - Accept `ownerSecretKeyHex?: string` and execute with owner/pauser authorization.
- Update `extractMetadata`:
  - Check whether the stored or provided owner secret key derives to `ownerHex`. If yes, mark `isCallerOwner = true` immediately so the UI reflects owner status.

---

### User Interface Layer

#### [MODIFY] [TokenActions.tsx](file:///home/paul/compact/fungible-token/src/presentation/components/TokenActions.tsx)
- **Mint Tab**:
  - Add an **Owner Secret Key / Admin Key** card:
    - Input field with show/hide password toggle.
    - Real-time derivation check against contract salt:
      Displays `Derived Commitment: 0x...` and a green `✓ Verified Contract Owner Key` badge when matching `metadata.owner`.
    - "Use Contract Owner Key" shortcut button (fills `e6cd62ba...`).
    - In Test Mode: "Use Alice Key (Test Owner)" button.
    - Saves verified key to `localStorage` under `midnight_owner_sk_${targetContractAddress}`.
  - Recipient Account:
    - Add quick selector for Lace address / test identity.
    - Display derived recipient commitment in real-time.
  - Connect the form submission to pass `ownerSecretKey` to `onMint`.
- **Emergency Tab**:
  - Add the same Owner / Pauser Key authentication card.
  - Wire `handlePause`, `handleUnpause`, `handleSetEmergencyPauser`, and `handleEmergencyWithdraw` to pass `ownerSecretKey`.
- Update prop types to support `ownerSecretKey?: string` for all administrative actions.

---

## Verification Plan

### Automated Tests
- Run vitest test suite:
  ```bash
  npm test --prefix /home/paul/compact/fungible-token
  ```
- Run production build:
  ```bash
  npm run build --prefix /home/paul/compact/fungible-token
  ```
- Run circuit execution verification script (verifies all 10 circuits including `mint` with the verified keys):
  ```bash
  npx tsx -e "/* test script */"
  ```

### Manual Verification
- In the browser DApp:
  1. Open http://localhost:3000 (or current dev server).
  2. Switch to **Actions** -> **Mint Tokens**.
  3. Verify that the Owner Secret Key field appears with `✓ Verified Contract Owner Key`.
  4. Enter a recipient and amount, click **Mint Tokens**, and observe the 4-step progress: Preparing -> Proving -> Submitting -> Confirmed.
  5. Verify that token total supply and recipient balance increase accordingly.
