import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import JSZip from 'jszip';
import { getCleanContractBaseName } from '@/src/lib/contract-utils';
import { container } from '@/src/infrastructure/di/container';
import {
    MIDNIGHT_CONFIG,
    generateDeploymentConfig,
    type DeploymentConfig,
    DEFAULT_DEPLOYMENT_CONFIG,
} from '@/src/infrastructure/config/midnight.config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ResolvedDeploymentInfo {
    contractAddress: string;
    contractSalt?: string;
    owner?: string;
    deployerAddress?: string;
}

function isPlaceholderAddress(addr?: string | null): boolean {
    if (!addr) return true;
    const trimmed = addr.trim();
    if (trimmed.length === 0) return true;
    if (trimmed === DEFAULT_DEPLOYMENT_CONFIG.contractAddress) return true;
    if (trimmed === '0000000000000000000000000000000000000000000000000000000000000000') return true;
    if (!/[1-9a-fA-F]/.test(trimmed)) return true;
    if (trimmed.toLowerCase() === 'undefined' || trimmed.toLowerCase() === 'null') return true;
    return false;
}

/**
 * Resolve the current deployed contract info from deployment storage
 * if not explicitly provided or if a dummy zero-address placeholder was passed.
 */
async function resolveCurrentDeployment(baseContractName: string, requestedAddress?: string): Promise<ResolvedDeploymentInfo> {
    const defaultPlaceholder = DEFAULT_DEPLOYMENT_CONFIG.contractAddress || '0000000000000000000000000000000000000000000000000000000000000000';
    let match: any = null;

    try {
        const deployments = await container.deploymentStorage.getDeployments();
        if (deployments && deployments.length > 0) {
            const clean = baseContractName.toLowerCase();
            if (!isPlaceholderAddress(requestedAddress)) {
                match = deployments.find((d) => (d.contractAddress || '').toLowerCase() === requestedAddress!.trim().toLowerCase());
            }
            if (!match) {
                // 1. Exact match on contractType
                match = deployments.find((d) => (d.contractType || '').toLowerCase() === clean);
            }
            if (!match) {
                // 2. Normalized match (ignoring dashes and underscores)
                const cleanNorm = clean.replace(/[^a-z0-9]/g, '');
                match = deployments.find((d) => {
                    const typeNorm = (d.contractType || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    return typeNorm === cleanNorm;
                });
            }
            if (!match) {
                // 3. Partial match on contractType or nickname
                match = deployments.find((d) => {
                    const type = (d.contractType || '').toLowerCase();
                    const nick = (d.nickname || '').toLowerCase();
                    return nick.includes(clean) || clean.includes(type) || type.includes(clean);
                });
            }
            if (!match) {
                match = deployments[0];
            }
        }
    } catch (err) {
        console.warn('Could not auto-resolve contract address from deployment storage:', err);
    }

    const resolvedAddress = !isPlaceholderAddress(requestedAddress)
        ? requestedAddress!.trim()
        : (match?.contractAddress || defaultPlaceholder);

    let contractSalt = match?.contractSalt;
    let owner = match?.owner;
    const deployerAddress = match?.deployerAddress;

    // Fallback: If contractSalt or owner is missing in storage, query live on-chain contract state
    if ((!contractSalt || !owner) && !isPlaceholderAddress(resolvedAddress)) {
        try {
            const state = await container.contractGateway.getContractState(resolvedAddress);
            if (state?.raw) {
                if (!contractSalt && (state.raw._contractSalt || state.raw.contractSalt)) {
                    contractSalt = String(state.raw._contractSalt || state.raw.contractSalt);
                }
                if (!owner && (state.raw.owner || state.raw._owner)) {
                    owner = String(state.raw.owner || state.raw._owner);
                }
            }
        } catch (stateErr) {
            console.warn(`Could not fetch live on-chain state for ${resolvedAddress}:`, stateErr);
        }
    }

    return {
        contractAddress: resolvedAddress,
        contractSalt,
        owner,
        deployerAddress,
    };
}

/**
 * Load contract-info.json metadata from managed compiler directories.
 */
async function loadContractInfo(baseContractName: string): Promise<any | null> {
    const rootDir = process.cwd();
    const candidatePaths = [
        path.join(rootDir, 'contracts', 'managed', baseContractName, 'compiler', 'contract-info.json'),
        path.join(rootDir, 'contracts', 'managed', baseContractName, 'contract', 'compiler', 'contract-info.json'),
        path.join(rootDir, 'contracts', 'managed', baseContractName, 'contract-info.json'),
    ];

    for (const p of candidatePaths) {
        try {
            const data = await fs.readFile(p, 'utf-8');
            return JSON.parse(data);
        } catch {}
    }
    return null;
}

/**
 * Format Compact JSON AST types into clean Compact syntax strings.
 */
function formatCompactType(typeObj: any): string {
    if (!typeObj) return 'void';
    if (typeof typeObj === 'string') return typeObj;
    switch (typeObj['type-name']) {
        case 'Bytes':
            return `Bytes<${typeObj.length ?? 32}>`;
        case 'Uint': {
            if (typeObj.maxval) {
                const max = String(typeObj.maxval);
                if (max === '255') return 'Uint<8>';
                if (max === '65535') return 'Uint<16>';
                if (max === '4294967295') return 'Uint<32>';
                if (max === '18446744073709551615') return 'Uint<64>';
                if (max === '340282366920938463463374607431768211455') return 'Uint<128>';
                if (max === '452312848583266388373324160190187140051835877600158453279131187530910662655') return 'Uint<248>';
            }
            return 'Uint';
        }
        case 'Boolean':
            return 'Boolean';
        case 'Field':
            return 'Field';
        case 'Opaque':
            return typeObj.tsType ? `Opaque<"${typeObj.tsType}">` : 'Opaque';
        case 'Alias':
            return typeObj.name || formatCompactType(typeObj.type);
        case 'Vector':
            return `Vector<${typeObj.length}, ${formatCompactType(typeObj.type)}>`;
        case 'Struct':
            return typeObj.name || 'Struct';
        case 'Tuple':
            return `[${(typeObj.types || []).map(formatCompactType).join(', ')}]`;
        case 'Cell':
            return `Cell<${formatCompactType(typeObj.type)}>`;
        case 'Map':
            return `Map<${formatCompactType(typeObj.key)}, ${formatCompactType(typeObj.value)}>`;
        case 'Set':
            return `Set<${formatCompactType(typeObj.type)}>`;
        case 'Counter':
            return 'Counter';
        default:
            return typeObj['type-name'] || JSON.stringify(typeObj);
    }
}

/**
 * Generate WHAT_NEWS.md instructing Gemini on all new and updated circuits,
 * ledger schemas, pruned view circuits, and Clean Architecture frontend updates.
 */
function generateWhatsNews(
    baseContractName: string,
    config: DeploymentConfig,
    contractInfo: any | null
): string {
    const pascalName = baseContractName
        .split('-')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');

    const circuits: any[] = contractInfo?.circuits || [];
    const ledger: any[] = contractInfo?.ledger || [];
    const witnesses: any[] = contractInfo?.witnesses || [];
    const compilerVersion = contractInfo?.['compiler-version'] || '0.31.1';
    const languageVersion = contractInfo?.['language-version'] || '0.23.0';

    // Capabilities detection
    const hasMultisig = circuits.some((c) =>
        c.arguments?.some((a: any) => a.name === 'pubkeys' || a.name === 'signatures')
    );
    const hasSelfBurn = circuits.some((c) => c.name === 'selfBurn');
    const hasPause = circuits.some((c) => c.name === 'pause');
    const hasUnpause = circuits.some((c) => c.name === 'unpause');
    const hasEmergencyPauser = circuits.some((c) => c.name === 'setEmergencyPauser');
    const hasAdminReallocate = circuits.some((c) => c.name === 'adminReallocate');
    const hasEmergencyWithdraw = circuits.some((c) => c.name === 'emergencyWithdraw');
    const hasReplaySalt = ledger.some((l) => l.name === '_contractSalt' || l.name === 'contractSalt');

    // Build circuit rows
    const circuitTableRows = circuits.length > 0
        ? circuits.map((c) => {
            const argsStr = (c.arguments || [])
                .map((a: any) => `\`${a.name}: ${formatCompactType(a.type)}\``)
                .join(', ') || '*none*';
            const retStr = `\`${formatCompactType(c['result-type'])}\``;
            const proofBadge = c.proof
                ? '🔒 **Proof Required**'
                : (c.pure ? '⚡ Pure / Local' : 'ℹ️ No Proof');
            return `| \`${c.name}\` | ${proofBadge} | ${argsStr} | ${retStr} |`;
        }).join('\n')
        : '| *No circuit metadata found* | - | - | - |';

    // Build ledger rows
    const ledgerTableRows = ledger.length > 0
        ? ledger.map((l) => {
            let typeStr = '';
            if (l.storage === 'Map') {
                typeStr = `Map<${formatCompactType(l.key)}, ${formatCompactType(l.value)}>`;
            } else if (l.storage === 'Set') {
                typeStr = `Set<${formatCompactType(l.type)}>`;
            } else if (l.storage === 'Cell') {
                typeStr = `Cell<${formatCompactType(l.type)}>`;
            } else if (l.storage === 'Counter') {
                typeStr = 'Counter';
            } else {
                typeStr = formatCompactType(l.type || l);
            }
            return `| \`${l.name}\` | \`${l.storage}\` | \`${typeStr}\` | ${l.index !== undefined ? l.index : '-'} |`;
        }).join('\n')
        : '| *No ledger metadata found* | - | - | - |';

    return `# WHAT'S NEW: Smart Contract Updates & Frontend Migration Guide

> **Target Contract**: \`${pascalName}\` (\`${baseContractName}\`)  
> **Compiler Version**: \`compactc ${compilerVersion}\` | **Language Version**: \`>= ${languageVersion}\`  
> **Deployed Address**: \`${config.contractAddress || DEFAULT_DEPLOYMENT_CONFIG.contractAddress}\`  
> **Network ID**: \`${config.networkId || DEFAULT_DEPLOYMENT_CONFIG.networkId}\`

---

## 📢 Executive Summary for Gemini

This document provides a comprehensive specification of all **new and updated circuits**, **ledger state changes**, **witness requirements**, and **frontend architecture updates** for the **\`${baseContractName}\`** smart contract.

Gemini **MUST** review this file to update the frontend DApp code (Clean Architecture: Domain, Application, Infrastructure, Presentation) to reflect these exact contract capabilities.

${hasMultisig ? `### 🔑 Key Evolution: Privacy-Preserving Multi-Sig Governance
The contract introduces **OpenZeppelin-style threshold multi-sig governance** on the **Jubjub elliptic curve**:
- Sensitive operations (\`mint\`, \`burn\`, \`setEmergencyPauser\`) require threshold Schnorr signatures.
- Signatures are verified **inside zero-knowledge circuits** using Jubjub points and Schnorr reduction witnesses.
- Private keys never leave signers' local machines, preserving complete transaction privacy.
` : ''}
${hasSelfBurn ? `### 🔥 User Deflationary Self-Burn
- The \`selfBurn\` circuit enables any token holder to permanently burn a portion of their own balance without requiring owner or multi-sig approval.
` : ''}
${hasPause ? `### ⏸️ Emergency Pause & Circuit Breaker
- The \`pause\` and \`unpause\` circuits allow the authorized emergency pauser or owner to freeze token movements during critical security events.
` : ''}
${hasReplaySalt ? `### 🛡️ Cross-Contract Replay Protection (\`_contractSalt\`)
- All authentications and domain hashes incorporate \`_contractSalt\`. The deployer's single wallet secret key satisfies both caller and owner authentication.
` : ''}

---

## ⚡ Complete Circuits Reference & Signatures

The table below lists all compiled circuits in \`${baseContractName}\`. Note which circuits require ZK proof generation and which are pure helpers:

| Circuit Name | Execution Type | Arguments | Return Type |
| :--- | :--- | :--- | :--- |
${circuitTableRows}

---

## 🔍 Detailed Breakdown of New & Updated Circuits

${hasMultisig ? `### 1. Multi-Sig Governance Circuits (\`mint\`, \`burn\`, \`setEmergencyPauser\`)

#### Signatures:
\`\`\`typescript
mint(to: Uint8Array, value: bigint, pubkeys: JubjubPoint[], signatures: SchnorrSignature[]): Promise<boolean>
burn(account: Uint8Array, value: bigint, pubkeys: JubjubPoint[], signatures: SchnorrSignature[]): Promise<boolean>
setEmergencyPauser(newPauser: Uint8Array, pubkeys: JubjubPoint[], signatures: SchnorrSignature[]): Promise<boolean>
\`\`\`

#### Required Data Shapes:
- **\`pubkeys\`**: Array of 2 \`JubjubPoint\` objects representing the threshold signers' public keys on the Jubjub curve.
- **\`signatures\`**: Array of 2 \`SchnorrSignature\` objects:
  \`\`\`typescript
  interface SchnorrSignature {
      announcement: JubjubPoint;
      response: bigint;
  }
  \`\`\`
- **Threshold**: Exactly \`_multisigThreshold\` (default: 2) valid signatures matching registered signer commitments in \`_multisigSigners\` must be provided.
- **Nonce Replay Prevention**: Each multi-sig transaction increments \`_multisigNonce\` on the ledger. Proposals must be signed over the current \`_multisigNonce\`.

#### Frontend Guidance for Gemini:
1. **Domain Port**: Define multi-sig methods in \`src/domain/ports/i-contract.gateway.ts\`.
2. **Use Case**: Implement \`mint-tokens.usecase.ts\` and \`burn-tokens.usecase.ts\` that accept signature arrays or provide a multi-sig proposal collection workflow.
3. **Infrastructure Adapter**: In \`src/infrastructure/adapters/contract.adapter.ts\`, serialize Jubjub points and Schnorr signatures into the format expected by \`contract.circuits.mint(...)\`.
4. **UI**: Add a **Multi-Sig Execution Stepper** or modal where signers can paste or assemble their Jubjub signatures.
` : ''}

${hasSelfBurn ? `### 2. Self-Burn Circuit (\`selfBurn\`)

#### Signature:
\`\`\`typescript
selfBurn(caller: Uint8Array, value: bigint): Promise<boolean>
\`\`\`

#### Purpose & Behavior:
- Allows any token holder to burn tokens directly from their own address.
- Verifies \`authenticate(caller)\` using the caller's \`localSecretKey()\` witness.
- Decrements the caller's balance in \`_balances\` and reduces \`_totalSupply\`.
- Enforces \`whenNotPaused()\`.

#### Frontend Guidance for Gemini:
1. Add \`selfBurn(value: bigint): Promise<string>\` to \`IContractGateway\`.
2. Implement \`self-burn.usecase.ts\`.
3. Add a dedicated **"Self Burn"** card in the Dashboard quick-actions grid with an input for the amount and a warning modal.
` : ''}

${hasPause ? `### 3. Emergency Pause Controls (\`pause\`, \`unpause\`, \`setEmergencyPauser\`)

#### Signatures:
\`\`\`typescript
pause(caller: Uint8Array): Promise<boolean>
unpause(caller: Uint8Array): Promise<boolean>
setEmergencyPauser(newPauser: Uint8Array, pubkeys: JubjubPoint[], signatures: SchnorrSignature[]): Promise<boolean>
\`\`\`

#### Purpose & Behavior:
- \`pause\`: Callable by the contract \`owner\` OR the \`_emergencyPauser\`. Sets \`_paused = true\`.
- \`unpause\`: Callable by \`owner\` or \`_emergencyPauser\`. Restores normal operation (\`_paused = false\`).
- When paused, \`transfer\`, \`transferFrom\`, \`mint\`, \`burn\`, and \`selfBurn\` are blocked by \`whenNotPaused()\`.

#### Frontend Guidance for Gemini:
1. Subscribe to \`_paused\` from the public ledger state in \`useContractState.ts\`.
2. Display a prominent **"CONTRACT PAUSED"** amber/red banner at the top of the DApp when \`_paused === true\`.
3. Disable transfer, mint, and burn submission buttons when paused, with a tooltip explaining that the contract is currently paused.
4. Add Pause/Unpause toggle controls in the Admin / Side Panel section visible only when connected with an authorized account.
` : ''}

${hasAdminReallocate ? `### 4. Admin Fund Recovery (\`adminReallocate\`)

#### Signature:
\`\`\`typescript
adminReallocate(caller: Uint8Array, trappedAccount: Uint8Array, targetSpendableAccount: Uint8Array, amount: bigint): Promise<boolean>
\`\`\`

#### Purpose & Behavior:
- Allows the contract owner to recover trapped or misplaced tokens from an unspendable account to a valid target account.
- Protected by \`authenticate(owner)\`.
` : ''}

---

## ⚠️ CRITICAL: Pruned View Circuits & Direct Public Ledger Queries

> [!IMPORTANT]
> **DO NOT generate circuit-call transactions for read-only / view operations!**  
> In Compact smart contracts, read-only view helper circuits (such as \`balanceOf\`, \`allowance\`, \`isPaused\`, \`getMultisigNonce\`, \`getMultisigThreshold\`, \`getMultisigSignerCount\`, \`isMultisigSigner\`) were **pruned from the on-chain circuit table** to prevent block gas limit exhaustion.

### How Gemini MUST Implement Queries:
Instead of submitting on-chain transactions, query the public ledger state directly using **\`@midnight-ntwrk/compact-runtime\`** \`contract.ledger(publicDataProvider)\` or the Indexer GraphQL API:

\`\`\`typescript
// Example: Reading public ledger state in contract.adapter.ts
async function getContractState(contractAddress: string): Promise<ContractStateModel> {
    const publicDataProvider = providers.publicDataProvider;
    const ledgerState = await contract.ledger(publicDataProvider);

    return {
        name: ledgerState._name,
        symbol: ledgerState._symbol,
        decimals: Number(ledgerState._decimals),
        totalSupply: ledgerState._totalSupply,
        maxSupply: ledgerState._maxSupply,
        isPaused: Boolean(ledgerState._paused),
        multisigThreshold: Number(ledgerState._multisigThreshold ?? 0),
        multisigSignerCount: Number(ledgerState._multisigSignerCount ?? 0),
        multisigNonce: BigInt(ledgerState._multisigNonce ?? 0n),
        owner: ledgerState.owner,
        emergencyPauser: ledgerState._emergencyPauser,
    };
}

// Example: Querying user balance from the _balances Map
async function getUserBalance(userAddressHex: string): Promise<bigint> {
    const ledgerState = await contract.ledger(providers.publicDataProvider);
    const addressBytes = fromHex(userAddressHex);
    return ledgerState._balances.get(addressBytes) ?? 0n;
}
\`\`\`

---

## 📊 Public Ledger Schema & Storage Layout

The table below outlines all state variables exported on the ledger:

| State Variable | Storage Type | Data Type | Index |
| :--- | :--- | :--- | :--- |
${ledgerTableRows}

---

## 🏗️ Step-by-Step Frontend Migration Plan for Gemini

Follow these exact steps across the Clean Architecture layers:

### Layer 1: Domain Layer (\`src/domain/\`)
1. **Ports** (\`src/domain/ports/i-contract.gateway.ts\`):
   - Update \`IContractGateway\` to include all new circuit operations:
     \`\`\`typescript
     export interface IContractGateway {
         getContractState(): Promise<ContractStateModel>;
         getBalance(account: string): Promise<bigint>;
         getAllowance(owner: string, spender: string): Promise<bigint>;
         transfer(to: string, amount: bigint): Promise<string>;
         approve(spender: string, amount: bigint): Promise<string>;
         transferFrom(from: string, to: string, amount: bigint): Promise<string>;
         ${hasSelfBurn ? 'selfBurn(amount: bigint): Promise<string>;' : ''}
         ${hasPause ? 'pause(): Promise<string>;\n         unpause(): Promise<string>;' : ''}
         ${hasMultisig ? `mint(to: string, amount: bigint, pubkeys: JubjubPoint[], signatures: SchnorrSignature[]): Promise<string>;
         burn(account: string, amount: bigint, pubkeys: JubjubPoint[], signatures: SchnorrSignature[]): Promise<string>;
         setEmergencyPauser(newPauser: string, pubkeys: JubjubPoint[], signatures: SchnorrSignature[]): Promise<string>;` : ''}
     }
     \`\`\`
2. **Models** (\`src/domain/models/contract-state.model.ts\`):
   - Add fields for \`isPaused\`, \`emergencyPauser\`, \`multisigThreshold\`, \`multisigSignerCount\`, and \`multisigNonce\`.

### Layer 2: Application Layer (\`src/application/use-cases/\`)
Create or update dedicated use cases:
- \`transfer-tokens.usecase.ts\`: Validates balance, ensures \`!isPaused\`, and calls \`gateway.transfer\`.
${hasSelfBurn ? '- `self-burn.usecase.ts`: Validates caller balance, ensures `!isPaused`, and calls `gateway.selfBurn`.' : ''}
${hasPause ? '- `toggle-pause.usecase.ts`: Executes pause or unpause based on current contract state.' : ''}
${hasMultisig ? `- \`mint-tokens.usecase.ts\`: Validates 2-of-2 Schnorr signatures, checks nonces, and calls \`gateway.mint\`.
- \`burn-tokens.usecase.ts\`: Coordinates multi-sig burn proposals.` : ''}

### Layer 3: Infrastructure Layer (\`src/infrastructure/\`)
1. **Contract Adapter** (\`src/infrastructure/adapters/contract.adapter.ts\`):
   - Implement the updated gateway methods.
   - Use the client SDK (\`src/client/${baseContractName}-sdk.ts\`) or direct \`contract.circuits[name]\`.
   - Wire Lace wallet transaction balancing:
     \`\`\`typescript
     const tx = await contract.circuits.transfer(ctx, callerBytes, toBytes, amount);
     const balancedTxHex = await connectedApi.balanceUnsealedTransaction(tx.serialize(), { payFees: true });
     await connectedApi.submitTransaction(balancedTxHex);
     \`\`\`
2. **Witness Handlers**:
   - Provide \`localSecretKey()\` witness returning the connected wallet's derived secret key.
   ${hasMultisig ? '- Provide `getSchnorrReduction(challengeHash)` witness returning `[q, cTruncated]` quotient and remainder for dividing challenge hash by `2^248`.' : ''}

### Layer 4: Presentation Layer (\`src/presentation/\`)
1. **Side Panel Navigation**:
   - Add navigation links for **"Multi-Sig Governance"**, **"Deflation & Burn"**, and **"Emergency Controls"**.
2. **Dashboard**:
   - Add **Pause Status Banner**: Alerts users when contract operations are paused.
   - Add **Multi-Sig Governance Metric Card**: Shows threshold (e.g. \`2 / 2\`), signer count, and current nonce.
   - Add Quick Actions:
     ${hasSelfBurn ? '- **"Burn My Tokens"** button triggering `selfBurn`.\n' : ''}
     ${hasMultisig ? '- **"Multi-Sig Mint"** button opening signature collection modal.\n' : ''}
     ${hasPause ? '- **"Emergency Pause"** / **"Resume Contract"** button for authorized signers.\n' : ''}
3. **Transaction Steppers**:
   - Display real-time steps: Proving (ZK Prover) -> Balancing (Lace DUST) -> Submitting (Node RPC) -> Block Confirmation.

---
*Generated by Midnight Compact Studio for ${pascalName} (${baseContractName}).*
`;
}

/**
 * Generate a comprehensive, self-contained master prompt for Gemini or Claude
 * to scaffold the complete React/Next.js frontend application.
 */
function generateGeminiDAppPrompt(
    baseContractName: string,
    config: DeploymentConfig,
    fileList: string[]
): string {
    const pascalName = baseContractName
        .split('-')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');

    const saltSection = config.contractSalt ? `- **Contract Salt (hex)**: \`${config.contractSalt}\`\n` : '';
    const ownerSection = config.owner ? `- **Owner Account (derived on-chain commitment)**: \`${config.owner}\`\n` : '';
    const deployerSection = config.deployerAddress ? `- **Deployer Address**: \`${config.deployerAddress}\`\n` : '';

    return `# Midnight Network DApp Frontend Architecture Prompt: ${pascalName}

You are an expert full-stack Web3 engineer and UI/UX designer specializing in the **Midnight Network**, the **Compact smart contract runtime**, modern **React 19 / Next.js (App Router)** frontend engineering, **Clean Architecture**, and world-class **UI/UX design**.

A Midnight Compact smart contract called **\`${baseContractName}\`** has been compiled, tested, and prepared for deployment. All relevant contract artifacts, compiled TypeScript definitions, ZKIR circuit bytecodes, client SDK adapters, and deployment configurations are provided in this bundle.

---

## 🧠 MANDATORY: Use Midnight DApp Skills in \`.agents/plugins/midnight-dapp-dev\`

Before writing code or scaffolding this DApp, you **MUST** consult, load, and strictly adhere to the official Midnight DApp development skills located in **\`.agents/plugins/midnight-dapp-dev\`**:

1. **\`midnight-dapp-dev:core\`** (\`.agents/plugins/midnight-dapp-dev/skills/core/SKILL.md\`):
   - **Authoritative Architecture**: Authoritative reference for building browser-based DApps on the Midnight blockchain using Vite + React 19 + shadcn + Tailwind v4.
   - **6-Provider Assembly Pattern**: Assembles \`WalletProvider\` (React context), \`MidnightProvidersProvider\`, \`PublicDataProvider\` (\`indexerPublicDataProvider\`), \`ZKConfigProvider\` (\`FetchZkConfigProvider\`), \`ProofProvider\` (\`httpClientProofProvider\`), and \`PrivateStateProvider\` (in-memory Map or browser storage).
   - **Dynamic Network Configuration**: Dynamically derives network endpoints from \`ConnectedAPI.getConfiguration()\` (\`indexerUri\`, \`indexerWsUri\`, \`substrateNodeUri\`, \`networkId\`) — **never hardcode URLs in production**.
   - **Vite Polyfills & Plugins**: Follows \`references/vite-config.md\` (\`@vitejs/plugin-react\`, \`@tailwindcss/vite\`, \`vite-plugin-wasm\`, \`vite-plugin-top-level-await\`, \`vite-plugin-node-polyfills\`).
   - **Reactive State Management**: Follows \`references/state-management.md\` using RxJS \`combineLatest\` to fuse on-chain public state with off-chain private state into reactive React hooks (\`useContractState\`).
   - **Testing Patterns**: Follows \`references/testing-patterns.md\` for Vitest + Testing Library tests with wallet mocking.

2. **\`midnight-dapp-dev:dapp-connector\`** (\`.agents/plugins/midnight-dapp-dev/skills/dapp-connector/SKILL.md\`):
   - **Connection Lifecycle**: Full connection lifecycle from \`window.midnight\` discovery to \`InitialAPI.connect(networkId)\` returning \`ConnectedAPI\`.
   - **Multi-Wallet Discovery**: Discovers wallets dynamically via CAIP-372 enumeration on \`window.midnight\` with Lace alias fallback (\`window.midnight.mnLace\`).
   - **Balancing & Submission**: Uses \`ConnectedAPI.balanceUnsealedTransaction(txHex, { payFees: true })\` for Lace gas fee balancing, and \`ConnectedAPI.submitTransaction(balancedTxHex)\` for broadcasting.
   - **DApp Connector Spec Compliance**: Note that \`submitTransaction(tx: string): Promise<void>\` returns \`void\` (\`undefined\`). The transaction hash MUST be extracted from the deserialized transaction bytes (\`txObj.identifiers()[0]\`) or observed via the Indexer public data provider.
   - **Error Handling**: Handles \`DAppConnectorAPIError\`, Effect-TS \`FiberFailure\` unwrapping, and insufficient DUST diagnostics.

3. **\`midnight-dapp-dev:init\`** (\`.agents/plugins/midnight-dapp-dev/skills/init/SKILL.md\`):
   - **Reference Scaffolding Templates**: Consults \`.agents/plugins/midnight-dapp-dev/skills/core/templates/\`:
     - \`templates/ui/\`: Complete Vite + React 19 + Tailwind v4 + shadcn frontend template with wallet widget, proof server status, and contract hooks.
     - \`templates/api/\`: TypeScript SDK adapter layer, private state manager, and contract types.

4. **\`midnight-dapp-dev:midnight-sdk\`** (\`.agents/plugins/midnight-dapp-dev/skills/midnight-sdk/SKILL.md\`):
   - Provides canonical reference for \`@midnight-ntwrk/*\` packages and ledger v8 interaction.

> **Crucial Rule**: Do NOT invent synthetic abstractions or non-standard wallet connection methods. Use the patterns documented in \`.agents/plugins/midnight-dapp-dev\` as the single source of truth.

---

## 📦 Bundled Project Artifacts Provided
${fileList.map((f) => `- \`${f}\``).join('\n')}
- \`WHAT_NEWS.md\` (CRITICAL: Read this file for all new and updated circuits, parameter signatures, pruned view circuits, and frontend migration steps)

---

## 🎯 Primary Goal & Mandatory Requirements
Scaffold and implement a complete, production-grade **React 19 / Next.js (App Router)** DApp client that interacts with the deployed **\`${pascalName}\`** smart contract on Midnight.

> 💡 **Review WHAT_NEWS.md**: Consult the bundled \`WHAT_NEWS.md\` for a complete analysis of all newly introduced and updated circuits (e.g. multi-sig mint/burn, user self-burn, emergency pause/unpause), parameter signatures, ledger state fields, and explicit rules on querying pruned view circuits directly from public ledger state.

You **MUST** adhere to these 3 mandatory requirements:
1. **Build a Clean Architecture DApp**: Decouple domain logic, use cases, external infrastructure/Midnight SDK providers, and presentation layers.
2. **The UI must have a Side Panel**: Provide a persistent, sleek navigation side panel (sidebar) with responsive drawer support.
3. **The DApp must have a Dashboard**: Feature a comprehensive dashboard as the central landing hub with stat cards, contract overview, quick action triggers, and live activity streams.

---

## 🏗️ 1. Clean Architecture Specification
You must organize the codebase strictly across Clean Architecture layers:

### A. Domain Layer (\`src/domain/\`)
- **Entities & Models** (\`src/domain/models/\` or \`src/domain/entities/\`):
  - Pure TypeScript domain models representing contract state, accounts, token balances, transaction receipts, and network status.
- **Ports (Interfaces)** (\`src/domain/ports/\`):
  - \`i-wallet.gateway.ts\`: Pure interface for wallet connection, account retrieval, network validation, and balance observation.
  - \`i-contract.gateway.ts\`: Pure interface for contract interactions, calling circuits, subscribing to public ledger state, and tracking transaction lifecycles.
  - \`i-activity.storage.ts\`: Pure interface for storing and retrieving recent transaction history and activity logs.

### B. Application Layer - Use Cases (\`src/application/use-cases/\`)
- Framework-agnostic use cases encapsulating business workflows:
  - \`connect-wallet.usecase.ts\`: Connects wallet and validates network ID.
  - \`get-contract-state.usecase.ts\`: Retrieves and watches public/private contract state.
  - \`execute-circuit.usecase.ts\` (e.g. transfer, mint, or contract-specific circuits): Validates parameters, initiates transactions, and coordinates proof generation.
  - \`get-activities.usecase.ts\`: Retrieves past transactions and streams new receipts.

### C. Infrastructure Layer - Adapters & Providers (\`src/infrastructure/\`)
- **Adapters** (\`src/infrastructure/adapters/\`):
  - \`wallet.adapter.ts\`: Implements \`IWalletGateway\` using \`@midnight-ntwrk/dapp-connector-api\` (\`window.midnight\`).
  - \`contract.adapter.ts\`: Implements \`IContractGateway\` utilizing the client SDK (\`src/client/${baseContractName}-sdk.ts\`) and Midnight providers.
  - \`activity.storage.ts\`: Implements \`IActivityStorage\` using browser LocalStorage or IndexedDB.
- **Provider Assembly** (\`src/infrastructure/providers/midnight-providers.ts\`):
  - Assemble the 6 Midnight providers matching the \`midnight-dapp-dev:core\` specification:
    1. **WalletProvider**: Derived from the connected Lace wallet instance via the DApp Connector API (\`window.midnight\`). Calls \`getConfiguration()\` to resolve service URIs.
    2. **PublicDataProvider**: Configured with \`@midnight-ntwrk/midnight-js-indexer-public-data-provider\` pointing to the Indexer GraphQL URL (\`${config.indexerUrl || DEFAULT_DEPLOYMENT_CONFIG.indexerUrl}\`).
    3. **ProofProvider**: Configured with \`@midnight-ntwrk/midnight-js-http-client-proof-provider\` pointing to the proof server (\`${config.proofServerUrl || DEFAULT_DEPLOYMENT_CONFIG.proofServerUrl}\`) or delegated proving via Lace.
    4. **ZKConfigProvider**: Serves the compiled ZKIR circuit bytecodes from \`public/zkir/${baseContractName}/\` (via \`FetchZkConfigProvider\`).
    5. **MidnightProvider**: Provides \`{ submitTx }\` delegating to Lace's \`submitTransaction\`.
    6. **PrivateStateProvider**: In-browser local private state manager for storing off-chain witness data.
- **Configuration** (\`src/infrastructure/config/midnight.config.ts\`):
  - Centralized network endpoints and contract deployment parameters matching \`deployment.config.json\`.

### D. Presentation Layer (\`src/presentation/\`)
- **Contexts** (\`src/presentation/context/\`):
  - \`WalletContext.tsx\`: React context exposing wallet connection, address, balance, and network with Stop-on-Lock protection and unhandled channel shutdown prevention.
  - \`ContractContext.tsx\`: React context providing reactive access to contract state and use cases.
- **Hooks** (\`src/presentation/hooks/\`):
  - \`use${pascalName}.ts\`: Exposes circuit methods, reactive state streams, and transaction progress.
  - \`useActivity.ts\`: Hook for querying and subscribing to recent transaction activity.
- **Components** (\`src/presentation/components/\`):
  - Clean, reusable React components styled with modern dark-mode Tailwind CSS.

---

## 🛡️ 2. Resilient Lace Wallet Extension Integration Patterns (CRITICAL)

Lace operates as a Chrome **Manifest V3** extension with a single IPC service worker port. When implementing \`wallet.adapter.ts\` and \`WalletContext.tsx\`, you **MUST** strictly implement these 5 resilience patterns to prevent authorization hangs, deadlocks, channel crashes, and repeated unlock password popups:

### A. The "Stop-on-Lock" Pattern (Zero Inactivity Password Loops)
- **Root Cause**: Querying \`api.getUnshieldedBalances()\` or \`api.getShieldedAddresses()\` on a locked Lace wallet forces Chrome/Lace to spawn an intrusive OS/extension modal ("Enter password to unlock your wallet"). If a polling timer runs every 3–15 seconds while locked, Lace continuously pops up unlock modals every minute!
- **Mandatory Implementation**:
  1. Detect locked keystore errors (e.g. error message matches \`"locked"\`, \`"decrypt"\`, or \`"keystore"\`).
  2. Maintain an \`isWalletLockedRef\` inside \`WalletContext\`. When locked, **immediately halt and disarm all background polling intervals and tab focus sync listeners**.
  3. Show a clear UI banner: *"Your Lace wallet is locked. Please unlock it via the browser toolbar icon."*
  4. Resume polling ONLY after the user explicitly unlocks the wallet or triggers a reconnection.

### B. Single-Flight Request Deduplication (Mutex Promise Locks)
- **Root Cause**: React component re-renders or simultaneous connection triggers fire concurrent \`connect()\` or balance queries over Lace's single IPC message channel, causing message collisions and permanent authorization window hangs.
- **Mandatory Implementation**:
  - Implement module-level single-flight promise locks: \`activeConnectPromise\` and \`activeFetchBalancesPromise\`.
  - If a connection handshake or balance query is already in flight, reuse the active promise rather than opening a duplicate IPC channel.

### C. 800ms Settling Delay & Sequential RPC Queries
- **Root Cause**: Calling \`Promise.allSettled([getUnshieldedBalances(), getDustBalance(), getShieldedBalances()])\` concurrently immediately after \`connect()\` returns crashes Lace's internal \`activity-channel\` and \`redux-store\` before the extension modal has closed.
- **Mandatory Implementation**:
  1. Add an **800ms settling delay** immediately after \`connect(networkId)\` resolves before querying any properties.
  2. Query balance and address methods **sequentially** (one-by-one with timeouts):
     - \`getUnshieldedAddress()\` $\\to$
     - \`getUnshieldedBalances()\` (if locked $\\to$ **fast-bailout immediately** without running remaining queries) $\\to$
     - \`getDustBalance()\` $\\to$
     - \`getShieldedAddresses()\`.

### D. Tab Visibility Guard & Relaxed Polling Intervals
- **Root Cause**: Aggressive polling loops (e.g. 3s–15s) bombard sleeping Manifest V3 background workers when the user is in another tab.
- **Mandatory Implementation**:
  - Check \`document.visibilityState === 'visible'\` before every poll; skip completely when hidden.
  - Set the background polling interval to **30–60 seconds** for the Lace extension (never lower than 30s).
  - Throttle window \`focus\` and \`visibilitychange\` listeners to at most once per **20 seconds**.

### E. Window-Level Channel Shutdown Interceptor (\`unhandledrejection\`)
- **Root Cause**: When Chrome puts idle extension service workers to sleep, in-flight IPC proxies disconnect, throwing \`Remote API with channel 'activity-channel' was shutdown: object can no longer be used\`.
- **Mandatory Implementation**:
  - Register a window \`unhandledrejection\` listener in \`WalletProvider\`.
  - If the rejection reason contains \`activity-channel\`, \`redux-store\`, or \`channel was shutdown\`, call \`event.preventDefault()\` to suppress the red browser console error, invalidate the dead API handle (\`extensionApiRef.current = null\`), and update UI state cleanly.

---

## 🎨 3. UI/UX Requirements: Side Panel & Dashboard

### A. Navigation Side Panel (Sidebar)
- **Positioning & Layout**: Persistent left sidebar on desktop (collapsible / expandable) with a mobile slide-over drawer toggle.
- **Branding & Network Header**: Displays DApp logo/title, contract badge, and active network status indicator with pulse animation (e.g. \`${config.networkId || DEFAULT_DEPLOYMENT_CONFIG.networkId}\` - Connected).
- **Navigation Menu** (using modern Lucide icons):
  - 📊 **Dashboard**: Overview, metrics, and quick action cards.
  - ⚡ **Circuits / Actions**: Dedicated panels for invoking smart contract circuits (transfers, mints, state changes).
  - 📜 **Activity History**: Full transaction log, execution receipts, and block explorer links.
  - ⚙️ **Contract & Config**: Deployed contract address, salt, explorer link, and endpoint settings.
- **Bottom Status Widget**: Compact card displaying connected account address (truncated), DUST gas balance, and disconnect button.

### B. Comprehensive Dashboard (Central Hub)
- **Top Metrics Bar / Stat Cards**:
  - **Token / Contract Stats**: Token symbol, token name, total supply, active state.
  - **User Balances**: Private/shielded balance, transparent/unshielded balance, and DUST gas tokens.
  - **Contract Status**: Active contract address (\`${config.contractAddress || DEFAULT_DEPLOYMENT_CONFIG.contractAddress}\`) with one-click copy and block explorer link, deployment status, and owner status indicator.
- **Quick Action Triggers**: Quick-action card grid for instant circuit executions (e.g., "Quick Transfer", "Mint Tokens", "Check Balance") with smooth modal or inline form triggers.
- **Live Transaction Stepper**: Real-time visual progress showing:
  - 🧮 Proof Generation (ZK Prover)
  - ⚖️ Transaction Balancing (Dust & Fee Calculation)
  - ⛓️ Network Submission & Block Inclusion
  - ✅ On-Chain Confirmation with explorer receipt link.
- **Recent Activity Stream**: Live feed of the latest transactions with status badges, timestamps, amount/circuit details, and transaction hashes.

---

## 🌐 4. Network & Deployment Configuration
Use the configuration specified in \`deployment.config.json\` or \`deployment.json\` (configured via \`infrastructure/config/midnight-config.ts\`):
- **Contract Name**: ${baseContractName}
- **Contract Address**: ${config.contractAddress || DEFAULT_DEPLOYMENT_CONFIG.contractAddress}
${saltSection}${ownerSection}${deployerSection}- **Network ID**: ${config.networkId || DEFAULT_DEPLOYMENT_CONFIG.networkId}
- **Indexer GraphQL Endpoint**: ${config.indexerUrl || DEFAULT_DEPLOYMENT_CONFIG.indexerUrl}
- **Indexer WebSocket Endpoint**: ${config.indexerWsUrl || DEFAULT_DEPLOYMENT_CONFIG.indexerWsUrl}
- **Node RPC Endpoint**: ${config.nodeUrl || DEFAULT_DEPLOYMENT_CONFIG.nodeUrl}
- **Proof Server Endpoint**: ${config.proofServerUrl || DEFAULT_DEPLOYMENT_CONFIG.proofServerUrl}
- **Faucet Endpoint**: ${config.faucetUrl || DEFAULT_DEPLOYMENT_CONFIG.faucetUrl}
- **Block Explorer**: ${config.explorerUrl || DEFAULT_DEPLOYMENT_CONFIG.explorerUrl}

> **Important Authorization Architecture (Single Secret Key Model)**: In Compact contracts with salt replay protection (v2.2), owner-authorized circuits (such as \`mint\`, \`pause\`, \`emergencyWithdraw\`) verify \`authenticate(owner)\` where \`derivedAccount = persistentHash(["fungible-token:auth", _contractSalt, sk])\`. Because the contract was deployed with \`initialOwner\` derived from the deployer's wallet address, the user's connected wallet address serves as the secret key in \`ctx.privateState.secretKey\`. **No separate ownerSecretKey is required in the browser.** The single wallet key in private state satisfies both \`authenticate(caller)\` and \`authenticate(owner)\` seamlessly.

---

## 🚀 Execution Instructions
1. **Consult WHAT_NEWS.md & Activate Midnight Skills**: Review \`WHAT_NEWS.md\` for the latest circuit changes, multi-sig parameter requirements, and pruned view circuit guidance, and thoroughly review the skills in \`.agents/plugins/midnight-dapp-dev\` (\`midnight-dapp-dev:core\`, \`midnight-dapp-dev:dapp-connector\`, \`midnight-dapp-dev:init\`) before generating code.
2. **Inspect Bundled Artifacts**: Inspect the provided TypeScript contract interfaces and artifacts in \`contract/\`, \`sdk/\`, and \`deployment.config.json\`.
3. **Scaffold Clean Architecture**: Generate all required application source files following the Clean Architecture layout (\`domain/\`, \`application/\`, \`infrastructure/\`, \`presentation/\`), referencing \`.agents/plugins/midnight-dapp-dev/skills/core/templates/\` for file structures and boilerplate.
4. **Implement UI**: Build the persistent **Side Panel** navigation and comprehensive **Dashboard** page with real-time ZK proof and transaction progress steppers.
5. **Ensure Midnight Standards**: Ensure all types, imports, wallet connections via \`window.midnight\`, and provider configurations align with the \`midnight-dapp-dev\` skills and Midnight Network specification.
6. **Implement Resilient Lace Wallet Integration**: Ensure \`WalletContext\` and \`wallet.adapter.ts\` strictly implement the Stop-on-Lock pattern, single-flight request deduplication, 800ms settling delay, sequential balance queries, visibility-guarded 30-60s polling, and the window-level \`unhandledrejection\` channel shutdown interceptor to prevent Lace from hanging or popping up password prompts.
`;
}

