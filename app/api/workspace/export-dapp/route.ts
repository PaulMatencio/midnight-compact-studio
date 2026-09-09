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

/**
 * Resolve the current deployed contract address from deployment storage
 * if not explicitly provided or if a dummy zero-address placeholder was passed.
 */
async function resolveCurrentContractAddress(baseContractName: string, requestedAddress?: string): Promise<string> {
    const defaultPlaceholder = DEFAULT_DEPLOYMENT_CONFIG.contractAddress || '0000000000000000000000000000000000000000000000000000000000000000';
    if (requestedAddress && requestedAddress.trim().length > 0 && requestedAddress !== defaultPlaceholder) {
        return requestedAddress.trim();
    }
    try {
        const deployments = await container.deploymentStorage.getDeployments();
        if (deployments && deployments.length > 0) {
            const clean = baseContractName.toLowerCase();
            // 1. Exact match on contractType
            const exactMatch = deployments.find((d) => (d.contractType || '').toLowerCase() === clean);
            if (exactMatch?.contractAddress) {
                return exactMatch.contractAddress;
            }
            // 2. Partial match on contractType or nickname
            const partialMatch = deployments.find((d) => {
                const type = (d.contractType || '').toLowerCase();
                const nick = (d.nickname || '').toLowerCase();
                return nick.includes(clean) || clean.includes(type) || type.includes(clean);
            });
            if (partialMatch?.contractAddress) {
                return partialMatch.contractAddress;
            }
            if (deployments[0]?.contractAddress) {
                return deployments[0].contractAddress;
            }
        }
    } catch (err) {
        console.warn('Could not auto-resolve contract address from deployment storage:', err);
    }
    return defaultPlaceholder;
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
- **Contract Name**: \`${baseContractName}\`
- **Contract Address**: \`${config.contractAddress || DEFAULT_DEPLOYMENT_CONFIG.contractAddress}\`
- **Network ID**: \`${config.networkId || DEFAULT_DEPLOYMENT_CONFIG.networkId}\`
- **Indexer GraphQL Endpoint**: \`${config.indexerUrl || DEFAULT_DEPLOYMENT_CONFIG.indexerUrl}\`
- **Indexer WebSocket Endpoint**: \`${config.indexerWsUrl || DEFAULT_DEPLOYMENT_CONFIG.indexerWsUrl}\`
- **Node RPC Endpoint**: \`${config.nodeUrl || DEFAULT_DEPLOYMENT_CONFIG.nodeUrl}\`
- **Proof Server Endpoint**: \`${config.proofServerUrl || DEFAULT_DEPLOYMENT_CONFIG.proofServerUrl}\`
- **Faucet Endpoint**: \`${config.faucetUrl || DEFAULT_DEPLOYMENT_CONFIG.faucetUrl}\`
- **Block Explorer**: \`${config.explorerUrl || DEFAULT_DEPLOYMENT_CONFIG.explorerUrl}\`

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

    // 4. Client SDK Adapter
    const sdkPath = path.join(rootDir, 'src', 'client', `${baseContractName}-sdk.ts`);
    try {
        await fs.access(sdkPath);
        artifacts.push({ zipPath: `sdk/${path.basename(sdkPath)}`, diskPath: sdkPath });
        detectedFiles.push(`sdk/${path.basename(sdkPath)}`);
    } catch {}

    // 5. Documentation
    const docPath = path.join(rootDir, 'docs', `${baseContractName}-sdk.md`);
    try {
        await fs.access(docPath);
        artifacts.push({ zipPath: `docs/${path.basename(docPath)}`, diskPath: docPath });
        detectedFiles.push(`docs/${path.basename(docPath)}`);
    } catch {}

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
        const resolvedAddress = await resolveCurrentContractAddress(baseContractName, rawAddress || undefined);
        queryOverride.contractAddress = resolvedAddress;

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
        const resolvedAddress = await resolveCurrentContractAddress(
            baseContractName,
            deploymentConfigOverride.contractAddress
        );
        deploymentConfigOverride.contractAddress = resolvedAddress;

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
