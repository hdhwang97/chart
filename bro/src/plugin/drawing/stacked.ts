import { MARK_NAME_PATTERNS, VARIANT_PROPERTY_MARK_NUM } from '../constants';
import { collectColumns, setVariantProperty, type ColRef } from './shared';
import { normalizeHexColor, rgbToHex, tryApplyFill, tryApplyStroke } from '../utils';

// ==========================================
// STACKED BAR CHART DRAWING
// ==========================================

function normalizeRatio(value: number | null | undefined): number {
    const ratio = typeof value === 'number' && Number.isFinite(value) ? value : 0.8;
    return Math.max(0.01, Math.min(1, ratio));
}

function computeClusterLayout(cellWidth: number, markRatio: number, markNum: number) {
    const safeCellWidth = Math.max(1, cellWidth);
    const safeMarkNum = Math.max(1, Math.floor(markNum));
    const clusterW = safeCellWidth * markRatio;
    const gaps = Math.max(0, safeMarkNum - 1);

    const t = Math.max(0, Math.min(1, (markRatio - 0.01) / 0.99));
    const gapRatioRaw = 0.005 + ((0.05 - 0.005) * (t * t));
    let gapPx = safeCellWidth * gapRatioRaw;
    if (gaps > 0) {
        const maxTotalGap = clusterW * 0.35;
        const totalGap = gapPx * gaps;
        if (totalGap > maxTotalGap) {
            gapPx = maxTotalGap / gaps;
        }
    } else {
        gapPx = 0;
    }

    const subBarW = Math.max(1, (clusterW - (gapPx * gaps)) / safeMarkNum);
    return { clusterW, subBarW, gapPx };
}

function hasHorizontalPadding(node: SceneNode): node is SceneNode & { paddingLeft: number; paddingRight: number } {
    return 'paddingLeft' in node && 'paddingRight' in node;
}

function hasItemSpacing(node: SceneNode): node is SceneNode & { itemSpacing: number } {
    return 'itemSpacing' in node && typeof (node as any).itemSpacing === 'number';
}

function getNodeContentWidth(node: SceneNode): number {
    if (!('width' in node)) return 0;
    if (hasHorizontalPadding(node)) {
        const content = node.width - node.paddingLeft - node.paddingRight;
        return content > 0 ? content : 0;
    }
    return node.width;
}

function setMarkNumVariantWithFallback(instance: InstanceNode, value: number): boolean {
    const next = String(value);
    if (setVariantProperty(instance, VARIANT_PROPERTY_MARK_NUM, next)) return true;
    if (setVariantProperty(instance, 'Count', next)) return true;
    if (setVariantProperty(instance, 'Size', next)) return true;
    return false;
}

function parseBarLayerIndex(name: string): number | null {
    const match = MARK_NAME_PATTERNS.STACKED_SEGMENT.exec(name);
    if (!match) return null;
    const idx = Number(match[1]);
    return Number.isFinite(idx) && idx > 0 ? idx : null;
}

function findSegmentLayerByIndex(subBar: SceneNode, index: number): (SceneNode & LayoutMixin) | null {
    if (!('children' in subBar)) return null;
    const found = (subBar as SceneNode & ChildrenMixin).children.find((n) => parseBarLayerIndex(n.name) === index);
    return found ? (found as SceneNode & LayoutMixin) : null;
}

function buildSegmentLayerMap(subBar: SceneNode): Map<number, SceneNode & LayoutMixin> {
    const byIndex = new Map<number, SceneNode & LayoutMixin>();
    if (!('children' in subBar)) return byIndex;
    (subBar as SceneNode & ChildrenMixin).children.forEach((child) => {
        const idx = parseBarLayerIndex(child.name);
        if (idx === null) return;
        byIndex.set(idx, child as SceneNode & LayoutMixin);
    });
    return byIndex;
}

function getVisibleSegmentLayers(subBar: SceneNode): Array<{ idx: number; node: SceneNode & LayoutMixin }> {
    if (!('children' in subBar)) return [];
    const children = (subBar as SceneNode & ChildrenMixin).children;
    return children
        .map((node) => ({ node, idx: parseBarLayerIndex(node.name) }))
        .filter((x): x is { node: SceneNode; idx: number } => x.idx !== null && x.node.visible)
        .sort((a, b) => a.idx - b.idx)
        .map((x) => ({ idx: x.idx, node: x.node as SceneNode & LayoutMixin }));
}

function pickPrimaryVisibleSegment(subBar: SceneNode): (SceneNode & LayoutMixin) | null {
    const visibleSegments = getVisibleSegmentLayers(subBar);
    if (visibleSegments.length === 0) return null;
    return visibleSegments[0].node;
}

function setLayoutSizingHorizontalIfChanged(layer: SceneNode & LayoutMixin, value: 'FIXED' | 'HUG' | 'FILL') {
    if (!('layoutSizingHorizontal' in layer)) return;
    try {
        const target = layer as SceneNode & { layoutSizingHorizontal: 'FIXED' | 'HUG' | 'FILL' };
        if (target.layoutSizingHorizontal !== value) {
            target.layoutSizingHorizontal = value;
        }
    } catch { }
}

