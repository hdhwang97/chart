// ==========================================
// STATE & CONSTANTS
// ==========================================

import type { CellStrokeStyle, RowStrokeStyle, StrokeStyleSnapshot } from '../shared/style-types';

export const MAX_SIZE = 25;

export const state = {
    rows: 3,
    cols: 3,
    cellCount: 4,
    groupStructure: [2, 2, 2],
    data: [] as string[][],
    mode: 'edit' as 'edit' | 'read',
    chartType: 'bar' as string,
    dataMode: 'raw' as 'raw' | 'percent',
    currentStep: 1,
    csvFileName: null as string | null,
    uiMode: 'create' as 'create' | 'edit',
    cachedRawData: null as string[][] | null,
    conversionMax: 100,
    strokeWidth: 2,
    markRatio: 0.8,
    assistLineVisible: false,
    assistLineEnabled: { min: false, max: false, avg: false },
    colStrokeStyle: null as StrokeStyleSnapshot | null,
    cellStrokeStyles: [] as CellStrokeStyle[],
    rowStrokeStyles: [] as RowStrokeStyle[]
};

export const CHART_ICONS: { [key: string]: string } = {
    bar: `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M4 19h4v-7H4v7zm6 0h4V9h-4v10zm6-14v14h4V5h-4zm2-4H2v22h22V1h-2z"/></svg>`,
    line: `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/></svg>`,
    stackedBar: `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M4 19h4v-4H4v4zm0-5h4v-3H4v3zm0-4h4V7H4v3zm6 9h4v-8h-4v8zm0-9h4V7h-4v3zm0-4h4V7h-4v3zm0-4h4V2h-4v4zm6 13h4v-6h-4v6zm0-7h4V7h-4v3zm0-4h4V2h-4v4z"/></svg>`
};

export function getTotalStackedCols(): number {
    return state.groupStructure.reduce((a, b) => a + b, 0);
}

export function initData(rows: number, cols: number): string[][] {
    const newData: string[][] = [];
    for (let i = 0; i < rows; i++) {
        const row = new Array(cols).fill("");
        newData.push(row);
    }
    return newData;
}
