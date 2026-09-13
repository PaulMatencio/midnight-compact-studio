import { describe, it, expect } from 'vitest';
import { speckToDust, formatDustFee } from '@/src/lib/dust-utils';

describe('dust-utils', () => {
    describe('speckToDust', () => {
        it('handles 0 and empty values', () => {
            expect(speckToDust(0)).toBe(0);
            expect(speckToDust('0')).toBe(0);
            expect(speckToDust(0n)).toBe(0);
            expect(speckToDust(undefined)).toBe(0);
            expect(speckToDust(null)).toBe(0);
            expect(speckToDust('')).toBe(0);
        });

        it('converts typical 300,000,000,000,001 SPECK fee to ~0.3 DUST', () => {
            const dust = speckToDust('300000000000001');
            expect(dust).toBeCloseTo(0.3, 4);
        });

        it('converts 1 full DUST (10^15 SPECK)', () => {
            expect(speckToDust('1000000000000000')).toBe(1);
            expect(speckToDust(1000000000000000n)).toBe(1);
        });

        it('preserves numbers that are already in DUST units (< 10^9)', () => {
            expect(speckToDust(0.3)).toBe(0.3);
            expect(speckToDust('5.25')).toBe(5.25);
        });
    });

    describe('formatDustFee', () => {
        it('formats 0 properly', () => {
            expect(formatDustFee(0)).toBe('0 DUST');
            expect(formatDustFee('0', false)).toBe('0');
        });

        it('formats 300,000,000,000,001 SPECK as "0.3 DUST"', () => {
            expect(formatDustFee('300000000000001')).toBe('0.3 DUST');
            expect(formatDustFee('300000000000001', false)).toBe('0.3');
        });

        it('formats 1 full DUST as "1 DUST"', () => {
            expect(formatDustFee('1000000000000000')).toBe('1 DUST');
        });

        it('formats fractional values cleanly', () => {
            expect(formatDustFee('1500000000000000')).toBe('1.5 DUST');
        });
    });
});
