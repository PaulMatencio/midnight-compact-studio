import * as fs from 'node:fs';
import * as path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { container } from '@/src/infrastructure/di/container';
import { CONTRACT_BLUEPRINTS } from '@/src/infrastructure/contracts/contract-registry';
import type { ContractBlueprint } from '@/src/domain/entities/contract-registry.entity';
import { parseContractConstructorParams } from '@/src/infrastructure/contracts/contract-inspector.server';

export const dynamic = 'force-dynamic';

function getAvailableManagedContracts(): ContractBlueprint[] {
    const blueprints: Record<string, ContractBlueprint> = {};
    for (const [key, bp] of Object.entries(CONTRACT_BLUEPRINTS)) {
        blueprints[key] = {
            ...bp,
            constructorParams: bp.constructorParams || parseContractConstructorParams(bp.id),
        };
    }

    const managedDir = path.resolve(process.cwd(), 'contracts', 'managed');

    try {
        if (fs.existsSync(managedDir)) {
            const entries = fs.readdirSync(managedDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const contractName = entry.name;
                    const contractJsPath = path.join(managedDir, contractName, 'contract', 'index.js');
                    if (fs.existsSync(contractJsPath) && !blueprints[contractName]) {
                        const constructorParams = parseContractConstructorParams(contractName);
                        blueprints[contractName] = {
                            id: contractName,
                            name: contractName.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
                            description: `Compiled Compact contract in contracts/managed/${contractName}`,
                            category: 'Utility',
                            version: '1.0.0',
                            constructorParams,
                            circuits: [],
                            stateFields: [],
                        };
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Error reading managed contracts directory:', e);
    }

    return Object.values(blueprints);
}

export async function GET() {
    try {
        const hasEnvPassword = Boolean(process.env.PRIVATE_STATE_PASSWORD && process.env.PRIVATE_STATE_PASSWORD.trim().length >= 16);
        const availableContracts = getAvailableManagedContracts();

        return NextResponse.json({
            success: true,
            data: {
                hasEnvPassword,
                availableContracts,
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to fetch deploy configuration.' },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { seed, contractType = 'hello-world', privateStatePassword, constructorArgs } = body;

        if (!seed) {
            return NextResponse.json({ success: false, error: 'Seed is required to deploy a contract.' }, { status: 400 });
        }

        // Determine effective password
        const envPassword = process.env.PRIVATE_STATE_PASSWORD?.trim();
        const userPassword = privateStatePassword?.trim();
        const effectivePassword = userPassword || envPassword;

        if (!effectivePassword) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Private state password is required because PRIVATE_STATE_PASSWORD is not configured in environment variables.',
                },
                { status: 400 }
            );
        }

        if (effectivePassword.length < 16) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Private state password must be at least 16 characters long.',
                },
                { status: 400 }
            );
        }

        const result = await container.deployContractUseCase.execute({
            seed,
            contractType,
            privateStatePassword: effectivePassword,
            constructorArgs,
        });

        return NextResponse.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error deploying contract:', error);
        return NextResponse.json(
            {
                success: false,
                error: error?.message || 'Failed to deploy contract',
            },
            { status: 500 }
        );
    }
}
