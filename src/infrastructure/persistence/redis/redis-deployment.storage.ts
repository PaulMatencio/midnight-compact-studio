/**
 * RedisJSON Deployment Storage Adapter
 * Persists and retrieves multiple contract deployment records using Redis Stack JSON documents.
 */

import type { IDeploymentStorage } from '@/src/domain/ports/i-deployment.storage';
import type { ContractDeploymentRecord } from '@/src/domain/entities/contract.entity';
import type { DeployedContractRecord } from '@/src/domain/entities/contract-registry.entity';
import { STORAGE_CONFIG } from '../../config/storage.config';
import { getRedisClient } from './redis-client.factory';

export class RedisDeploymentStorage implements IDeploymentStorage {
    private readonly listKey: string;

    constructor(customKey?: string) {
        this.listKey = customKey || `${STORAGE_CONFIG.redis.keyPrefix}contracts:list`;
    }

    async getDeployments(): Promise<DeployedContractRecord[]> {
        try {
            const client = await getRedisClient();
            const data = await client.json.get(this.listKey);
            if (Array.isArray(data)) {
                return (data as any[]).map((item) => ({
                    contractAddress: item.contractAddress,
                    contractType: item.contractType || 'hello-world',
                    nickname: item.nickname,
                    deployerSeed: item.deployerSeed || item.seed,
                    seed: item.deployerSeed || item.seed,
                    network: item.network || 'preprod',
                    deployedAt: item.deployedAt || new Date().toISOString(),
                    owner: item.owner,
                }));
            }
            if (data && typeof data === 'object' && (data as any).contractAddress) {
                const item = data as any;
                return [
                    {
                        contractAddress: item.contractAddress,
                        contractType: item.contractType || 'hello-world',
                        nickname: item.nickname,
                        deployerSeed: item.deployerSeed || item.seed,
                        seed: item.deployerSeed || item.seed,
                        network: item.network || 'preprod',
                        deployedAt: item.deployedAt || new Date().toISOString(),
                        owner: item.owner,
                    },
                ];
            }
            return [];
        } catch (err) {
            console.error('[RedisDeploymentStorage] Failed to get deployments list:', err);
            return [];
        }
    }

    async getDeployment(contractAddress?: string): Promise<ContractDeploymentRecord | null> {
        try {
            const deployments = await this.getDeployments();
            if (deployments.length === 0) return null;

            if (contractAddress) {
                return deployments.find((d) => d.contractAddress.toLowerCase() === contractAddress.toLowerCase()) || null;
            }

            return deployments[0] || null;
        } catch (err) {
            console.error('[RedisDeploymentStorage] Failed to get deployment:', err);
            return null;
        }
    }

    async saveDeployment(record: ContractDeploymentRecord | DeployedContractRecord): Promise<void> {
        try {
            const client = await getRedisClient();
            const deployments = await this.getDeployments();

            const normalized: DeployedContractRecord = {
                contractAddress: record.contractAddress,
                contractType: (record as any).contractType || 'hello-world',
                nickname: (record as any).nickname,
                deployerSeed: record.deployerSeed || (record as any).seed,
                network: record.network || 'preprod',
                deployedAt: record.deployedAt || new Date().toISOString(),
                owner: (record as any).owner,
            };

            const filtered = deployments.filter((d) => d.contractAddress.toLowerCase() !== normalized.contractAddress.toLowerCase());
            const updated = [normalized, ...filtered];

            await client.json.set(this.listKey, '$', updated as any);
        } catch (err) {
            console.error('[RedisDeploymentStorage] Failed to save deployment:', err);
        }
    }

    async deleteDeployment(contractAddress: string): Promise<void> {
        try {
            const client = await getRedisClient();
            const deployments = await this.getDeployments();
            const updated = deployments.filter((d) => d.contractAddress.toLowerCase() !== contractAddress.toLowerCase());
            await client.json.set(this.listKey, '$', updated as any);
        } catch (err) {
            console.error('[RedisDeploymentStorage] Failed to delete deployment:', err);
        }
    }
}