/**
 * Collect all contract-related files from disk to package in ZIP.
 */
async function collectContractArtifacts(baseContractName: string): Promise<{
    artifacts: { zipPath: string; diskPath: string }[];
    detectedFiles: string[];
}> {
    const rootDir = process.cwd();
    const artifacts: { zipPath: string; diskPath: string }[] = [];
    const detectedFiles: string[] = [];

    // 1. Original Compact Contract Source
    const compactPath = path.join(rootDir, 'contracts', `${baseContractName}.compact`);
    try {
        await fs.access(compactPath);
        artifacts.push({ zipPath: `contracts/${path.basename(compactPath)}`, diskPath: compactPath });
        detectedFiles.push(`contracts/${path.basename(compactPath)}`);
    } catch {}

    // 2. Managed Contract Runtime (index.js, index.d.ts)
    const managedContractDir = path.join(rootDir, 'contracts', 'managed', baseContractName, 'contract');
    try {
        const files = await fs.readdir(managedContractDir);
        for (const file of files) {
            const diskPath = path.join(managedContractDir, file);
            artifacts.push({ zipPath: `contract/${file}`, diskPath });
            detectedFiles.push(`contract/${file}`);
        }
    } catch {}

    // 3. Managed ZKIR Files
    const managedZkirDir = path.join(rootDir, 'contracts', 'managed', baseContractName, 'zkir');
    try {
        const files = await fs.readdir(managedZkirDir);
        for (const file of files) {
            const diskPath = path.join(managedZkirDir, file);
            artifacts.push({ zipPath: `zkir/${file}`, diskPath });
            detectedFiles.push(`zkir/${file}`);
        }
    } catch {}

    // 3b. Managed Cryptographic Proving Keys (.prover & .verifier)
    const managedKeysDir = path.join(rootDir, 'contracts', 'managed', baseContractName, 'keys');
    try {
        const files = await fs.readdir(managedKeysDir);
        for (const file of files) {
            const diskPath = path.join(managedKeysDir, file);
            artifacts.push({ zipPath: `keys/${file}`, diskPath });
            detectedFiles.push(`keys/${file}`);
        }
    } catch {}

    // 4. Client SDK Adapter & Type Definitions
    try {
        const clientDir = path.join(rootDir, 'src', 'client');
        const clientFiles = await fs.readdir(clientDir);
        const prefix = baseContractName.toLowerCase();
        for (const file of clientFiles) {
            const lower = file.toLowerCase();
            if (lower.startsWith(prefix) || lower.startsWith(prefix.replace(/-/g, ''))) {
                const diskPath = path.join(clientDir, file);
                artifacts.push({ zipPath: `sdk/${file}`, diskPath });
                detectedFiles.push(`sdk/${file}`);
            }
        }
    } catch {
        const sdkPath = path.join(rootDir, 'src', 'client', `${baseContractName}-sdk.ts`);
        try {
            await fs.access(sdkPath);
            artifacts.push({ zipPath: `sdk/${path.basename(sdkPath)}`, diskPath: sdkPath });
            detectedFiles.push(`sdk/${path.basename(sdkPath)}`);
        } catch {}
    }

    // 5. Documentation, API Interface Definitions (.d.ts), & Architecture Diagrams
    try {
        const docsDir = path.join(rootDir, 'docs');
        const docFiles = await fs.readdir(docsDir);
        const prefix = baseContractName.toLowerCase();
        for (const file of docFiles) {
            const lower = file.toLowerCase();
            if (lower.startsWith(prefix) || lower.startsWith(prefix.replace(/-/g, ''))) {
                const diskPath = path.join(docsDir, file);
                artifacts.push({ zipPath: `docs/${file}`, diskPath });
                detectedFiles.push(`docs/${file}`);
            }
        }
    } catch {
        const docCandidates = [
            path.join(rootDir, 'docs', `${baseContractName}-sdk.md`),
            path.join(rootDir, 'docs', `${baseContractName}-api.d.ts`),
            path.join(rootDir, 'docs', `${baseContractName}-architecture.txt`),
        ];
        for (const p of docCandidates) {
            try {
                await fs.access(p);
                artifacts.push({ zipPath: `docs/${path.basename(p)}`, diskPath: p });
                detectedFiles.push(`docs/${path.basename(p)}`);
            } catch {}
        }
    }

    // 6. Usage Example
    const examplePath = path.join(rootDir, 'examples', `${baseContractName}-example.ts`);
    try {
        await fs.access(examplePath);
        artifacts.push({ zipPath: `examples/${path.basename(examplePath)}`, diskPath: examplePath });
        detectedFiles.push(`examples/${path.basename(examplePath)}`);
    } catch {}

    // 7. Vitest Tests
    const testPath = path.join(rootDir, 'tests', 'contracts', `${baseContractName}.test.ts`);
    try {
        await fs.access(testPath);
        artifacts.push({ zipPath: `tests/${path.basename(testPath)}`, diskPath: testPath });
        detectedFiles.push(`tests/${path.basename(testPath)}`);
    } catch {}

    // 8. Installation / Script
    const scriptPath = path.join(rootDir, 'scripts', `${baseContractName}-install.sh`);
    try {
        await fs.access(scriptPath);
        artifacts.push({ zipPath: `scripts/${path.basename(scriptPath)}`, diskPath: scriptPath });
        detectedFiles.push(`scripts/${path.basename(scriptPath)}`);
    } catch {}

    return { artifacts, detectedFiles };
}

