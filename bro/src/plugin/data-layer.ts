import { PLUGIN_DATA_KEYS } from './constants';
import { inferStructureFromGraph } from './init';
import { normalizeHexColor } from './utils';
import type {
    AssistLineInjectionStyle,
    CellFillInjectionStyle,
    GridStrokeInjectionStyle,
    LocalStyleOverrideMask,
    LocalStyleOverrides,
    MarkInjectionStyle,
    SideStrokeInjectionStyle,
    StyleApplyMode
} from '../shared/style-types';

// ==========================================
// DATA LAYER (저장/로드 핵심 로직)
// ==========================================

export const safeParse = (data: string | undefined) => (data ? JSON.parse(data) : null);

function normalizeMarkRatio(value: unknown): number | null {
    const ratio = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(ratio)) return null;
    return Math.max(0.01, Math.min(1.0, ratio));
}

function normalizeAssistLineEnabled(value: any) {
    if (!value || typeof value !== 'object') {
        return { min: false, max: false, avg: false };
    }
    return {
        min: Boolean(value.min),
        max: Boolean(value.max),
        avg: Boolean(value.avg)
    };
}

function normalizeRowColors(value: any): string[] {
    if (!Array.isArray(value)) return [];
    const next: string[] = [];
    value.forEach((item) => {
        const normalized = normalizeHexColor(item);
        if (normalized) next.push(normalized);
    });
    return next;
}

function getDefaultRowHeaderLabel(index: number, chartType: string): string {
    if (chartType === 'stackedBar' || chartType === 'stacked') {
        if (index === 0) return 'All';
        return `R${index}`;
    }
    return `R${index + 1}`;
}

function normalizeRowHeaderLabels(value: unknown, rowCount: number, chartType: string): string[] {
    const source = Array.isArray(value) ? value : [];
    const safeCount = Math.max(1, Number.isFinite(rowCount) ? Math.floor(rowCount) : 1);
    const next: string[] = [];
    for (let i = 0; i < safeCount; i++) {
        const raw = typeof source[i] === 'string' ? source[i].trim() : '';
        next.push(raw || getDefaultRowHeaderLabel(i, chartType));
    }
    return next;
}

function normalizeXAxisLabels(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const next: string[] = [];
    value.forEach((item) => {
        if (typeof item !== 'string') return;
        const trimmed = item.trim();
        if (!trimmed) return;
        next.push(trimmed);
    });
    return next;
}

function normalizeMarkColorSource(value: unknown): 'row' | 'col' {
    return value === 'col' ? 'col' : 'row';
}

function normalizeColColorEnabled(value: unknown, colCount: number): boolean[] {
    const source = Array.isArray(value) ? value : [];
    const safeCount = Math.max(1, Number.isFinite(colCount) ? Math.floor(colCount) : 1);
    const next: boolean[] = [];
    for (let i = 0; i < safeCount; i++) {
        next.push(Boolean(source[i]));
    }
    return next;
}

function normalizeStyleApplyMode(value: unknown): StyleApplyMode {
    return value === 'data_only' ? 'data_only' : 'include_style';
}

function normalizeLocalStyleOverrideMask(value: unknown): LocalStyleOverrideMask {
    if (!value || typeof value !== 'object') return {};
    const source = value as Record<string, unknown>;
    const keys: Array<keyof LocalStyleOverrideMask> = [
        'rowColors',
        'colColors',
        'colColorEnabled',
        'markColorSource',
        'assistLineVisible',
        'assistLineEnabled',
        'cellFillStyle',
        'cellTopStyle',
        'tabRightStyle',
        'gridContainerStyle',
        'assistLineStyle',
        'markStyle',
        'markStyles',
        'rowStrokeStyles',
        'colStrokeStyle'
    ];
    const next: LocalStyleOverrideMask = {};
    keys.forEach((key) => {
        if (key in source) next[key] = Boolean(source[key]);
    });
    return next;
}

function hasTruthyMask(mask: LocalStyleOverrideMask): boolean {
    return Object.values(mask).some((value) => Boolean(value));
}

