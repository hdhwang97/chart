export type YLabelFormatMode = 'integer' | 'decimal';

export function normalizeYLabelFormatMode(value: unknown): YLabelFormatMode {
    return value === 'decimal' ? 'decimal' : 'integer';
}

function normalizeNegativeZero(value: number): number {
    return Object.is(value, -0) ? 0 : value;
}

export function formatYLabelValue(value: number, mode: YLabelFormatMode): string {
    if (!Number.isFinite(value)) return '0';

    if (mode === 'decimal') {
        const rounded = normalizeNegativeZero(Math.round(value * 10) / 10);
        return Number.isInteger(rounded)
            ? String(rounded)
            : rounded.toFixed(1).replace(/\.0$/, '');
    }

    return String(normalizeNegativeZero(Math.round(value)));
}
