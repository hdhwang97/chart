// ==========================================
// STATE & CONSTANTS
// ==========================================

import type { CellStrokeStyle, RowStrokeStyle, StrokeStyleSnapshot, StyleTemplateItem } from '../shared/style-types';

export const MAX_SIZE = 25;
export const DEFAULT_ROW_COLORS = [
    '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#DBEAFE',
    '#34D399', '#FBBF24', '#F87171', '#A78BFA', '#FB923C'
];

export type StyleInjectionDraftItem = {
    color: string;
    thickness: number;
    visible: boolean;
    strokeStyle: 'solid' | 'dash';
};

export type AssistLineStyleInjectionDraftItem = {
    color: string;
    thickness: number;
    strokeStyle: 'solid' | 'dash';
};

export type MarkStyleInjectionDraftItem = {
    fillColor: string;
    strokeColor: string;
    thickness: number;
    strokeStyle: 'solid' | 'dash';
};

export type GridStyleInjectionDraftItem = StyleInjectionDraftItem & {
    sides: {
        top: boolean;
        right: boolean;
        bottom: boolean;
        left: boolean;
    };
};

export type StyleInjectionDraft = {
    cellFill: {
        color: string;
    };
    cellTop: StyleInjectionDraftItem;
    tabRight: StyleInjectionDraftItem;
    gridContainer: GridStyleInjectionDraftItem;
    assistLine: AssistLineStyleInjectionDraftItem;
    mark: MarkStyleInjectionDraftItem;
};

export const DEFAULT_STYLE_INJECTION_ITEM: StyleInjectionDraftItem = {
    color: '#E5E7EB',
    thickness: 1,
    visible: true,
    strokeStyle: 'solid'
};

export const DEFAULT_STYLE_INJECTION_DRAFT: StyleInjectionDraft = {
    cellFill: { color: '#FFFFFF' },
    cellTop: { ...DEFAULT_STYLE_INJECTION_ITEM },
    tabRight: { ...DEFAULT_STYLE_INJECTION_ITEM },
    gridContainer: {
        ...DEFAULT_STYLE_INJECTION_ITEM,
        sides: { top: true, right: true, bottom: true, left: true }
    },
    assistLine: {
        color: '#E5E7EB',
        thickness: 1,
        strokeStyle: 'solid'
    },
    mark: {
        fillColor: '#3B82F6',
        strokeColor: '#3B82F6',
        thickness: 1,
        strokeStyle: 'solid'
    }
};

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
    rowColors: DEFAULT_ROW_COLORS.slice(0, 3),
    rowHeaderLabels: ['R1', 'R2', 'R3'] as string[],
    colHeaderTitles: ['C1', 'C2', 'C3'] as string[],
    colHeaderColors: [] as string[],
    colHeaderColorEnabled: [] as boolean[],
    markColorSource: 'row' as 'row' | 'col',
    assistLineVisible: false,
    assistLineEnabled: { min: false, max: false, avg: false },
    colStrokeStyle: null as StrokeStyleSnapshot | null,
    cellStrokeStyles: [] as CellStrokeStyle[],
    rowStrokeStyles: [] as RowStrokeStyle[],
    styleInjectionDraft: {
        cellFill: { color: '#FFFFFF' },
        cellTop: { ...DEFAULT_STYLE_INJECTION_ITEM },
        tabRight: { ...DEFAULT_STYLE_INJECTION_ITEM },
        gridContainer: {
            ...DEFAULT_STYLE_INJECTION_ITEM,
            sides: { top: true, right: true, bottom: true, left: true }
        },
        assistLine: {
            color: '#E5E7EB',
            thickness: 1,
            strokeStyle: 'solid'
        },
        mark: {
            fillColor: '#3B82F6',
            strokeColor: '#3B82F6',
            thickness: 1,
            strokeStyle: 'solid'
        }
    } as StyleInjectionDraft,
    styleInjectionDirty: false,
    markStylesDraft: [{
        fillColor: '#3B82F6',
        strokeColor: '#3B82F6',
        thickness: 1,
        strokeStyle: 'solid'
    }] as MarkStyleInjectionDraftItem[],
    activeMarkStyleIndex: 0,
    styleTemplateMode: 'read' as 'read' | 'edit',
    styleTemplates: [] as StyleTemplateItem[],
    selectedStyleTemplateId: null as string | null,
    editingTemplateId: null as string | null,
    editingTemplateName: '' as string
};

