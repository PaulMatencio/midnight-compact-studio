import { NextRequest, NextResponse } from 'next/server';
import { container } from '@/src/infrastructure/di/container';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { contractAddress, contractType } = body;

        if (!contractAddress) {
            return NextResponse.json(
                { success: false, error: 'contractAddress is required to record a deployment.' },
                { status: 400 }
            );
        }

        const data = await container.contractGateway.recordDeployment({
            contractAddress,
            contractType: contractType || 'hello-world',
            txHash: body.txHash,
            blockHeight: body.blockHeight,
            deployerAddress: body.deployerAddress,
            contractSalt: body.contractSalt,
            owner: body.owner,
            dustPaid: body.dustPaid,
            durationMs: body.durationMs,
        });

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('Error recording contract deployment:', error);
        return NextResponse.json(
            {
                success: false,
                error: error?.message || 'Failed to record contract deployment.',
            },
            { status: 500 }
        );
    }
}
