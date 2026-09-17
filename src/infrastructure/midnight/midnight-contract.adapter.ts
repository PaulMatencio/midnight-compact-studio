import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findDeployedContract, deployContract, createUnprovenDeployTx } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type {
    IContractGateway,
    DeployContractOptions,
    PrepareDeployOptions,
    RecordDeploymentOptions,
} from '@/src/domain/ports/i-contract.gateway';
import type { IWalletGateway } from '@/src/domain/ports/i-wallet.gateway';
import type { IDeploymentStorage } from '@/src/domain/ports/i-deployment.storage';
import { parseContractConstructorParams } from '@/src/infrastructure/contracts/contract-inspector.server';
import type {
    TransactionExecutionReceipt,
    DeploymentExecutionReceipt,
    ContractMessageSnapshot,
    PreparedDeployData,
} from '@/src/domain/entities/contract.entity';
import {
    WalletNotSyncedError,
    InsufficientDustError,
    ContractNotFoundError,
    InvalidInputError,
} from '@/src/domain/errors/domain-errors';
import { MIDNIGHT_CONFIG } from '../config/midnight.config';
import { createProviders } from './midnight-providers.factory';
import * as LedgerV8 from '@midnight-ntwrk/ledger-v8';
import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

// Guard global Reflect.get against wasm-bindgen non-object property lookups
if (typeof globalThis.Reflect?.get === 'function') {
    const originalReflectGet = globalThis.Reflect.get;
    if (!(originalReflectGet as any).__isSafeWasmReflectGet) {
        const safeReflectGet = function (target: any, propertyKey: PropertyKey, receiver?: any) {
            if (target === undefined || target === null || (typeof target !== 'object' && typeof target !== 'function')) {
                return undefined;
            }
            if (arguments.length < 3) {
                return originalReflectGet(target, propertyKey);
            }
            return originalReflectGet(target, propertyKey, receiver);
        };
        (safeReflectGet as any).__isSafeWasmReflectGet = true;
        globalThis.Reflect.get = safeReflectGet as any;
    }
}

import * as crypto from 'node:crypto';
import type { FileTransactionHistoryStorage } from '@/src/lib/file-transaction-history-storage';

export function createWitnesses(contractType: string, walletCtx?: any): Record<string, any> {
    const defaultWitnesses: Record<string, any> = {
        localSecretKey: ({ privateState }: any) => {
            let sk = privateState?.secretKey;
            if (!sk || !(sk instanceof Uint8Array) || sk.length !== 32) {
                const unshieldedHex = walletCtx?.unshieldedKeystore?.getAddress?.()?.replace(/^0x/, '');
                if (unshieldedHex && /^[0-9a-fA-F]{64}$/.test(unshieldedHex)) {
                    sk = new Uint8Array(Buffer.from(unshieldedHex, 'hex'));
                } else if (walletCtx?.shieldedSecretKeys?.coinPublicKey) {
                    sk = new Uint8Array(walletCtx.shieldedSecretKeys.coinPublicKey);
                } else {
                    sk = crypto.randomBytes(32);
                }
            }
            const nextPrivateState = {
                ...(privateState || {}),
                secretKey: sk,
            };
            return [nextPrivateState, sk instanceof Uint8Array ? sk : new Uint8Array(sk)];
        },
        secretKey: ({ privateState }: any) => {
            let sk = privateState?.secretKey;
            if (!sk || !(sk instanceof Uint8Array) || sk.length !== 32) {
                sk = crypto.randomBytes(32);
            }
            const nextPrivateState = {
                ...(privateState || {}),
                secretKey: sk,
            };
            return [nextPrivateState, sk instanceof Uint8Array ? sk : new Uint8Array(sk)];
        },
    };

    return new Proxy(defaultWitnesses, {
        get(target, prop: string) {
            if (prop in target) {
                return target[prop];
            }
            return ({ privateState }: any) => {
                const ps = privateState || {};
                return [ps, crypto.randomBytes(32)];
            };
        },
        has() {
            return true;
        },
    });
}

/**
 * Derives a deterministic 32-byte on-chain account commitment matching the contract's authenticate() circuit.
 * Supports contractSalt for cross-contract replay protection.
 */
