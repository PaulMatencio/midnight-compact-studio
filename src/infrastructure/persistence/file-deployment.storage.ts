import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IDeploymentStorage } from '@/src/domain/ports/i-deployment.storage';
import type { ContractDeploymentRecord } from '@/src/domain/entities/contract.entity';
import type { DeployedContractRecord } from '@/src/domain/entities/contract-registry.entity';

export class FileDeploymentStorage implements IDeploymentStorage {
    private readonly filePath: string;

    constructor(customPath?: string) {
        this.filePath = customPath || path.resolve(process.cwd(), 'deployment.json');
    }

    private readRaw(): any {
        if (!fs.existsSync(this.filePath)) {
            return null;
        }
        try {
            return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        } catch {
            return null;
        }
    }

    async getDeployments(): Promise<DeployedContractRecord[]> {
        const raw = this.readRaw();
        if (!raw) return [];

        if (Array.isArray(raw)) {
            return raw.map((item) => ({
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

        if (typeof raw === 'object' && raw.contractAddress) {
            return [
                {
                    contractAddress: raw.contractAddress,
                    contractType: raw.contractType || 'hello-world',
                    nickname: raw.nickname,
                    deployerSeed: raw.deployerSeed || raw.seed,
                    seed: raw.deployerSeed || raw.seed,
                    network: raw.network || 'preprod',
                    deployedAt: raw.deployedAt || new Date().toISOString(),
                    owner: raw.owner,
                },
            ];
        }

        return [];
    }

    async getDeployment(contractAddress?: string): Promise<ContractDeploymentRecord | null> {
        const deployments = await this.getDeployments();
        if (deployments.length === 0) return null;

        if (contractAddress) {
            const found = deployments.find((d) => d.contractAddress.toLowerCase() === contractAddress.toLowerCase());
            return found || null;
        }

        // Return the most recent deployment
        return deployments[0] || null;
    }

    async saveDeployment(record: ContractDeploymentRecord | DeployedContractRecord): Promise<void> {
        try {
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

            const tempPath = `${this.filePath}.tmp.${Date.now()}`;
            await fs.promises.writeFile(tempPath, JSON.stringify(updated, null, 2), 'utf-8');
            await fs.promises.rename(tempPath, this.filePath);
        } catch (err) {
            console.error('Failed to save deployment.json:', err);
        }
    }

    async deleteDeployment(contractAddress: string): Promise<void> {
        try {
            const deployments = await this.getDeployments();
            const updated = deployments.filter((d) => d.contractAddress.toLowerCase() !== contractAddress.toLowerCase());

            const tempPath = `${this.filePath}.tmp.${Date.now()}`;
            await fs.promises.writeFile(tempPath, JSON.stringify(updated, null, 2), 'utf-8');
            await fs.promises.rename(tempPath, this.filePath);
        } catch (err) {
            console.error('Failed to delete deployment from deployment.json:', err);
        }
    }
}
