import { VARIANT_MAPPING, PLUGIN_DATA_KEYS } from './constants';
import { saveChartData } from './data-layer';
import { extractStyleFromNode } from './style';
import { collectColumns, setVariantProperty, setLayerVisibility, applyCells, applyYAxis, getGraphHeight } from './drawing/shared';
import { applyBar } from './drawing/bar';
import { applyLine } from './drawing/line';
import { applyStackedBar } from './drawing/stacked';
import { applyAssistLines } from './drawing/assist-line';
import { resolveEffectiveYRange } from './drawing/y-range';
import { getOrImportComponent, initPluginUI, inferChartType, inferStructureFromGraph } from './init';
import { normalizeHexColor } from './utils';

// ==========================================
// PLUGIN ENTRY POINT
// ==========================================

figma.showUI(__html__, { width: 600, height: 800 });

let currentSelectionId: string | null = null;
let prevWidth = 0;
let prevHeight = 0;

function normalizeMarkRatio(value: unknown): number | null {
    const ratio = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(ratio)) return null;
    return Math.max(0.01, Math.min(1.0, ratio));
}

const DEFAULT_ROW_COLORS = [
    '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#DBEAFE',
    '#34D399', '#FBBF24', '#F87171', '#A78BFA', '#FB923C'
];

function getDefaultRowColor(index: number) {
    return DEFAULT_ROW_COLORS[index % DEFAULT_ROW_COLORS.length];
}

function normalizeRowColors(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeHexColor(item))
        .filter((item): item is string => Boolean(item));
}

function resolveRowColorsFromNode(
    node: SceneNode,
    chartType: string,
    rowCount: number,
    fallbackColors?: string[]
) {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_ROW_COLORS);
    let saved: any[] = [];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const fallback = Array.isArray(fallbackColors) ? fallbackColors : [];
    const fallbackRowColors = (chartType === 'stackedBar' || chartType === 'stacked')
        ? [getDefaultRowColor(0), ...fallback]
        : fallback;
    const next: string[] = [];
    for (let i = 0; i < Math.max(1, rowCount); i++) {
        const color =
            normalizeHexColor(saved[i]) ||
            normalizeHexColor(fallbackRowColors[i]) ||
            getDefaultRowColor(i);
        next.push(color);
    }
    return next;
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

function resolveStrokeWidthForUi(node: SceneNode, requestedStrokeWidth?: unknown, extractedStrokeWidth?: unknown): number {
    const requested = normalizeStrokeWidth(requestedStrokeWidth);
    if (requested !== null) return requested;

    const saved = normalizeStrokeWidth(node.getPluginData(PLUGIN_DATA_KEYS.LAST_STROKE_WIDTH));
    if (saved !== null) return saved;

    const extracted = normalizeStrokeWidth(extractedStrokeWidth);
    if (extracted !== null) return extracted;

    return 2;
}

function isRecognizedChartSelection(node: SceneNode) {
    const savedChartType = node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE);
    const columnCount = collectColumns(node).length;
    return Boolean(savedChartType) || columnCount > 0;
}

function resolveChartTargetFromSelection(node: SceneNode): SceneNode {
    let current: BaseNode | null = node;
    let resolved: SceneNode = node;

    while (current && current.type !== 'PAGE') {
        if ('getPluginData' in current) {
            const candidate = current as SceneNode;
            if (isRecognizedChartSelection(candidate)) {
                resolved = candidate;
            }
        }
        current = current.parent;
    }

    return resolved;
}

function logSelectionRecognition(node: SceneNode) {
    const savedChartType = node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE);
    const inferredChartType = inferChartType(node);
    const columnCount = collectColumns(node).length;
    const recognized = isRecognizedChartSelection(node);

    console.log('[chart-plugin][selection]', {
        recognized,
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        savedChartType: savedChartType || null,
        inferredChartType,
        columnCount
    });
}

