import {
    MASTER_COMPONENT_CONFIG, STORAGE_KEY_COMPONENT_ID,
    VARIANT_PROPERTY_TYPE, PLUGIN_DATA_KEYS, MARK_NAME_PATTERNS,
    VARIANT_MAPPING
} from './constants';
import { traverse, findActualPropKey, normalizeHexColor } from './utils';
import { loadChartData, loadLocalStyleOverrides } from './data-layer';
import { extractChartColors, extractStyleFromNode } from './style';
import { collectColumns } from './drawing/shared';
import { applyBar } from './drawing/bar';
import { applyLine } from './drawing/line';
import { applyStackedBar } from './drawing/stacked';
import { applyAssistLines } from './drawing/assist-line';
import { applyStrokeInjection } from './drawing/stroke-injection';
import { getGraphHeight, getXEmptyHeight } from './drawing/shared';
import { resolveEffectiveYRange } from './drawing/y-range';
import type {
    AssistLineInjectionStyle,
    CellFillInjectionStyle,
    GridStrokeInjectionStyle,
    LocalStyleOverrideMask,
    LocalStyleOverrides,
    MarkInjectionStyle,
    SideStrokeInjectionStyle
} from '../shared/style-types';

// ==========================================
// COMPONENT DISCOVERY
// ==========================================

function normalizeMarkRatio(value: unknown): number | null {
    const ratio = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(ratio)) return null;
    return Math.max(0.01, Math.min(1.0, ratio));
}

function resolveMarkRatioFromNode(node: SceneNode, extractedRatio?: number): number {
    const savedRatioStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_BAR_PADDING);
    const savedRatio = normalizeMarkRatio(savedRatioStr);
    if (savedRatio !== null) return savedRatio;

    const extracted = normalizeMarkRatio(extractedRatio);
    if (extracted !== null) return extracted;

    return 0.8;
}

function resolveAssistLineEnabledFromNode(node: SceneNode) {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_ENABLED);
    if (!raw) {
        return { min: false, max: false, avg: false };
    }
    try {
        const parsed = JSON.parse(raw);
        return {
            min: Boolean(parsed?.min),
            max: Boolean(parsed?.max),
            avg: Boolean(parsed?.avg)
        };
    } catch {
        return { min: false, max: false, avg: false };
    }
}

function resolveAssistLineVisibleFromNode(node: SceneNode) {
    return node.getPluginData(PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_VISIBLE) === 'true';
}

function parseSavedSideStyleFromNode(node: SceneNode, key: string): SideStrokeInjectionStyle | null {
    const raw = node.getPluginData(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed as SideStrokeInjectionStyle;
    } catch {
        return null;
    }
}

function parseSavedGridStyleFromNode(node: SceneNode, key: string): GridStrokeInjectionStyle | null {
    const raw = node.getPluginData(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed as GridStrokeInjectionStyle;
    } catch {
        return null;
    }
}

function parseSavedAssistLineStyleFromNode(node: SceneNode, key: string): AssistLineInjectionStyle | null {
    const raw = node.getPluginData(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed as AssistLineInjectionStyle;
    } catch {
        return null;
    }
}

function parseSavedCellFillStyleFromNode(node: SceneNode, key: string): CellFillInjectionStyle | null {
    const raw = node.getPluginData(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed as CellFillInjectionStyle;
    } catch {
        return null;
    }
}

function parseSavedMarkStyleFromNode(node: SceneNode, key: string): MarkInjectionStyle | null {
    const raw = node.getPluginData(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed as MarkInjectionStyle;
    } catch {
        return null;
    }
}

function parseSavedMarkStylesFromNode(node: SceneNode, key: string): MarkInjectionStyle[] | null {
    const raw = node.getPluginData(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return parsed.filter((item) => item && typeof item === 'object') as MarkInjectionStyle[];
    } catch {
        return null;
    }
}

function parseSavedRowHeaderLabelsFromNode(node: SceneNode, key: string): string[] | null {
    const raw = node.getPluginData(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return parsed.map((item) => (typeof item === 'string' ? item.trim() : ''));
    } catch {
        return null;
    }
}

function parseSavedXAxisLabelsFromNode(node: SceneNode, key: string): string[] | null {
    const raw = node.getPluginData(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return parsed
            .map((item) => (typeof item === 'string' ? item.trim() : ''))
            .filter((item) => item.length > 0);
    } catch {
        return null;
    }
}

