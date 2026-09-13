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

You are an expert full-stack Web3 engineer and UI/UX designer specializing in the **Midnight Network**, the **Compact smart contract runtime**, modern **React 19 / Next.js (App Router)** frontend engineering, and world-class **UI/UX design**.

A Midnight Compact smart contract called **\`${baseContractName}\`** has been compiled, tested, and prepared for deployment. All relevant contract artifacts, compiled TypeScript definitions, ZKIR circuit bytecodes, client SDK adapters, and deployment configurations are provided in this bundle.

---

## 📦 Bundled Project Artifacts Provided
${fileList.map((f) => `- \`${f}\``).join('\n')}

---

## 🎯 Primary Goal
Scaffold and implement a complete, production-grade **React 19 / Next.js (App Router)** DApp client that interacts with the deployed **\`${pascalName}\`** smart contract on Midnight.

---

## 🏗️ Architecture Requirements

### 1. Technology Stack
- **Framework**: Next.js 15+ (App Router) / React 19
- **Midnight SDK**:
  - \`@midnight-ntwrk/compact-runtime\`
  - \`@midnight-ntwrk/midnight-js-contracts\`
  - \`@midnight-ntwrk/midnight-js-fetch-zk-config-provider\`
  - \`@midnight-ntwrk/midnight-js-http-client-proof-provider\`
  - \`@midnight-ntwrk/midnight-js-indexer-public-data-provider\`
  - \`@midnight-ntwrk/midnight-js-level-private-state-provider\` (or in-browser IndexedDB / LocalStorage adapter)
  - \`@midnight-ntwrk/midnight-js-types\`
- **State & Reactivity**: React Context + RxJS observables for live indexer contract state subscriptions.
- **Styling & UX/UI**: Modern dark-mode UI with Tailwind CSS or Vanilla CSS, Lucide React icons, rich visual hierarchy, smooth micro-interactions, responsive layouts, and sleek feedback toasts.

---

## 2. Network & Deployment Configuration
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

### 3. Core Modules to Build

#### Module A: Midnight Wallet Connector (\`WalletContext.tsx\`)
- Inspects \`window.midnight\` for installed Midnight wallet extensions (such as Lace Midnight Wallet).
- Provides:
  - \`connectWallet(walletName: string): Promise<void>\`
  - \`disconnectWallet(): void\`
  - \`isConnected: boolean\`
  - \`accountAddress: string | null\`
  - \`dustBalance: bigint | null\`
  - \`networkId: string\`
- Displays a clean wallet connection modal if \`window.midnight\` is missing or disconnected.

#### Module B: Midnight Provider Assembly (\`midnight-providers.ts\`)
Assemble the 5 essential Midnight providers into a unified \`MidnightProvider\`:
1. **WalletProvider**: Derived from the connected Lace wallet instance via the DApp Connector API.
2. **PublicDataProvider**: Configured with \`@midnight-ntwrk/midnight-js-indexer-public-data-provider\` pointing to the Indexer GraphQL URL to query and subscribe to contract states.
3. **ProofProvider**: Configured with \`@midnight-ntwrk/midnight-js-http-client-proof-provider\` pointing to the proof server (\`${config.proofServerUrl}\`) or delegated proving via Lace.
4. **ZKConfigProvider**: Serves the compiled ZKIR circuit bytecodes from \`public/zkir/${baseContractName}/\`.
5. **PrivateStateProvider**: In-browser local private state manager for storing off-chain witness data.

#### Module C: Contract Interaction Hooks (\`use${pascalName}.ts\`)
- Custom React hook wrapping the contract SDK (\`src/client/${baseContractName}-sdk.ts\`).
- Exposes callable circuit methods, transaction submission lifecycle states (\`syncing\`, \`balancing\`, \`proving\`, \`submitting\`, \`confirmed\`, \`error\`), and real-time state streams.
- Shows live updates of public ledger state.

#### Module D: User Interface Components
- **Dashboard / Hero Card**: Contract overview displaying current contract address (\`${config.contractAddress}\`), active network (\`${config.networkId}\`), connection status, and public ledger statistics.
- **Circuit Execution Forms**: Clean, validated input forms for executing circuits (e.g. transfer, mint, query) with instant parameter feedback.
- **Live Transaction Stepper**: Real-time visual progress showing Proof Generation -> Transaction Balancing -> Block Inclusion -> On-Chain Confirmation with explorer link.
- **Activity Log / Transaction Feed**: Historical and live transaction receipts with block heights and transaction hashes.

---

## 🚀 Execution Instructions
1. Inspect the provided TypeScript contract interfaces and artifacts in \`contract/\`, \`sdk/\`, and \`deployment.config.json\`.
2. Generate all required application source files with complete, working implementations.
3. Ensure all types, imports, and provider configurations align with the Midnight Network specification.
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
        const masterPrompt = generateGeminiDAppPrompt(baseContractName, config, detectedFiles);

        if (isPreview) {
            return NextResponse.json({
                success: true,
                contract: baseContractName,
                detectedFiles,
                deploymentConfig: config,
                masterPrompt,
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

        // Add Master Gemini Prompt
        zip.file('GEMINI_DAPP_PROMPT.md', masterPrompt);

        // Add Bundle README
        const readmeContent = `# ${baseContractName} - Midnight DApp Export Bundle

This bundle contains all compiled smart contract artifacts, ZKIR circuit bytecodes, TypeScript client SDK, documentation, and configuration for **${baseContractName}**.

## Contents:
- \`GEMINI_DAPP_PROMPT.md\`: Master prompt for Gemini to scaffold your React 19 / Next.js frontend!
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
        zip.file('GEMINI_DAPP_PROMPT.md', masterPrompt);

        const readmeContent = `# ${baseContractName} - Midnight DApp Export Bundle

This bundle contains all compiled smart contract artifacts, ZKIR circuit bytecodes, TypeScript client SDK, documentation, and configuration for **${baseContractName}**.

## Contents:
- \`GEMINI_DAPP_PROMPT.md\`: Master prompt for Gemini to scaffold your React 19 / Next.js frontend!
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
