import { MARK_NAME_PATTERNS, VARIANT_PROPERTY_MARK_NUM } from '../constants';
import { collectColumns, setVariantProperty } from './shared';
import { normalizeHexColor, tryApplyFill } from '../utils';

// ==========================================
// STACKED BAR CHART DRAWING
// ==========================================

function normalizeRatio(value: number | null | undefined): number {
    const ratio = typeof value === 'number' && Number.isFinite(value) ? value : 0.8;
    return Math.max(0.01, Math.min(1, ratio));
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
    const match = /^bar[-_]?0*(\d+)$/.exec(name);
    if (!match) return null;
    const idx = Number(match[1]);
    return Number.isFinite(idx) && idx > 0 ? idx : null;
}

function findSegmentLayerByIndex(subBar: SceneNode, index: number): (SceneNode & LayoutMixin) | null {
    if (!('children' in subBar)) return null;
    const found = (subBar as SceneNode & ChildrenMixin).children.find((n) => parseBarLayerIndex(n.name) === index);
    return found ? (found as SceneNode & LayoutMixin) : null;
}

function findSubBarMarkLayer(subBar: SceneNode): (SceneNode & LayoutMixin) | null {
    if (!('children' in subBar)) return null;
    const children = (subBar as SceneNode & ChildrenMixin).children;

    // Preferred: direct `bar` node
    const direct = children.find((n) => n.name === 'bar');
    if (direct) return direct as SceneNode & LayoutMixin;

    // Fallback: first bar-N style layer
    const indexed = children
        .map((n) => ({ node: n, idx: parseBarLayerIndex(n.name) }))
        .filter((x): x is { node: SceneNode; idx: number } => x.idx !== null)
        .sort((a, b) => a.idx - b.idx);
    if (indexed.length > 0) return indexed[0].node as SceneNode & LayoutMixin;

    return null;
}

function setLayerWidthWithCentering(layer: SceneNode & LayoutMixin, targetWidth: number, containerWidth: number) {
    const width = Math.max(1, targetWidth);
    const safeContainerWidth = Math.max(1, containerWidth);

    if ('layoutSizingHorizontal' in layer) {
        try {
            (layer as SceneNode & { layoutSizingHorizontal: 'FIXED' | 'HUG' | 'FILL' }).layoutSizingHorizontal = 'FIXED';
        } catch { }
    }

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

function applyStackedMarkRatioToSubBar(subBar: SceneNode, cellWidth: number, ratio: number, barCount: number) {
    const safeCellWidth = Math.max(1, cellWidth);
    const safeBarCount = Math.max(1, barCount);
    const targetClusterWidth = safeCellWidth * ratio;
    const targetSubBarWidth = Math.max(1, targetClusterWidth / safeBarCount);

    const markLayer = findSubBarMarkLayer(subBar);
    if (!markLayer) return;

    if ('layoutSizingHorizontal' in markLayer) {
        try {
            (markLayer as SceneNode & { layoutSizingHorizontal: 'FIXED' | 'HUG' | 'FILL' }).layoutSizingHorizontal = 'HUG';
        } catch { }
    }

    if (hasHorizontalPadding(markLayer)) {
        const nextPad = targetSubBarWidth / 2;
        if (Math.abs(markLayer.paddingLeft - nextPad) >= 0.1) markLayer.paddingLeft = nextPad;
        if (Math.abs(markLayer.paddingRight - nextPad) >= 0.1) markLayer.paddingRight = nextPad;
        return;
    }

    // fallback: width/x approximation for nodes without padding support
    const parentWidth = getNodeContentWidth(subBar) || safeCellWidth;
    setLayerWidthWithCentering(markLayer, targetSubBarWidth, parentWidth);
}

function forceGroupContainerHug(groupInstance: InstanceNode) {
    if (hasItemSpacing(groupInstance)) {
        groupInstance.itemSpacing = 0;
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

export function applyStackedBar(config: any, H: number, graph: SceneNode) {
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

    const columns = collectColumns(graph);
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
            forceGroupContainerHug(groupInstance);
            let markNumChanged = setMarkNumVariantWithFallback(groupInstance, currentGroupBarCount);

            const subBars = (groupInstance as any).children.filter((n: SceneNode) => MARK_NAME_PATTERNS.STACKED_SUB_INSTANCE.test(n.name));
            subBars.sort((a: SceneNode, b: SceneNode) => {
                const numA = parseInt(a.name.match(/\d+/)?.[0] || '0');
                const numB = parseInt(b.name.match(/\d+/)?.[0] || '0');
                return numA - numB;
            });

            if (markNumChanged) {
                subBars.forEach((subBar: SceneNode) => {
                    subBar.visible = true;
                    if ('children' in subBar) {
                        (subBar as SceneNode & ChildrenMixin).children.forEach((seg: SceneNode) => {
                            if (/^bar[-_]?0*(\d+)$/.test(seg.name)) seg.visible = true;
                        });
                    }
                });
            }

            subBars.forEach((subBar: SceneNode, subIdx: number) => {
                if (subIdx >= currentGroupBarCount) {
                    subBar.visible = false;
                    return;
                }
                if (globalDataIdx < totalDataCols) {
                    subBar.visible = true;
                    applyStackedMarkRatioToSubBar(subBar, cellWidth, targetRatio, currentGroupBarCount);
                    applySegmentsToBar(subBar, values, globalDataIdx, rowCount, H, globalMaxSum, mode, config.rowColors);
                    globalDataIdx++;
                } else {
                    subBar.visible = false;
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

    for (let r = 0; r < rowCount; r++) {
        const val = Number(values[r][colIndex]) || 0;
        const targetNum = r + 1;
        const targetLayer = findSegmentLayerByIndex(barInstance, targetNum);

        if (targetLayer) {
            const rowColor = Array.isArray(rowColors) ? normalizeHexColor(rowColors[r + 1]) : null;
            if (val === 0) {
                targetLayer.visible = false;
            } else {
                targetLayer.visible = true;
                if (rowColor) {
                    tryApplyFill(targetLayer as SceneNode, rowColor);
                }
                let ratio = 0;
                if (mode === 'raw') {
                    ratio = maxSum === 0 ? 0 : val / maxSum;
                } else {
                    ratio = Math.min(Math.max(val, 0), 100) / 100;
                }
                const finalHeight = Math.round((H * ratio) * 10) / 10;
                if ('paddingBottom' in targetLayer) {
                    (targetLayer as any).paddingBottom = finalHeight;
                }
            }
        }
    }
    (barInstance as any).children.forEach((child: SceneNode) => {
        const match = /^bar[-_]?0*(\d+)$/.exec(child.name);
        if (match) {
            const layerNum = parseInt(match[1]);
            if (layerNum > rowCount) child.visible = false;
        }
    });
}
