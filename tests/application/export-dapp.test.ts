import { describe, it, expect } from 'vitest';
import { GET, POST } from '@/app/api/workspace/export-dapp/route';
import { MIDNIGHT_CONFIG, generateDeploymentConfig } from '@/src/infrastructure/config/midnight.config';
import { MIDNIGHT_CONFIG as ALIAS_CONFIG } from '@/src/infrastructure/config/midnight-config';
import { NextRequest } from 'next/server';
import JSZip from 'jszip';

describe('Export DApp Bundle API (/api/workspace/export-dapp)', () => {
    it('returns preview metadata with detected files, tailored prompt, and midnight-config defaults', async () => {
        const req = new NextRequest(
            'http://localhost:3000/api/workspace/export-dapp?contract=fungible-token&preview=true'
        );
        const res = await GET(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.contract).toBe('fungible-token');
        expect(Array.isArray(data.detectedFiles)).toBe(true);
        expect(data.detectedFiles.length).toBeGreaterThan(0);

        // Core required files must be detected
        expect(data.detectedFiles).toContain('contracts/fungible-token.compact');
        expect(data.detectedFiles).toContain('contract/index.d.ts');
        expect(data.detectedFiles).toContain('contract/index.js');

        // Master prompt must mention the contract, Midnight architecture, Clean Architecture, Side Panel, and Dashboard
        expect(data.masterPrompt).toContain('# Midnight Network DApp Frontend Architecture Prompt: FungibleToken');
        expect(data.masterPrompt).toContain('.agents/plugins/midnight-dapp-dev');
        expect(data.masterPrompt).toContain('midnight-dapp-dev:core');
        expect(data.masterPrompt).toContain('midnight-dapp-dev:dapp-connector');
        expect(data.masterPrompt).toContain('WalletProvider');
        expect(data.masterPrompt).toContain('PublicDataProvider');
        expect(data.masterPrompt).toContain('ProofProvider');
        expect(data.masterPrompt).toContain('UI/UX design');
        expect(data.masterPrompt).toContain('Clean Architecture');
        expect(data.masterPrompt).toContain('Side Panel');
        expect(data.masterPrompt).toContain('Dashboard');
        expect(data.masterPrompt).toContain('WHAT_NEWS.md');

        // What's New must be generated and returned in preview
        expect(typeof data.whatsNews).toBe('string');
        expect(data.whatsNews).toContain("# WHAT'S NEW: Smart Contract Updates & Frontend Migration Guide");
        expect(data.whatsNews).toContain('FungibleToken');

        // Verify deploymentConfig uses MIDNIGHT_CONFIG defaults
        expect(data.deploymentConfig.networkId).toBe(MIDNIGHT_CONFIG.networkId);
        expect(data.deploymentConfig.indexerUrl).toBe(MIDNIGHT_CONFIG.indexer);
        expect(data.deploymentConfig.nodeUrl).toBe(MIDNIGHT_CONFIG.nodeRpc);
        expect(data.deploymentConfig.proofServerUrl).toBe(MIDNIGHT_CONFIG.proofServer);
        expect(data.deploymentConfig.faucetUrl).toBe(MIDNIGHT_CONFIG.faucet);
    });

    it('cleans compound filenames when requested', async () => {
        const req = new NextRequest(
            'http://localhost:3000/api/workspace/export-dapp?contract=docs/fungible-token-install.sh-sdk.md&preview=true'
        );
        const res = await GET(req);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.contract).toBe('fungible-token');
    });

    it('includes docs/*-api.d.ts and related documentation in export bundle for fungible-token-v2-2', async () => {
        const req = new NextRequest(
            'http://localhost:3000/api/workspace/export-dapp?contract=fungible-token-v2-2&preview=true'
        );
        const res = await GET(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.contract).toBe('fungible-token-v2-2');

        // Check that api.d.ts is detected
        expect(data.detectedFiles).toContain('docs/fungible-token-v2-2-api.d.ts');
        expect(data.detectedFiles).toContain('docs/fungible-token-v2-2-sdk.md');
        expect(data.detectedFiles).toContain('sdk/fungible-token-v2-2-sdk.ts');
        expect(data.masterPrompt).toContain('docs/fungible-token-v2-2-api.d.ts');
    });

    it('generates deployment.config.json using midnight.config.ts defaults when no overrides are given', async () => {
        const req = new NextRequest('http://localhost:3000/api/workspace/export-dapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contract: 'fungible-token',
            }),
        });

        const res = await POST(req);
        expect(res.status).toBe(200);

        const arrayBuffer = await res.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        const configText = await zip.file('deployment.config.json')?.async('text');
        expect(configText).toBeDefined();

        const parsedConfig = JSON.parse(configText!);
        expect(parsedConfig.contractAddress).toBeDefined();
        expect(parsedConfig.contractAddress).toMatch(/^[0-9a-fA-F]{64}$/);
        expect(parsedConfig.contractAddress).not.toBe('0000000000000000000000000000000000000000000000000000000000000000');
        expect(parsedConfig.networkId).toBe('preprod');
        expect(parsedConfig.indexerUrl).toBe('https://indexer.preprod.midnight.network/api/v4/graphql');
        expect(parsedConfig.indexerWsUrl).toBe('wss://indexer.preprod.midnight.network/api/v4/graphql/ws');
        expect(parsedConfig.nodeUrl).toBe('https://rpc.preprod.midnight.network');
        expect(parsedConfig.proofServerUrl).toBe('http://127.0.0.1:6300');
        expect(parsedConfig.faucetUrl).toBe('https://faucet.preprod.midnight.network');
        expect(parsedConfig.indexer).toBe('https://indexer.preprod.midnight.network/api/v4/graphql');
        expect(parsedConfig.nodeRpc).toBe('https://rpc.preprod.midnight.network');

        // Verify deployment.json is also packaged with the current contract address
        const deploymentJsonText = await zip.file('deployment.json')?.async('text');
        expect(deploymentJsonText).toBeDefined();
        const parsedDeploymentJson = JSON.parse(deploymentJsonText!);
        expect(parsedDeploymentJson.contractAddress).toBe(parsedConfig.contractAddress);
    });

    it('generates a valid ZIP archive via POST with custom deployment configuration', async () => {
        const customConfig = {
            contractAddress: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
            networkId: 'testnet-remote',
            indexerUrl: 'https://indexer.testnet.midnight.network/api/v4/graphql',
            proofServerUrl: 'https://prover.testnet.midnight.network',
        };

        const req = new NextRequest('http://localhost:3000/api/workspace/export-dapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contract: 'fungible-token',
                deploymentConfig: customConfig,
            }),
        });

        const res = await POST(req);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/zip');
        expect(res.headers.get('Content-Disposition')).toContain('fungible-token-dapp-bundle.zip');

        // Parse and verify ZIP contents
        const arrayBuffer = await res.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        const filenames = Object.keys(zip.files);
        expect(filenames).toContain('contracts/fungible-token.compact');
        expect(filenames).toContain('contract/index.d.ts');
        expect(filenames).toContain('contract/index.js');
        expect(filenames).toContain('deployment.config.json');
        expect(filenames).toContain('GEMINI_DAPP_PROMPT.md');
        expect(filenames).toContain('WHAT_NEWS.md');
        expect(filenames).toContain('README.md');

        // Verify deployment.config.json has our custom address
        const configText = await zip.file('deployment.config.json')?.async('text');
        expect(configText).toBeDefined();
        const parsedConfig = JSON.parse(configText!);
        expect(parsedConfig.contractAddress).toBe(customConfig.contractAddress);
        expect(parsedConfig.networkId).toBe('testnet-remote');

        // Verify GEMINI_DAPP_PROMPT.md includes custom address and instructions
        const promptText = await zip.file('GEMINI_DAPP_PROMPT.md')?.async('text');
        expect(promptText).toBeDefined();
        expect(promptText).toContain(customConfig.contractAddress);
        expect(promptText).toContain('WHAT_NEWS.md');

        // Verify WHAT_NEWS.md is packaged
        const whatsNewsText = await zip.file('WHAT_NEWS.md')?.async('text');
        expect(whatsNewsText).toBeDefined();
        expect(whatsNewsText).toContain("# WHAT'S NEW: Smart Contract Updates & Frontend Migration Guide");

        // Verify README.md lists WHAT_NEWS.md
        const readmeText = await zip.file('README.md')?.async('text');
        expect(readmeText).toBeDefined();
        expect(readmeText).toContain('WHAT_NEWS.md');
    });

    it('generates WHAT_NEWS.md with new/updated circuits, pruned view circuit guidance, and Clean Architecture instructions for fungible-token-v2-4', async () => {
        const req = new NextRequest(
            'http://localhost:3000/api/workspace/export-dapp?contract=fungible-token-v2-4&preview=true'
        );
        const res = await GET(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.contract).toBe('fungible-token-v2-4');
        expect(typeof data.whatsNews).toBe('string');
        expect(data.whatsNews.length).toBeGreaterThan(0);

        // Header and metadata
        expect(data.whatsNews).toContain("# WHAT'S NEW: Smart Contract Updates & Frontend Migration Guide");
        expect(data.whatsNews).toContain('FungibleTokenV24');

        // Multi-sig governance on Jubjub curve
        expect(data.whatsNews).toContain('Multi-Sig Governance');
        expect(data.whatsNews).toContain('Jubjub');
        expect(data.whatsNews).toContain('SchnorrSignature');
        expect(data.whatsNews).toContain('`mint`');
        expect(data.whatsNews).toContain('`burn`');
        expect(data.whatsNews).toContain('`setEmergencyPauser`');

        // Deflationary self-burn
        expect(data.whatsNews).toContain('Self-Burn');
        expect(data.whatsNews).toContain('`selfBurn`');

        // Emergency pause
        expect(data.whatsNews).toContain('`pause`');
        expect(data.whatsNews).toContain('`unpause`');

        // Admin recovery
        expect(data.whatsNews).toContain('`adminReallocate`');

        // Warning against calling pruned view circuits on-chain
        expect(data.whatsNews).toContain('CRITICAL: Pruned View Circuits & Direct Public Ledger Queries');
        expect(data.whatsNews).toContain('DO NOT generate circuit-call transactions for read-only / view operations');
        expect(data.whatsNews).toContain('contract.ledger');

        // Clean Architecture layer updates
        expect(data.whatsNews).toContain('Domain Layer (`src/domain/`)');
        expect(data.whatsNews).toContain('src/domain/ports/i-contract.gateway.ts');
        expect(data.whatsNews).toContain('Application Layer (`src/application/use-cases/`)');
        expect(data.whatsNews).toContain('Infrastructure Layer (`src/infrastructure/`)');
        expect(data.whatsNews).toContain('Presentation Layer (`src/presentation/`)');

        // Master prompt must also reference WHAT_NEWS.md
        expect(data.masterPrompt).toContain('WHAT_NEWS.md');
    });

    it('re-exports midnight-config.ts identically and generates deployment config', () => {
        expect(ALIAS_CONFIG.indexer).toBe(MIDNIGHT_CONFIG.indexer);
        expect(ALIAS_CONFIG.networkId).toBe('preprod');

        const generated = generateDeploymentConfig('my-contract');
        expect(generated.contractName).toBe('my-contract');
        expect(generated.networkId).toBe('preprod');
        expect(generated.indexer).toBe(MIDNIGHT_CONFIG.indexer);
        expect(generated.indexerWS).toBe(MIDNIGHT_CONFIG.indexerWS);
        expect(generated.nodeRpc).toBe(MIDNIGHT_CONFIG.nodeRpc);
        expect(generated.proofServer).toBe(MIDNIGHT_CONFIG.proofServer);
        expect(generated.faucet).toBe(MIDNIGHT_CONFIG.faucet);
    });
});
