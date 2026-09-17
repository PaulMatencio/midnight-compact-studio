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

function splitTopLevelCommas(str: string): string[] {
    const result: string[] = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '<' || char === '(' || char === '[' || char === '{') depth++;
        else if (char === '>' || char === ')' || char === ']' || char === '}') depth--;

        if (char === ',' && depth === 0) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    if (current.trim()) {
        result.push(current.trim());
    }
    return result;
}

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
                splitTopLevelCommas(cMatch[1]).forEach((p) => {
                    const colonIdx = p.indexOf(':');
                    if (colonIdx !== -1) {
                        const pn = p.slice(0, colonIdx).trim();
                        const pt = p.slice(colonIdx + 1).trim();
                        if (pn && pt) {
                            compactTypes[pn] = pt;
                            compactTypes[pn.replace(/^_+/, '')] = pt;
                        }
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

        const isSaltParam = strippedName.toLowerCase().includes('salt') || rawParamName.toLowerCase().includes('salt');
        const isVectorParam = compactType.startsWith('Vector') || tsType.endsWith('[]');
        const isThresholdParam = strippedName.toLowerCase().includes('threshold') || rawParamName.toLowerCase().includes('threshold');
        const isDecimalParam = strippedName.toLowerCase().includes('decimal') || rawParamName.toLowerCase().includes('decimal');
        const isNameParam = strippedName.toLowerCase().includes('name') || rawParamName.toLowerCase().includes('name');
        const isSymbolParam = strippedName.toLowerCase().includes('symbol') || rawParamName.toLowerCase().includes('symbol');

        if (isSaltParam) {
            type = 'string';
            defaultValue = '';
        } else if (isVectorParam) {
            type = 'string';
            defaultValue = '';
        } else if (tsType === 'Uint8Array' || compactType.includes('Bytes')) {
            type = 'address';
            defaultValue = 'deployer';
        } else if (tsType === 'bigint' || compactType.includes('Uint') || compactType.includes('Field')) {
            type = 'number';
            defaultValue = isThresholdParam ? '2' : isDecimalParam ? '6' : '0';
        } else if (tsType === 'boolean') {
            type = 'boolean';
            defaultValue = 'false';
        } else {
            type = 'string';
            defaultValue = isNameParam ? 'Midnight Compact Token' : isSymbolParam ? 'MCT' : '';
        }

        const label = strippedName
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (str) => str.toUpperCase())
            .trim();

        const placeholder = isSaltParam
            ? 'Leave empty for auto-generated cryptographic salt (or 32-byte hex)'
            : isVectorParam
            ? 'Comma-separated 32-byte hex signer commitments (or leave empty for auto-generated signers)'
            : type === 'address'
            ? '32-byte hex or leave empty for deployer key'
            : type === 'number'
            ? (isThresholdParam ? '2' : isDecimalParam ? '6' : '0')
            : isNameParam
            ? 'e.g. Midnight Compact Token'
            : isSymbolParam
            ? 'e.g. MCT'
            : '';

        descriptors.push({
            name: rawParamName,
            type,
            compactType,
            label,
            description: compactType,
            placeholder,
            defaultValue,
            required: !isSaltParam && !isVectorParam && type !== 'boolean' && !compactType.startsWith('Maybe'),
        });
    }

    return descriptors;
}
