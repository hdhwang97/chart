import { PLUGIN_DATA_KEYS } from './constants';
import { inferStructureFromGraph } from './init';

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

    // UI에서 직접 넘어온 Stroke Width가 있다면 우선 저장
    if (msg.strokeWidth) {
        node.setPluginData(PLUGIN_DATA_KEYS.LAST_STROKE_WIDTH, String(msg.strokeWidth));
    } else if (styleInfo && styleInfo.strokeWidth !== undefined) {
        node.setPluginData(PLUGIN_DATA_KEYS.LAST_STROKE_WIDTH, String(styleInfo.strokeWidth));
    }

    // 추출된 스타일 정보 저장
    const requestedRatio = msg.type === 'bar' ? normalizeMarkRatio(msg.markRatio) : null;
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
}

export async function loadChartData(node: SceneNode, chartType: string) {
    const savedValuesStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_VALUES);
    const savedCell = node.getPluginData(PLUGIN_DATA_KEYS.LAST_CELL_COUNT);
    const savedMarkNumStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MARK_NUM);

    if (savedValuesStr) {
        try {
            const values = JSON.parse(savedValuesStr);
            const markNum = savedMarkNumStr ? JSON.parse(savedMarkNumStr) : 1;
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