export function deriveAccountForContract(
    ContractClass: any,
    secretKey: Uint8Array,
    contractSalt: string | Uint8Array = new Uint8Array(32)
): Uint8Array {
    const domainTag = new Uint8Array(32);
    domainTag.set(Buffer.from('fungible-token:auth', 'utf-8'));

    let saltBytes: Uint8Array;
    if (typeof contractSalt === 'string') {
        const cleanHex = contractSalt.startsWith('0x') ? contractSalt.slice(2) : contractSalt;
        saltBytes = new Uint8Array(Buffer.from(cleanHex.padEnd(64, '0').slice(0, 64), 'hex'));
    } else {
        saltBytes = contractSalt;
    }

    try {
        const dummyContract = new ContractClass({
            localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
            getSchnorrReduction: (ctx: any) => [ctx.privateState, [0n, 0n]],
        });
        if (typeof (dummyContract as any)._persistentHash_1 === 'function') {
            try {
                return (dummyContract as any)._persistentHash_1([domainTag, saltBytes, secretKey]);
            } catch {
                return (dummyContract as any)._persistentHash_1([domainTag, { bytes: saltBytes }, secretKey]);
            }
        }
        const proto = Object.getPrototypeOf(dummyContract);
        const hashMethods = Object.getOwnPropertyNames(proto).filter((k) => k.startsWith('_persistentHash'));
        for (const method of hashMethods) {
            try {
                const res = (dummyContract as any)[method]([domainTag, saltBytes, secretKey]);
                if (res instanceof Uint8Array && res.length === 32) {
                    return res;
                }
            } catch {}
            try {
                const res = (dummyContract as any)[method]([domainTag, { bytes: saltBytes }, secretKey]);
                if (res instanceof Uint8Array && res.length === 32) {
                    return res;
                }
            } catch {}
        }
    } catch (err) {
        console.warn('Could not derive account via ContractClass dynamic persistentHash, falling back:', err);
    }
    return crypto.createHash('sha256').update(Buffer.concat([domainTag, saltBytes, secretKey])).digest();
}

export class MidnightContractAdapter implements IContractGateway {
    private compiledContractCache: any = null;

    constructor(
        private readonly walletGateway: IWalletGateway,
        private readonly deploymentStorage: IDeploymentStorage,
        private readonly txHistoryStorage?: FileTransactionHistoryStorage,
    ) { }

    async getContractArtifacts(contractType: string = 'hello-world', walletCtx?: any) {
        const zkConfigPath = path.resolve(process.cwd(), 'contracts', 'managed', contractType);
        const contractJsPath = path.join(zkConfigPath, 'contract', 'index.js');

        if (!fs.existsSync(contractJsPath)) {
            throw new Error(`Compiled contract artifacts not found at contracts/managed/${contractType}. Please compile the contract first in the IDE.`);
        }

        const mtime = fs.statSync(contractJsPath).mtimeMs;
        const contractUrl = `${pathToFileURL(contractJsPath).href}?t=${mtime}`;
        let contractModule: any;
        try {
            // Use runtime Function constructor to avoid Webpack/Turbopack static analysis and module mangling
            const dynamicImport = new Function('specifier', 'return import(specifier)');
            contractModule = await dynamicImport(contractUrl);
        } catch (importErr: any) {
            console.error(`Failed to dynamically load contract module for ${contractType}:`, importErr);
            throw new Error(`Failed to load contract runtime for ${contractType}: ${importErr.message}`);
        }

        const ContractClass = (contractModule as any).Contract || (contractModule as any).default?.Contract || contractModule;

        let compiledContract: any;
        if (contractType === 'hello-world') {
            compiledContract = CompiledContract.make(contractType, ContractClass).pipe(
                CompiledContract.withVacantWitnesses,
                CompiledContract.withCompiledFileAssets(zkConfigPath),
            );
        } else {
            const witnesses = createWitnesses(contractType, walletCtx);
            const withWitnessesFn = CompiledContract.withWitnesses as any;
            const withFileAssetsFn = CompiledContract.withCompiledFileAssets as any;
            compiledContract = (CompiledContract.make(contractType, ContractClass) as any).pipe(
                withWitnessesFn(witnesses),
                withFileAssetsFn(zkConfigPath),
            );
        }

        return { ContractClass, HelloWorld: ContractClass, compiledContract, zkConfigPath, contractModule };
    }

    async storeMessage(seed: string, message: string, contractAddress?: string): Promise<TransactionExecutionReceipt> {
        if (!message || message.trim().length === 0) {
            throw new InvalidInputError('Message cannot be empty.');
        }

        const targetAddress = contractAddress || (await this.deploymentStorage.getDeployment())?.contractAddress;
        if (!targetAddress) {
            throw new ContractNotFoundError();
        }

        return this.executeCircuit(seed, targetAddress, 'storeMessage', [message.trim()], 'hello-world');
    }