function sanitizeLocalStyleOverrides(value: unknown): LocalStyleOverrides {
    if (!value || typeof value !== 'object') return {};
    const source = value as LocalStyleOverrides;
    const next: LocalStyleOverrides = {};

    if (Array.isArray(source.rowColors)) next.rowColors = normalizeRowColors(source.rowColors);
    if (Array.isArray(source.colColors)) next.colColors = normalizeRowColors(source.colColors);
    if (Array.isArray(source.colColorEnabled)) next.colColorEnabled = source.colColorEnabled.map((v) => Boolean(v));
    if (source.markColorSource === 'col' || source.markColorSource === 'row') next.markColorSource = source.markColorSource;
    if (typeof source.assistLineVisible === 'boolean') next.assistLineVisible = source.assistLineVisible;
    if (source.assistLineEnabled && typeof source.assistLineEnabled === 'object') {
        next.assistLineEnabled = normalizeAssistLineEnabled(source.assistLineEnabled);
    }
    const cellFillStyle = normalizeCellFillStyle(source.cellFillStyle);
    if (cellFillStyle) next.cellFillStyle = cellFillStyle;
    const cellTopStyle = normalizeSideStrokeStyle(source.cellTopStyle);
    if (cellTopStyle) next.cellTopStyle = cellTopStyle;
    const tabRightStyle = normalizeSideStrokeStyle(source.tabRightStyle);
    if (tabRightStyle) next.tabRightStyle = tabRightStyle;
    const gridContainerStyle = normalizeGridStrokeStyle(source.gridContainerStyle);
    if (gridContainerStyle) next.gridContainerStyle = gridContainerStyle;
    const assistLineStyle = normalizeAssistLineStyle(source.assistLineStyle);
    if (assistLineStyle) next.assistLineStyle = assistLineStyle;
    const markStyle = normalizeMarkStyle(source.markStyle);
    if (markStyle) next.markStyle = markStyle;
    const markStyles = normalizeMarkStyles(source.markStyles);
    if (markStyles.length > 0) next.markStyles = markStyles;
    if (Array.isArray(source.rowStrokeStyles)) next.rowStrokeStyles = source.rowStrokeStyles;
    if (source.colStrokeStyle && typeof source.colStrokeStyle === 'object') next.colStrokeStyle = source.colStrokeStyle;

    return next;
}

export function saveLocalStyleOverrides(
    node: SceneNode,
    overrides: unknown,
    mask: unknown
) {
    const normalizedMask = normalizeLocalStyleOverrideMask(mask);
    if (!hasTruthyMask(normalizedMask)) {
        node.setPluginData(PLUGIN_DATA_KEYS.LAST_LOCAL_STYLE_OVERRIDES, '');
        node.setPluginData(PLUGIN_DATA_KEYS.LAST_LOCAL_STYLE_OVERRIDE_MASK, '');
        return;
    }
    const normalizedOverrides = sanitizeLocalStyleOverrides(overrides);
    node.setPluginData(PLUGIN_DATA_KEYS.LAST_LOCAL_STYLE_OVERRIDES, JSON.stringify(normalizedOverrides));
    node.setPluginData(PLUGIN_DATA_KEYS.LAST_LOCAL_STYLE_OVERRIDE_MASK, JSON.stringify(normalizedMask));
}

export function loadLocalStyleOverrides(node: SceneNode): {
    overrides: LocalStyleOverrides;
    mask: LocalStyleOverrideMask;
} {
    let overrides: LocalStyleOverrides = {};
    let mask: LocalStyleOverrideMask = {};

    const rawOverrides = node.getPluginData(PLUGIN_DATA_KEYS.LAST_LOCAL_STYLE_OVERRIDES);
    if (rawOverrides) {
        try {
            overrides = sanitizeLocalStyleOverrides(JSON.parse(rawOverrides));
        } catch {
            overrides = {};
        }
    }
    const rawMask = node.getPluginData(PLUGIN_DATA_KEYS.LAST_LOCAL_STYLE_OVERRIDE_MASK);
    if (rawMask) {
        try {
            mask = normalizeLocalStyleOverrideMask(JSON.parse(rawMask));
        } catch {
            mask = {};
        }
    }
    return { overrides, mask };
}

