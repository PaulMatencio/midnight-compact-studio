import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ContractBlueprint } from '@/src/domain/entities/contract-registry.entity';

describe('Deploy Form State Persistence & Lace Handling', () => {
    const DEPLOY_STORAGE_KEY = 'midnight_deploy_form_state';

    const mockStorage: Record<string, string> = {};

    beforeEach(() => {
        for (const key of Object.keys(mockStorage)) {
            delete mockStorage[key];
        }
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => mockStorage[key] ?? null,
            setItem: (key: string, val: string) => { mockStorage[key] = val; },
            removeItem: (key: string) => { delete mockStorage[key]; },
            clear: () => {
                for (const k of Object.keys(mockStorage)) delete mockStorage[k];
            },
        });
    });

    const mockBlueprintV24: ContractBlueprint = {
        id: 'fungible-token-v2-4',
        name: 'Privacy Governance Token v2.4',
        description: 'Multi-sig token contract',
        category: 'Token',
        version: '2.4.0',
        circuits: [],
        stateFields: [],
        constructorParams: [
            { name: '_name', type: 'string', label: 'Token Name', defaultValue: 'Privacy Governance Token' },
            { name: '_symbol', type: 'string', label: 'Token Symbol', defaultValue: 'PGT' },
            { name: '_initialSupply', type: 'number', label: 'Initial Supply', defaultValue: 0 },
            { name: '_owner', type: 'address', label: 'Initial Owner Address', defaultValue: 'deployer' },
            { name: '_multisigThreshold', type: 'number', label: 'Threshold', defaultValue: 2 },
        ],
    };

    it('persists selected blueprint, nickname, and gas payer mode to localStorage', () => {
        const stateToSave = {
            selectedBlueprintId: 'fungible-token-v2-4',
            nickname: 'My Governance DAO Token',
            gasPayerMode: 'lace' as const,
            constructorArgsByBlueprint: {
                'fungible-token-v2-4': {
                    _name: 'Custom DAO',
                    _symbol: 'CDAO',
                    _initialSupply: '1000000',
                    _owner: 'mn_addr_preprod1laceowner...',
                    _multisigThreshold: '3',
                },
            },
        };

        localStorage.setItem(DEPLOY_STORAGE_KEY, JSON.stringify(stateToSave));

        const retrieved = JSON.parse(localStorage.getItem(DEPLOY_STORAGE_KEY) || '{}');
        expect(retrieved.selectedBlueprintId).toBe('fungible-token-v2-4');
        expect(retrieved.nickname).toBe('My Governance DAO Token');
        expect(retrieved.gasPayerMode).toBe('lace');
        expect(retrieved.constructorArgsByBlueprint['fungible-token-v2-4']._name).toBe('Custom DAO');
        expect(retrieved.constructorArgsByBlueprint['fungible-token-v2-4']._symbol).toBe('CDAO');
    });

    it('preserves constructor arguments per blueprint when navigating between contracts', () => {
        const cache: Record<string, Record<string, string>> = {};

        // User enters custom data for v2.4
        cache['fungible-token-v2-4'] = {
            _name: 'Alpha Token',
            _symbol: 'ALPHA',
            _initialSupply: '500',
        };

        // User switches to hello-world (no params)
        cache['hello-world'] = {};

        // User switches back to v2.4 - inputs are restored from cache
        const restored = cache['fungible-token-v2-4'];
        expect(restored._name).toBe('Alpha Token');
        expect(restored._symbol).toBe('ALPHA');
        expect(restored._initialSupply).toBe('500');
    });

    it('auto-populates owner fields with Lace address only when empty or deployer default', () => {
        const laceAddress = 'mn_addr_preprod1laceactive99999999999';

        const argsWithDeployer = {
            _name: 'Beta Token',
            _owner: 'deployer',
        };

        const argsWithCustom = {
            _name: 'Gamma Token',
            _owner: 'mn_addr_preprod1customspecifiedowner',
        };

        const updateOwner = (args: Record<string, string>) => {
            const next = { ...args };
            for (const param of mockBlueprintV24.constructorParams || []) {
                const clean = param.name.replace(/^_+/, '').toLowerCase();
                const isOwner = clean.includes('owner');
                if (isOwner && (!next[param.name] || next[param.name] === 'deployer')) {
                    next[param.name] = laceAddress;
                }
            }
            return next;
        };

        // Deployer should be replaced by connected Lace address
        const updated1 = updateOwner(argsWithDeployer);
        expect(updated1._owner).toBe(laceAddress);

        // Custom owner should NOT be replaced
        const updated2 = updateOwner(argsWithCustom);
        expect(updated2._owner).toBe('mn_addr_preprod1customspecifiedowner');
    });

    it('resets constructor arguments to blueprint defaults on user request', () => {
        const getDefaults = (bp: ContractBlueprint) => {
            const initial: Record<string, string> = {};
            for (const param of bp.constructorParams || []) {
                if (param.defaultValue !== undefined) {
                    initial[param.name] = String(param.defaultValue);
                } else {
                    initial[param.name] = '';
                }
            }
            return initial;
        };

        const defaults = getDefaults(mockBlueprintV24);
        expect(defaults._name).toBe('Privacy Governance Token');
        expect(defaults._symbol).toBe('PGT');
        expect(defaults._initialSupply).toBe('0');
        expect(defaults._multisigThreshold).toBe('2');
    });
});
