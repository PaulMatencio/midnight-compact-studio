/**
 * Utility functions for Midnight DUST conversions and display formatting.
 * In the Midnight Network:
 *   1 NIGHT = 1,000,000 STAR (10^6)
 *   1 DUST  = 1,000,000,000,000,000 SPECK (10^15)
 *
 * Transaction gas fees reported by the Wallet SDK (e.g. 300_000_000_000_001n)
 * are in base SPECK units. When displayed to users, they should be converted
 * to human-readable DUST units by dividing by 10^15.
 */

export const SPECK_PER_DUST = 1_000_000_000_000_000n; // 10^15

/**
 * Converts a raw SPECK value (or already converted DUST value) into human-readable DUST number.
 * @param rawVal Value in SPECK (base units) or DUST
 */
export function speckToDust(rawVal: string | number | bigint | undefined | null): number {
    if (rawVal === undefined || rawVal === null || rawVal === '') return 0;
    try {
        const str = String(rawVal).trim();
        if (!str || str === '0') return 0;

        // If scientific notation or float already
        if (str.includes('.') || str.includes('e') || str.includes('E')) {
            const num = Number(str);
            if (isNaN(num)) return 0;
            return num >= 1_000_000_000 ? num / 1e15 : num;
        }

        const big = typeof rawVal === 'bigint' ? rawVal : BigInt(str);
        if (big === 0n) return 0;

        // If value is in base units (>= 10^9 SPECK), divide by 10^15
        if (big >= 1_000_000_000n) {
            return Number(big) / 1e15;
        }
        return Number(big);
    } catch {
        const num = Number(rawVal);
        return isNaN(num) ? 0 : (num >= 1_000_000_000 ? num / 1e15 : num);
    }
}

/**
 * Formats a raw DUST / SPECK fee or balance into a clean, human-readable string.
 * Examples:
 *   300000000000001 -> "0.0003 DUST"
 *   0               -> "0 DUST" (or "0" if includeUnit is false)
 *   1000000000000000 -> "1 DUST"
 *
 * @param rawVal Raw fee in SPECK or DUST
 * @param includeUnit Whether to append " DUST" (default: true)
 */
export function formatDustFee(
    rawVal: string | number | bigint | undefined | null,
    includeUnit: boolean = true
): string {
    const dust = speckToDust(rawVal);
    if (dust === 0) return includeUnit ? '0 DUST' : '0';

    let formatted: string;
    if (dust < 0.0001) {
        formatted = dust.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
        if (formatted === '0') {
            formatted = dust.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
        }
        if (formatted === '0') {
            formatted = '< 0.000001';
        }
    } else {
        formatted = dust.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 4,
        });
    }

    return includeUnit ? `${formatted} DUST` : formatted;
}