    async executeCircuit(
        seed: string,
        contractAddress: string,
        circuitName: string,
        args: any[] = [],
        contractType: string = 'hello-world'
    ): Promise<TransactionExecutionReceipt> {
        const targetAddress = contractAddress || (await this.deploymentStorage.getDeployment())?.contractAddress;
        if (!targetAddress) {
            throw new ContractNotFoundError();
        }

        const status = await this.walletGateway.getWalletStatus(seed);
        const isSynced = Boolean(status.isSynced) || (status.syncProgress?.percentage ?? 0) >= 100;
        if (!isSynced) {
            throw new WalletNotSyncedError(status.syncProgress?.percentage);
        }

        const currentDust = BigInt(status.dustBalance || '0');
        if (currentDust === 0n) {
            throw new InsufficientDustError();
        }

        const walletCtx = await this.walletGateway.getOrCreateWalletContext(seed);
        await Promise.race([
            walletCtx.wallet.waitForSyncedState(),
            new Promise((r) => setTimeout(r, 3000)),
        ]);

        const { compiledContract, zkConfigPath } = await this.getContractArtifacts(contractType, walletCtx);
        const providers = createProviders(walletCtx, { zkConfigPath });

        const contract = await findDeployedContract(providers as any, {
            contractAddress: targetAddress,
            compiledContract: compiledContract as any,
            privateStateId: `${contractType}State`,
            initialPrivateState: {},
        });

        const circuitFn = (contract as any).callTx[circuitName];
        if (typeof circuitFn !== 'function') {
            throw new Error(`Circuit '${circuitName}' was not found on contract '${contractType}'.`);
        }

        const startTime = Date.now();
        let tx: any;
        try {
            tx = await circuitFn(...args);
        } catch (err: any) {
            const errMsg = err?.message || String(err);
            console.error(`[ContractAdapter] Execution error for '${circuitName}':`, err);
            if (
                errMsg.includes('170') ||
                errMsg.includes('InvalidDustSpendProof') ||
                errMsg.includes('Transaction submission error') ||
                errMsg.includes('non-linearly')
            ) {
                console.warn('[ContractAdapter] Detected invalid DUST spend proof (error 170). Evicting wallet and clearing state for auto-recovery...');
                await this.walletGateway.clearStoredState(seed).catch(() => {});
                throw new Error(
                    `Transaction submission error: Invalid DUST spend proof (Node Error 170). The wallet commitment tree was desynchronized from the network. Corrupted wallet state has been cleared. Please re-try '${circuitName}' in a few moments.`
                );
            }
            throw err;
        }
        const durationMs = Date.now() - startTime;
        const dustPaid = walletCtx.lastDustFee ? walletCtx.lastDustFee.toString() : '0';

        const displayMessage = args.length > 0 && typeof args[0] === 'string'
            ? args[0]
            : `${circuitName}() executed`;

        const receipt: TransactionExecutionReceipt = {
            success: true,
            message: displayMessage,
            contractAddress: targetAddress,
            txHash: tx.public.txHash,
            blockHeight: tx.public.blockHeight,
            dustPaid,
            durationMs,
            timestamp: new Date().toISOString(),
        };

        if (this.txHistoryStorage) {
            try {
                await this.txHistoryStorage.storeTxRecord({
                    id: `tx-${Date.now()}`,
                    txHash: tx.public.txHash,
                    blockHeight: tx.public.blockHeight,
                    message: displayMessage,
                    contractAddress: targetAddress,
                    contractType,
                    circuitName,
                    txType: 'contract_call',
                    timestamp: receipt.timestamp,
                    dustPaid,
                    durationMs,
                });
            } catch (e) {
                console.warn('Failed to persist tx record:', e);
            }
        }

        return receipt;
    }

