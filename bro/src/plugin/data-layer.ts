import { PLUGIN_DATA_KEYS } from './constants';
import { inferStructureFromGraph } from './init';
import { normalizeHexColor } from './utils';
import type { GridStrokeInjectionStyle, SideStrokeInjectionStyle } from '../shared/style-types';

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

    if (!color && thickness === undefined && visible === undefined) return null;
    return {
        color: color || undefined,
        thickness: visible === false ? 0 : thickness,
        visible
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
        PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_ENABLED,
        JSON.stringify(normalizeAssistLineEnabled(msg.assistLineEnabled))
    );
    node.setPluginData(
        PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_VISIBLE,
        String(Boolean(msg.assistLineVisible))
    );
    node.setPluginData(
        PLUGIN_DATA_KEYS.LAST_ROW_COLORS,
        JSON.stringify(normalizeRowColors(msg.rowColors))
    );

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

    const cellBottomStyle = normalizeSideStrokeStyle(msg.cellBottomStyle);
    const tabRightStyle = normalizeSideStrokeStyle(msg.tabRightStyle);
    const gridContainerStyle = normalizeGridStrokeStyle(msg.gridContainerStyle);

    node.setPluginData(
        PLUGIN_DATA_KEYS.LAST_CELL_BOTTOM_STYLE,
        cellBottomStyle ? JSON.stringify(cellBottomStyle) : ''
    );
    node.setPluginData(
        PLUGIN_DATA_KEYS.LAST_TAB_RIGHT_STYLE,
        tabRightStyle ? JSON.stringify(tabRightStyle) : ''
    );
    node.setPluginData(
        PLUGIN_DATA_KEYS.LAST_GRID_CONTAINER_STYLE,
        gridContainerStyle ? JSON.stringify(gridContainerStyle) : ''
    );
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
