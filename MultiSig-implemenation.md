# Implementation Plan: Privacy-Preserving Multi-Sig for Compact FungibleToken v2.4

This document outlines the architectural understanding of OpenZeppelin's privacy-preserving multisig presets designed for the Midnight Network, followed by the concrete technical specification to upgrade [`contracts/fungible-token-v2-4.compact`](file:///home/paul/compact/midnight-compact-studio/contracts/fungible-token-v2-4.compact) to incorporate threshold multi-signature governance for token minting, token burning, and emergency pauser designation.

---

## 1. Understanding OpenZeppelin's Compact Privacy-Preserving Multi-Sig Preset

### 1.1 Architectural Contrast: EVM vs. Midnight Multi-Sig

Traditional EVM multi-signature contracts (such as Gnosis Safe) maintain on-chain state machines for every proposal:
1. Proposer creates a proposal on-chain (`propose(...)`).
2. Signers submit public transactions voting or signing on-chain (`approve(...)`).
3. Once threshold is reached, an execution transaction is broadcast (`execute(...)`).

**Privacy and Operational Issues on EVM:**
- **Signer exposure:** Every signer's public address is publicly visible on the blockchain ledger.
- **On-chain voting trail:** Observers see which proposals are proposed, who votes, when they vote, and which proposals fail.
- **Transaction overhead:** M distinct on-chain transactions are required before an action can be performed.

### 1.2 OpenZeppelin's Midnight Privacy-Preserving Multi-Sig Design

OpenZeppelin's `compact-contracts` suite introduces a purpose-built multisig architecture (featuring presets such as `ShieldedMultiSigV2` and `ShieldedMultiSigV3` driven by `EcdsaSignerManager` / `Signer<T>`):

1. **Signer Identities as Cryptographic Commitments:**
   - Signer identities are stored as commitments:
     $$\text{SignerCommitment} = \text{persistentHash}(\text{"multisig:signer:"}, \text{instanceSalt}, \text{SignerPublicKey})$$
   - The signer's actual public key or network address is not stored raw on the ledger.
   - The deployment `instanceSalt` ensures that the same signer keys generate completely uncorrelated commitments across different contract instances, preventing cross-contract tracking and identity clustering.

2. **Single-Transaction Off-Chain Threshold Authorization (No On-Chain Proposal Trail):**
   - Proposal creation, signature collection, and consensus coordination take place **entirely off-chain**.
   - When the threshold of approvals is reached (e.g. 2 of 3), a single relayer/executor submits a single zero-knowledge transaction containing the action parameters, public keys, and digital signatures.
   - The zero-knowledge circuit verifies inside the zk-SNARK:
     - Each public key hashes to an active signer commitment in `_multisigSigners`.
     - Signers are distinct (no duplicate signer attacks).
     - Each signature is mathematically valid over the canonical domain-separated operation digest.
     - The number of valid approvals meets or exceeds `_multisigThreshold`.
   - The action executes atomically in one transaction. Observers only see a valid execution; no intermediate voting steps or debate are recorded on-chain.

3. **Domain Separation & Replay Protection:**
   - Every governed operation binds to a distinct message digest:
     $$\text{msgHash} = \text{persistentHash}([\text{opDomainTag}, \text{kernel.self}().\text{bytes}, \text{nonce}, \dots\text{params}])$$
   - Operation tags (`"multisig:mint:"`, `"multisig:burn:"`, `"multisig:set-pauser:"`) ensure a signature meant for a mint cannot be replayed as a burn or emergency stop.
   - `kernel.self().bytes` prevents cross-instance replays on other deployed contracts.
   - A strictly increasing counter `_multisigNonce` prevents replaying the same authorization payload.

---

## 2. Proposed Changes for `fungible-token-v2-4.compact`