    async deployContract(seed: string, options?: DeployContractOptions): Promise<DeploymentExecutionReceipt> {
        const contractType = options?.contractType || 'hello-world';
        const password = options?.privateStatePassword?.trim() || MIDNIGHT_CONFIG.privateStatePassword;

        if (!password || password.length < 16) {
            throw new InvalidInputError('Private state password is required and must be at least 16 characters long.');
        }

        const status = await this.walletGateway.getWalletStatus(seed);
        const isSynced = Boolean(status.isSynced) || (status.syncProgress?.percentage ?? 0) >= 100;
        if (!isSynced) {
            throw new WalletNotSyncedError(status.syncProgress?.percentage);
        }

        const currentDust = BigInt(status.dustBalance || '0');
        if (currentDust === 0n) {
            throw new InsufficientDustError();
        }

        const walletCtx = await this.walletGateway.getOrCreateWalletContext(seed);
        await Promise.race([
            walletCtx.wallet.waitForSyncedState(),
            new Promise((r) => setTimeout(r, 3000)),
        ]);

        const { compiledContract, zkConfigPath, ContractClass } = await this.getContractArtifacts(contractType, walletCtx);

        const providers = createProviders(walletCtx, {
            privateStatePassword: password,
            zkConfigPath,
        });

        const { resolvedArgs, activeContractSalt, derivedOwner } = this.resolveConstructorArgs(
            contractType,
            ContractClass,
            options?.constructorArgs,
            options?.deployerAddress,
            walletCtx
        );

        console.log(`[DeployAdapter] Starting deployment pipeline for '${contractType}'...`);
        console.log(`[DeployAdapter] Resolved ${resolvedArgs.length} constructor arguments.`);

        const startTime = Date.now();
        let deployed: any;
        try {
            deployed = await deployContract(providers as any, {
                compiledContract: compiledContract as any,
                args: resolvedArgs,
                privateStateId: `${contractType}State`,
                initialPrivateState: {},
            });
        } catch (err: any) {
            const errMsg = err?.message || String(err);
            console.error(`[DeployAdapter] Deployment error for '${contractType}':`, err);
            if (
                errMsg.includes('170') ||
                errMsg.includes('InvalidDustSpendProof') ||
                errMsg.includes('Transaction submission error') ||
                errMsg.includes('non-linearly')
            ) {
                console.warn('[DeployAdapter] Detected invalid DUST spend proof or tree divergence (error 170). Evicting wallet and clearing state for auto-recovery...');
                await this.walletGateway.clearStoredState(seed).catch(() => {});
                throw new Error(
                    'Transaction submission error: Invalid DUST spend proof (Node Error 170). The wallet commitment tree was desynchronized from the network. Corrupted wallet state has been cleared and reset. Please re-try deployment in a few moments once the wallet re-syncs.'
                );
            }
            throw err;
        }

        const contractAddress = deployed.deployTxData.public.contractAddress;
        const txHash = (deployed as any).deployTxData?.txHash || (deployed as any).txHash;
        const blockHeight = (deployed as any).deployTxData?.blockHeight ?? null;
        const dustPaid = walletCtx.lastDustFee ? walletCtx.lastDustFee.toString() : '0';
        const durationMs = Date.now() - startTime;

        console.log(`[DeployAdapter] Deployment succeeded in ${durationMs}ms! Contract Address: ${contractAddress}, Block: ${blockHeight}`);

        const owner = derivedOwner;
        const hasNonZeroSalt = activeContractSalt && !activeContractSalt.every(b => b === 0);

        await this.deploymentStorage.saveDeployment({
            contractAddress,
            contractType,
            deployerSeed: seed.trim(),
            deployedAt: new Date().toISOString(),
            ...(owner ? { owner } : {}),
            ...(hasNonZeroSalt ? { contractSalt: Buffer.from(activeContractSalt).toString('hex') } : {}),
            deployerAddress: options?.deployerAddress || walletCtx?.unshieldedKeystore?.getBech32Address?.()?.toString(),
        });

        const receipt: DeploymentExecutionReceipt = {
            success: true,
            contractAddress,
            contractType,
            dustPaid,
            durationMs,
            network: MIDNIGHT_CONFIG.networkId,
            deployedAt: new Date().toISOString(),
        };

        if (this.txHistoryStorage) {
            try {
                await this.txHistoryStorage.storeTxRecord({
                    id: `deploy-${Date.now()}`,
                    txHash: txHash || `deploy-${contractAddress.slice(0, 16)}`,
                    contractAddress: contractAddress,
                    contractType,
                    txType: 'contract_deploy',
                    blockHeight,
                    message: `Contract Deployed: ${contractAddress.slice(0, 10)}...`,
                    timestamp: receipt.deployedAt,
                    dustPaid,
                    durationMs,
                });
            } catch (e) {
                console.warn('Failed to persist deploy tx record:', e);
            }
        }

        return receipt;
    }

