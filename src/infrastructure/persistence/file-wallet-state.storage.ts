/**
 * Persistent File Wallet State Storage
 * Persists serialized Shielded and DUST wallet state to disk atomically in wallet-serialized-state.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IWalletStateStorage, SerializedWalletState } from '@/src/domain/ports/i-wallet-state.storage';

export class FileWalletStateStorage implements IWalletStateStorage {
    private readonly filePath: string;
    private cache: Record<string, SerializedWalletState> | null = null;
    private writeLock: Promise<void> = Promise.resolve();
    private pendingFlush = false;

    constructor(filePath?: string) {
        this.filePath = filePath || path.resolve(process.cwd(), 'wallet-serialized-state.json');
    }

    private async readAll(): Promise<Record<string, SerializedWalletState>> {
        if (this.cache !== null) {
            return this.cache;
        }
        try {
            if (!fs.existsSync(this.filePath)) {
                this.cache = {};
                return this.cache;
            }
            const data = await fs.promises.readFile(this.filePath, 'utf-8');
            const parsed = JSON.parse(data);
            const valid: Record<string, SerializedWalletState> = typeof parsed === 'object' && parsed !== null ? parsed : {};
            this.cache = valid;
            return valid;
        } catch {
            this.cache = {};
            return this.cache;
        }
    }

    async loadState(walletId: string): Promise<SerializedWalletState | null> {
        const all = await this.readAll();
        return all[walletId] || null;
    }

    async saveState(walletId: string, state: SerializedWalletState): Promise<void> {
        const all = await this.readAll();
        all[walletId] = state;

        if (this.pendingFlush) {
            return this.writeLock;
        }
        this.pendingFlush = true;

        this.writeLock = this.writeLock.then(async () => {
            this.pendingFlush = false;
            try {
                const tempPath = `${this.filePath}.tmp.${Date.now()}`;
                // Compact JSON serialization without multi-megabyte whitespace formatting
                await fs.promises.writeFile(tempPath, JSON.stringify(this.cache || {}), 'utf-8');
                await fs.promises.rename(tempPath, this.filePath);
            } catch (e) {
                console.warn('Failed to atomically save wallet serialized state:', e);
            }
        });
        return this.writeLock;
    }

    async clearState(walletId: string): Promise<void> {
        const all = await this.readAll();
        delete all[walletId];

        this.writeLock = this.writeLock.then(async () => {
            try {
                const tempPath = `${this.filePath}.tmp.${Date.now()}`;
                await fs.promises.writeFile(tempPath, JSON.stringify(this.cache || {}), 'utf-8');
                await fs.promises.rename(tempPath, this.filePath);
            } catch (e) {
                console.warn('Failed to atomically clear wallet serialized state:', e);
            }
        });
        return this.writeLock;
    }
}
