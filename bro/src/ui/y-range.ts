// ==========================================
// Y RANGE HELPERS
// ==========================================

type ChartDataValue = string | number | null | undefined;

function toNumber(value: ChartDataValue): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function isBlank(value: unknown): boolean {
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

export function getMaxDataValue(data: Array<Array<ChartDataValue>>, chartType: string): number {
    const isStacked = chartType === 'stackedBar' || chartType === 'stacked';
    if (!Array.isArray(data) || data.length === 0) return 0;

    if (isStacked) {
        const rowStart = data.length > 1 ? 1 : 0; // Ignore "All" row when present
        const maxCols = data.reduce((acc, row) => Math.max(acc, Array.isArray(row) ? row.length : 0), 0);
        let maxSum = 0;

        for (let c = 0; c < maxCols; c++) {
            let sum = 0;
            for (let r = rowStart; r < data.length; r++) {
                sum += toNumber(data[r]?.[c]);
            }
            maxSum = Math.max(maxSum, sum);
        }
        return maxSum;
    }

    let max = 0;
    for (const row of data) {
        for (const value of row || []) {
            max = Math.max(max, toNumber(value));
        }
    }
    return max;
}

export function resolveRawYMax(params: { inputValue: unknown; maxData: number }): { yMax: number; isAuto: boolean; isValidManual: boolean } {
    const safeMaxData = Math.max(1, params.maxData);
    if (isBlank(params.inputValue)) {
        return {
            yMax: safeMaxData,
            isAuto: true,
            isValidManual: true
        };
    }

    const manual = Number(params.inputValue);
    if (!Number.isFinite(manual) || manual <= 0) {
        return {
            yMax: safeMaxData,
            isAuto: false,
            isValidManual: true
        };
    }

    return {
        yMax: Math.max(safeMaxData, manual),
        isAuto: false,
        isValidManual: true
    };
}

export function getEffectiveYDomain(params: {
    mode: 'raw' | 'percent';
    yMinInput: unknown;
    yMaxInput: unknown;
    data: Array<Array<ChartDataValue>>;
    chartType: string;
}): { yMin: number; yMax: number; isRawManualInvalid: boolean; maxData: number; isAuto: boolean } {
    if (params.mode === 'percent') {
        return {
            yMin: 0,
            yMax: 100,
            isRawManualInvalid: false,
            maxData: getMaxDataValue(params.data, params.chartType),
            isAuto: false
        };
    }

    const maxData = getMaxDataValue(params.data, params.chartType);
    const resolved = resolveRawYMax({ inputValue: params.yMaxInput, maxData });
    return {
        yMin: 0,
        yMax: Math.max(1, resolved.yMax),
        isRawManualInvalid: false,
        maxData,
        isAuto: resolved.isAuto
    };
}
