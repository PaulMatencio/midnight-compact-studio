import { NextRequest, NextResponse } from 'next/server';
import { container } from '@/src/infrastructure/di/container';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const { seed, target } = body;

        if (!seed) {
            return NextResponse.json({ success: false, error: 'Seed is required.' }, { status: 400 });
        }

        const cleanTarget = target === 'all' ? 'all' : 'dust';
        const result = await container.resetWalletSyncUseCase.execute({
            seed: String(seed).trim(),
            target: cleanTarget,
        });

        return NextResponse.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error resetting wallet sync:', error);
        return NextResponse.json(
            {
                success: false,
                error: error?.message || 'Failed to reset wallet sync',
            },
            { status: 500 }
        );
    }
}
