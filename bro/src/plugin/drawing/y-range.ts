// ==========================================
// Y RANGE HELPERS (PLUGIN)
// ==========================================

function toNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function normalizeYMax(value: unknown): number | null {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

export function getRawDataMax(values: any[][], chartType: string): number {
    if (!Array.isArray(values) || values.length === 0) return 1;
    const isStacked = chartType === 'stackedBar' || chartType === 'stacked';

    if (isStacked) {
        const colCount = values[0]?.length || 0;
        let maxSum = 0;
        for (let c = 0; c < colCount; c++) {
            let sum = 0;
            for (let r = 0; r < values.length; r++) {
                sum += toNumber(values[r]?.[c]);
            }
            maxSum = Math.max(maxSum, sum);
        }
        return Math.max(1, maxSum);
    }

    let max = 0;
    for (const row of values) {
        for (const val of row || []) {
            max = Math.max(max, toNumber(val));
        }
    }
    return Math.max(1, max);
}

export function resolveEffectiveYRange(params: {
    chartType: string;
    mode: string;
    values: any[][];
    yMin?: number | null;
    yMax?: number | null;
    rawYMaxAuto?: boolean;
}) {
    if (params.mode === 'raw') {
        const dataMax = getRawDataMax(params.values, params.chartType);
        const manualYMax = params.rawYMaxAuto ? null : normalizeYMax(params.yMax);
        const yMax = manualYMax ?? dataMax;
        return {
            yMin: 0,
            yMax: Math.max(1, yMax),
            rawYMaxAuto: manualYMax === null
        };
    }

    const yMin = Number.isFinite(params.yMin) ? Number(params.yMin) : 0;
    const yMaxCandidate = Number.isFinite(params.yMax) ? Number(params.yMax) : 100;
    const yMax = yMaxCandidate > yMin ? yMaxCandidate : yMin + 1;
    return {
        yMin,
        yMax,
        rawYMaxAuto: false
    };
}
