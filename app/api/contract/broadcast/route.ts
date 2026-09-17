import { NextRequest, NextResponse } from 'next/server';
import { container } from '@/src/infrastructure/di/container';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { balancedTxHex } = body;

        if (!balancedTxHex || typeof balancedTxHex !== 'string') {
            return NextResponse.json(
                { success: false, error: 'balancedTxHex string is required.' },
                { status: 400 }
            );
        }

        const result = await container.contractGateway.broadcastTransaction(balancedTxHex);
        return NextResponse.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error broadcasting transaction via backend node RPC:', error);
        return NextResponse.json(
            {
                success: false,
                error: error?.message || 'Failed to broadcast transaction to network.',
            },
            { status: 500 }
        );
    }
}