We will update [`contracts/fungible-token-v2-4.compact`](file:///home/paul/compact/midnight-compact-studio/contracts/fungible-token-v2-4.compact) to upgrade the single-owner governance model from `v2-3` to the OpenZeppelin-inspired privacy-preserving multi-sig model.

### 2.1 Multi-Sig State Additions

```compact
// Multi-Sig State (OpenZeppelin Pattern)
export ledger _multisigSigners: Set<Bytes<32>>;     // Registry of signer commitments
export ledger _multisigThreshold: Uint<8>;          // Threshold approvals required (e.g., 2)
export ledger _multisigSignerCount: Uint<8>;        // Number of registered signers (e.g., 3)
export ledger _multisigNonce: Counter;              // Replay protection counter
```

### 2.2 Cryptographic Verification Engine

To ensure full compatibility with the local Compact toolchain (language version `>= 0.23`) while remaining completely self-contained and portable:
- Implement Jubjub Schnorr digital signature verification (`SchnorrSignature { announcement: JubjubPoint, response: Field }`) with challenge reduction to 248 bits.
- Compute signer commitments using:
  `persistentHash([pad(32, "multisig:signer:"), _contractSalt, pk_x, pk_y])`.
- Circuit `assertApprovals2(msgHash, pubkeys, signatures)`:
  - Verifies no duplicate signers (`pubkeys[0] != pubkeys[1]`).
  - Verifies each signer commitment is registered in `_multisigSigners`.
  - Verifies each digital signature over `msgHash`.
  - Asserts threshold is met.

### 2.3 Circuit Updates

1. **`mint(to, value, pubkeys, signatures)`**:
   - Guarded by `whenNotPaused()`.
   - Computes domain-separated digest:
     `persistentHash([pad(32, "multisig:mint:"), kernel.self().bytes, nonce, to, value])`.
   - Enforces `assertApprovals2(msgHash, pubkeys, signatures)`.
   - Increments `_multisigNonce`.
   - Executes internal `_mint(to, value)`.

2. **`burn(account, value, pubkeys, signatures)`**:
   - Guarded by `whenNotPaused()`.
   - Computes domain-separated digest:
     `persistentHash([pad(32, "multisig:burn:"), kernel.self().bytes, nonce, account, value])`.
   - Enforces `assertApprovals2(msgHash, pubkeys, signatures)`.
   - Increments `_multisigNonce`.
   - Executes internal `_burn(account, value)`.
   - *(Note: A user-level `selfBurn(caller, value)` authenticated by the holder is also provided for token holders to voluntarily burn their own tokens).*

3. **`setEmergencyPauser(newPauser, pubkeys, signatures)`**:
   - Replaces single `onlyOwner` restriction with multi-sig threshold authorization.
   - Computes domain-separated digest:
     `persistentHash([pad(32, "multisig:set-pauser:"), kernel.self().bytes, nonce, newPauser])`.
   - Enforces `assertApprovals2(msgHash, pubkeys, signatures)`.
   - Increments `_multisigNonce`.
   - Sets `_emergencyPauser = disclose(newPauser)`.

4. **Multi-Sig Inspection (Off-Chain Public Ledger Queries)**:
   - `_multisigNonce`, `_multisigThreshold`, `_multisigSignerCount`, and `_multisigSigners` are exported public ledger fields read directly off-chain via SDK (`queryLedgerStateFromRaw` / `getMultisigNonce`, etc.) without requiring ZK view circuits, saving ~6.5 KB of on-chain verifier keys to stay strictly under Substrate's 37,500 byte normal block limit.
   - `calculateSignerCommitment(pk: JubjubPoint, salt: Bytes<32>): Bytes<32>` (pure circuit for off-chain commitment derivation)

5. **Constructor Signature**:
   - Takes token configuration, `_contractSalt`, `initialOwner`, `initialSigners: Vector<3, Bytes<32>>`, and `threshold_: Uint<8>`.

---

## 3. Verification Plan

### Automated Compilation & ZK Circuit Check
1. Compile [`contracts/fungible-token-v2-4.compact`](file:///home/paul/compact/midnight-compact-studio/contracts/fungible-token-v2-4.compact) with the local compiler:
   ```bash
   ./bin/compactc --skip-zk contracts/fungible-token-v2-4.compact scratch/compiler/v2_4_verify
   ```
2. Verify that all circuit targets (`mint.zkir`, `burn.zkir`, `setEmergencyPauser.zkir`, etc.) and TypeScript definitions (`index.d.ts`, `index.js`) generate without errors or warnings.
3. Validate type check and syntax integrity.
