import { MARK_NAME_PATTERNS, VARIANT_PROPERTY_MARK_NUM } from '../constants';
import { collectColumns, setVariantProperty } from './shared';

// ==========================================
// STACKED BAR CHART DRAWING
// ==========================================

export function applyStackedBar(config: any, H: number, graph: SceneNode) {
    const { values, mode, markNum } = config;
    if (!values || values.length === 0) return;

    const rowCount = values.length;
    const totalDataCols = values[0].length;

    let globalMaxSum = 100;
    if (mode === "raw") {
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
        if ("children" in colObj.node) {
            const tab = (colObj.node as any).children.find((n: SceneNode) => n.name === "tab");
            if (tab) targetParent = tab;
        }

        let groupInstance: InstanceNode | null = null;
        if ("children" in targetParent) {
            groupInstance = (targetParent as any).children.find((n: SceneNode) => MARK_NAME_PATTERNS.STACKED_GROUP.test(n.name));
        }

        if (groupInstance && groupInstance.type === "INSTANCE") {
            let markNumChanged = setVariantProperty(groupInstance, VARIANT_PROPERTY_MARK_NUM, String(currentGroupBarCount));
            if (!markNumChanged) markNumChanged = setVariantProperty(groupInstance, 'Count', String(currentGroupBarCount));
            if (!markNumChanged) markNumChanged = setVariantProperty(groupInstance, 'Size', String(currentGroupBarCount));

            const subBars = (groupInstance as any).children.filter((n: SceneNode) => MARK_NAME_PATTERNS.STACKED_SUB_INSTANCE.test(n.name));
            subBars.sort((a: SceneNode, b: SceneNode) => {
                const numA = parseInt(a.name.match(/\d+/)?.[0] || "0");
                const numB = parseInt(b.name.match(/\d+/)?.[0] || "0");
                return numA - numB;
            });

            if (markNumChanged) {
                // markNum 변경 직후에는 이전 숨김 상태를 초기화한다.
                subBars.forEach((subBar: SceneNode) => {
                    subBar.visible = true;
                    if ("children" in subBar) {
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
                    applySegmentsToBar(subBar, values, globalDataIdx, rowCount, H, globalMaxSum, mode);
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
    mode: string
) {
    if (!("children" in barInstance)) return;

    for (let r = 0; r < rowCount; r++) {
        const val = Number(values[r][colIndex]) || 0;
        const targetNum = r + 1;

        const segmentPattern = new RegExp(`^bar[-_]?0*(${targetNum})$`);
        const targetLayer = (barInstance as any).children.find((n: SceneNode) => segmentPattern.test(n.name)) as (SceneNode & LayoutMixin);

        if (targetLayer) {
            if (val === 0) {
                targetLayer.visible = false;
            } else {
                targetLayer.visible = true;
                let ratio = 0;
                if (mode === "raw") {
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