    private resolveConstructorArgs(
        contractType: string,
        ContractClass: any,
        userArgs?: Record<string, any> | any[],
        explicitDeployerAddress?: string,
        walletCtx?: any
    ): { resolvedArgs: any[]; activeContractSalt: Uint8Array; derivedOwner?: string } {
        const constructorParams = parseContractConstructorParams(contractType);
        const resolvedArgs: any[] = [];

        // Check if there is a contract salt parameter
        let activeContractSalt: Uint8Array = new Uint8Array(32);
        for (let i = 0; i < constructorParams.length; i++) {
            const p = constructorParams[i];
            const clean = p.name.replace(/^_+/, '').toLowerCase();
            if (clean.includes('salt') || p.label?.toLowerCase().includes('salt')) {
                let userVal: any = undefined;
                if (Array.isArray(userArgs)) {
                    userVal = userArgs[i];
                } else if (userArgs && typeof userArgs === 'object') {
                    userVal = userArgs[p.name] ?? userArgs[clean];
                }
                if (userVal instanceof Uint8Array && userVal.length === 32) {
                    activeContractSalt = userVal;
                } else if (typeof userVal === 'string' && /^[0-9a-fA-F]{64}$/.test(userVal.replace(/^0x/, ''))) {
                    activeContractSalt = new Uint8Array(Buffer.from(userVal.replace(/^0x/, ''), 'hex'));
                } else {
                    activeContractSalt = new Uint8Array(crypto.randomBytes(32));
                }
                break;
            }
        }

        // Determine deployer key bytes and addresses
        let deployerKeyBytes: Uint8Array | undefined;
        let deployerUnshieldedHex = '';
        let deployerBech32 = '';

        if (explicitDeployerAddress && explicitDeployerAddress.trim()) {
            const trimmed = explicitDeployerAddress.trim();
            if (trimmed.startsWith('mn_') || trimmed.startsWith('midnight')) {
                try {
                    const decoded = MidnightBech32m.parse(trimmed).decode(UnshieldedAddress, getNetworkId());
                    deployerKeyBytes = new Uint8Array(decoded.data);
                    deployerUnshieldedHex = Buffer.from(deployerKeyBytes).toString('hex').toLowerCase();
                    deployerBech32 = trimmed.toLowerCase();
                } catch {
                    // ignore
                }
            } else {
                const cleanHex = trimmed.replace(/^0x/, '').toLowerCase();
                if (/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
                    deployerUnshieldedHex = cleanHex;
                    deployerKeyBytes = new Uint8Array(Buffer.from(cleanHex, 'hex'));
                    deployerBech32 = trimmed;
                }
            }
        }

        if (!deployerKeyBytes) {
            deployerUnshieldedHex = walletCtx?.unshieldedKeystore?.getAddress
                ? walletCtx.unshieldedKeystore.getAddress().toLowerCase().replace(/^0x/, '')
                : '';
            deployerBech32 = walletCtx?.unshieldedKeystore?.getBech32Address?.()?.toString()?.toLowerCase() || '';
            deployerKeyBytes = deployerUnshieldedHex && /^[0-9a-fA-F]{64}$/.test(deployerUnshieldedHex)
                ? new Uint8Array(Buffer.from(deployerUnshieldedHex, 'hex'))
                : (walletCtx?.shieldedSecretKeys?.coinPublicKey
                    ? new Uint8Array(walletCtx.shieldedSecretKeys.coinPublicKey)
                    : new Uint8Array(32).fill(1));
        }

        let derivedOwner: string | undefined = undefined;

        for (let i = 0; i < constructorParams.length; i++) {
            const param = constructorParams[i];
            const cleanName = param.name.replace(/^_+/, '');
            let userVal: any = undefined;

            if (Array.isArray(userArgs)) {
                userVal = userArgs[i];
            } else if (userArgs && typeof userArgs === 'object') {
                userVal = userArgs[param.name] ?? userArgs[cleanName];
            }

            const isVectorParam = param.compactType?.startsWith('Vector') ||
                param.description?.startsWith('Vector') ||
                cleanName.toLowerCase().includes('signers');

            if (cleanName.toLowerCase().includes('salt') || param.label?.toLowerCase().includes('salt')) {
                resolvedArgs.push(activeContractSalt);
            } else if (isVectorParam) {
                const vectorMatch = param.compactType?.match(/Vector<\s*(\d+)\s*,\s*(.+)\s*>/);
                const vectorLen = vectorMatch ? parseInt(vectorMatch[1], 10) : 3;
                const elemType = vectorMatch ? vectorMatch[2] : 'Bytes<32>';

                if (elemType.includes('Bytes') || elemType.includes('Uint8Array') || cleanName.toLowerCase().includes('signers')) {
                    const signers: Uint8Array[] = [];
                    if (Array.isArray(userVal)) {
                        for (const item of userVal) {
                            if (item instanceof Uint8Array && item.length === 32) {
                                signers.push(item);
                            } else if (typeof item === 'string' && /^[0-9a-fA-F]{64}$/.test(item.replace(/^0x/, ''))) {
                                signers.push(new Uint8Array(Buffer.from(item.replace(/^0x/, ''), 'hex')));
                            }
                        }
                    } else if (typeof userVal === 'string' && userVal.trim()) {
                        const parts = userVal.split(/[\s,]+/).map((s) => s.trim().replace(/^0x/, '')).filter(Boolean);
                        for (const part of parts) {
                            if (/^[0-9a-fA-F]{64}$/.test(part)) {
                                signers.push(new Uint8Array(Buffer.from(part, 'hex')));
                            }
                        }
                    }

                    // Ensure we have exactly vectorLen unique 32-byte elements
                    while (signers.length < vectorLen) {
                        const idx = signers.length + 1;
                        const uniqueBytes = crypto.createHash('sha256')
                            .update(activeContractSalt)
                            .update(`multisig:initial-signer:${idx}`)
                            .digest();
                        signers.push(new Uint8Array(uniqueBytes));
                    }
                    resolvedArgs.push(signers.slice(0, vectorLen));
                } else if (elemType.includes('Uint') || elemType.includes('Field')) {
                    let nums: bigint[] = [];
                    if (Array.isArray(userVal)) {
                        nums = userVal.map((v) => BigInt(v));
                    }
                    while (nums.length < vectorLen) {
                        nums.push(0n);
                    }
                    resolvedArgs.push(nums.slice(0, vectorLen));
                } else {
                    resolvedArgs.push(Array.isArray(userVal) ? userVal : []);
                }
            } else if (param.type === 'address' || param.compactType?.includes('Bytes') || param.description?.includes('Uint8Array')) {
                const isOwnerOrAuthParam = param.name.toLowerCase().includes('owner') ||
                    param.name.toLowerCase().includes('admin') ||
                    param.name.toLowerCase().includes('seller') ||
                    param.label?.toLowerCase().includes('owner') ||
                    param.description?.toLowerCase().includes('owner') ||
                    cleanName.toLowerCase().includes('owner');

                const isDeployerKeyword = !userVal || userVal === 'deployer' || userVal === 'auto';
                const isDeployerWalletMatch = typeof userVal === 'string' && (
                    userVal.toLowerCase().replace(/^0x/, '') === deployerUnshieldedHex ||
                    userVal.toLowerCase() === deployerBech32
                );

                if (isOwnerOrAuthParam && (isDeployerKeyword || isDeployerWalletMatch)) {
                    const derived = deriveAccountForContract(ContractClass, deployerKeyBytes, activeContractSalt);
                    resolvedArgs.push(derived);
                    derivedOwner = Buffer.from(derived).toString('hex');
                } else if (userVal instanceof Uint8Array && userVal.length === 32) {
                    if (isOwnerOrAuthParam) {
                        const derived = deriveAccountForContract(ContractClass, userVal, activeContractSalt);
                        resolvedArgs.push(derived);
                        derivedOwner = Buffer.from(derived).toString('hex');
                    } else {
                        resolvedArgs.push(userVal);
                    }
                } else if (typeof userVal === 'string' && userVal.trim() && !isDeployerKeyword) {
                    const val = userVal.trim();
                    let targetKeyBytes: Uint8Array;
                    if (val.startsWith('derive:')) {
                        const customSkHex = val.replace('derive:', '').replace(/^0x/, '');
                        targetKeyBytes = customSkHex.length === 64
                            ? new Uint8Array(Buffer.from(customSkHex, 'hex'))
                            : deployerKeyBytes;
                    } else if (val.startsWith('mn_') || val.startsWith('midnight')) {
                        try {
                            const decoded = MidnightBech32m.parse(val).decode(UnshieldedAddress, getNetworkId());
                            targetKeyBytes = new Uint8Array(decoded.data);
                        } catch {
                            throw new InvalidInputError(`Invalid Midnight Bech32 address: ${val}`);
                        }
                    } else {
                        const cleanHex = val.replace(/^0x/, '');
                        if (/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
                            targetKeyBytes = new Uint8Array(Buffer.from(cleanHex, 'hex'));
                        } else {
                            throw new InvalidInputError(
                                `Constructor argument '${param.label}' must be a valid Midnight address (mn_addr_...), 32-byte hex string, or 'deployer'. Received: ${userVal}`
                            );
                        }
                    }

                    if (isOwnerOrAuthParam) {
                        const derived = deriveAccountForContract(ContractClass, targetKeyBytes, activeContractSalt);
                        resolvedArgs.push(derived);
                        derivedOwner = Buffer.from(derived).toString('hex');
                    } else {
                        resolvedArgs.push(targetKeyBytes);
                    }
                } else if (isOwnerOrAuthParam) {
                    const derived = deriveAccountForContract(ContractClass, deployerKeyBytes, activeContractSalt);
                    resolvedArgs.push(derived);
                    derivedOwner = Buffer.from(derived).toString('hex');
                } else {
                    resolvedArgs.push(deployerKeyBytes);
                }
            } else if (param.type === 'number' || param.compactType?.includes('Uint') || param.compactType?.includes('Field')) {
                const isThresholdParam = cleanName.toLowerCase().includes('threshold') || param.label?.toLowerCase().includes('threshold');
                if (typeof userVal === 'bigint') {
                    resolvedArgs.push(isThresholdParam && userVal <= 0n ? 2n : userVal);
                } else if (typeof userVal === 'number') {
                    const valBigInt = BigInt(userVal);
                    resolvedArgs.push(isThresholdParam && valBigInt <= 0n ? 2n : valBigInt);
                } else if (typeof userVal === 'string' && userVal.trim()) {
                    const parsed = BigInt(userVal.trim());
                    resolvedArgs.push(isThresholdParam && parsed <= 0n ? 2n : parsed);
                } else if (isThresholdParam) {
                    resolvedArgs.push(2n);
                } else if (cleanName.toLowerCase().includes('decimal')) {
                    resolvedArgs.push(6n);
                } else {
                    resolvedArgs.push(0n);
                }
            } else if (param.type === 'boolean') {
                resolvedArgs.push(Boolean(userVal));
            } else if (param.compactType?.startsWith('Maybe') || param.description?.startsWith('Maybe')) {
                if (typeof userVal === 'object' && userVal !== null && 'is_some' in userVal) {
                    resolvedArgs.push(userVal);
                } else if (typeof userVal === 'string' && userVal.trim().length > 0) {
                    resolvedArgs.push({ is_some: true, value: userVal.trim() });
                } else {
                    resolvedArgs.push({ is_some: false, value: '' });
                }
            } else {
                let defaultStr = '';
                if (cleanName.toLowerCase().includes('name') && (!userVal || typeof userVal !== 'string' || userVal.trim() === '')) {
                    defaultStr = 'Midnight Compact Token';
                } else if (cleanName.toLowerCase().includes('symbol') && (!userVal || typeof userVal !== 'string' || userVal.trim() === '')) {
                    defaultStr = 'MCT';
                }
                resolvedArgs.push(userVal !== undefined && userVal !== '' ? userVal : defaultStr);
            }
        }

        return { resolvedArgs, activeContractSalt, derivedOwner };
    }