const DEFAULT_ROW_COLORS = [
    '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#DBEAFE',
    '#34D399', '#FBBF24', '#F87171', '#A78BFA', '#FB923C'
];

function getDefaultRowColor(index: number) {
    return DEFAULT_ROW_COLORS[index % DEFAULT_ROW_COLORS.length];
}

function resolveRowColorsFromNode(
    node: SceneNode,
    chartType: string,
    rowCount: number,
    fallbackColors?: string[]
) {
    const savedRaw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_ROW_COLORS);
    let saved: any[] = [];
    if (savedRaw) {
        try {
            const parsed = JSON.parse(savedRaw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const fallback = Array.isArray(fallbackColors) ? fallbackColors : [];
    const fallbackRowColors = (chartType === 'stackedBar' || chartType === 'stacked')
        ? [getDefaultRowColor(0), ...fallback]
        : fallback;
    const next: string[] = [];

    for (let i = 0; i < rowCount; i++) {
        const color =
            normalizeHexColor(saved[i]) ||
            normalizeHexColor(fallbackRowColors[i]) ||
            getDefaultRowColor(i);
        next.push(color);
    }

    return next;
}

function resolveColColorsFromNode(node: SceneNode, colCount: number) {
    const savedRaw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_COL_COLORS);
    let saved: any[] = [];
    if (savedRaw) {
        try {
            const parsed = JSON.parse(savedRaw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const next: string[] = [];
    for (let i = 0; i < colCount; i++) {
        next.push(normalizeHexColor(saved[i]) || getDefaultRowColor(i));
    }
    return next;
}

function resolveColColorEnabledFromNode(node: SceneNode, colCount: number) {
    const savedRaw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_COL_COLOR_ENABLED);
    let saved: any[] = [];
    if (savedRaw) {
        try {
            const parsed = JSON.parse(savedRaw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const next: boolean[] = [];
    for (let i = 0; i < colCount; i++) {
        next.push(Boolean(saved[i]));
    }
    return next;
}

function hasTruthyMask(mask: LocalStyleOverrideMask): boolean {
    return Object.values(mask).some((value) => Boolean(value));
}

function applyLocalOverridesToUiSnapshot(
    base: LocalStyleOverrides,
    overrides: LocalStyleOverrides,
    mask: LocalStyleOverrideMask
): LocalStyleOverrides {
    if (!hasTruthyMask(mask)) return { ...base };
    const next: LocalStyleOverrides = { ...base };
    (Object.keys(mask) as Array<keyof LocalStyleOverrideMask>).forEach((key) => {
        if (!mask[key]) return;
        const value = overrides[key as keyof LocalStyleOverrides];
        if (value === undefined) return;
        (next as any)[key] = value;
    });
    return next;
}

export async function getOrImportComponent(): Promise<ComponentNode | ComponentSetNode | null> {
    const { KEY, NAME } = MASTER_COMPONENT_CONFIG;

    const cachedId = await figma.clientStorage.getAsync(STORAGE_KEY_COMPONENT_ID);
    if (cachedId) {
        const cachedNode = figma.getNodeById(cachedId);
        if (cachedNode && (cachedNode.type === "COMPONENT" || cachedNode.type === "COMPONENT_SET")) {
            return cachedNode as ComponentNode | ComponentSetNode;
        } else {
            await figma.clientStorage.setAsync(STORAGE_KEY_COMPONENT_ID, undefined);
        }
    }

    if (KEY) {
        try {
            return await figma.importComponentByKeyAsync(KEY);
        } catch (e) { }
    }

    let found = figma.currentPage.findOne(n =>
        (n.type === "COMPONENT" || n.type === "COMPONENT_SET") && n.name === NAME
    );
    if (!found) {
        found = figma.root.findOne(n =>
            (n.type === "COMPONENT" || n.type === "COMPONENT_SET") && n.name === NAME
        );
    }

    if (found) {
        await figma.clientStorage.setAsync(STORAGE_KEY_COMPONENT_ID, found.id);
    }
    return found as (ComponentNode | ComponentSetNode);
}

// ==========================================
// PLUGIN UI INITIALIZATION
// ==========================================

export async function initPluginUI(
    node: SceneNode,
    autoApply = false,
    opts?: { reason?: 'selection' | 'auto-resize' }
) {
    const chartType = node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE) || inferChartType(node);
    const chartData = await loadChartData(node, chartType);

    // 저장된 두께 값 로드
    const lastStrokeWidth = node.getPluginData(PLUGIN_DATA_KEYS.LAST_STROKE_WIDTH);

    // Auto-Resize 처리
    if (autoApply && chartData.isSaved) {
        const lastDrawingVals = node.getPluginData(PLUGIN_DATA_KEYS.LAST_DRAWING_VALUES);
        const lastMode = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MODE);
        const lastYMin = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MIN);
        const lastYMax = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX);
        const mode = lastMode || 'raw';
        const isStacked = chartType === 'stackedBar' || chartType === 'stacked';

        let valuesToUse = chartData.values;
        if (lastDrawingVals) {
            try { valuesToUse = JSON.parse(lastDrawingVals); } catch (e) { }
        } else if (isStacked && Array.isArray(chartData.values)) {
            valuesToUse = chartData.values.slice(1);
        }

        const yMinInput = Number.isFinite(Number(lastYMin)) ? Number(lastYMin) : 0;
        const yMaxInput = lastYMax === '' ? null : (Number.isFinite(Number(lastYMax)) ? Number(lastYMax) : null);
        const rawYMaxAuto = mode === 'raw' && lastYMax === '';
        const effectiveY = resolveEffectiveYRange({
            chartType,
            mode,
            values: valuesToUse,
            yMin: yMinInput,
            yMax: yMaxInput,
            rawYMaxAuto
        });

        const assistLineEnabled = resolveAssistLineEnabledFromNode(node);
        const assistLineVisible = resolveAssistLineVisibleFromNode(node);
        const localOverrideState = node.type === 'INSTANCE'
            ? loadLocalStyleOverrides(node)
            : { overrides: {} as LocalStyleOverrides, mask: {} as LocalStyleOverrideMask };
        const runtimeRowColors = localOverrideState.mask.rowColors ? localOverrideState.overrides.rowColors : undefined;
        const runtimeColColors = localOverrideState.mask.colColors ? localOverrideState.overrides.colColors : undefined;
        const runtimeColEnabled = localOverrideState.mask.colColorEnabled ? localOverrideState.overrides.colColorEnabled : undefined;
        const runtimeMarkColorSource = localOverrideState.mask.markColorSource ? localOverrideState.overrides.markColorSource : undefined;
        const runtimeAssistLineStyle = localOverrideState.mask.assistLineStyle ? localOverrideState.overrides.assistLineStyle : undefined;
        const payload = {
            type: chartType,
            mode,
            values: valuesToUse,
            rawValues: chartData.values,
            cols: 0,
            cellCount: chartData.cellCount,
            yMin: effectiveY.yMin,
            yMax: effectiveY.yMax,
            rawYMaxAuto: effectiveY.rawYMaxAuto,
            markNum: chartData.markNum,
            strokeWidth: lastStrokeWidth ? Number(lastStrokeWidth) : undefined,
            markRatio: (chartType === 'bar' || chartType === 'stackedBar' || chartType === 'stacked')
                ? resolveMarkRatioFromNode(node)
                : undefined,
            assistLineVisible,
            assistLineEnabled,
            rowColors: runtimeRowColors,
            colColors: runtimeColColors,
            colColorEnabled: runtimeColEnabled,
            markColorSource: runtimeMarkColorSource,
            assistLineStyle: runtimeAssistLineStyle,
            reason: opts?.reason || 'auto-resize'
        };

        const H = getGraphHeight(node as FrameNode);
        const xEmptyHeight = getXEmptyHeight(node as FrameNode);
        if (chartType === 'stackedBar' || chartType === 'stacked') applyStackedBar(payload, H, node);
        else if (chartType === 'bar') applyBar(payload, H, node);
        else if (chartType === 'line') applyLine(payload, H, node);
        applyAssistLines(payload, node, H, { xEmptyHeight });
        if (node.type === 'INSTANCE' && hasTruthyMask(localOverrideState.mask)) {
            applyStrokeInjection(node, {
                chartType,
                markNum: chartData.markNum,
                ...(localOverrideState.mask.rowColors ? { rowColors: localOverrideState.overrides.rowColors } : {}),
                ...(localOverrideState.mask.colColors ? { colColors: localOverrideState.overrides.colColors } : {}),
                ...(localOverrideState.mask.colColorEnabled ? { colColorEnabled: localOverrideState.overrides.colColorEnabled } : {}),
                ...(localOverrideState.mask.cellFillStyle ? { cellFillStyle: localOverrideState.overrides.cellFillStyle } : {}),
                ...(localOverrideState.mask.cellTopStyle ? { cellTopStyle: localOverrideState.overrides.cellTopStyle } : {}),
                ...(localOverrideState.mask.tabRightStyle ? { tabRightStyle: localOverrideState.overrides.tabRightStyle } : {}),
                ...(localOverrideState.mask.gridContainerStyle ? { gridContainerStyle: localOverrideState.overrides.gridContainerStyle } : {}),
                ...(localOverrideState.mask.assistLineStyle ? { assistLineStyle: localOverrideState.overrides.assistLineStyle } : {}),
                ...(localOverrideState.mask.markStyle ? { markStyle: localOverrideState.overrides.markStyle } : {}),
                ...(localOverrideState.mask.markStyles ? { markStyles: localOverrideState.overrides.markStyles } : {}),
                ...(localOverrideState.mask.rowStrokeStyles ? { rowStrokeStyles: localOverrideState.overrides.rowStrokeStyles } : {}),
                ...(localOverrideState.mask.colStrokeStyle ? { colStrokeStyle: localOverrideState.overrides.colStrokeStyle } : {})
            });
        }
        return;
    }

    const lastMode = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MODE);
    const lastYMin = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MIN);
    const lastYMax = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX);
    const parsedLastYMin = lastYMin !== '' && Number.isFinite(Number(lastYMin)) ? Number(lastYMin) : undefined;
    const parsedLastYMax = lastYMax !== '' && Number.isFinite(Number(lastYMax)) ? Number(lastYMax) : undefined;
    const extractedColors = extractChartColors(node, chartType);
    const styleInfo = extractStyleFromNode(node, chartType);
    const isInstanceTarget = node.type === 'INSTANCE';
    const localOverrideState = isInstanceTarget
        ? loadLocalStyleOverrides(node)
        : { overrides: {} as LocalStyleOverrides, mask: {} as LocalStyleOverrideMask };
    const markRatio = resolveMarkRatioFromNode(node, styleInfo.markRatio);
    const assistLineEnabled = resolveAssistLineEnabledFromNode(node);
    const assistLineVisible = resolveAssistLineVisibleFromNode(node);
    const savedCellTopStyle =
        parseSavedSideStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_CELL_TOP_STYLE)
        || parseSavedSideStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_CELL_BOTTOM_STYLE);
    const savedCellFillStyle = parseSavedCellFillStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_CELL_FILL_STYLE);
    const savedTabRightStyle = parseSavedSideStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_TAB_RIGHT_STYLE);
    const savedGridContainerStyle = parseSavedGridStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_GRID_CONTAINER_STYLE);
    const savedAssistLineStyle = parseSavedAssistLineStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_STYLE);
    const savedMarkStyle = parseSavedMarkStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_MARK_STYLE);
    const savedMarkStyles = parseSavedMarkStylesFromNode(node, PLUGIN_DATA_KEYS.LAST_MARK_STYLES);
    const savedRowHeaderLabels = parseSavedRowHeaderLabelsFromNode(node, PLUGIN_DATA_KEYS.LAST_ROW_HEADER_LABELS);
    const savedXAxisLabels = parseSavedXAxisLabelsFromNode(node, PLUGIN_DATA_KEYS.LAST_X_AXIS_LABELS);
    const rowColorCount = Array.isArray(chartData.values) ? chartData.values.length : 1;
    const extractedRowColors = Array.from({ length: Math.max(1, rowColorCount) }, (_, i) =>
        normalizeHexColor(styleInfo.colors[i]) || getDefaultRowColor(i)
    );
    const colCount = chartType === 'stackedBar' || chartType === 'stacked'
        ? (Array.isArray(chartData.markNum) ? chartData.markNum.reduce((a, b) => a + b, 0) : 0)
        : (Array.isArray(chartData.values) && chartData.values.length > 0 ? chartData.values[0].length : 0);
    const extractedColColors = Array.from({ length: Math.max(1, colCount) }, () => extractedRowColors[0] || '#3B82F6');
    const extractedColEnabled = Array.from({ length: Math.max(1, colCount) }, () => false);
    const baseUiSnapshot: LocalStyleOverrides = isInstanceTarget
        ? {
            rowColors: extractedRowColors,
            colColors: extractedColColors,
            colColorEnabled: extractedColEnabled,
            markColorSource: 'row',
            cellFillStyle: styleInfo.cellFillStyle || undefined,
            cellTopStyle: undefined,
            tabRightStyle: undefined,
            gridContainerStyle: undefined,
            assistLineStyle: undefined,
            markStyle: styleInfo.markStyle || undefined,
            markStyles: styleInfo.markStyles || [],
            rowStrokeStyles: styleInfo.rowStrokeStyles || [],
            colStrokeStyle: styleInfo.colStrokeStyle || null
        }
        : {
            rowColors: resolveRowColorsFromNode(node, chartType, rowColorCount, styleInfo.colors),
            colColors: resolveColColorsFromNode(node, Math.max(1, colCount)),
            colColorEnabled: resolveColColorEnabledFromNode(node, Math.max(1, colCount)),
            markColorSource: node.getPluginData(PLUGIN_DATA_KEYS.LAST_MARK_COLOR_SOURCE) === 'col' ? 'col' : 'row'
        };
    const effectiveUiSnapshot = isInstanceTarget
        ? applyLocalOverridesToUiSnapshot(baseUiSnapshot, localOverrideState.overrides, localOverrideState.mask)
        : baseUiSnapshot;
    const rowColors = Array.isArray(effectiveUiSnapshot.rowColors) ? effectiveUiSnapshot.rowColors : extractedRowColors;
    const colColors = Array.isArray(effectiveUiSnapshot.colColors) ? effectiveUiSnapshot.colColors : extractedColColors;
    const colColorEnabled = Array.isArray(effectiveUiSnapshot.colColorEnabled) ? effectiveUiSnapshot.colColorEnabled : extractedColEnabled;
    const markColorSource = effectiveUiSnapshot.markColorSource === 'col' ? 'col' : 'row';

    figma.ui.postMessage({
        type: 'init',
        uiMode: 'edit',
        chartType: chartType,

        savedValues: chartData.values,
        savedMarkNum: chartData.markNum,
        lastCellCount: chartData.cellCount,

        lastMode: lastMode,
        lastYMin: parsedLastYMin,
        lastYMax: parsedLastYMax,

        markColors: extractedColors,
        rowColors,
        colColors,
        colColorEnabled,
        markColorSource,
        lastStrokeWidth: lastStrokeWidth ? Number(lastStrokeWidth) : 2,
        markRatio,
        assistLineVisible,
        assistLineEnabled,
        savedCellTopStyle: isInstanceTarget
            ? (localOverrideState.mask.cellTopStyle ? localOverrideState.overrides.cellTopStyle : undefined)
            : savedCellTopStyle,
        savedCellFillStyle: isInstanceTarget
            ? (localOverrideState.mask.cellFillStyle ? localOverrideState.overrides.cellFillStyle : undefined)
            : savedCellFillStyle,
        savedTabRightStyle: isInstanceTarget
            ? (localOverrideState.mask.tabRightStyle ? localOverrideState.overrides.tabRightStyle : undefined)
            : savedTabRightStyle,
        savedGridContainerStyle: isInstanceTarget
            ? (localOverrideState.mask.gridContainerStyle ? localOverrideState.overrides.gridContainerStyle : undefined)
            : savedGridContainerStyle,
        savedAssistLineStyle: isInstanceTarget
            ? (localOverrideState.mask.assistLineStyle ? localOverrideState.overrides.assistLineStyle : undefined)
            : savedAssistLineStyle,
        savedMarkStyle: isInstanceTarget
            ? (localOverrideState.mask.markStyle ? localOverrideState.overrides.markStyle : undefined)
            : savedMarkStyle,
        savedMarkStyles: isInstanceTarget
            ? (localOverrideState.mask.markStyles ? localOverrideState.overrides.markStyles : undefined)
            : savedMarkStyles,
        savedRowHeaderLabels,
        savedXAxisLabels,

        cellFillStyle: effectiveUiSnapshot.cellFillStyle || styleInfo.cellFillStyle || null,
        markStyle: effectiveUiSnapshot.markStyle || styleInfo.markStyle || null,
        markStyles: effectiveUiSnapshot.markStyles || styleInfo.markStyles || [],
        colStrokeStyle: effectiveUiSnapshot.colStrokeStyle || styleInfo.colStrokeStyle || null,
        chartContainerStrokeStyle: styleInfo.chartContainerStrokeStyle || null,
        assistLineStrokeStyle: styleInfo.assistLineStrokeStyle || null,
        cellStrokeStyles: styleInfo.cellStrokeStyles || [],
        rowStrokeStyles: effectiveUiSnapshot.rowStrokeStyles || styleInfo.rowStrokeStyles || [],
        isInstanceTarget,
        extractedStyleSnapshot: {
            rowColors: extractedRowColors,
            colColors: extractedColColors,
            colColorEnabled: extractedColEnabled,
            markColorSource: 'row',
            cellFillStyle: styleInfo.cellFillStyle || null,
            markStyle: styleInfo.markStyle || null,
            markStyles: styleInfo.markStyles || [],
            rowStrokeStyles: styleInfo.rowStrokeStyles || [],
            colStrokeStyle: styleInfo.colStrokeStyle || null,
            chartContainerStrokeStyle: styleInfo.chartContainerStrokeStyle || null,
            assistLineStrokeStyle: styleInfo.assistLineStrokeStyle || null
        },
        localStyleOverrides: localOverrideState.overrides,
        localStyleOverrideMask: localOverrideState.mask
    });
}