function normalizeThickness(value: unknown): number | undefined {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return Math.max(0, Math.min(20, Math.round(n)));
}

function normalizeSideStrokeStyle(value: unknown): SideStrokeInjectionStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as SideStrokeInjectionStyle;
    const color = normalizeHexColor(source.color);
    const thickness = normalizeThickness(source.thickness);
    const visible = typeof source.visible === 'boolean' ? source.visible : undefined;
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);

    if (!color && thickness === undefined && visible === undefined && !strokeStyle) return null;
    return {
        color: color || undefined,
        thickness: visible === false ? 0 : thickness,
        visible,
        strokeStyle
    };
}

function normalizeGridStrokeStyle(value: unknown): GridStrokeInjectionStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as GridStrokeInjectionStyle;
    const side = normalizeSideStrokeStyle(source);
    const enableIndividualStroke = source.enableIndividualStroke !== false;
    const sides = {
        top: source.sides?.top !== false,
        right: source.sides?.right !== false,
        bottom: source.sides?.bottom !== false,
        left: source.sides?.left !== false
    };
    if (!side && source.enableIndividualStroke === undefined && source.sides === undefined) return null;
    return {
        ...(side || {}),
        enableIndividualStroke,
        sides
    };
}

function normalizeAssistLineStyle(value: unknown): AssistLineInjectionStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as AssistLineInjectionStyle;
    const color = normalizeHexColor(source.color);
    const thickness = normalizeThickness(source.thickness);
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);
    if (!color && thickness === undefined && !strokeStyle) return null;
    return {
        color: color || undefined,
        thickness,
        strokeStyle
    };
}

function normalizeCellFillStyle(value: unknown): CellFillInjectionStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as CellFillInjectionStyle;
    const color = normalizeHexColor(source.color);
    if (!color) return null;
    return { color };
}

function normalizeMarkStyle(value: unknown): MarkInjectionStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as MarkInjectionStyle;
    const fillColor = normalizeHexColor(source.fillColor);
    const strokeColor = normalizeHexColor(source.strokeColor);
    const thickness = normalizeThickness(source.thickness);
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);
    if (!fillColor && !strokeColor && thickness === undefined && !strokeStyle) return null;
    return {
        fillColor: fillColor || undefined,
        strokeColor: strokeColor || undefined,
        thickness,
        strokeStyle
    };
}

function normalizeMarkStyles(value: unknown): MarkInjectionStyle[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeMarkStyle(item))
        .filter((item): item is MarkInjectionStyle => Boolean(item));
}

function isStackedChartType(chartType: string) {
    return chartType === 'stackedBar' || chartType === 'stacked';
}

function recoverLegacyStackedValuesIfNeeded(values: any, markNum: any) {
    if (!Array.isArray(values)) return values;
    if (!Array.isArray(markNum)) return values;

    const maxSegments = markNum.reduce((acc: number, raw: unknown) => {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) return acc;
        return Math.max(acc, Math.floor(n));
    }, 0);
    if (maxSegments <= 0) return values;
    if (values.length !== maxSegments) return values;

    const normalizedRows = values.map((row) => Array.isArray(row) ? [...row] : []);
    const maxCols = normalizedRows.reduce((acc, row) => Math.max(acc, row.length), 0);
    const allRow = Array.from({ length: maxCols }, (_, col) => {
        let sum = 0;
        for (let r = 0; r < normalizedRows.length; r++) {
            sum += Number(normalizedRows[r][col]) || 0;
        }
        return String(sum);
    });

    return [allRow, ...normalizedRows];
}

