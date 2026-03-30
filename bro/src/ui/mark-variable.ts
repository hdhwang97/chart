import { ensureRowColorModesLength, ensureRowPaintStyleIdsLength, state } from './state';

const MARK_INPUT_IDS = {
    fill: 'style-mark-fill-color',
    stroke: 'style-mark-stroke-color',
    lineBackground: 'style-mark-line-background-color',
    linePointStroke: 'style-mark-line-point-stroke',
    linePointFill: 'style-mark-line-point-fill'
} as const;

function normalizeInputId(inputId: string | null | undefined): string | null {
    if (typeof inputId !== 'string') return null;
    const trimmed = inputId.trim();
    return trimmed || null;
}

export function isMarkColorInputId(inputId: string | null | undefined) {
    const normalized = normalizeInputId(inputId);
    if (!normalized) return false;
    return normalized === MARK_INPUT_IDS.fill
        || normalized === MARK_INPUT_IDS.stroke
        || normalized === MARK_INPUT_IDS.lineBackground
        || normalized === MARK_INPUT_IDS.linePointStroke
        || normalized === MARK_INPUT_IDS.linePointFill;
}

export function resolveActiveMarkRowIndex() {
    const seriesIndex = Math.max(0, Math.floor(state.activeMarkStyleIndex));
    const rowIndex = (state.chartType === 'stackedBar' || state.chartType === 'stacked')
        ? seriesIndex + 1
        : seriesIndex;
    const maxRow = Math.max(0, state.rows - 1);
    return Math.max(0, Math.min(maxRow, rowIndex));
}

function resolveActiveMarkIndexOneBased() {
    return Math.max(0, Math.floor(state.activeMarkStyleIndex)) + 1;
}

export function resolveMarkVariableSlotKeysForInputId(inputId: string | null | undefined) {
    const normalized = normalizeInputId(inputId);
    if (!normalized) return [];
    const markIndex = resolveActiveMarkIndexOneBased();
    if (normalized === MARK_INPUT_IDS.stroke) return [`color/${markIndex}_str`];
    if (normalized === MARK_INPUT_IDS.fill) return [`color/${markIndex}_fill`];
    if (normalized === MARK_INPUT_IDS.lineBackground) {
        return [
            `color/${markIndex}_area`,
            `color/${markIndex}_area_top`,
            `color/${markIndex}_area_bot`
        ];
    }
    if (normalized === MARK_INPUT_IDS.linePointStroke) return [`color/${markIndex}_pt_stroke`];
    if (normalized === MARK_INPUT_IDS.linePointFill) return [`color/${markIndex}_pt_fill`];
    return [];
}

function isPrimaryPaletteInputId(inputId: string | null | undefined) {
    const normalized = normalizeInputId(inputId);
    if (!normalized) return false;
    return state.chartType === 'line'
        ? normalized === MARK_INPUT_IDS.stroke
        : normalized === MARK_INPUT_IDS.fill;
}

export function resolveMarkVariableStyleIdForInputId(inputId: string | null | undefined): {
    styleId: string | null;
    slotKeys: string[];
    fromSlotMap: boolean;
} {
    const slotKeys = resolveMarkVariableSlotKeysForInputId(inputId);
    for (const slotKey of slotKeys) {
        const id = state.markVariableSlotMap[slotKey];
        if (typeof id === 'string' && id.trim()) {
            return { styleId: id, slotKeys, fromSlotMap: true };
        }
    }

    if (isPrimaryPaletteInputId(inputId)) {
        const rowCount = Math.max(1, state.rows);
        const rowModes = ensureRowColorModesLength(rowCount);
        const rowPaintStyleIds = ensureRowPaintStyleIdsLength(rowCount);
        const rowIndex = resolveActiveMarkRowIndex();
        const styleId = rowModes[rowIndex] === 'paint_style' ? rowPaintStyleIds[rowIndex] : null;
        if (styleId) {
            return { styleId, slotKeys, fromSlotMap: false };
        }
    }

    return { styleId: null, slotKeys, fromSlotMap: false };
}

export function setMarkVariableStyleIdForInputId(
    inputId: string | null | undefined,
    styleId: string | null
) {
    const slotKeys = resolveMarkVariableSlotKeysForInputId(inputId);
    if (slotKeys.length === 0) return slotKeys;
    const next = { ...(state.markVariableSlotMap || {}) };
    if (typeof styleId === 'string' && styleId.trim()) {
        slotKeys.forEach((slotKey) => {
            next[slotKey] = styleId;
        });
    } else {
        slotKeys.forEach((slotKey) => {
            delete next[slotKey];
        });
    }
    state.markVariableSlotMap = next;
    return slotKeys;
}

