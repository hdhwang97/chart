import {
    MASTER_COMPONENT_CONFIG, STORAGE_KEY_COMPONENT_ID,
    VARIANT_PROPERTY_TYPE, PLUGIN_DATA_KEYS, MARK_NAME_PATTERNS,
    VARIANT_MAPPING
} from './constants';
import { traverse, findActualPropKey, normalizeHexColor } from './utils';
import { withLoadingOpacity } from './loading';
import { loadChartData, loadLocalStyleOverrides } from './data-layer';
import { extractChartColors, extractStyleFromNode } from './style';
import { applyColumnXEmptyVisibility, applyYAxisEmptyVisibility, applyYAxisVisibility, collectColumns } from './drawing/shared';
import { applyBar } from './drawing/bar';
import { applyLine, resolveLineFeature2Enabled, resolveLinePointVisible, syncFlatLineFillBottomPadding } from './drawing/line';
import { applyStackedBar } from './drawing/stacked';
import { applyAssistLines } from './drawing/assist-line';
import { applyStrokeInjection } from './drawing/stroke-injection';
import { getGraphHeight, getPlotAreaWidth, getXEmptyHeight } from './drawing/shared';
import { buildLineBundleMatrix, detectLineSeriesCountInColumns, hasLineBundleStructureInColumns } from './drawing/line-structure';
import { resolveEffectiveYRange } from './drawing/y-range';
import { PerfTracker, logApplyPerf } from './perf';
import type {
    AssistLineInjectionStyle,
    CellFillInjectionStyle,
    ColorMode,
    GridStrokeInjectionStyle,
    LineBackgroundInjectionStyle,
    LocalStyleOverrideMask,
    LocalStyleOverrides,
    MarkInjectionStyle,
    SideStrokeInjectionStyle
} from '../shared/style-types';
import { normalizeYLabelFormatMode } from '../shared/y-label-format';

export type SelectionTargetMeta = {
    id: string;
    name: string;
    chartType: string;
};

export type UiInitPerfTrace = {
    traceId: string;
    trigger: 'selectionchange' | 'target_switch' | 'manual';
    selectionStartedAtMs: number;
    targetNodeId?: string;
    selectionCount?: number;
    preInitSingleResolveMs?: number;
    preInitCollectTargetsMs?: number;
    preInitTotalMs?: number;
    pluginInitPostedAtMs?: number;
    pluginInitReason?: 'selection' | 'auto-resize';
};

type InitPluginUiOptions = {
    reason?: 'selection' | 'auto-resize';
    isCType?: boolean;
    selectionTargets?: SelectionTargetMeta[];
    activeTargetId?: string | null;
    deferStyleExtract?: boolean;
    uiPerfTrace?: UiInitPerfTrace;
};

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

function normalizeStrokeWidth(value: unknown): number | null {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

function nearlyEqual(a: number, b: number, epsilon = 1e-6) {
    return Math.abs(a - b) <= epsilon;
}

function parseMarkVariableSlotMap(raw: unknown): Record<string, string> {
    if (!raw) return {};
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return parseMarkVariableSlotMap(parsed);
        } catch {
            return {};
        }
    }
    if (typeof raw !== 'object') return {};
    const next: Record<string, string> = {};
    Object.entries(raw as Record<string, unknown>).forEach(([slot, id]) => {
        if (typeof id === 'string' && id) next[slot] = id;
    });
    return next;
}

function resolveVariableModeId(variable: Variable): string | null {
    const collection = figma.variables.getVariableCollectionById(variable.variableCollectionId);
    if (collection?.defaultModeId) return collection.defaultModeId;
    const valuesByMode = (variable as any).valuesByMode;
    if (!valuesByMode || typeof valuesByMode !== 'object') return null;
    const first = Object.keys(valuesByMode)[0];
    return first || null;
}

function readFloatVariableValue(variable: Variable): number | null {
    if (variable.resolvedType !== 'FLOAT') return null;
    const modeId = resolveVariableModeId(variable);
    if (!modeId) return null;
    const valuesByMode = (variable as any).valuesByMode;
    if (!valuesByMode || typeof valuesByMode !== 'object') return null;
    const value = valuesByMode[modeId];
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function resolveLineStrokeWidthFromVariableSlots(node: SceneNode, seriesCount: number): number | null {
    if (seriesCount <= 0) return null;
    const slotMap = parseMarkVariableSlotMap(
        node.getPluginData(PLUGIN_DATA_KEYS.LAST_MARK_VARIABLE_SLOT_MAP)
    );
    if (Object.keys(slotMap).length === 0) return null;

    const collected: number[] = [];
    for (let i = 1; i <= seriesCount; i++) {
        const variableId = slotMap[`number/${i}_thk`];
        if (!variableId) continue;
        const variable = figma.variables.getVariableById(variableId);
        if (!variable) continue;
        const value = readFloatVariableValue(variable);
        if (value !== null) collected.push(value);
    }

    if (collected.length === 0) {
        Object.entries(slotMap).forEach(([slot, variableId]) => {
            if (!/^number\/\d+_thk$/.test(slot)) return;
            const variable = figma.variables.getVariableById(variableId);
            if (!variable) return;
            const value = readFloatVariableValue(variable);
            if (value !== null) collected.push(value);
        });
    }

    if (collected.length === 0) return null;
    const first = collected[0];
    const isUniform = collected.every((value) => nearlyEqual(value, first));
    return isUniform ? first : null;
}

function resolveStrokeWidthForInit(
    node: SceneNode,
    chartType: string,
    fallbackStrokeWidth: unknown,
    seriesCount: number
): number {
    if (chartType === 'line') {
        const variableStrokeWidth = resolveLineStrokeWidthFromVariableSlots(node, Math.max(1, seriesCount));
        if (variableStrokeWidth !== null) return variableStrokeWidth;
    }
    const fallback = normalizeStrokeWidth(fallbackStrokeWidth);
    if (fallback !== null) return fallback;
    return 2;
}

function resolveAssistLineEnabledFromNode(node: SceneNode) {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_ENABLED);
    if (!raw) {
        return { min: false, max: false, avg: false, ctr: false };
    }
    try {
        const parsed = JSON.parse(raw);
        return {
            min: Boolean(parsed?.min),
            max: Boolean(parsed?.max),
            avg: Boolean(parsed?.avg),
            ctr: Boolean(parsed?.ctr)
        };
    } catch {
        return { min: false, max: false, avg: false, ctr: false };
    }
}