// Message Handler
figma.ui.onmessage = async (msg) => {
    if (msg.type === 'resize') {
        figma.ui.resize(msg.width, msg.height);
    }
    else if (msg.type === 'generate' || msg.type === 'apply') {
        const { type, mode, values, rawValues, cols, rows, cellCount, yMin, yMax, markNum, strokeWidth, markRatio, rowColors, rawYMaxAuto, assistLineVisible, assistLineEnabled } = msg.payload;

        const nodes = figma.currentPage.selection;
        let targetNode: FrameNode | ComponentNode | InstanceNode;

        if (msg.type === 'apply' && nodes.length > 0) {
            const resolvedNode = resolveChartTargetFromSelection(nodes[0]);
            if (!isRecognizedChartSelection(resolvedNode)) {
                figma.notify("Please select a chart component instance.");
                return;
            }
            targetNode = resolvedNode as FrameNode;
            console.log('[chart-plugin][apply]', {
                selectedNodeId: nodes[0].id,
                targetNodeId: resolvedNode.id,
                selectedNodeName: nodes[0].name,
                targetNodeName: resolvedNode.name
            });
        } else {
            // Generate new
            const component = await getOrImportComponent();
            if (!component) {
                figma.notify(`Master Component '${(await import('./constants')).MASTER_COMPONENT_CONFIG.NAME}' not found.`);
                return;
            }

            let instance;
            if (component.type === "COMPONENT_SET") {
                const defaultVar = component.defaultVariant;
                if (!defaultVar) {
                    figma.notify("Error: Default Variant not found");
                    return;
                }
                instance = defaultVar.createInstance();
            } else {
                instance = component.createInstance();
            }

            targetNode = instance;

            const { x, y } = figma.viewport.center;
            instance.x = x - (instance.width / 2);
            instance.y = y - (instance.height / 2);

            figma.currentPage.appendChild(instance);
            figma.viewport.scrollAndZoomIntoView([instance]);
            figma.currentPage.selection = [instance];
        }

        // 2. Variant Setup
        if (targetNode.type === "INSTANCE") {
            const variantValue = VARIANT_MAPPING[type] || 'bar';
            setVariantProperty(targetNode, "Type", variantValue);
        }

        // 3. Basic Setup
        const graphColCount = cols;
        setLayerVisibility(targetNode, "col-", graphColCount);

        const effectiveY = resolveEffectiveYRange({
            chartType: type,
            mode,
            values,
            yMin,
            yMax,
            rawYMaxAuto
        });

        applyCells(targetNode, cellCount);
        applyYAxis(targetNode, cellCount, { yMin: effectiveY.yMin, yMax: effectiveY.yMax });

        // 4. Draw Chart
        const H = getGraphHeight(targetNode as FrameNode);
        const drawConfig = {
            values,
            mode,
            markNum,
            rows,
            yMin: effectiveY.yMin,
            yMax: effectiveY.yMax,
            rawYMaxAuto: effectiveY.rawYMaxAuto,
            strokeWidth,
            markRatio,
            rowColors: normalizeRowColors(rowColors),
            assistLineVisible,
            assistLineEnabled
        };

        if (type === "bar") applyBar(drawConfig, H, targetNode);
        else if (type === "line") applyLine(drawConfig, H, targetNode);
        else if (type === "stackedBar" || type === "stacked") applyStackedBar(drawConfig, H, targetNode);
        applyAssistLines(drawConfig, targetNode, H);

        // 5. 스타일 자동 추출 및 전송
        const styleInfo = extractStyleFromNode(targetNode, type);
        const requestedRatio = (type === 'bar' || type === 'stackedBar' || type === 'stacked')
            ? normalizeMarkRatio(markRatio)
            : null;
        const requestedRowColors = normalizeRowColors(rowColors);
        const rowColorsForUi = requestedRowColors.length > 0
            ? requestedRowColors
            : resolveRowColorsFromNode(targetNode, type, rows, styleInfo.colors);

        // 차트 생성 후 데이터 및 스타일 저장
        saveChartData(targetNode, msg.payload, styleInfo);
        const markRatioForUi = requestedRatio ?? resolveMarkRatioFromNode(targetNode, styleInfo.markRatio);

        const stylePayload = {
            chartType: type,
            markNum: markNum,
            yCount: cellCount,
            colCount: cols,

            colors: styleInfo.colors.length > 0 ? styleInfo.colors : ['#3b82f6', '#9CA3AF'],
            markRatio: markRatioForUi,
            rowColors: rowColorsForUi,
            assistLineVisible: Boolean(assistLineVisible),
            assistLineEnabled: assistLineEnabled || { min: false, max: false, avg: false },
            cornerRadius: styleInfo.cornerRadius,
            strokeWidth: resolveStrokeWidthForUi(targetNode, strokeWidth, styleInfo.strokeWidth),
            colStrokeStyle: styleInfo.colStrokeStyle || null,
            cellStrokeStyles: styleInfo.cellStrokeStyles || [],
            rowStrokeStyles: styleInfo.rowStrokeStyles || []
        };

        figma.ui.postMessage({ type: 'style_extracted', payload: stylePayload });

        if (msg.type === 'generate') {
            figma.notify("Chart Generated!");
        } else {
            figma.notify("Chart Updated & Style Synced!");
        }
    }

    // Export를 위한 스타일 추출 로직 (별도 호출 시)
    else if (msg.type === 'extract_style') {
        const nodes = figma.currentPage.selection;
        if (nodes.length !== 1) {
            figma.notify("Please select exactly one chart component.");
            return;
        }
        const node = resolveChartTargetFromSelection(nodes[0]);
        if (!isRecognizedChartSelection(node)) {
            figma.notify("Please select a chart component instance.");
            return;
        }
        const chartType = node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE) || inferChartType(node);

        // 주입된 payload가 없으므로 역산(Inference) 수행
        const structure = inferStructureFromGraph(chartType, node);

        // 숨겨진 레이어 제외하고 카운트 (Visible Column Only)
        const cols = collectColumns(node);
        const visibleCols = cols.filter(c => c.node.visible);
        const colCount = visibleCols.length > 0 ? visibleCols.length : 5;

        const styleInfo = extractStyleFromNode(node, chartType);
        const markRatioForUi = resolveMarkRatioFromNode(node, styleInfo.markRatio);
        let rowCount = 1;
        const savedValuesRaw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_VALUES);
        if (savedValuesRaw) {
            try {
                const parsed = JSON.parse(savedValuesRaw);
                if (Array.isArray(parsed)) rowCount = parsed.length;
            } catch { }
        }
        if (!savedValuesRaw) {
            if (chartType === 'stackedBar' || chartType === 'stacked') {
                rowCount = Array.isArray(structure.markNum) ? Math.max(1, Math.max(...structure.markNum) + 1) : 1;
            } else {
                rowCount = typeof structure.markNum === 'number' ? Math.max(1, structure.markNum) : 1;
            }
        }
        const rowColorsForUi = resolveRowColorsFromNode(node, chartType, rowCount, styleInfo.colors);
        const assistLineVisible = node.getPluginData(PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_VISIBLE) === 'true';
        const assistLineEnabledRaw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_ENABLED);
        let assistLineEnabled = { min: false, max: false, avg: false };
        if (assistLineEnabledRaw) {
            try {
                const parsed = JSON.parse(assistLineEnabledRaw);
                assistLineEnabled = {
                    min: Boolean(parsed?.min),
                    max: Boolean(parsed?.max),
                    avg: Boolean(parsed?.avg)
                };
            } catch { }
        }

        const payload = {
            chartType: chartType,
            markNum: structure.markNum,
            yCount: structure.cellCount || 4,
            colCount: colCount,

            colors: styleInfo.colors.length > 0 ? styleInfo.colors : ['#3b82f6', '#9CA3AF'],
            markRatio: markRatioForUi,
            rowColors: rowColorsForUi,
            assistLineVisible,
            assistLineEnabled,
            cornerRadius: styleInfo.cornerRadius,
            strokeWidth: resolveStrokeWidthForUi(node, undefined, styleInfo.strokeWidth),
            colStrokeStyle: styleInfo.colStrokeStyle || null,
            cellStrokeStyles: styleInfo.cellStrokeStyles || [],
            rowStrokeStyles: styleInfo.rowStrokeStyles || []
        };

        figma.ui.postMessage({ type: 'style_extracted', payload: payload });
        figma.notify("Style Extracted!");
    }
};


