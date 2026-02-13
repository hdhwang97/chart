import {
    MASTER_COMPONENT_CONFIG, STORAGE_KEY_COMPONENT_ID,
    VARIANT_PROPERTY_TYPE, PLUGIN_DATA_KEYS, MARK_NAME_PATTERNS,
    VARIANT_MAPPING
} from './constants';
import { traverse, findActualPropKey } from './utils';
import { loadChartData } from './data-layer';
import { extractChartColors, extractStyleFromNode } from './style';
import { collectColumns } from './drawing/shared';
import { applyBar } from './drawing/bar';
import { applyLine } from './drawing/line';
import { applyStackedBar } from './drawing/stacked';
import { getGraphHeight } from './drawing/shared';
import { resolveEffectiveYRange } from './drawing/y-range';

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

        let valuesToUse = chartData.values;
        if (lastDrawingVals) {
            try { valuesToUse = JSON.parse(lastDrawingVals); } catch (e) { }
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
            reason: opts?.reason || 'auto-resize'
        };

        const H = getGraphHeight(node as FrameNode);
        if (chartType === 'stackedBar' || chartType === 'stacked') applyStackedBar(payload, H, node);
        else if (chartType === 'bar') applyBar(payload, H, node);
        else if (chartType === 'line') applyLine(payload, H, node);
        return;
    }

    const lastMode = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MODE);
    const lastYMin = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MIN);
    const lastYMax = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX);
    const parsedLastYMin = lastYMin !== '' && Number.isFinite(Number(lastYMin)) ? Number(lastYMin) : undefined;
    const parsedLastYMax = lastYMax !== '' && Number.isFinite(Number(lastYMax)) ? Number(lastYMax) : undefined;
    const extractedColors = extractChartColors(node, chartType);
    const styleInfo = extractStyleFromNode(node, chartType);
    const markRatio = resolveMarkRatioFromNode(node, styleInfo.markRatio);

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
        lastStrokeWidth: lastStrokeWidth ? Number(lastStrokeWidth) : 2,
        markRatio,

        colStrokeStyle: styleInfo.colStrokeStyle || null,
        cellStrokeStyles: styleInfo.cellStrokeStyles || [],
        rowStrokeStyles: styleInfo.rowStrokeStyles || []
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
        rowCount = Math.max(...groupStructure) || 1;

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

    const emptyValues = Array.from({ length: rowCount }, () => Array(colCount).fill(0));

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
