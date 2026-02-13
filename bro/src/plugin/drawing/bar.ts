import { MARK_NAME_PATTERNS, VARIANT_PROPERTY_MARK_NUM, PLUGIN_DATA_KEYS } from '../constants';
import { collectColumns, setVariantProperty } from './shared';

// ==========================================
// BAR CHART DRAWING
// ==========================================

function normalizeRatio(value: number | null | undefined): number {
    const ratio = typeof value === 'number' && Number.isFinite(value) ? value : 0.8;
    return Math.max(0.01, Math.min(1, ratio));
}

function hasHorizontalPadding(node: SceneNode): node is SceneNode & { paddingLeft: number; paddingRight: number } {
    return 'paddingLeft' in node && 'paddingRight' in node;
}

function getNodeContentWidth(node: SceneNode, measureWidth: number): number {
    if (measureWidth <= 0) return 'width' in node ? node.width : 0;
    if (hasHorizontalPadding(node)) {
        const content = measureWidth - node.paddingLeft - node.paddingRight;
        return content > 0 ? content : 0;
    }
    return 'width' in node ? node.width : 0;
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
        const firstBar = barInst.children.find((n: SceneNode) => /^bar($|[-_]?0*\d+$)/.test(n.name));
        if (!firstBar) continue;
        const inferred = getNodeContentWidth(firstBar, measureWidth) / measureWidth;
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
        barWidth: number;
        appliedRatio: number;
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
            // Figma 컴포넌트의 'markNum' Variant 속성 변경
            setMarkNumVariantWithFallback(barInst, numMarks);
            // markNum 기준으로 활성 범위 레이어는 항상 visible=true로 강제한다.
            barInst.children.forEach((child: SceneNode) => {
                const layerIndex = parseBarLayerIndex(child.name);
                if (layerIndex === null) return;
                child.visible = layerIndex <= numMarks;
            });

            for (let m = 0; m < numMarks; m++) {
                let val = 0;
                if (values.length > m) val = Number(values[m][cIdx]) || 0;

                const targetNum = m + 1;
                const pattern = new RegExp(`^bar[-_]?0*(${targetNum})$`);

                const barLayer = barInst.children.find((n: SceneNode) => pattern.test(n.name)) as (SceneNode & LayoutMixin);

                if (barLayer) {
                    if (measureWidth > 0) {
                        try {
                            const barWidthBefore = getNodeContentWidth(barLayer, measureWidth);
                            const ratioBefore = barWidthBefore / measureWidth;
                            const desiredContentWidth = Math.max(1, measureWidth * targetRatio);

                            let leftPadding = 'x' in barLayer ? barLayer.x : 0;
                            let rightPadding = measureWidth - (('x' in barLayer ? barLayer.x : 0) + ('width' in barLayer ? barLayer.width : 0));

                            if (hasHorizontalPadding(barLayer)) {
                                const nextLeft = Math.max(0, desiredContentWidth / 2);
                                const nextRight = Math.max(0, desiredContentWidth / 2);
                                if (Math.abs(barLayer.paddingLeft - nextLeft) >= 0.1) {
                                    barLayer.paddingLeft = nextLeft;
                                }
                                if (Math.abs(barLayer.paddingRight - nextRight) >= 0.1) {
                                    barLayer.paddingRight = nextRight;
                                }
                                leftPadding = barLayer.paddingLeft;
                                rightPadding = barLayer.paddingRight;
                            } else if ('resize' in barLayer && typeof barLayer.resize === 'function' && 'width' in barLayer && 'height' in barLayer) {
                                if (Math.abs(desiredContentWidth - barLayer.width) >= 0.1) {
                                    barLayer.resize(desiredContentWidth, barLayer.height);
                                }
                                leftPadding = 'x' in barLayer ? barLayer.x : 0;
                                rightPadding = measureWidth - (leftPadding + ('width' in barLayer ? barLayer.width : 0));
                            }

                            if (m === 0) {
                                const barWidthAfter = getNodeContentWidth(barLayer, measureWidth);
                                const ratioAfter = measureWidth > 0 ? barWidthAfter / measureWidth : 0;
                                ratioAuditRows.push({
                                    colIndex: cIdx,
                                    measuredCellWidth: measureWidth,
                                    barWidth: barWidthAfter,
                                    appliedRatio: ratioAfter,
                                    leftPadding,
                                    rightPadding
                                });
                            }

                            if (shouldLogResizeDebug && m === 0) {
                                const barWidthAfter = getNodeContentWidth(barLayer, measureWidth);
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
            effectiveRatio: targetRatio,
            appliedRatio: targetRatio,
            columns: ratioAuditRows.length
        });
        ratioAuditRows.forEach((row) => {
            console.log('[chart-plugin][bar-ratio-check][col]', row);
        });
    }
}