    async prepareDeploy(options: PrepareDeployOptions): Promise<PreparedDeployData> {
        const contractType = options.contractType || 'hello-world';
        const password = options?.privateStatePassword?.trim() || MIDNIGHT_CONFIG.privateStatePassword;
        const startTime = Date.now();

        console.log(`[DeployAdapter] Preparing deployment for '${contractType}' with Lace/Extension...`);

        const effectiveSeed = options.seed?.trim() || process.env.WALLET_SEED?.trim() || process.env.MIDNIGHT_WALLET_SEED?.trim();
        let walletCtx: any = null;
        if (effectiveSeed) {
            try {
                walletCtx = await this.walletGateway.getOrCreateWalletContext(effectiveSeed);
            } catch (e) {
                console.warn('[DeployAdapter] Could not initialize wallet context from seed, using decoupled context:', e);
            }
        }
        if (!walletCtx) {
            const dummySeed = new Uint8Array(32);
            walletCtx = {
                shieldedSecretKeys: LedgerV8.ZswapSecretKeys.fromSeed(dummySeed),
                dustSecretKey: LedgerV8.DustSecretKey.fromSeed(dummySeed),
                unshieldedKeystore: {
                    getBech32Address: () => options.deployerAddress || 'mn_addr_preprod_decoupled',
                    getAddress: () => '00'.repeat(32),
                },
            };
        }

        const { compiledContract, zkConfigPath, ContractClass } = await this.getContractArtifacts(contractType, walletCtx);

        const { resolvedArgs, activeContractSalt } = this.resolveConstructorArgs(
            contractType,
            ContractClass,
            options?.constructorArgs,
            options?.deployerAddress,
            walletCtx
        );

        const providers = createProviders(walletCtx, {
            privateStatePassword: password,
            zkConfigPath,
            accountId: options.deployerAddress,
            shieldedCoinPublicKey: options.shieldedCoinPublicKey,
            shieldedEncryptionPublicKey: options.shieldedEncryptionPublicKey,
        });

        const signingKey = CompactRuntime.sampleSigningKey();
        console.log(`[DeployAdapter] Creating unproven deploy transaction for '${contractType}'...`);
        const unprovenDeployTxData = await createUnprovenDeployTx(providers as any, {
            compiledContract: compiledContract as any,
            args: resolvedArgs,
            signingKey,
            initialPrivateState: {},
        });

        const contractAddress = unprovenDeployTxData.public.contractAddress;
        console.log(`[DeployAdapter] Unproven deploy TX created. Target address: ${contractAddress}`);

        console.log(`[DeployAdapter] Generating ZK proofs on proof server for '${contractType}'...`);
        const proofStartTime = Date.now();
        const provenTx = await providers.proofProvider.proveTx(unprovenDeployTxData.private.unprovenTx);
        console.log(`[DeployAdapter] ZK proof generated in ${Date.now() - proofStartTime}ms!`);

        const unsealedTxHex = Buffer.from(provenTx.serialize()).toString('hex');

        try {
            providers.privateStateProvider.setContractAddress(contractAddress);
            await providers.privateStateProvider.set(`${contractType}State`, unprovenDeployTxData.private.initialPrivateState);
            await providers.privateStateProvider.setSigningKey(contractAddress, unprovenDeployTxData.private.signingKey);
        } catch (storageErr) {
            console.warn('[DeployAdapter] Warning: failed to store initial private state:', storageErr);
        }

        const hasNonZeroSalt = activeContractSalt && !activeContractSalt.every(b => b === 0);
        const contractSalt = hasNonZeroSalt ? Buffer.from(activeContractSalt).toString('hex') : undefined;

        const durationMs = Date.now() - startTime;
        console.log(`[DeployAdapter] Deployment prepared in ${durationMs}ms. Ready for Lace signature and fee balancing.`);

        return {
            unsealedTxHex,
            contractAddress,
            contractSalt,
            contractType,
            durationMs,
        };
    }

