import { MARK_NAME_PATTERNS, VARIANT_PROPERTY_MARK_NUM, PLUGIN_DATA_KEYS } from '../constants';
import { collectColumns, setVariantProperty } from './shared';
import { normalizeHexColor, tryApplyFill } from '../utils';

// ==========================================
// BAR CHART DRAWING
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
    return { clusterW, subBarW, gapPx, gapRatio: gapPx / safeCellWidth };
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

function findTabInColumn(colNode: SceneNode): SceneNode {
    if ("children" in colNode) {
        const tab = (colNode as SceneNode & ChildrenMixin).children.find((n: SceneNode) => n.name === "tab");
        if (tab) return tab as SceneNode;
    }
    return colNode;
}

function resolveBarMeasureContext(colNode: SceneNode): { barInst: InstanceNode | null; measureWidth: number } {
    const targetParent = findTabInColumn(colNode);
    const tabWidth = "width" in targetParent ? targetParent.width : 0;
    const colWidth = "width" in colNode ? colNode.width : 0;
    const measureWidth = tabWidth > 0 ? tabWidth : colWidth;
    const searchParent = targetParent && "children" in targetParent ? targetParent : ("children" in colNode ? colNode : null);
    const barInst = searchParent
        ? (searchParent as SceneNode & ChildrenMixin).children.find((n: SceneNode) => MARK_NAME_PATTERNS.BAR_INSTANCE.test(n.name))
        : null;
    return {
        barInst: barInst && barInst.type === "INSTANCE" ? barInst : null,
        measureWidth
    };
}

function inferRatioFromCurrentGeometry(cols: { node: SceneNode, index: number }[]): number | null {
    for (const col of cols) {
        const { barInst, measureWidth } = resolveBarMeasureContext(col.node);
        if (!barInst || measureWidth <= 0) continue;
        const layerPool = resolveBarMarkLayerPool(barInst);
        const firstBar = layerPool.find((n: SceneNode) => /^bar($|[-_]?0*\d+$)/.test(n.name));
        if (!firstBar) continue;
        const inferred = getNodeContentWidth(firstBar) / measureWidth;
        if (Number.isFinite(inferred) && inferred > 0) {
            return inferred;
        }
    }
    return null;
}

function setMarkNumVariantWithFallback(instance: InstanceNode, value: number): boolean {
    const next = String(value);
    if (setVariantProperty(instance, VARIANT_PROPERTY_MARK_NUM, next)) return true;
    if (setVariantProperty(instance, 'Count', next)) return true;
    if (setVariantProperty(instance, 'Size', next)) return true;
    return false;
}

function parseBarLayerIndex(name: string): number | null {
    if (name === 'bar') return 1;
    const match = /^bar[-_]?0*(\d+)$/.exec(name);
    if (!match) return null;
    const idx = Number(match[1]);
    return Number.isFinite(idx) && idx > 0 ? idx : null;
}

function findBarClusterNode(barInst: InstanceNode): (SceneNode & ChildrenMixin) | null {
    const directCluster = barInst.children.find((n) => n.name === 'bar' && 'children' in n);
    if (directCluster && 'children' in directCluster) {
        return directCluster as SceneNode & ChildrenMixin;
    }
    return null;
}

function resolveBarMarkLayerPool(barInst: InstanceNode): ReadonlyArray<SceneNode> {
    const clusterNode = findBarClusterNode(barInst);
    if (clusterNode) {
        return clusterNode.children;
    }
    return barInst.children;
}

function findBarLayerByIndex(layerPool: ReadonlyArray<SceneNode>, index: number): (SceneNode & LayoutMixin) | null {
    const found = layerPool.find((n) => parseBarLayerIndex(n.name) === index);
    return found ? (found as SceneNode & LayoutMixin) : null;
}

function getBarRowColor(config: any, rowIndex: number) {
    if (!Array.isArray(config?.rowColors)) return null;
    return normalizeHexColor(config.rowColors[rowIndex]);
}