// Selection Change
figma.on("selectionchange", () => {
    const selection = figma.currentPage.selection;
    if (selection.length === 1) {
        const node = selection[0];
        const resolvedNode = resolveChartTargetFromSelection(node);
        logSelectionRecognition(resolvedNode);
        console.log('[chart-plugin][selection-resolve]', {
            selectedNodeId: node.id,
            resolvedNodeId: resolvedNode.id,
            selectedNodeName: node.name,
            resolvedNodeName: resolvedNode.name
        });
        if (!isRecognizedChartSelection(resolvedNode)) {
            currentSelectionId = null;
            figma.ui.postMessage({ type: 'init', chartType: null });
            return;
        }
        initPluginUI(resolvedNode);

        if (resolvedNode.id !== currentSelectionId) {
            currentSelectionId = resolvedNode.id;
            prevWidth = resolvedNode.width;
            prevHeight = resolvedNode.height;
        }
    } else {
        currentSelectionId = null;
        console.log('[chart-plugin][selection]', {
            recognized: false,
            reason: selection.length === 0 ? 'empty-selection' : 'multi-selection',
            selectionCount: selection.length
        });
        figma.ui.postMessage({ type: 'init', chartType: null });
    }
});

// Auto-Resize Loop
setInterval(() => {
    if (!currentSelectionId) return;
    const tracked = figma.getNodeById(currentSelectionId);
    if (!tracked || tracked.type === 'PAGE' || tracked.type === 'DOCUMENT') {
        currentSelectionId = null;
        return;
    }

    const trackedScene = tracked as SceneNode;
    if (!isRecognizedChartSelection(trackedScene)) {
        currentSelectionId = null;
        return;
    }

    if (Math.abs(trackedScene.width - prevWidth) > 1 || Math.abs(trackedScene.height - prevHeight) > 1) {
        console.log('[chart-plugin][auto-resize]', {
            nodeId: trackedScene.id,
            prevWidth,
            nextWidth: trackedScene.width,
            prevHeight,
            nextHeight: trackedScene.height
        });
        initPluginUI(trackedScene, true, { reason: 'auto-resize' });
        prevWidth = trackedScene.width;
        prevHeight = trackedScene.height;
    }
}, 500);