// styleInfo를 받아 스타일 데이터도 함께 저장
export function saveChartData(node: SceneNode, msg: any, styleInfo?: any) {
    const styleApplyMode = normalizeStyleApplyMode(msg?.styleApplyMode);
    const shouldSaveStyleKeys = styleApplyMode === 'include_style';

    node.setPluginData(PLUGIN_DATA_KEYS.CHART_TYPE, msg.type);
    node.setPluginData(PLUGIN_DATA_KEYS.LAST_VALUES, JSON.stringify(msg.rawValues));
    node.setPluginData(PLUGIN_DATA_KEYS.LAST_DRAWING_VALUES, JSON.stringify(msg.values));
    node.setPluginData(PLUGIN_DATA_KEYS.LAST_MODE, msg.mode);
    node.setPluginData(PLUGIN_DATA_KEYS.LAST_Y_MIN, String(msg.yMin));
    if (msg.mode === 'raw' && msg.rawYMaxAuto) {
        node.setPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX, '');
    } else {
        node.setPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX, String(msg.yMax));
    }

    node.setPluginData(PLUGIN_DATA_KEYS.LAST_CELL_COUNT, String(msg.cellCount));
    if (msg.markNum) {
        node.setPluginData(PLUGIN_DATA_KEYS.LAST_MARK_NUM, JSON.stringify(msg.markNum));
    }
    node.setPluginData(
        PLUGIN_DATA_KEYS.LAST_X_AXIS_LABELS,
        JSON.stringify(normalizeXAxisLabels(msg.xAxisLabels))
    );
    node.setPluginData(
        PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_ENABLED,
        JSON.stringify(normalizeAssistLineEnabled(msg.assistLineEnabled))
    );
    node.setPluginData(
        PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_VISIBLE,
        String(Boolean(msg.assistLineVisible))
    );
    const rowCount = Number.isFinite(Number(msg.rows))
        ? Number(msg.rows)
        : (Array.isArray(msg.rawValues) ? msg.rawValues.length : 1);
    node.setPluginData(
        PLUGIN_DATA_KEYS.LAST_ROW_HEADER_LABELS,
        JSON.stringify(normalizeRowHeaderLabels(msg.rowHeaderLabels, rowCount, msg.type))
    );
    if (shouldSaveStyleKeys) {
        node.setPluginData(
            PLUGIN_DATA_KEYS.LAST_ROW_COLORS,
            JSON.stringify(normalizeRowColors(msg.rowColors))
        );
        node.setPluginData(
            PLUGIN_DATA_KEYS.LAST_COL_COLORS,
            JSON.stringify(normalizeRowColors(msg.colColors))
        );
        const msgCols = Number.isFinite(Number(msg.cols)) ? Number(msg.cols) : 0;
        const xAxisCount = Array.isArray(msg.xAxisLabels) ? msg.xAxisLabels.length : 0;
        const colCount = Math.max(1, msgCols, xAxisCount);
        node.setPluginData(
            PLUGIN_DATA_KEYS.LAST_COL_COLOR_ENABLED,
            JSON.stringify(normalizeColColorEnabled(msg.colColorEnabled, colCount))
        );
        node.setPluginData(
            PLUGIN_DATA_KEYS.LAST_MARK_COLOR_SOURCE,
            normalizeMarkColorSource(msg.markColorSource)
        );
    }

    // UI에서 직접 넘어온 Stroke Width가 있다면 우선 저장
    if (msg.strokeWidth) {
        node.setPluginData(PLUGIN_DATA_KEYS.LAST_STROKE_WIDTH, String(msg.strokeWidth));
    } else if (styleInfo && styleInfo.strokeWidth !== undefined) {
        node.setPluginData(PLUGIN_DATA_KEYS.LAST_STROKE_WIDTH, String(styleInfo.strokeWidth));
    }

    // 추출된 스타일 정보 저장
    const requestedRatio = (msg.type === 'bar' || msg.type === 'stackedBar' || msg.type === 'stacked')
        ? normalizeMarkRatio(msg.markRatio)
        : null;
    if (requestedRatio !== null) {
        node.setPluginData(PLUGIN_DATA_KEYS.LAST_BAR_PADDING, String(requestedRatio));
    }

    if (styleInfo) {
        if (requestedRatio === null && styleInfo.markRatio !== undefined) {
            const fallbackRatio = normalizeMarkRatio(styleInfo.markRatio);
            if (fallbackRatio !== null) {
                node.setPluginData(PLUGIN_DATA_KEYS.LAST_BAR_PADDING, String(fallbackRatio));
            }
        }
        if (styleInfo.cornerRadius !== undefined) {
            node.setPluginData(PLUGIN_DATA_KEYS.LAST_CORNER_RADIUS, String(styleInfo.cornerRadius));
        }
    }

    if (shouldSaveStyleKeys) {
        const cellFillStyle = normalizeCellFillStyle(msg.cellFillStyle);
        const cellTopStyle = normalizeSideStrokeStyle(msg.cellTopStyle ?? msg.cellBottomStyle);
        const tabRightStyle = normalizeSideStrokeStyle(msg.tabRightStyle);
        const gridContainerStyle = normalizeGridStrokeStyle(msg.gridContainerStyle);
        const assistLineStyle = normalizeAssistLineStyle(msg.assistLineStyle);
        const markStyle = normalizeMarkStyle(msg.markStyle);
        const markStyles = normalizeMarkStyles(msg.markStyles);

        node.setPluginData(
            PLUGIN_DATA_KEYS.LAST_CELL_FILL_STYLE,
            cellFillStyle ? JSON.stringify(cellFillStyle) : ''
        );
        node.setPluginData(
            PLUGIN_DATA_KEYS.LAST_CELL_TOP_STYLE,
            cellTopStyle ? JSON.stringify(cellTopStyle) : ''
        );
        // Legacy compatibility for previously-saved charts.
        node.setPluginData(
            PLUGIN_DATA_KEYS.LAST_CELL_BOTTOM_STYLE,
            cellTopStyle ? JSON.stringify(cellTopStyle) : ''
        );
        node.setPluginData(
            PLUGIN_DATA_KEYS.LAST_TAB_RIGHT_STYLE,
            tabRightStyle ? JSON.stringify(tabRightStyle) : ''
        );
        node.setPluginData(
            PLUGIN_DATA_KEYS.LAST_GRID_CONTAINER_STYLE,
            gridContainerStyle ? JSON.stringify(gridContainerStyle) : ''
        );
        node.setPluginData(
            PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_STYLE,
            assistLineStyle ? JSON.stringify(assistLineStyle) : ''
        );
        node.setPluginData(
            PLUGIN_DATA_KEYS.LAST_MARK_STYLE,
            markStyle ? JSON.stringify(markStyle) : ''
        );
        node.setPluginData(
            PLUGIN_DATA_KEYS.LAST_MARK_STYLES,
            markStyles.length > 0 ? JSON.stringify(markStyles) : ''
        );
    }
}

