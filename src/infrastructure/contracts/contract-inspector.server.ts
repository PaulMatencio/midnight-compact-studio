import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CircuitParamDescriptor } from '@/src/domain/entities/contract-registry.entity';
import { getCleanContractBaseName } from '@/src/lib/contract-utils';

/**
 * Server-only utility to inspect a managed contract's TypeScript definitions and Compact source
 * to extract constructor parameter metadata for deployment.
 */
export function parseContractConstructorParams(contractName: string): CircuitParamDescriptor[] {
    const cleanName = getCleanContractBaseName(contractName);
    const managedDir = path.resolve(process.cwd(), 'contracts', 'managed');

    // Find matching directory in contracts/managed
    let targetDir = path.join(managedDir, cleanName);
    if (!fs.existsSync(targetDir) && fs.existsSync(managedDir)) {
        const candidates = fs.readdirSync(managedDir);
        const match = candidates.find(
            (c) => c.toLowerCase() === cleanName.toLowerCase() || c.toLowerCase() === contractName.toLowerCase()
        );
        if (match) {
            targetDir = path.join(managedDir, match);
        }
    }

    const dtsPath = path.join(targetDir, 'contract', 'index.d.ts');
    if (!fs.existsSync(dtsPath)) return [];

    const dtsContent = fs.readFileSync(dtsPath, 'utf8');
    const initMatch = dtsContent.match(/initialState\(([^)]*)\)/s);
    if (!initMatch) return [];

    const raw = initMatch[1].trim();
    // Split parameters by comma followed by newline or space
    const parts = raw.split(/,\s*\n/).map((s) => s.trim()).filter(Boolean);
    if (parts.length <= 1) return [];

    // Attempt to extract Compact types from .compact source file
    const compactCandidates = [
        path.resolve(process.cwd(), 'contracts', `${cleanName}.compact`),
        path.resolve(process.cwd(), 'contracts', `${contractName}.compact`),
        path.resolve(process.cwd(), 'contracts', `${cleanName.replace(/-v\d+$/, '')}.compact`),
    ];

    const compactTypes: Record<string, string> = {};
    for (const cPath of compactCandidates) {
        if (fs.existsSync(cPath)) {
            const cSrc = fs.readFileSync(cPath, 'utf8');
            const cMatch = cSrc.match(/constructor\s*\(([^)]*)\)/s);
            if (cMatch) {
                cMatch[1].split(',').forEach((p) => {
                    const [pn, pt] = p.split(':').map((s) => s.trim());
                    if (pn && pt) {
                        compactTypes[pn] = pt;
                        compactTypes[pn.replace(/^_+/, '')] = pt;
                    }
                });
            }
            break;
        }
    }

    const descriptors: CircuitParamDescriptor[] = [];
    for (let i = 1; i < parts.length; i++) {
        const paramStr = parts[i];
        const match = paramStr.match(/^([a-zA-Z0-9_]+?)(?:_\d+)?\s*:\s*(.+)$/);
        if (!match) continue;

        const rawParamName = match[1];
        const strippedName = rawParamName.replace(/^_+/, '');
        const tsType = match[2].trim();
        const compactType =
            compactTypes[rawParamName] ||
            compactTypes[strippedName] ||
            (tsType === 'Uint8Array' ? 'Bytes<32>' : tsType === 'bigint' ? 'Uint' : tsType);

        let type: 'string' | 'number' | 'boolean' | 'address' = 'string';
        let defaultValue: any = '';

        if (tsType === 'Uint8Array' || compactType.includes('Bytes')) {
            type = 'address';
            defaultValue = 'deployer';
        } else if (tsType === 'bigint' || compactType.includes('Uint') || compactType.includes('Field')) {
            type = 'number';
            defaultValue = '0';
        } else if (tsType === 'boolean') {
            type = 'boolean';
            defaultValue = 'false';
        }

        const label = strippedName
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (str) => str.toUpperCase())
            .trim();

        descriptors.push({
            name: rawParamName,
            type,
            compactType,
            label,
            description: compactType,
            placeholder:
                type === 'address'
                    ? '32-byte hex or leave empty for deployer key'
                    : type === 'number'
                    ? '0'
                    : '',
            defaultValue,
            required: type !== 'boolean' && !compactType.startsWith('Maybe'),
        });
    }

    return descriptors;
}
