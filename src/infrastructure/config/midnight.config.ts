/**
 * Midnight Preprod Environment Configuration
 */

export const MIDNIGHT_CONFIG = {
    indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    nodeRpc: 'https://rpc.preprod.midnight.network',
    proofServer: 'http://127.0.0.1:6300',
    networkId: 'preprod' as const,
    faucet: 'https://faucet.preprod.midnight.network',
    explorer: process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://explorer.1am.xyz',
    privateStatePassword: process.env.PRIVATE_STATE_PASSWORD?.trim() || '',
};

export interface DeploymentConfig {
    contractName?: string;
    contractAddress?: string;
    contractSalt?: string;
    owner?: string;
    deployerSecretKey?: string;
    deployerAddress?: string;
    networkId?: string;
    indexerUrl?: string;
    indexerWsUrl?: string;
    nodeUrl?: string;
    proofServerUrl?: string;
    faucetUrl?: string;
    explorerUrl?: string;
    // Direct MIDNIGHT_CONFIG property compatibility
    indexer?: string;
    indexerWS?: string;
    nodeRpc?: string;
    proofServer?: string;
    faucet?: string;
    explorer?: string;
}

export const DEFAULT_DEPLOYMENT_CONFIG: DeploymentConfig = {
    contractAddress: '0000000000000000000000000000000000000000000000000000000000000000',
    networkId: (process.env.MIDNIGHT_NETWORK_ID || MIDNIGHT_CONFIG.networkId) as string,
    indexerUrl: process.env.MIDNIGHT_INDEXER || MIDNIGHT_CONFIG.indexer,
    indexerWsUrl: process.env.MIDNIGHT_INDEXER_WS || MIDNIGHT_CONFIG.indexerWS,
    nodeUrl: process.env.MIDNIGHT_NODE_RPC || MIDNIGHT_CONFIG.nodeRpc,
    proofServerUrl: process.env.MIDNIGHT_PROOF_SERVER || MIDNIGHT_CONFIG.proofServer,
    faucetUrl: process.env.MIDNIGHT_FAUCET || MIDNIGHT_CONFIG.faucet,
    explorerUrl: process.env.MIDNIGHT_EXPLORER || MIDNIGHT_CONFIG.explorer,
};

/**
 * Generate deployment.config.json content based on midnight.config.ts defaults and overrides
 */
export function generateDeploymentConfig(
    baseContractName: string,
    override?: Partial<DeploymentConfig>
): DeploymentConfig {
    const networkId = override?.networkId || DEFAULT_DEPLOYMENT_CONFIG.networkId;
    const indexerUrl = override?.indexerUrl || override?.indexer || DEFAULT_DEPLOYMENT_CONFIG.indexerUrl;
    const indexerWsUrl =
        override?.indexerWsUrl ||
        override?.indexerWS ||
        (indexerUrl
            ? indexerUrl.replace(/^http/, 'ws') + (indexerUrl.endsWith('/ws') ? '' : '/ws')
            : DEFAULT_DEPLOYMENT_CONFIG.indexerWsUrl);
    const nodeUrl = override?.nodeUrl || override?.nodeRpc || DEFAULT_DEPLOYMENT_CONFIG.nodeUrl;
    const proofServerUrl = override?.proofServerUrl || override?.proofServer || DEFAULT_DEPLOYMENT_CONFIG.proofServerUrl;
    const faucetUrl = override?.faucetUrl || override?.faucet || DEFAULT_DEPLOYMENT_CONFIG.faucetUrl;
    const explorerUrl = override?.explorerUrl || override?.explorer || DEFAULT_DEPLOYMENT_CONFIG.explorerUrl;

    return {
        contractName: baseContractName,
        contractAddress: override?.contractAddress || DEFAULT_DEPLOYMENT_CONFIG.contractAddress,
        ...(override?.contractSalt ? { contractSalt: override.contractSalt } : {}),
        ...(override?.owner ? { owner: override.owner } : {}),
        ...(override?.deployerAddress ? { deployerAddress: override.deployerAddress } : {}),
        networkId,
        indexerUrl,
        indexerWsUrl,
        nodeUrl,
        proofServerUrl,
        faucetUrl,
        explorerUrl,
        // Direct MIDNIGHT_CONFIG property compatibility
        indexer: indexerUrl,
        indexerWS: indexerWsUrl,
        nodeRpc: nodeUrl,
        proofServer: proofServerUrl,
        faucet: faucetUrl,
        explorer: explorerUrl,
    };
}