function resolveAssistLineVisibleFromNode(node: SceneNode) {
    return node.getPluginData(PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_VISIBLE) === 'true';
}

function resolveXAxisLabelsVisibleFromNode(node: SceneNode) {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_X_AXIS_LABELS_VISIBLE);
    if (!raw) return true;
    return raw !== 'false';
}

function resolveBarLabelVisibleFromNode(node: SceneNode) {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_BAR_LABEL_VISIBLE);
    if (!raw) return true;
    return raw !== 'false';
}

function resolveBarLabelSourceFromNode(node: SceneNode): 'row' | 'y' {
    return node.getPluginData(PLUGIN_DATA_KEYS.LAST_BAR_LABEL_SOURCE) === 'y' ? 'y' : 'row';
}

function resolveYAxisVisibleFromNode(node: SceneNode) {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_AXIS_VISIBLE);
    if (!raw) return true;
    return raw !== 'false';
}

function resolveLinePointVisibleFromNode(node: SceneNode, precomputedCols?: ReturnType<typeof collectColumns>) {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_LINE_POINT_VISIBLE);
    if (raw) return raw !== 'false';
    return resolveLinePointVisible(node, precomputedCols);
}

function resolveLineFeature2EnabledFromNode(node: SceneNode, precomputedCols?: ReturnType<typeof collectColumns>) {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_LINE_CURVE_ENABLED);
    if (raw) return raw === 'true';
    return resolveLineFeature2Enabled(node, precomputedCols);
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