export const CHART_ICONS: { [key: string]: string } = {
    bar: `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M4 19h4v-7H4v7zm6 0h4V9h-4v10zm6-14v14h4V5h-4zm2-4H2v22h22V1h-2z"/></svg>`,
    line: `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/></svg>`,
    stackedBar: `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M4 19h4v-4H4v4zm0-5h4v-3H4v3zm0-4h4V7H4v3zm6 9h4v-8h-4v8zm0-9h4V7h-4v3zm0-4h4V7h-4v3zm0-4h4V2h-4v4zm6 13h4v-6h-4v6zm0-7h4V7h-4v3zm0-4h4V2h-4v4z"/></svg>`
};

export function getTotalStackedCols(): number {
    return state.groupStructure.reduce((a, b) => a + b, 0);
}

export function getGridColsForChart(chartType: string, cols: number): number {
    if (chartType === 'line') return Math.max(2, cols + 1);
    return cols;
}

export function initData(rows: number, cols: number): string[][] {
    const newData: string[][] = [];
    for (let i = 0; i < rows; i++) {
        const row = new Array(cols).fill("");
        newData.push(row);
    }
    return newData;
}

export function normalizeHexColorInput(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const m = value.trim().toUpperCase().match(/^#?([0-9A-F]{6})$/);
    if (!m) return null;
    return `#${m[1]}`;
}

export function getDefaultRowColor(index: number): string {
    return DEFAULT_ROW_COLORS[index % DEFAULT_ROW_COLORS.length];
}

export function getDefaultRowHeaderLabel(rowIndex: number, chartType: string): string {
    if (chartType === 'stackedBar') {
        if (rowIndex === 0) return 'All';
        return `R${rowIndex}`;
    }
    return `R${rowIndex + 1}`;
}

export function getDefaultColHeaderTitle(colIndex: number, chartType: string): string {
    if (chartType === 'stackedBar') {
        return `G${colIndex + 1}`;
    }
    return `C${colIndex + 1}`;
}

export function ensureRowColorsLength(rowCount: number) {
    const next: string[] = [];
    for (let i = 0; i < rowCount; i++) {
        next.push(normalizeHexColorInput(state.rowColors[i]) || getDefaultRowColor(i));
    }
    state.rowColors = next;
    return state.rowColors;
}

export function ensureColHeaderColorsLength(colCount: number) {
    const next: string[] = [];
    for (let i = 0; i < colCount; i++) {
        next.push(normalizeHexColorInput(state.colHeaderColors[i]) || getRowColor(0));
    }
    state.colHeaderColors = next;
    return state.colHeaderColors;
}

export function ensureColHeaderColorEnabledLength(colCount: number) {
    const next: boolean[] = [];
    for (let i = 0; i < colCount; i++) {
        next.push(Boolean(state.colHeaderColorEnabled[i]));
    }
    state.colHeaderColorEnabled = next;
    return state.colHeaderColorEnabled;
}

function normalizeColHeaderTitleInput(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
}

export function ensureColHeaderTitlesLength(colCount: number, chartType: string) {
    const next: string[] = [];
    for (let i = 0; i < colCount; i++) {
        const normalized = normalizeColHeaderTitleInput(state.colHeaderTitles[i]);
        next.push(normalized || getDefaultColHeaderTitle(i, chartType));
    }
    state.colHeaderTitles = next;
    return state.colHeaderTitles;
}

function normalizeRowHeaderLabelInput(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
}

export function ensureRowHeaderLabelsLength(rowCount: number, chartType: string) {
    const next: string[] = [];
    for (let i = 0; i < rowCount; i++) {
        const normalized = normalizeRowHeaderLabelInput(state.rowHeaderLabels[i]);
        next.push(normalized || getDefaultRowHeaderLabel(i, chartType));
    }
    state.rowHeaderLabels = next;
    return state.rowHeaderLabels;
}

export function applyIncomingRowColors(
    incoming: unknown,
    rowCount: number,
    fallback?: unknown
) {
    const source = Array.isArray(incoming) ? incoming : [];
    const fallbackSource = Array.isArray(fallback) ? fallback : [];
    const next: string[] = [];

    for (let i = 0; i < rowCount; i++) {
        const color =
            normalizeHexColorInput(source[i]) ||
            normalizeHexColorInput(fallbackSource[i]) ||
            getDefaultRowColor(i);
        next.push(color);
    }

    state.rowColors = next;
    return state.rowColors;
}

export function getRowColor(index: number): string {
    return normalizeHexColorInput(state.rowColors[index]) || getDefaultRowColor(index);
}
