/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    '@midnight-ntwrk/wallet-sdk',
    '@midnight-ntwrk/wallet-sdk-abstractions',
    '@midnight-ntwrk/wallet-sdk-address-format',
    '@midnight-ntwrk/wallet-sdk-capabilities',
    '@midnight-ntwrk/wallet-sdk-dust-wallet',
    '@midnight-ntwrk/wallet-sdk-facade',
    '@midnight-ntwrk/wallet-sdk-hd',
    '@midnight-ntwrk/wallet-sdk-indexer-client',
    '@midnight-ntwrk/wallet-sdk-node-client',
    '@midnight-ntwrk/wallet-sdk-prover-client',
    '@midnight-ntwrk/wallet-sdk-runtime',
    '@midnight-ntwrk/wallet-sdk-shielded',
    '@midnight-ntwrk/wallet-sdk-unshielded-wallet',
    '@midnight-ntwrk/wallet-sdk-utilities',
    '@midnight-ntwrk/midnight-js-contracts',
    '@midnight-ntwrk/midnight-js-http-client-proof-provider',
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider',
    '@midnight-ntwrk/midnight-js-level-private-state-provider',
    '@midnight-ntwrk/midnight-js-node-zk-config-provider',
    '@midnight-ntwrk/midnight-js-network-id',
    '@midnight-ntwrk/midnight-js-protocol',
    '@midnight-ntwrk/midnight-js-types',
    '@midnight-ntwrk/midnight-js-utils',
    '@midnight-ntwrk/compact-js',
    '@midnight-ntwrk/compact-runtime',
    '@midnight-ntwrk/onchain-runtime-v3',
    '@midnight-ntwrk/zkir-v2',
    '@midnight-ntwrk/platform-js',
    '@midnight-ntwrk/ledger-v8',
    'ws',
    'level',
    'classic-level',
    'redis'
  ],
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      topLevelAwait: true,
      layers: true,
    };
    config.output = {
      ...config.output,
      environment: {
        ...config.output?.environment,
        asyncFunction: true,
      },
    };
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
        util: false,
      };
    }
    return config;
  },
  turbopack: {},
};

export default nextConfig;