// ==========================================
// INFERENCE
// ==========================================

export function inferStructureFromGraph(chartType: string, graph: SceneNode) {
    const cols = collectColumns(graph);

    // 1. Detect Cell Count (Y축 눈금)
    let detectedCellCount = 4;
    const yAxis = (graph as FrameNode).findOne(n => MARK_NAME_PATTERNS.Y_AXIS_CONTAINER.test(n.name));
    if (yAxis && "children" in yAxis) {
        let maxIdx = 0;
        (yAxis as any).children.forEach((c: SceneNode) => {
            const match = MARK_NAME_PATTERNS.Y_CEL_ITEM.exec(c.name);
            if (match && c.visible) maxIdx = Math.max(maxIdx, parseInt(match[1]));
        });
        if (maxIdx > 0) detectedCellCount = maxIdx;
    }

    // 2. Count Columns
    const colCount = cols.length || 1;

    // 3. Detect Mark Count (Rows) & Generate Empty Values
    let markNum: any = 1;
    let rowCount = 1;

    if (chartType === "stackedBar") {
        const groupStructure: number[] = [];
        cols.forEach(colObj => {
            let parent: any = colObj.node;
            if ("children" in parent) {
                const tab = parent.children.find((n: SceneNode) => n.name === "tab");
                if (tab) parent = tab;
            }
            const group = parent.children.find((n: SceneNode) => MARK_NAME_PATTERNS.STACKED_GROUP.test(n.name));
            if (group && "children" in group) {
                const visibleBars = (group as any).children.filter((n: SceneNode) => MARK_NAME_PATTERNS.STACKED_SUB_INSTANCE.test(n.name) && n.visible);
                groupStructure.push(visibleBars.length);
            } else {
                groupStructure.push(0);
            }
        });
        markNum = groupStructure;
        const maxVisibleSegments = groupStructure.length > 0 ? Math.max(...groupStructure) : 0;
        rowCount = Math.max(1, maxVisibleSegments + 1);

    } else if (chartType === "bar" || chartType === "line") {
        let maxRows = 1;
        cols.forEach(c => {
            let parent: any = c.node;
            const tab = c.node && "children" in c.node ? (c.node as any).children.find((n: SceneNode) => n.name === "tab") : null;
            if (tab) parent = tab;

            let count = 0;
            if (parent.children) {
                parent.children.forEach((child: SceneNode) => {
                    if (!child.visible) return;
                    if (chartType === "bar") {
                        if (MARK_NAME_PATTERNS.BAR_ITEM_MULTI.test(child.name)) count++;
                    } else {
                        if (MARK_NAME_PATTERNS.LINE.test(child.name)) count++;
                    }
                });
            }
            if (chartType === "bar" && count === 0) {
                const singleBar = parent.children.find((n: SceneNode) => MARK_NAME_PATTERNS.BAR_ITEM_SINGLE.test(n.name));
                if (singleBar && singleBar.visible) count = 1;
            }
            if (count > maxRows) maxRows = count;
        });
        markNum = maxRows;
        rowCount = maxRows;
    }

    const valueCols = chartType === 'line' ? Math.max(2, colCount + 1) : colCount;
    const emptyValues = Array.from({ length: rowCount }, () => Array(valueCols).fill(0));

    return {
        values: emptyValues,
        markNum: markNum,
        cellCount: detectedCellCount
    };
}

export function inferChartType(node: SceneNode): string {
    if (node.type === "INSTANCE") {
        const props = node.componentProperties;
        const typePropKey = findActualPropKey(props, VARIANT_PROPERTY_TYPE);
        if (typePropKey && props[typePropKey]) return props[typePropKey].value as string;
    }
    let found = 'bar';
    traverse(node, n => {
        if (MARK_NAME_PATTERNS.STACKED_GROUP.test(n.name)) found = 'stackedBar';
        if (MARK_NAME_PATTERNS.LINE.test(n.name)) found = 'line';
    });
    return found;
}