    async recordDeployment(options: RecordDeploymentOptions): Promise<DeploymentExecutionReceipt> {
        const {
            contractAddress,
            contractType,
            txHash,
            blockHeight,
            deployerAddress,
            contractSalt,
            owner,
            dustPaid = '0',
            durationMs = 0,
        } = options;

        await this.deploymentStorage.saveDeployment({
            contractAddress,
            contractType,
            deployedAt: new Date().toISOString(),
            deployerAddress,
            ...(owner ? { owner } : {}),
            ...(contractSalt ? { contractSalt } : {}),
        });

        if (this.txHistoryStorage) {
            try {
                await this.txHistoryStorage.storeTxRecord({
                    id: `deploy-${Date.now()}`,
                    txHash: txHash || `deploy-${contractAddress.slice(0, 16)}`,
                    contractAddress,
                    contractType,
                    txType: 'contract_deploy',
                    blockHeight: blockHeight ?? null,
                    message: `Contract Deployed: ${contractAddress.slice(0, 10)}... (via Lace)`,
                    timestamp: new Date().toISOString(),
                    dustPaid,
                    durationMs,
                });
            } catch (e) {
                console.warn('Failed to persist deploy tx record:', e);
            }
        }

        return {
            success: true,
            contractAddress,
            contractType,
            txHash,
            blockHeight: blockHeight ?? null,
            dustPaid,
            durationMs,
            network: MIDNIGHT_CONFIG.networkId,
            deployedAt: new Date().toISOString(),
        };
    }

