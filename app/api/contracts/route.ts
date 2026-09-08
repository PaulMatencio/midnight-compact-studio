import { NextRequest, NextResponse } from 'next/server';
import { container } from '@/src/infrastructure/di/container';
import { getAllContractBlueprints } from '@/src/infrastructure/contracts/contract-registry';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const deployments = await container.deploymentStorage.getDeployments();
        const blueprints = getAllContractBlueprints();
        return NextResponse.json({
            success: true,
            data: {
                deployments,
                blueprints,
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to fetch contracts' },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { contractAddress, contractType = 'hello-world', nickname, deployerSeed, network = 'preprod', owner } = body;

        if (!contractAddress || typeof contractAddress !== 'string' || contractAddress.trim().length === 0) {
            return NextResponse.json({ success: false, error: 'Contract address is required.' }, { status: 400 });
        }

        const record = {
            contractAddress: contractAddress.trim(),
            contractType,
            nickname: nickname?.trim() || undefined,
            deployerSeed: deployerSeed?.trim() || undefined,
            network,
            deployedAt: new Date().toISOString(),
            owner: owner?.trim() || undefined,
        };

        await container.deploymentStorage.saveDeployment(record);

        return NextResponse.json({
            success: true,
            data: record,
        });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to import contract' },
            { status: 500 }
        );
    }
}