export function applyBar(config: any, H: number, graph: SceneNode) {
    const { values, mode, markNum, reason, markRatio } = config;
    const cols = collectColumns(graph);
    if (!Array.isArray(values) || values.length === 0 || !Array.isArray(values[0])) return;

    // 1. Max Value 계산
    let maxVal = 100;
    if (mode === "raw") {
        const configuredMax = Number(config.yMax);
        if (Number.isFinite(configuredMax) && configuredMax > 0) {
            maxVal = configuredMax;
        } else {
            const allValues: number[] = [];
            values.forEach((row: any[]) => row.forEach((v: any) => allValues.push(Number(v) || 0)));
            maxVal = Math.max(...allValues);
            if (maxVal === 0) maxVal = 1;
        }
    }

    // 저장된 Mark Ratio(너비 비율) 불러오기
    const savedRatioStr = graph.getPluginData(PLUGIN_DATA_KEYS.LAST_BAR_PADDING);
    const savedRatio = savedRatioStr ? parseFloat(savedRatioStr) : null;
    const inferredRatio = inferRatioFromCurrentGeometry(cols);
    const configRatio = typeof markRatio === 'number' ? markRatio : null;
    const ratioSource =
        configRatio !== null ? 'config.markRatio' :
            (savedRatio !== null && Number.isFinite(savedRatio)) ? 'pluginData.LAST_BAR_PADDING' :
                (inferredRatio !== null && Number.isFinite(inferredRatio)) ? 'inferredFromGeometry' :
                    'fallback(0.8)';
    const targetRatio = normalizeRatio(configRatio ?? savedRatio ?? inferredRatio);
    const shouldLogResizeDebug = reason === 'auto-resize';
    let totalRatioBefore = 0;
    let totalRatioAfter = 0;
    let loggedColumns = 0;
    const ratioAuditRows: Array<{
        colIndex: number;
        measuredCellWidth: number;
        clusterWidth: number;
        barWidth: number;
        appliedRatio: number;
        subBarWidth: number;
        gapPx: number;
        leftPadding: number;
        rightPadding: number;
    }> = [];

    const numMarks = Number(markNum) || 1;
    const dataCols = values[0].length;

    cols.forEach((colObj, cIdx) => {
        if (cIdx >= dataCols) return;

        // 2. Bar Instance (컨테이너) 찾기
        const { barInst, measureWidth } = resolveBarMeasureContext(colObj.node);

        if (barInst) {
            const clusterLayout = computeClusterLayout(measureWidth, targetRatio, numMarks);
            // Figma 컴포넌트의 'markNum' Variant 속성 변경
            setMarkNumVariantWithFallback(barInst, numMarks);
            // Variant 변경 직후 인스턴스 내부 레이어가 재구성될 수 있으므로 반드시 재조회한다.
            const barLayerPool = resolveBarMarkLayerPool(barInst);
            // markNum 기준으로 활성 범위 레이어는 항상 visible=true로 강제한다.
            barLayerPool.forEach((child: SceneNode) => {
                const layerIndex = parseBarLayerIndex(child.name);
                if (layerIndex === null) return;
                child.visible = layerIndex <= numMarks;
            });
            if (hasItemSpacing(barInst)) {
                barInst.itemSpacing = clusterLayout.gapPx;
            }
            if (hasHorizontalPadding(barInst)) {
                // cluster(bar)에는 좌우 padding을 주입하지 않는다.
                barInst.paddingLeft = 0;
                barInst.paddingRight = 0;
            }
            if ('layoutSizingHorizontal' in barInst) {
                (barInst as SceneNode & { layoutSizingHorizontal: 'FIXED' | 'HUG' | 'FILL' }).layoutSizingHorizontal = 'HUG';
            }

            for (let m = 0; m < numMarks; m++) {
                let val = 0;
                if (values.length > m) val = Number(values[m][cIdx]) || 0;

                const targetNum = m + 1;
                const barLayer = findBarLayerByIndex(barLayerPool, targetNum);

                if (barLayer) {
                    const rowColor = getBarRowColor(config, m);
                    if (rowColor) {
                        tryApplyFill(barLayer as SceneNode, rowColor);
                    }
                    if (measureWidth > 0) {
                        try {
                            const barWidthBefore = getNodeContentWidth(barLayer);
                            const ratioBefore = barWidthBefore / measureWidth;
                            const desiredContentWidth = clusterLayout.subBarW;

                            let leftPadding = 'x' in barLayer ? barLayer.x : 0;
                            let rightPadding = measureWidth - (('x' in barLayer ? barLayer.x : 0) + ('width' in barLayer ? barLayer.width : 0));

                            if ('layoutSizingHorizontal' in barLayer) {
                                (barLayer as SceneNode & { layoutSizingHorizontal: 'FIXED' | 'HUG' | 'FILL' }).layoutSizingHorizontal = 'HUG';
                            }

                            if (hasHorizontalPadding(barLayer)) {
                                // bar-N 레이어가 padding을 지원하면 항상 padding으로 폭을 주입한다.
                                const nextLeft = desiredContentWidth / 2;
                                const nextRight = desiredContentWidth / 2;
                                if (Math.abs(barLayer.paddingLeft - nextLeft) >= 0.1) {
                                    barLayer.paddingLeft = nextLeft;
                                }
                                if (Math.abs(barLayer.paddingRight - nextRight) >= 0.1) {
                                    barLayer.paddingRight = nextRight;
                                }
                            } else if ('resize' in barLayer && typeof barLayer.resize === 'function' && 'width' in barLayer && 'height' in barLayer) {
                                // padding을 지원하지 않는 경우에만 resize fallback
                                if (Math.abs(desiredContentWidth - barLayer.width) >= 0.1) {
                                    barLayer.resize(desiredContentWidth, barLayer.height);
                                }
                            }

                            leftPadding = hasHorizontalPadding(barLayer) ? barLayer.paddingLeft : ('x' in barLayer ? barLayer.x : 0);
                            rightPadding = hasHorizontalPadding(barLayer)
                                ? barLayer.paddingRight
                                : measureWidth - (leftPadding + ('width' in barLayer ? barLayer.width : 0));

                            if (m === 0) {
                                const barWidthAfter = getNodeContentWidth(barLayer);
                                const ratioAfter = measureWidth > 0 ? barWidthAfter / measureWidth : 0;
                                ratioAuditRows.push({
                                    colIndex: cIdx,
                                    measuredCellWidth: measureWidth,
                                    clusterWidth: clusterLayout.clusterW,
                                    barWidth: barWidthAfter,
                                    appliedRatio: ratioAfter,
                                    subBarWidth: clusterLayout.subBarW,
                                    gapPx: clusterLayout.gapPx,
                                    leftPadding,
                                    rightPadding
                                });
                            }

                            if (shouldLogResizeDebug && m === 0) {
                                const barWidthAfter = getNodeContentWidth(barLayer);
                                const ratioAfter = barWidthAfter / measureWidth;
                                totalRatioBefore += ratioBefore;
                                totalRatioAfter += ratioAfter;
                                loggedColumns += 1;

                                console.log('[chart-plugin][bar-resize][col]', {
                                    colIndex: cIdx,
                                    measuredCellWidth: measureWidth,
                                    barWidthBefore,
                                    barWidthAfter,
                                    ratioBefore,
                                    ratioAfter,
                                    leftPadding,
                                    rightPadding
                                });
                            }
                        } catch (e) {
                            console.error("Bar Width Apply Error", e);
                        }
                    }

                    barLayer.visible = true;
                    let ratio = (mode === "raw") ? (val / maxVal) : (val / 100);
                    if (!Number.isFinite(ratio) || ratio < 0) ratio = 0;
                    const finalH = Math.round((H * ratio) * 10) / 10;

                    if ('paddingBottom' in barLayer) {
                        (barLayer as any).paddingBottom = finalH;
                    }
                }
            }
        }
    });

    if (shouldLogResizeDebug && loggedColumns > 0) {
        console.log('[chart-plugin][bar-resize][summary]', {
            columns: loggedColumns,
            appliedRatio: targetRatio,
            avgRatioBefore: totalRatioBefore / loggedColumns,
            avgRatioAfter: totalRatioAfter / loggedColumns
        });
    }

    if (ratioAuditRows.length > 0) {
        console.log('[chart-plugin][bar-ratio-check][summary]', {
            reason: reason || 'apply/generate',
            source: ratioSource,
            inputRatio: configRatio,
            configRatio,
            savedRatio,
            inferredRatio,
            markNum: numMarks,
            effectiveRatio: targetRatio,
            appliedRatio: targetRatio,
            gapRatio: ratioAuditRows.length > 0
                ? (ratioAuditRows.reduce((acc, row) => acc + (row.measuredCellWidth > 0 ? (row.gapPx / row.measuredCellWidth) : 0), 0) / ratioAuditRows.length)
                : 0,
            columns: ratioAuditRows.length
        });
        ratioAuditRows.forEach((row) => {
            console.log('[chart-plugin][bar-ratio-check][col]', row);
        });
    }
}
