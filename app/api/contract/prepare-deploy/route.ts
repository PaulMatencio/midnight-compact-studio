import { NextRequest, NextResponse } from 'next/server';
import { container } from '@/src/infrastructure/di/container';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            contractType = 'hello-world',
            privateStatePassword,
            constructorArgs,
            deployerAddress,
            shieldedCoinPublicKey,
            shieldedEncryptionPublicKey,
        } = body;

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

        const data = await container.contractGateway.prepareDeploy({
            contractType,
            privateStatePassword: effectivePassword,
            constructorArgs,
            deployerAddress,
            shieldedCoinPublicKey,
            shieldedEncryptionPublicKey,
        });

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('Error preparing contract deployment:', error);
        return NextResponse.json(
            {
                success: false,
                error: error?.message || 'Failed to prepare contract deployment.',
            },
            { status: 500 }
        );
    }
}