function applySegmentResizeModes(subBar: SceneNode) {
    const visibleSegments = getVisibleSegmentLayers(subBar);
    if (visibleSegments.length === 0) return;

    visibleSegments.forEach((segment, index) => {
        if (index === 0) {
            setLayoutSizingHorizontalIfChanged(segment.node, 'HUG');
            return;
        }
        setLayoutSizingHorizontalIfChanged(segment.node, 'FILL');
    });
}

function setLayerWidthWithCentering(layer: SceneNode & LayoutMixin, targetWidth: number, containerWidth: number) {
    const width = Math.max(1, targetWidth);
    const safeContainerWidth = Math.max(1, containerWidth);

    setLayoutSizingHorizontalIfChanged(layer, 'FIXED');

    try {
        const anyLayer = layer as unknown as {
            resizeWithoutConstraints?: (w: number, h: number) => void;
            resize?: (w: number, h: number) => void;
            height: number;
        };
        if (typeof anyLayer.resizeWithoutConstraints === 'function') {
            anyLayer.resizeWithoutConstraints(width, anyLayer.height);
        } else if (typeof anyLayer.resize === 'function') {
            anyLayer.resize(width, anyLayer.height);
        }
    } catch { }

    try {
        const pos = layer as unknown as { x: number };
        pos.x = Math.max(0, (safeContainerWidth - width) / 2);
    } catch { }
}

function setVisibleIfChanged(node: SceneNode, visible: boolean) {
    if (node.visible === visible) return;
    node.visible = visible;
}

function hasSameSolidFill(node: SceneNode, targetHex: string): boolean {
    if (!('fills' in node) || !Array.isArray(node.fills) || node.fills.length === 0) return false;
    const first = node.fills[0];
    if (first.type !== 'SOLID') return false;
    const currentHex = rgbToHex(first.color.r, first.color.g, first.color.b);
    return currentHex.toUpperCase() === targetHex.toUpperCase();
}

function applyStackedMarkRatioToSubBar(subBar: SceneNode, cellWidth: number, ratio: number, barCount: number) {
    const clusterLayout = computeClusterLayout(cellWidth, ratio, barCount);
    const targetSubBarWidth = clusterLayout.subBarW;

    const markLayer = pickPrimaryVisibleSegment(subBar);
    if (!markLayer) return;

    setLayoutSizingHorizontalIfChanged(markLayer, 'HUG');

    if (hasHorizontalPadding(markLayer)) {
        const nextPad = targetSubBarWidth / 2;
        if (Math.abs(markLayer.paddingLeft - nextPad) >= 0.1) markLayer.paddingLeft = nextPad;
        if (Math.abs(markLayer.paddingRight - nextPad) >= 0.1) markLayer.paddingRight = nextPad;
        return;
    }

    // fallback: width/x approximation for nodes without padding support
    const parentWidth = Math.max(1, getNodeContentWidth(subBar));
    setLayerWidthWithCentering(markLayer, targetSubBarWidth, parentWidth);
}

function forceGroupContainerHug(groupInstance: InstanceNode, itemSpacing: number) {
    if (hasItemSpacing(groupInstance)) {
        groupInstance.itemSpacing = itemSpacing;
    }
    if (hasHorizontalPadding(groupInstance)) {
        groupInstance.paddingLeft = 0;
        groupInstance.paddingRight = 0;
    }
    if ('layoutSizingHorizontal' in groupInstance) {
        try {
            (groupInstance as SceneNode & { layoutSizingHorizontal: 'FIXED' | 'HUG' | 'FILL' }).layoutSizingHorizontal = 'HUG';
        } catch { }
    }
}