function parseSavedLineBackgroundStyleFromNode(node: SceneNode, key: string): LineBackgroundInjectionStyle | null {
    const raw = node.getPluginData(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed as LineBackgroundInjectionStyle;
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

function normalizeColorMode(value: unknown): ColorMode {
    return value === 'paint_style' ? 'paint_style' : 'hex';
}

function normalizeStyleId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
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

function resolveRowColorModesFromNode(node: SceneNode, rowCount: number): ColorMode[] {
    const savedRaw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_ROW_COLOR_MODES);
    let saved: any[] = [];
    if (savedRaw) {
        try {
            const parsed = JSON.parse(savedRaw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const next: ColorMode[] = [];
    for (let i = 0; i < rowCount; i++) {
        next.push(normalizeColorMode(saved[i]));
    }
    return next;
}

function resolveRowPaintStyleIdsFromNode(node: SceneNode, rowCount: number): Array<string | null> {
    const savedRaw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_ROW_PAINT_STYLE_IDS);
    let saved: any[] = [];
    if (savedRaw) {
        try {
            const parsed = JSON.parse(savedRaw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const next: Array<string | null> = [];
    for (let i = 0; i < rowCount; i++) {
        next.push(normalizeStyleId(saved[i]));
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

function resolveColColorModesFromNode(node: SceneNode, colCount: number): ColorMode[] {
    const savedRaw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_COL_COLOR_MODES);
    let saved: any[] = [];
    if (savedRaw) {
        try {
            const parsed = JSON.parse(savedRaw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const next: ColorMode[] = [];
    for (let i = 0; i < colCount; i++) {
        next.push(normalizeColorMode(saved[i]));
    }
    return next;
}

function resolveColPaintStyleIdsFromNode(node: SceneNode, colCount: number): Array<string | null> {
    const savedRaw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_COL_PAINT_STYLE_IDS);
    let saved: any[] = [];
    if (savedRaw) {
        try {
            const parsed = JSON.parse(savedRaw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const next: Array<string | null> = [];
    for (let i = 0; i < colCount; i++) {
        next.push(normalizeStyleId(saved[i]));
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
    ) as SceneNode | null;
    if (!found) {
        found = figma.root.findOne(n =>
            (n.type === "COMPONENT" || n.type === "COMPONENT_SET") && n.name === NAME
        ) as SceneNode | null;
    }

    if (found) {
        await figma.clientStorage.setAsync(STORAGE_KEY_COMPONENT_ID, found.id);
    }
    return found as (ComponentNode | ComponentSetNode);
}

// ==========================================
// PLUGIN UI INITIALIZATION
// ==========================================

export async function syncChartOnResize(
    node: SceneNode,
    opts?: { reason?: 'selection' | 'auto-resize'; postPreviewUpdate?: boolean }
) {
    const perf = new PerfTracker();
    const reason = opts?.reason || 'auto-resize';
    const layoutOnly = reason === 'auto-resize';
    const chartType = node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE) || inferChartType(node);
    const chartData = await perf.step('load-chart-data', () => loadChartData(node, chartType));
    if (!chartData.isSaved) return;

    await withLoadingOpacity(node, async () => {
        // 저장된 두께 값 로드
        const lastStrokeWidth = node.getPluginData(PLUGIN_DATA_KEYS.LAST_STROKE_WIDTH);
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
        const precomputedLineCols = chartType === 'line' ? collectColumns(node) : undefined;
        const precomputedVisibleLineCols = chartType === 'line'
            ? (precomputedLineCols || []).filter((col) => col.node.visible)
            : undefined;
        const precomputedLineMatrix = chartType === 'line'
            ? buildLineBundleMatrix(
                precomputedVisibleLineCols || [],
                Array.isArray(valuesToUse) ? valuesToUse.length : 0
            )
            : undefined;

        const yMinInput = Number.isFinite(Number(lastYMin)) ? Number(lastYMin) : 0;
        const yMaxInput = lastYMax === '' ? null : (Number.isFinite(Number(lastYMax)) ? Number(lastYMax) : null);
        const rawYMaxAuto = mode === 'raw' && lastYMax === '';
        const effectiveY = await perf.step('resolve-y-range', () => resolveEffectiveYRange({
            chartType,
            mode,
            values: valuesToUse,
            yMin: yMinInput,
            yMax: yMaxInput,
            rawYMaxAuto
        }));

        const assistLineEnabled = resolveAssistLineEnabledFromNode(node);
        const assistLineVisible = resolveAssistLineVisibleFromNode(node);
        const xAxisLabelsVisible = resolveXAxisLabelsVisibleFromNode(node);
        const barLabelVisible = resolveBarLabelVisibleFromNode(node);
        const barLabelSource = resolveBarLabelSourceFromNode(node);
        const yAxisVisible = resolveYAxisVisibleFromNode(node);
        const linePointVisible = chartType === 'line'
            ? resolveLinePointVisibleFromNode(node, precomputedLineCols)
            : true;
        const lineFeature2Enabled = chartType === 'line'
            ? resolveLineFeature2EnabledFromNode(node, precomputedLineCols)
            : false;
        const localOverrideState = node.type === 'INSTANCE'
            ? loadLocalStyleOverrides(node)
            : { overrides: {} as LocalStyleOverrides, mask: {} as LocalStyleOverrideMask };
        const runtimeRowColors = !layoutOnly && localOverrideState.mask.rowColors ? localOverrideState.overrides.rowColors : undefined;
        const runtimeRowColorModes = !layoutOnly && localOverrideState.mask.rowColorModes ? localOverrideState.overrides.rowColorModes : undefined;
        const runtimeRowPaintStyleIds = !layoutOnly && localOverrideState.mask.rowPaintStyleIds ? localOverrideState.overrides.rowPaintStyleIds : undefined;
        const runtimeColColors = !layoutOnly && localOverrideState.mask.colColors ? localOverrideState.overrides.colColors : undefined;
        const runtimeColColorModes = !layoutOnly && localOverrideState.mask.colColorModes ? localOverrideState.overrides.colColorModes : undefined;
        const runtimeColPaintStyleIds = !layoutOnly && localOverrideState.mask.colPaintStyleIds ? localOverrideState.overrides.colPaintStyleIds : undefined;
        const runtimeColEnabled = !layoutOnly && localOverrideState.mask.colColorEnabled
            ? localOverrideState.overrides.colColorEnabled
            : undefined;
        const runtimeMarkColorSource = !layoutOnly && localOverrideState.mask.markColorSource ? localOverrideState.overrides.markColorSource : undefined;
        const runtimeAssistLineStyle = !layoutOnly && localOverrideState.mask.assistLineStyle ? localOverrideState.overrides.assistLineStyle : undefined;
        const savedMarkStyle = !layoutOnly ? parseSavedMarkStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_MARK_STYLE) : undefined;
        const savedMarkStyles = !layoutOnly ? parseSavedMarkStylesFromNode(node, PLUGIN_DATA_KEYS.LAST_MARK_STYLES) : undefined;
        const runtimeMarkStyle = !layoutOnly && localOverrideState.mask.markStyle ? localOverrideState.overrides.markStyle : undefined;
        const runtimeMarkStyles = !layoutOnly && localOverrideState.mask.markStyles ? localOverrideState.overrides.markStyles : undefined;
        const savedRowHeaderLabels = parseSavedRowHeaderLabelsFromNode(node, PLUGIN_DATA_KEYS.LAST_ROW_HEADER_LABELS);
        const rowCount = Array.isArray(chartData.values) ? chartData.values.length : 1;
        const colCount = chartType === 'stackedBar' || chartType === 'stacked'
            ? (Array.isArray(chartData.markNum) ? chartData.markNum.reduce((acc, cur) => acc + (Number(cur) || 0), 0) : 0)
            : (Array.isArray(valuesToUse) && Array.isArray(valuesToUse[0]) ? valuesToUse[0].length : 1);
        const strokeWidthForPayload = resolveStrokeWidthForInit(
            node,
            chartType,
            lastStrokeWidth ? Number(lastStrokeWidth) : undefined,
            rowCount
        );
        const payload = {
            type: chartType,
            mode,
            values: valuesToUse,
            rawValues: chartData.values,
            rowHeaderLabels: Array.isArray(savedRowHeaderLabels) ? savedRowHeaderLabels : [],
            barLabelSource,
            cols: 0,
            cellCount: chartData.cellCount,
            yMin: effectiveY.yMin,
            yMax: effectiveY.yMax,
            rawYMaxAuto: effectiveY.rawYMaxAuto,
            markNum: chartData.markNum,
            strokeWidth: strokeWidthForPayload,
            markRatio: (chartType === 'bar' || chartType === 'stackedBar' || chartType === 'stacked')
                ? resolveMarkRatioFromNode(node)
                : undefined,
            xAxisLabelsVisible,
            barLabelVisible,
            yAxisVisible,
            linePointVisible,
            lineFeature2Enabled,
            assistLineVisible,
            assistLineEnabled,
            rowColors: layoutOnly ? undefined : (runtimeRowColors ?? resolveRowColorsFromNode(node, chartType, Math.max(1, rowCount))),
            rowColorModes: layoutOnly ? undefined : (runtimeRowColorModes ?? resolveRowColorModesFromNode(node, Math.max(1, rowCount))),
            rowPaintStyleIds: layoutOnly ? undefined : (runtimeRowPaintStyleIds ?? resolveRowPaintStyleIdsFromNode(node, Math.max(1, rowCount))),
            colColors: layoutOnly ? undefined : (runtimeColColors ?? resolveColColorsFromNode(node, Math.max(1, colCount))),
            colColorModes: layoutOnly ? undefined : (runtimeColColorModes ?? resolveColColorModesFromNode(node, Math.max(1, colCount))),
            colPaintStyleIds: layoutOnly ? undefined : (runtimeColPaintStyleIds ?? resolveColPaintStyleIdsFromNode(node, Math.max(1, colCount))),
            colColorEnabled: runtimeColEnabled
                ?? (layoutOnly ? undefined : resolveColColorEnabledFromNode(node, Math.max(1, colCount))),
            markColorSource: runtimeMarkColorSource,
            markStyle: runtimeMarkStyle ?? savedMarkStyle ?? undefined,
            markStyles: runtimeMarkStyles ?? savedMarkStyles ?? undefined,
            assistLineStyle: runtimeAssistLineStyle,
            deferLineSegmentStrokeStyling: chartType === 'line',
            layoutOnly,
            reason
        };

        await perf.step('basic-setup', () => {
            applyColumnXEmptyVisibility(node, xAxisLabelsVisible);
            applyYAxisEmptyVisibility(node, xAxisLabelsVisible);
            applyYAxisVisibility(node, yAxisVisible);
        });
        const H = getGraphHeight(node as FrameNode);
        const xEmptyHeight = getXEmptyHeight(node as FrameNode);
        await perf.step('draw-chart', async () => {
            if (chartType === 'stackedBar' || chartType === 'stacked') {
                await applyStackedBar(payload, H, node);
            } else if (chartType === 'bar') {
                await applyBar(payload, H, node);
            } else if (chartType === 'line') {
                const lineResult = await applyLine(payload, H, node, undefined, {
                    cols: precomputedVisibleLineCols,
                    matrix: precomputedLineMatrix
                });
                if (!lineResult.ok) {
                    if (lineResult.errorCode === 'cancelled') {
                        return;
                    }
                    figma.notify('Line apply failed: required line structure is missing.');
                    console.error('[chart-plugin][line-apply-failed]', {
                        reason,
                        targetNodeId: node.id,
                        targetNodeName: node.name,
                        lineResult
                    });
                    return;
                }
            }
            applyAssistLines(payload, node, H, { xEmptyHeight });
        });
        const hasLocalStyleOverrides = node.type === 'INSTANCE' && hasTruthyMask(localOverrideState.mask);
        const shouldApplyResizeStyleInjection = hasLocalStyleOverrides && reason !== 'auto-resize';
        if (shouldApplyResizeStyleInjection) {
            await perf.step('stroke-injection', () => applyStrokeInjection(node, {
                chartType,
                markNum: chartData.markNum,
                ...(localOverrideState.mask.rowColors ? { rowColors: localOverrideState.overrides.rowColors } : {}),
                ...(localOverrideState.mask.rowColorModes ? { rowColorModes: localOverrideState.overrides.rowColorModes } : {}),
                ...(localOverrideState.mask.rowPaintStyleIds ? { rowPaintStyleIds: localOverrideState.overrides.rowPaintStyleIds } : {}),
                ...(localOverrideState.mask.colColors ? { colColors: localOverrideState.overrides.colColors } : {}),
                ...(localOverrideState.mask.colColorModes ? { colColorModes: localOverrideState.overrides.colColorModes } : {}),
                ...(localOverrideState.mask.colPaintStyleIds ? { colPaintStyleIds: localOverrideState.overrides.colPaintStyleIds } : {}),
                ...(localOverrideState.mask.colColorEnabled ? { colColorEnabled: localOverrideState.overrides.colColorEnabled } : {}),
                ...(localOverrideState.mask.cellFillStyle ? { cellFillStyle: localOverrideState.overrides.cellFillStyle } : {}),
                ...(localOverrideState.mask.lineBackgroundStyle ? { lineBackgroundStyle: localOverrideState.overrides.lineBackgroundStyle } : {}),
                ...(localOverrideState.mask.cellTopStyle ? { cellTopStyle: localOverrideState.overrides.cellTopStyle } : {}),
                ...(localOverrideState.mask.tabRightStyle ? { tabRightStyle: localOverrideState.overrides.tabRightStyle } : {}),
                ...(localOverrideState.mask.gridContainerStyle ? { gridContainerStyle: localOverrideState.overrides.gridContainerStyle } : {}),
                ...(localOverrideState.mask.assistLineStyle ? { assistLineStyle: localOverrideState.overrides.assistLineStyle } : {}),
                ...(localOverrideState.mask.markStyle ? { markStyle: localOverrideState.overrides.markStyle } : {}),
                ...(localOverrideState.mask.markStyles ? { markStyles: localOverrideState.overrides.markStyles } : {}),
                ...(localOverrideState.mask.rowStrokeStyles ? { rowStrokeStyles: localOverrideState.overrides.rowStrokeStyles } : {}),
                ...(localOverrideState.mask.colStrokeStyle ? { colStrokeStyle: localOverrideState.overrides.colStrokeStyle } : {})
            }));
        }
        if (hasLocalStyleOverrides && chartType === 'line') {
            await perf.step('flat-padding-sync', () => syncFlatLineFillBottomPadding(
                node,
                precomputedVisibleLineCols,
                precomputedLineMatrix
            ));
        }
        if (opts?.postPreviewUpdate) {
            await perf.step('post-preview-update', () => figma.ui.postMessage({
                type: 'preview_plot_size_updated',
                previewPlotWidth: getPlotAreaWidth(node),
                previewPlotHeight: getGraphHeight(node as FrameNode)
            }));
        }
    });
    logApplyPerf(perf.done(), {
        messageType: 'sync-chart',
        chartType,
        targetNodeId: node.id,
        targetNodeName: node.name,
        targetNodeType: node.type,
        applyPolicy: node.type === 'COMPONENT' ? 'template-master' : (node.type === 'INSTANCE' ? 'instance-data' : 'default'),
        reason
    });
}

export async function initPluginUI(
    node: SceneNode,
    autoApply = false,
    opts?: InitPluginUiOptions
) {
    if (autoApply) {
        await syncChartOnResize(node, {
            reason: opts?.reason,
            postPreviewUpdate: true
        });
        return;
    }

    const perf = new PerfTracker();
    const chartType = node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE) || inferChartType(node);
    const chartData = await perf.step('load-chart-data', () => loadChartData(node, chartType));

    // 저장된 두께 값 로드
    const lastStrokeWidth = node.getPluginData(PLUGIN_DATA_KEYS.LAST_STROKE_WIDTH);
    const rowColorCount = Array.isArray(chartData.values) ? chartData.values.length : 1;
    const initStrokeWidth = resolveStrokeWidthForInit(
        node,
        chartType,
        lastStrokeWidth ? Number(lastStrokeWidth) : undefined,
        rowColorCount
    );

    const lastMode = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MODE);
    const lastYMin = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MIN);
    const lastYMax = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX);
    const lastYLabelFormat = normalizeYLabelFormatMode(node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_LABEL_FORMAT));
    const parsedLastYMin = lastYMin !== '' && Number.isFinite(Number(lastYMin)) ? Number(lastYMin) : undefined;
    const parsedLastYMax = lastYMax !== '' && Number.isFinite(Number(lastYMax)) ? Number(lastYMax) : undefined;
    const colCount = chartType === 'stackedBar' || chartType === 'stacked'
        ? (Array.isArray(chartData.markNum) ? chartData.markNum.reduce((a, b) => a + b, 0) : 0)
        : (Array.isArray(chartData.values) && chartData.values.length > 0 ? chartData.values[0].length : 0);
    const deferStyleExtract = opts?.deferStyleExtract === true;
    let cols: ReturnType<typeof collectColumns> = [];
    let hasLoadedCols = false;
    const ensureCols = async () => {
        if (hasLoadedCols) return cols;
        cols = await perf.step('collect-columns', () => collectColumns(node));
        hasLoadedCols = true;
        return cols;
    };
    if (!deferStyleExtract) {
        await ensureCols();
    }
    const shouldUseSelectionFastPath = Boolean(
        chartData.isSaved
        && opts?.reason === 'selection'
        && Math.max(colCount, hasLoadedCols ? cols.length : 0) >= 40
    );
    const styleInfo = deferStyleExtract
        ? {
            colors: [] as string[],
            markRatio: undefined,
            cornerRadius: 0,
            strokeWidth: initStrokeWidth,
            cellFillStyle: null,
            lineBackgroundStyle: null,
            markStyle: null,
            markStyles: [] as MarkInjectionStyle[],
            colStrokeStyle: null,
            chartContainerStrokeStyle: null,
            assistLineStrokeStyle: null,
            cellStrokeStyles: [] as any[],
            rowStrokeStyles: [] as any[]
        }
        : await perf.step('style-extract', async () => {
            const resolvedCols = await ensureCols();
            return extractStyleFromNode(node, chartType, {
                columns: resolvedCols,
                fastPath: shouldUseSelectionFastPath
            });
        });
    const extractedColors = deferStyleExtract
        ? resolveRowColorsFromNode(node, chartType, Math.max(1, rowColorCount))
        : styleInfo.colors;
    const isInstanceTarget = node.type === 'INSTANCE';
    const localOverrideState = isInstanceTarget
        ? loadLocalStyleOverrides(node)
        : { overrides: {} as LocalStyleOverrides, mask: {} as LocalStyleOverrideMask };
    const markRatio = resolveMarkRatioFromNode(node, deferStyleExtract ? undefined : styleInfo.markRatio);
    const assistLineEnabled = resolveAssistLineEnabledFromNode(node);
    const assistLineVisible = resolveAssistLineVisibleFromNode(node);
    const xAxisLabelsVisible = resolveXAxisLabelsVisibleFromNode(node);
    const barLabelVisible = resolveBarLabelVisibleFromNode(node);
    const barLabelSource = resolveBarLabelSourceFromNode(node);
    const yAxisVisible = resolveYAxisVisibleFromNode(node);
    const hasSavedLinePointVisible = Boolean(node.getPluginData(PLUGIN_DATA_KEYS.LAST_LINE_POINT_VISIBLE));
    const hasSavedLineCurveEnabled = Boolean(node.getPluginData(PLUGIN_DATA_KEYS.LAST_LINE_CURVE_ENABLED));
    const linePointVisible = chartType === 'line'
        ? (
            hasSavedLinePointVisible || !deferStyleExtract
                ? resolveLinePointVisibleFromNode(node, hasLoadedCols ? cols : undefined)
                : true
        )
        : true;
    const lineFeature2Enabled = chartType === 'line'
        ? (
            hasSavedLineCurveEnabled || !deferStyleExtract
                ? resolveLineFeature2EnabledFromNode(node, hasLoadedCols ? cols : undefined)
                : false
        )
        : false;
    const savedCellTopStyle =
        parseSavedSideStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_CELL_TOP_STYLE)
        || parseSavedSideStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_CELL_BOTTOM_STYLE);
    const savedCellFillStyle = parseSavedCellFillStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_CELL_FILL_STYLE);
    const savedLineBackgroundStyle = parseSavedLineBackgroundStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_LINE_BACKGROUND_STYLE);
    const savedTabRightStyle = parseSavedSideStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_TAB_RIGHT_STYLE);
    const savedGridContainerStyle = parseSavedGridStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_GRID_CONTAINER_STYLE);
    const savedAssistLineStyle = parseSavedAssistLineStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_STYLE);
    const savedMarkStyle = parseSavedMarkStyleFromNode(node, PLUGIN_DATA_KEYS.LAST_MARK_STYLE);
    const savedMarkStyles = parseSavedMarkStylesFromNode(node, PLUGIN_DATA_KEYS.LAST_MARK_STYLES);
    const savedRowHeaderLabels = parseSavedRowHeaderLabelsFromNode(node, PLUGIN_DATA_KEYS.LAST_ROW_HEADER_LABELS);
    const savedXAxisLabels = parseSavedXAxisLabelsFromNode(node, PLUGIN_DATA_KEYS.LAST_X_AXIS_LABELS);
    const previewPlotWidth = getPlotAreaWidth(node);
    const previewPlotHeight = getGraphHeight(node as FrameNode, hasLoadedCols ? cols : []);
    const extractedRowColors = Array.from({ length: Math.max(1, rowColorCount) }, (_, i) =>
        normalizeHexColor(styleInfo.colors[i]) || getDefaultRowColor(i)
    );
    const extractedColColors = Array.from({ length: Math.max(1, colCount) }, () => extractedRowColors[0] || '#3B82F6');
    const extractedColEnabled = Array.from({ length: Math.max(1, colCount) }, () => false);
    const shouldUseSavedPaletteForInstance = isInstanceTarget && chartData.isSaved;
    const fallbackCellFillStyle = savedCellFillStyle || styleInfo.cellFillStyle || null;
    const fallbackLineBackgroundStyle = savedLineBackgroundStyle || styleInfo.lineBackgroundStyle || null;
    const fallbackMarkStyle = savedMarkStyle || styleInfo.markStyle || null;
    const fallbackMarkStyles = savedMarkStyles || styleInfo.markStyles || [];
    const baseUiSnapshot: LocalStyleOverrides = isInstanceTarget
        ? {
            rowColors: shouldUseSavedPaletteForInstance
                ? resolveRowColorsFromNode(node, chartType, rowColorCount, styleInfo.colors)
                : extractedRowColors,
            rowColorModes: shouldUseSavedPaletteForInstance
                ? resolveRowColorModesFromNode(node, rowColorCount)
                : Array.from({ length: Math.max(1, rowColorCount) }, () => 'hex' as ColorMode),
            rowPaintStyleIds: shouldUseSavedPaletteForInstance
                ? resolveRowPaintStyleIdsFromNode(node, rowColorCount)
                : Array.from({ length: Math.max(1, rowColorCount) }, () => null as string | null),
            colColors: shouldUseSavedPaletteForInstance
                ? resolveColColorsFromNode(node, Math.max(1, colCount))
                : extractedColColors,
            colColorModes: shouldUseSavedPaletteForInstance
                ? resolveColColorModesFromNode(node, Math.max(1, colCount))
                : Array.from({ length: Math.max(1, colCount) }, () => 'hex' as ColorMode),
            colPaintStyleIds: shouldUseSavedPaletteForInstance
                ? resolveColPaintStyleIdsFromNode(node, Math.max(1, colCount))
                : Array.from({ length: Math.max(1, colCount) }, () => null as string | null),
            colColorEnabled: shouldUseSavedPaletteForInstance
                ? resolveColColorEnabledFromNode(node, Math.max(1, colCount))
                : extractedColEnabled,
            markColorSource: shouldUseSavedPaletteForInstance
                ? (node.getPluginData(PLUGIN_DATA_KEYS.LAST_MARK_COLOR_SOURCE) === 'col' ? 'col' : 'row')
                : 'row',
            cellFillStyle: fallbackCellFillStyle || undefined,
            lineBackgroundStyle: fallbackLineBackgroundStyle || undefined,
            cellTopStyle: undefined,
            tabRightStyle: undefined,
            gridContainerStyle: undefined,
            assistLineStyle: undefined,
            markStyle: fallbackMarkStyle || undefined,
            markStyles: fallbackMarkStyles,
            rowStrokeStyles: styleInfo.rowStrokeStyles || [],
            colStrokeStyle: styleInfo.colStrokeStyle || null
        }
        : {
            rowColors: resolveRowColorsFromNode(node, chartType, rowColorCount, styleInfo.colors),
            rowColorModes: resolveRowColorModesFromNode(node, rowColorCount),
            rowPaintStyleIds: resolveRowPaintStyleIdsFromNode(node, rowColorCount),
            colColors: resolveColColorsFromNode(node, Math.max(1, colCount)),
            colColorModes: resolveColColorModesFromNode(node, Math.max(1, colCount)),
            colPaintStyleIds: resolveColPaintStyleIdsFromNode(node, Math.max(1, colCount)),
            colColorEnabled: resolveColColorEnabledFromNode(node, Math.max(1, colCount)),
            markColorSource: node.getPluginData(PLUGIN_DATA_KEYS.LAST_MARK_COLOR_SOURCE) === 'col' ? 'col' : 'row'
        };
    const effectiveUiSnapshot = isInstanceTarget
        ? applyLocalOverridesToUiSnapshot(baseUiSnapshot, localOverrideState.overrides, localOverrideState.mask)
        : baseUiSnapshot;
    const rowColors = Array.isArray(effectiveUiSnapshot.rowColors) ? effectiveUiSnapshot.rowColors : extractedRowColors;
    const rowColorModes = Array.isArray(effectiveUiSnapshot.rowColorModes)
        ? effectiveUiSnapshot.rowColorModes.map((value) => normalizeColorMode(value))
        : Array.from({ length: Math.max(1, rowColorCount) }, () => 'hex' as ColorMode);
    const rowPaintStyleIds = Array.isArray(effectiveUiSnapshot.rowPaintStyleIds)
        ? effectiveUiSnapshot.rowPaintStyleIds.map((value) => normalizeStyleId(value))
        : Array.from({ length: Math.max(1, rowColorCount) }, () => null as string | null);
    const colColors = Array.isArray(effectiveUiSnapshot.colColors) ? effectiveUiSnapshot.colColors : extractedColColors;
    const colColorModes = Array.isArray(effectiveUiSnapshot.colColorModes)
        ? effectiveUiSnapshot.colColorModes.map((value) => normalizeColorMode(value))
        : Array.from({ length: Math.max(1, colCount) }, () => 'hex' as ColorMode);
    const colPaintStyleIds = Array.isArray(effectiveUiSnapshot.colPaintStyleIds)
        ? effectiveUiSnapshot.colPaintStyleIds.map((value) => normalizeStyleId(value))
        : Array.from({ length: Math.max(1, colCount) }, () => null as string | null);
    const colColorEnabled = Array.isArray(effectiveUiSnapshot.colColorEnabled) ? effectiveUiSnapshot.colColorEnabled : extractedColEnabled;
    const markColorSource = effectiveUiSnapshot.markColorSource === 'col' ? 'col' : 'row';
    const selectionTargets = Array.isArray(opts?.selectionTargets) ? opts.selectionTargets : [];
    const activeTargetId = typeof opts?.activeTargetId === 'string' ? opts.activeTargetId : node.id;
    const activeTargetIndex = selectionTargets.findIndex((target) => target.id === activeTargetId);
    const uiPerfTrace = opts?.uiPerfTrace
        ? {
            ...opts.uiPerfTrace,
            pluginInitPostedAtMs: Date.now(),
            pluginInitReason: opts?.reason || 'selection'
        }
        : undefined;
    const markVariableSlotMap = parseMarkVariableSlotMap(
        node.getPluginData(PLUGIN_DATA_KEYS.LAST_MARK_VARIABLE_SLOT_MAP)
    );

    await perf.step('post-message', () => figma.ui.postMessage({
        type: 'init',
        uiMode: 'edit',
        chartType: chartType,
        selectionTargets,
        activeTargetId,
        activeTargetIndex: activeTargetIndex >= 0 ? activeTargetIndex : 0,
        selectionCount: selectionTargets.length,

        savedValues: chartData.values,
        savedMarkNum: chartData.markNum,
        lastCellCount: chartData.cellCount,

        lastMode: lastMode,
        lastYMin: parsedLastYMin,
        lastYMax: parsedLastYMax,
        lastYLabelFormat,

        markColors: extractedColors,
        rowColors,
        rowColorModes,
        rowPaintStyleIds,
        colColors,
        colColorModes,
        colPaintStyleIds,
        colColorEnabled,
        markVariableSlotMap,
        markColorSource,
        lastStrokeWidth: initStrokeWidth,
        markRatio,
        xAxisLabelsVisible,
        barLabelVisible,
        barLabelSource,
        yAxisVisible,
        linePointVisible,
        lineFeature2Enabled,
        assistLineVisible,
        assistLineEnabled,
        savedCellTopStyle: isInstanceTarget
            ? (localOverrideState.mask.cellTopStyle ? localOverrideState.overrides.cellTopStyle : undefined)
            : savedCellTopStyle,
        savedCellFillStyle: isInstanceTarget
            ? (localOverrideState.mask.cellFillStyle ? localOverrideState.overrides.cellFillStyle : undefined)
            : savedCellFillStyle,
        savedLineBackgroundStyle: isInstanceTarget
            ? (localOverrideState.mask.lineBackgroundStyle ? localOverrideState.overrides.lineBackgroundStyle : undefined)
            : savedLineBackgroundStyle,
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
        previewPlotWidth,
        previewPlotHeight,

        cellFillStyle: effectiveUiSnapshot.cellFillStyle || fallbackCellFillStyle,
        lineBackgroundStyle: effectiveUiSnapshot.lineBackgroundStyle || fallbackLineBackgroundStyle,
        markStyle: effectiveUiSnapshot.markStyle || fallbackMarkStyle,
        markStyles: effectiveUiSnapshot.markStyles || fallbackMarkStyles,
        colStrokeStyle: effectiveUiSnapshot.colStrokeStyle || styleInfo.colStrokeStyle || null,
        chartContainerStrokeStyle: styleInfo.chartContainerStrokeStyle || null,
        assistLineStrokeStyle: styleInfo.assistLineStrokeStyle || null,
        cellStrokeStyles: styleInfo.cellStrokeStyles || [],
        rowStrokeStyles: effectiveUiSnapshot.rowStrokeStyles || styleInfo.rowStrokeStyles || [],
        isInstanceTarget,
        isTemplateMasterTarget: node.type === 'COMPONENT',
        isCType: Boolean(opts?.isCType),
        extractedStyleSnapshot: {
            rowColors: extractedRowColors,
            rowColorModes: Array.from({ length: Math.max(1, rowColorCount) }, () => 'hex' as ColorMode),
            rowPaintStyleIds: Array.from({ length: Math.max(1, rowColorCount) }, () => null as string | null),
            colColors: extractedColColors,
            colColorModes: Array.from({ length: Math.max(1, colCount) }, () => 'hex' as ColorMode),
            colPaintStyleIds: Array.from({ length: Math.max(1, colCount) }, () => null as string | null),
            colColorEnabled: extractedColEnabled,
            markColorSource: 'row',
            cellFillStyle: fallbackCellFillStyle,
            lineBackgroundStyle: fallbackLineBackgroundStyle,
            markStyle: fallbackMarkStyle,
            markStyles: fallbackMarkStyles,
            rowStrokeStyles: styleInfo.rowStrokeStyles || [],
            colStrokeStyle: styleInfo.colStrokeStyle || null,
            chartContainerStrokeStyle: styleInfo.chartContainerStrokeStyle || null,
            assistLineStrokeStyle: styleInfo.assistLineStrokeStyle || null
        },
        localStyleOverrides: localOverrideState.overrides,
        localStyleOverrideMask: localOverrideState.mask,
        uiPerfTrace
    }));
    logApplyPerf(perf.done(), {
        messageType: 'init-ui',
        chartType,
        targetNodeId: node.id,
        targetNodeName: node.name,
        targetNodeType: node.type,
        applyPolicy: node.type === 'COMPONENT' ? 'template-master' : (node.type === 'INSTANCE' ? 'instance-data' : 'default'),
        reason: opts?.reason || 'selection'
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

    } else if (chartType === "line") {
        const visibleCols = cols.filter((col) => col.node.visible);
        const maxRows = detectLineSeriesCountInColumns(visibleCols.length > 0 ? visibleCols : cols);
        markNum = maxRows;
        rowCount = Math.max(1, maxRows);
    } else if (chartType === "bar") {
        let maxRows = 1;
        cols.forEach(c => {
            let parent: any = c.node;
            const tab = c.node && "children" in c.node ? (c.node as any).children.find((n: SceneNode) => n.name === "tab") : null;
            if (tab) parent = tab;

            let count = 0;
            if (parent.children) {
                parent.children.forEach((child: SceneNode) => {
                    if (!child.visible) return;
                    if (MARK_NAME_PATTERNS.BAR_ITEM_MULTI.test(child.name)) count++;
                });
            }
            if (count === 0) {
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
    const visibleCols = collectColumns(node).filter((col) => col.node.visible);
    if (hasLineBundleStructureInColumns(visibleCols)) {
        return 'line';
    }
    let found = 'bar';
    traverse(node, n => {
        if (MARK_NAME_PATTERNS.STACKED_GROUP.test(n.name)) found = 'stackedBar';
        if (MARK_NAME_PATTERNS.LINE.test(n.name)) found = 'line';
    });
    return found;
}
