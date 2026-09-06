import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findDeployedContract, deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { IContractGateway, DeployContractOptions } from '@/src/domain/ports/i-contract.gateway';
import type { IWalletGateway } from '@/src/domain/ports/i-wallet.gateway';
import type { IDeploymentStorage } from '@/src/domain/ports/i-deployment.storage';
import { parseContractConstructorParams } from '@/src/infrastructure/contracts/contract-inspector.server';
import type {
    TransactionExecutionReceipt,
    DeploymentExecutionReceipt,
    ContractMessageSnapshot,
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
import * as OnchainRuntimeV3 from '@midnight-ntwrk/onchain-runtime-v3';
import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';

// Guard global Reflect.get against wasm-bindgen non-object property lookups
if (typeof globalThis.Reflect?.get === 'function') {
    const originalReflectGet = globalThis.Reflect.get;
    if (!(originalReflectGet as any).__isSafeWasmReflectGet) {
        const safeReflectGet = function (target: any, propertyKey: PropertyKey, receiver?: any) {
            if (target === undefined || target === null || (typeof target !== 'object' && typeof target !== 'function')) {
                return undefined;
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
                if (walletCtx?.shieldedSecretKeys?.coinPublicKey) {
                    sk = crypto.createHash('sha256').update(walletCtx.shieldedSecretKeys.coinPublicKey).digest();
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

export class MidnightContractAdapter implements IContractGateway {
    private compiledContractCache: any = null;

    constructor(
        private readonly walletGateway: IWalletGateway,
        private readonly deploymentStorage: IDeploymentStorage,
        private readonly txHistoryStorage?: FileTransactionHistoryStorage,
    ) {}

    async getContractArtifacts(contractType: string = 'hello-world', walletCtx?: any) {
        const zkConfigPath = path.resolve(process.cwd(), 'contracts', 'managed', contractType);
        const contractJsPath = path.join(zkConfigPath, 'contract', 'index.js');
        
        if (!fs.existsSync(contractJsPath)) {
            throw new Error(`Compiled contract artifacts not found at contracts/managed/${contractType}. Please compile the contract first in the IDE.`);
        }

        const contractUrl = pathToFileURL(contractJsPath).href;
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
        if (!status.isSynced) {
            throw new WalletNotSyncedError(status.syncProgress?.percentage);
        }

        const currentDust = BigInt(status.dustBalance || '0');
        if (currentDust === 0n) {
            throw new InsufficientDustError();
        }

        const walletCtx = await this.walletGateway.getOrCreateWalletContext(seed);
        await walletCtx.wallet.waitForSyncedState();

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
        const tx = await circuitFn(...args);
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
        if (!status.isSynced) {
            throw new WalletNotSyncedError(status.syncProgress?.percentage);
        }

        const currentDust = BigInt(status.dustBalance || '0');
        if (currentDust === 0n) {
            throw new InsufficientDustError();
        }

        const walletCtx = await this.walletGateway.getOrCreateWalletContext(seed);
        await walletCtx.wallet.waitForSyncedState();

        const { compiledContract, zkConfigPath } = await this.getContractArtifacts(contractType, walletCtx);

        const providers = createProviders(walletCtx, {
            privateStatePassword: password,
            zkConfigPath,
        });

        // Resolve constructor arguments for the target contract
        const constructorParams = parseContractConstructorParams(contractType);
        const resolvedArgs: any[] = [];
        const userArgs = options?.constructorArgs;

        for (let i = 0; i < constructorParams.length; i++) {
            const param = constructorParams[i];
            const cleanName = param.name.replace(/^_+/, '');
            let userVal: any = undefined;

            if (Array.isArray(userArgs)) {
                userVal = userArgs[i];
            } else if (userArgs && typeof userArgs === 'object') {
                userVal = userArgs[param.name] ?? userArgs[cleanName];
            }

            if (param.type === 'address' || param.compactType?.includes('Bytes') || param.description?.includes('Uint8Array')) {
                if (userVal instanceof Uint8Array && userVal.length === 32) {
                    resolvedArgs.push(userVal);
                } else if (typeof userVal === 'string' && userVal.trim() && userVal !== 'deployer') {
                    const cleanHex = userVal.trim().replace(/^0x/, '');
                    if (/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
                        resolvedArgs.push(new Uint8Array(Buffer.from(cleanHex, 'hex')));
                    } else {
                        throw new InvalidInputError(
                            `Constructor argument '${param.label}' must be a 32-byte hex string (64 characters). Received: ${userVal}`
                        );
                    }
                } else {
                    // Default to deployer's coinPublicKey (32 bytes)
                    if (walletCtx?.shieldedSecretKeys?.coinPublicKey) {
                        resolvedArgs.push(new Uint8Array(walletCtx.shieldedSecretKeys.coinPublicKey));
                    } else {
                        resolvedArgs.push(new Uint8Array(crypto.randomBytes(32)));
                    }
                }
            } else if (param.type === 'number' || param.compactType?.includes('Uint') || param.compactType?.includes('Field')) {
                if (typeof userVal === 'bigint') {
                    resolvedArgs.push(userVal);
                } else if (typeof userVal === 'number') {
                    resolvedArgs.push(BigInt(userVal));
                } else if (typeof userVal === 'string' && userVal.trim()) {
                    resolvedArgs.push(BigInt(userVal.trim()));
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
                resolvedArgs.push(userVal !== undefined ? userVal : '');
            }
        }

        const startTime = Date.now();
        const deployed = await deployContract(providers as any, {
            compiledContract: compiledContract as any,
            args: resolvedArgs,
            privateStateId: `${contractType}State`,
            initialPrivateState: {},
        });

        const deployPublicData = deployed.deployTxData.public as any;
        const contractAddress = deployPublicData.contractAddress;
        const txHash = deployPublicData.txHash || deployPublicData.txId || null;
        const blockHeight = typeof deployPublicData.blockHeight === 'number' ? deployPublicData.blockHeight : null;
        const durationMs = Date.now() - startTime;
        const dustPaid = walletCtx.lastDustFee ? walletCtx.lastDustFee.toString() : '0';

        await this.deploymentStorage.saveDeployment({
            contractAddress,
            contractType,
            deployerSeed: seed.trim(),
            deployedAt: new Date().toISOString(),
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
                                decodedLedger[key] = val;
                                if (key === 'message' && !message && typeof val === 'string') {
                                    message = val;
                                }
                            }
                        } catch {}
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
}

