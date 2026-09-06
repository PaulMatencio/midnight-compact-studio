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

        // Master prompt must mention the contract and Midnight architecture
        expect(data.masterPrompt).toContain('# Midnight Network DApp Frontend Architecture Prompt: FungibleToken');
        expect(data.masterPrompt).toContain('WalletProvider');
        expect(data.masterPrompt).toContain('PublicDataProvider');
        expect(data.masterPrompt).toContain('ProofProvider');
        expect(data.masterPrompt).toContain('UI/UX design');

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
        expect(parsedConfig.networkId).toBe('preprod');
        expect(parsedConfig.indexerUrl).toBe('https://indexer.preprod.midnight.network/api/v4/graphql');
        expect(parsedConfig.indexerWsUrl).toBe('wss://indexer.preprod.midnight.network/api/v4/graphql/ws');
        expect(parsedConfig.nodeUrl).toBe('https://rpc.preprod.midnight.network');
        expect(parsedConfig.proofServerUrl).toBe('http://127.0.0.1:6300');
        expect(parsedConfig.faucetUrl).toBe('https://faucet.preprod.midnight.network');
        expect(parsedConfig.indexer).toBe('https://indexer.preprod.midnight.network/api/v4/graphql');
        expect(parsedConfig.nodeRpc).toBe('https://rpc.preprod.midnight.network');
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
