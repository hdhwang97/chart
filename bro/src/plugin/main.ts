import { VARIANT_MAPPING, PLUGIN_DATA_KEYS } from './constants';
import { saveChartData } from './data-layer';
import { extractStyleFromNode } from './style';
import { collectColumns, setVariantProperty, setLayerVisibility, applyCells, applyYAxis, getGraphHeight } from './drawing/shared';
import { applyBar } from './drawing/bar';
import { applyLine } from './drawing/line';
import { applyStackedBar } from './drawing/stacked';
import { getOrImportComponent, initPluginUI, inferChartType, inferStructureFromGraph } from './init';

// ==========================================
// PLUGIN ENTRY POINT
// ==========================================

figma.showUI(__html__, { width: 600, height: 800 });

let currentSelectionId: string | null = null;
let prevWidth = 0;
let prevHeight = 0;

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
        const { type, mode, values, rawValues, cols, rows, cellCount, yMin, yMax, markNum, strokeWidth, markRatio } = msg.payload;

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

        applyCells(targetNode, cellCount);
        applyYAxis(targetNode, cellCount, { yMin, yMax });

        // 4. Draw Chart
        const H = getGraphHeight(targetNode as FrameNode);
        const drawConfig = { values, mode, markNum, rows, yMin, yMax, strokeWidth, markRatio };

        if (type === "bar") applyBar(drawConfig, H, targetNode);
        else if (type === "line") applyLine(drawConfig, H, targetNode);
        else if (type === "stackedBar" || type === "stacked") applyStackedBar(drawConfig, H, targetNode);

        // 5. 스타일 자동 추출 및 전송
        const styleInfo = extractStyleFromNode(targetNode, type);

        // 차트 생성 후 데이터 및 스타일 저장
        saveChartData(targetNode, msg.payload, styleInfo);

        const stylePayload = {
            chartType: type,
            markNum: markNum,
            yCount: cellCount,
            colCount: cols,

            colors: styleInfo.colors.length > 0 ? styleInfo.colors : ['#3b82f6', '#9CA3AF'],
            markRatio: styleInfo.markRatio,
            cornerRadius: styleInfo.cornerRadius,
            strokeWidth: styleInfo.strokeWidth,
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

        const payload = {
            chartType: chartType,
            markNum: structure.markNum,
            yCount: structure.cellCount || 4,
            colCount: colCount,

            colors: styleInfo.colors.length > 0 ? styleInfo.colors : ['#3b82f6', '#9CA3AF'],
            markRatio: styleInfo.markRatio,
            cornerRadius: styleInfo.cornerRadius,
            strokeWidth: styleInfo.strokeWidth,
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