/**
 * GET Handler:
 * - ?preview=true -> Returns JSON preview with list of detected files, generated prompt, and default config
 * - (default) -> Downloads ZIP bundle
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const rawContract = searchParams.get('contract') || 'fungible-token';
        const isPreview = searchParams.get('preview') === 'true';

        const baseContractName = getCleanContractBaseName(rawContract);
        const { artifacts, detectedFiles } = await collectContractArtifacts(baseContractName);

        const queryOverride: Partial<DeploymentConfig> = {};
        const rawAddress = searchParams.get('contractAddress');
        const resolvedDeployment = await resolveCurrentDeployment(baseContractName, rawAddress || undefined);
        queryOverride.contractAddress = resolvedDeployment.contractAddress;
        if (resolvedDeployment.contractSalt) queryOverride.contractSalt = resolvedDeployment.contractSalt;
        if (resolvedDeployment.owner) queryOverride.owner = resolvedDeployment.owner;
        if (resolvedDeployment.deployerAddress) queryOverride.deployerAddress = resolvedDeployment.deployerAddress;

        if (searchParams.get('contractSalt')) queryOverride.contractSalt = searchParams.get('contractSalt')!;
        if (searchParams.get('owner')) queryOverride.owner = searchParams.get('owner')!;
        if (searchParams.get('networkId')) queryOverride.networkId = searchParams.get('networkId')!;
        if (searchParams.get('indexerUrl')) queryOverride.indexerUrl = searchParams.get('indexerUrl')!;
        if (searchParams.get('indexerWsUrl')) queryOverride.indexerWsUrl = searchParams.get('indexerWsUrl')!;
        if (searchParams.get('nodeUrl')) queryOverride.nodeUrl = searchParams.get('nodeUrl')!;
        if (searchParams.get('proofServerUrl')) queryOverride.proofServerUrl = searchParams.get('proofServerUrl')!;
        if (searchParams.get('faucetUrl')) queryOverride.faucetUrl = searchParams.get('faucetUrl')!;
        if (searchParams.get('explorerUrl')) queryOverride.explorerUrl = searchParams.get('explorerUrl')!;

        const config = generateDeploymentConfig(baseContractName, queryOverride);
        const contractInfo = await loadContractInfo(baseContractName);
        const whatsNews = generateWhatsNews(baseContractName, config, contractInfo);
        const masterPrompt = generateGeminiDAppPrompt(baseContractName, config, detectedFiles);

        if (isPreview) {
            return NextResponse.json({
                success: true,
                contract: baseContractName,
                detectedFiles,
                deploymentConfig: config,
                masterPrompt,
                whatsNews,
            });
        }

        const zip = new JSZip();

        for (const item of artifacts) {
            try {
                const data = await fs.readFile(item.diskPath);
                zip.file(item.zipPath, data);
            } catch (err) {
                console.warn(`Could not add ${item.diskPath} to zip:`, err);
            }
        }

        // Add deployment configuration JSON (both deployment.config.json and deployment.json)
        const configJson = JSON.stringify(config, null, 2);
        zip.file('deployment.config.json', configJson);
        zip.file('deployment.json', configJson);

        // Add What's New Guide
        zip.file('WHAT_NEWS.md', whatsNews);

        // Add Master Gemini Prompt
        zip.file('GEMINI_DAPP_PROMPT.md', masterPrompt);

        // Add Bundle README
        const readmeContent = `# ${baseContractName} - Midnight DApp Export Bundle

This bundle contains all compiled smart contract artifacts, ZKIR circuit bytecodes, TypeScript client SDK, documentation, and configuration for **${baseContractName}**.

## Contents:
- \`WHAT_NEWS.md\`: Detailed breakdown of new or updated circuits, parameter signatures, ledger schemas, pruned view circuits, and Clean Architecture frontend migration instructions for Gemini.
- \`GEMINI_DAPP_PROMPT.md\`: Master prompt instructing Gemini to scaffold your React 19 / Next.js frontend using the Midnight skills in \`.agents/plugins/midnight-dapp-dev\`.
- \`deployment.config.json\` / \`deployment.json\`: Midnight network and contract connection parameters (including current contractAddress).
- \`contract/\`: Compiled contract runtime (\`index.js\`, \`index.d.ts\`).
- \`zkir/\`: Circuit Zero-Knowledge Intermediate Representation files.
- \`sdk/\`: High-level TypeScript client adapter.
- \`docs/\`: SDK specification and circuit guides.
- \`examples/\`: Runnable quickstart scripts.
- \`tests/\`: Vitest contract test suite.
- \`contracts/\`: Original Compact contract source.

Exported from Midnight Compact Studio.
`;
        zip.file('README.md', readmeContent);

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        const filename = `${baseContractName}-dapp-bundle.zip`;

        return new NextResponse(zipBuffer as any, {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': zipBuffer.length.toString(),
                'Cache-Control': 'no-cache',
            },
        });
    } catch (err: any) {
        console.error('Failed to export DApp bundle:', err);
        return NextResponse.json(
            { success: false, error: err.message || 'Export failed' },
            { status: 500 }
        );
    }
}

/**
 * POST Handler:
 * Accepts customized deploymentConfig in body and returns binary ZIP.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const rawContract = body.contract || 'fungible-token';
        const baseContractName = getCleanContractBaseName(rawContract);

        const deploymentConfigOverride = body.deploymentConfig || {};
        const resolvedDeployment = await resolveCurrentDeployment(
            baseContractName,
            deploymentConfigOverride.contractAddress
        );
        deploymentConfigOverride.contractAddress = resolvedDeployment.contractAddress;
        if (resolvedDeployment.contractSalt && !deploymentConfigOverride.contractSalt) {
            deploymentConfigOverride.contractSalt = resolvedDeployment.contractSalt;
        }
        if (resolvedDeployment.owner && !deploymentConfigOverride.owner) {
            deploymentConfigOverride.owner = resolvedDeployment.owner;
        }
        if (resolvedDeployment.deployerAddress && !deploymentConfigOverride.deployerAddress) {
            deploymentConfigOverride.deployerAddress = resolvedDeployment.deployerAddress;
        }

        const config = generateDeploymentConfig(baseContractName, deploymentConfigOverride);
        const contractInfo = await loadContractInfo(baseContractName);
        const whatsNews = generateWhatsNews(baseContractName, config, contractInfo);

        const { artifacts, detectedFiles } = await collectContractArtifacts(baseContractName);
        const masterPrompt = generateGeminiDAppPrompt(baseContractName, config, detectedFiles);

        const zip = new JSZip();

        for (const item of artifacts) {
            try {
                const data = await fs.readFile(item.diskPath);
                zip.file(item.zipPath, data);
            } catch (err) {
                console.warn(`Could not add ${item.diskPath} to zip:`, err);
            }
        }

        const configJson = JSON.stringify(config, null, 2);
        zip.file('deployment.config.json', configJson);
        zip.file('deployment.json', configJson);
        zip.file('WHAT_NEWS.md', whatsNews);
        zip.file('GEMINI_DAPP_PROMPT.md', masterPrompt);

        const readmeContent = `# ${baseContractName} - Midnight DApp Export Bundle

This bundle contains all compiled smart contract artifacts, ZKIR circuit bytecodes, TypeScript client SDK, documentation, and configuration for **${baseContractName}**.

## Contents:
- \`WHAT_NEWS.md\`: Detailed breakdown of new or updated circuits, parameter signatures, ledger schemas, pruned view circuits, and Clean Architecture frontend migration instructions for Gemini.
- \`GEMINI_DAPP_PROMPT.md\`: Master prompt instructing Gemini to scaffold your React 19 / Next.js frontend using the Midnight skills in \`.agents/plugins/midnight-dapp-dev\`.
- \`deployment.config.json\` / \`deployment.json\`: Midnight network and contract connection parameters (including current contractAddress).
- \`contract/\`: Compiled contract runtime (\`index.js\`, \`index.d.ts\`).
- \`zkir/\`: Circuit Zero-Knowledge Intermediate Representation files.
- \`sdk/\`: High-level TypeScript client adapter.
- \`docs/\`: SDK specification and circuit guides.
- \`examples/\`: Runnable quickstart scripts.
- \`tests/\`: Vitest contract test suite.
- \`contracts/\`: Original Compact contract source.

Exported from Midnight Compact Studio.
`;
        zip.file('README.md', readmeContent);

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        const filename = `${baseContractName}-dapp-bundle.zip`;

        return new NextResponse(zipBuffer as any, {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': zipBuffer.length.toString(),
                'Cache-Control': 'no-cache',
            },
        });
    } catch (err: any) {
        console.error('Failed to export DApp bundle via POST:', err);
        return NextResponse.json(
            { success: false, error: err.message || 'Export failed' },
            { status: 500 }
        );
    }
}