    async getContractState(contractAddress?: string): Promise<ContractMessageSnapshot> {
        const deployment = await this.deploymentStorage.getDeployment(contractAddress);
        const targetAddress = contractAddress || deployment?.contractAddress;
        if (!targetAddress) {
            throw new ContractNotFoundError();
        }

        const contractType = (deployment as any)?.contractType || 'hello-world';
        const artifacts = await this.getContractArtifacts(contractType);
        const publicDataProvider = indexerPublicDataProvider(MIDNIGHT_CONFIG.indexer, MIDNIGHT_CONFIG.indexerWS);
        const state = await publicDataProvider.queryContractState(targetAddress);

        if (!state) {
            return {
                contractAddress: targetAddress,
                found: false,
                message: '',
                raw: null,
                lastChecked: new Date().toISOString(),
            };
        }

        const ledgerFn = artifacts.contractModule?.ledger || artifacts.contractModule?.default?.ledger;
        let message = '';
        let decodedLedger: Record<string, any> | null = null;

        if (ledgerFn) {
            try {
                const ledgerState = ledgerFn(state.data);
                if (ledgerState) {
                    decodedLedger = {};
                    // Extract message property
                    if (typeof ledgerState.message === 'string') {
                        message = ledgerState.message;
                        decodedLedger.message = ledgerState.message;
                    } else if (ledgerState.message?.value) {
                        message = String(ledgerState.message.value);
                        decodedLedger.message = message;
                    }

                    // Extract any other ledger properties (e.g. sequence, state, owner)
                    const protoProps = Object.getOwnPropertyNames(Object.getPrototypeOf(ledgerState) || {});
                    const ownProps = Object.keys(ledgerState);
                    const allKeys = Array.from(new Set([...ownProps, ...protoProps]));

                    for (const key of allKeys) {
                        if (key === 'constructor') continue;
                        try {
                            const val = (ledgerState as any)[key];
                            if (val !== undefined && typeof val !== 'function') {
                                if (typeof val === 'bigint') {
                                    decodedLedger[key] = val.toString();
                                } else if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
                                    decodedLedger[key] = Buffer.from(val).toString('hex');
                                } else {
                                    decodedLedger[key] = val;
                                }
                                if (key === 'message' && !message && typeof val === 'string') {
                                    message = val;
                                }
                            }
                        } catch { }
                    }
                }
            } catch (e) {
                console.warn('Error extracting ledger message from on-chain state:', e);
            }
        }

        return {
            contractAddress: targetAddress,
            found: true,
            message,
            raw: decodedLedger || { contractStateFound: true },
            lastChecked: new Date().toISOString(),
        };
    }

    async broadcastTransaction(balancedTxHex: string): Promise<{ txHash: string }> {
        if (!balancedTxHex || typeof balancedTxHex !== 'string') {
            throw new Error('balancedTxHex string is required for broadcast.');
        }

        const cleanHex = balancedTxHex.replace(/^0x/, '').trim();
        const bytes = new Uint8Array(Buffer.from(cleanHex, 'hex'));
        const { Transaction } = await import('@midnight-ntwrk/ledger-v8');
        const txObj = Transaction.deserialize('signature', 'proof', 'binding', bytes);
        const txIds = txObj.identifiers();
        const txHash = txIds && txIds.length > 0 ? txIds[0] : String(txObj.transactionHash());

        console.log(`[DeployAdapter] Broadcasting pre-balanced transaction ${txHash} to Midnight node RPC...`);

        const effectiveSeed = process.env.WALLET_SEED?.trim() || process.env.MIDNIGHT_WALLET_SEED?.trim() || 'bfddeea52c8e16ebc8b278f4bb5a76604982046d690e7c6f3139831c6888861d';
        const walletCtx = await this.walletGateway.getOrCreateWalletContext(effectiveSeed);

        try {
            const submittedId = await walletCtx.wallet.submitTransaction(txObj);
            const finalHash = typeof submittedId === 'string' ? submittedId : (submittedId?.toString?.() || txHash);
            console.log(`[DeployAdapter] Pre-balanced transaction accepted by node! ID: ${finalHash}`);
            return { txHash: finalHash };
        } catch (err: any) {
            const errMsg = err?.message || String(err);
            console.error('[DeployAdapter] Error broadcasting pre-balanced transaction to node:', err);
            if (errMsg.includes('170') || errMsg.includes('InvalidDustSpendProof')) {
                throw new Error(
                    'Substrate Node Error 170 (InvalidDustSpendProof): The transaction was rejected because your Lace wallet internal DUST Merkle tree is out of sync with the Preprod network. Please resync or reset your Lace extension wallet.'
                );
            }
            if (errMsg.includes('171') || errMsg.includes('OutOfDustValidityWindow')) {
                throw new Error(
                    'Substrate Node Error 171 (OutOfDustValidityWindow): The transaction expired before reaching the node. Please re-submit.'
                );
            }
            throw new Error(`Node rejected transaction: ${errMsg}`);
        }
    }
}