export async function loadChartData(node: SceneNode, chartType: string) {
    const savedValuesStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_VALUES);
    const savedCell = node.getPluginData(PLUGIN_DATA_KEYS.LAST_CELL_COUNT);
    const savedMarkNumStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MARK_NUM);

    if (savedValuesStr) {
        try {
            const parsedValues = JSON.parse(savedValuesStr);
            const markNum = savedMarkNumStr ? JSON.parse(savedMarkNumStr) : 1;
            const values = isStackedChartType(chartType)
                ? recoverLegacyStackedValuesIfNeeded(parsedValues, markNum)
                : parsedValues;
            const cellCount = Number(savedCell) || 4;
            console.log('[chart-plugin][data] saved LAST_VALUES found', {
                nodeId: node.id,
                valuesRows: Array.isArray(values) ? values.length : 0,
                cellCount,
                hasSavedMarkNum: Boolean(savedMarkNumStr)
            });
            return {
                values,
                markNum,
                cellCount,
                isSaved: true
            };
        } catch (e) {
            console.warn('[chart-plugin][data] failed to parse saved LAST_VALUES, fallback to inference', {
                nodeId: node.id,
                error: e instanceof Error ? e.message : String(e)
            });
        }
    }

    console.log('[chart-plugin][data] no saved LAST_VALUES, infer from structure', {
        nodeId: node.id,
        chartType
    });

    const structure = inferStructureFromGraph(chartType, node);
    return {
        values: structure.values,
        markNum: structure.markNum,
        cellCount: structure.cellCount,
        isSaved: false
    };
}