export function applyStackedBar(config: any, H: number, graph: SceneNode, precomputedCols?: ColRef[]) {
    const { values, mode, markNum, markRatio } = config;
    if (!values || values.length === 0) return;

    const rowCount = values.length;
    const totalDataCols = values[0].length;

    let globalMaxSum = 100;
    if (mode === 'raw') {
        const configuredMax = Number(config.yMax);
        if (Number.isFinite(configuredMax) && configuredMax > 0) {
            globalMaxSum = configuredMax;
        } else {
            const colSums = new Array(totalDataCols).fill(0);
            for (let c = 0; c < totalDataCols; c++) {
                let sum = 0;
                for (let r = 0; r < rowCount; r++) {
                    sum += (Number(values[r][c]) || 0);
                }
                colSums[c] = sum;
            }
            globalMaxSum = Math.max(...colSums);
            if (globalMaxSum === 0) globalMaxSum = 1;
        }
    }

    const columns = precomputedCols ?? collectColumns(graph);
    let globalDataIdx = 0;
    const targetRatio = normalizeRatio(typeof markRatio === 'number' ? markRatio : null);

    columns.forEach((colObj, index) => {
        if (globalDataIdx >= totalDataCols) return;

        let currentGroupBarCount = 1;
        if (Array.isArray(markNum)) {
            if (index < markNum.length) currentGroupBarCount = markNum[index];
            else currentGroupBarCount = 2;
        } else {
            currentGroupBarCount = Number(markNum) || 1;
        }

        let targetParent: SceneNode = colObj.node;
        if ('children' in colObj.node) {
            const tab = (colObj.node as any).children.find((n: SceneNode) => n.name === 'tab');
            if (tab) targetParent = tab;
        }
        const cellWidth = getNodeContentWidth(targetParent) || getNodeContentWidth(colObj.node) || 1;

        let groupInstance: InstanceNode | null = null;
        if ('children' in targetParent) {
            groupInstance = (targetParent as any).children.find((n: SceneNode) => MARK_NAME_PATTERNS.STACKED_GROUP.test(n.name));
        }

        if (groupInstance && groupInstance.type === 'INSTANCE') {
            const clusterLayout = computeClusterLayout(cellWidth, targetRatio, currentGroupBarCount);
            forceGroupContainerHug(groupInstance, clusterLayout.gapPx);
            const isVariantMarkNumUpdated = setMarkNumVariantWithFallback(groupInstance, currentGroupBarCount);

            const subBars = (groupInstance as any).children.filter((n: SceneNode) => MARK_NAME_PATTERNS.STACKED_SUB_INSTANCE.test(n.name));
            subBars.sort((a: SceneNode, b: SceneNode) => {
                const numA = parseInt(a.name.match(/\d+/)?.[0] || '0');
                const numB = parseInt(b.name.match(/\d+/)?.[0] || '0');
                return numA - numB;
            });

            if (isVariantMarkNumUpdated) {
                subBars.forEach((subBar: SceneNode) => {
                    setVisibleIfChanged(subBar, true);
                    if ('children' in subBar) {
                        (subBar as SceneNode & ChildrenMixin).children.forEach((seg: SceneNode) => {
                            if (MARK_NAME_PATTERNS.STACKED_SEGMENT.test(seg.name)) {
                                setVisibleIfChanged(seg, true);
                            }
                        });
                    }
                });
            }

            subBars.forEach((subBar: SceneNode, subIdx: number) => {
                if (subIdx >= currentGroupBarCount) {
                    setVisibleIfChanged(subBar, false);
                    return;
                }
                if (globalDataIdx < totalDataCols) {
                    setVisibleIfChanged(subBar, true);
                    applySegmentResizeModes(subBar);
                    applyStackedMarkRatioToSubBar(subBar, cellWidth, targetRatio, currentGroupBarCount);
                    applySegmentsToBar(subBar, values, globalDataIdx, rowCount, H, globalMaxSum, mode, config.rowColors);
                    applySegmentResizeModes(subBar);
                    globalDataIdx++;
                } else {
                    setVisibleIfChanged(subBar, false);
                }
            });
        }
    });
}

export function applySegmentsToBar(
    barInstance: SceneNode,
    values: any[][],
    colIndex: number,
    rowCount: number,
    H: number,
    maxSum: number,
    mode: string,
    rowColors?: string[]
) {
    if (!('children' in barInstance)) return;
    const segmentByIndex = buildSegmentLayerMap(barInstance);
    const normalizedRowColors = Array.isArray(rowColors)
        ? rowColors.map((color) => normalizeHexColor(color))
        : [];

    for (let r = 0; r < rowCount; r++) {
        const val = Number(values[r][colIndex]) || 0;
        const targetNum = r + 1;
        const targetLayer = segmentByIndex.get(targetNum) || findSegmentLayerByIndex(barInstance, targetNum);

        if (targetLayer) {
            const rowColor = normalizedRowColors[r + 1] || null;
            if (val === 0) {
                setVisibleIfChanged(targetLayer, false);
            } else {
                setVisibleIfChanged(targetLayer, true);
                if (rowColor) {
                    if (!hasSameSolidFill(targetLayer as SceneNode, rowColor)) {
                        tryApplyFill(targetLayer as SceneNode, rowColor);
                    }
                    tryApplyStroke(targetLayer as SceneNode, rowColor);
                }
                let ratio = 0;
                if (mode === 'raw') {
                    ratio = maxSum === 0 ? 0 : val / maxSum;
                } else {
                    ratio = Math.min(Math.max(val, 0), 100) / 100;
                }
                const finalHeight = Math.round((H * ratio) * 10) / 10;
                if ('paddingBottom' in targetLayer) {
                    const currentPadding = Number((targetLayer as any).paddingBottom);
                    if (!Number.isFinite(currentPadding) || Math.abs(currentPadding - finalHeight) >= 0.1) {
                        (targetLayer as any).paddingBottom = finalHeight;
                    }
                }
            }
        }
    }
    (barInstance as any).children.forEach((child: SceneNode) => {
        const match = MARK_NAME_PATTERNS.STACKED_SEGMENT.exec(child.name);
        if (match) {
            const layerNum = parseInt(match[1]);
            if (layerNum > rowCount) setVisibleIfChanged(child, false);
        }
    });
}
