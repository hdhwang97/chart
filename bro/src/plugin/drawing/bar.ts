import { MARK_NAME_PATTERNS, VARIANT_PROPERTY_MARK_NUM, PLUGIN_DATA_KEYS } from '../constants';
import { collectColumns, setVariantProperty } from './shared';

// ==========================================
// BAR CHART DRAWING
// ==========================================

export function applyBar(config: any, H: number, graph: SceneNode) {
    const { values, mode, markNum } = config;
    const cols = collectColumns(graph);

    // 1. Max Value 계산
    let maxVal = 100;
    if (mode === "raw") {
        let allValues: number[] = [];
        values.forEach((row: any[]) => row.forEach((v: any) => allValues.push(Number(v) || 0)));
        maxVal = Math.max(...allValues);
        if (maxVal === 0) maxVal = 1;
    }

    // 저장된 Mark Ratio(너비 비율) 불러오기
    const savedRatioStr = graph.getPluginData(PLUGIN_DATA_KEYS.LAST_BAR_PADDING);
    const targetRatio = savedRatioStr ? parseFloat(savedRatioStr) : null;

    const numMarks = Number(markNum) || 1;

    cols.forEach((colObj, cIdx) => {
        if (cIdx >= values[0].length) return;

        let targetParent: any = colObj.node;
        if ("children" in colObj.node) {
            const tab = (colObj.node as any).children.find((n: SceneNode) => n.name === "tab");
            if (tab) targetParent = tab;
        }

        // 2. Bar Instance (컨테이너) 찾기
        const barInst = targetParent.children.find((n: SceneNode) => MARK_NAME_PATTERNS.BAR_INSTANCE.test(n.name));

        if (barInst && barInst.type === "INSTANCE") {
            // 너비 리사이징 (Mark Ratio 적용)
            if (targetRatio !== null && "width" in colObj.node && (colObj.node as any).width > 0) {
                try {
                    const colWidth = (colObj.node as any).width;
                    const newBarWidth = Math.max(1, colWidth * targetRatio);

                    if (barInst.layoutSizingHorizontal !== 'FIXED') {
                        barInst.layoutSizingHorizontal = 'FIXED';
                    }
                    barInst.resize(newBarWidth, barInst.height);
                } catch (e) {
                    console.error("Bar Resizing Error", e);
                }
            }

            // Figma 컴포넌트의 'markNum' Variant 속성 변경
            setVariantProperty(barInst, VARIANT_PROPERTY_MARK_NUM, String(numMarks));

            for (let m = 0; m < numMarks; m++) {
                let val = 0;
                if (values.length > m) val = Number(values[m][cIdx]) || 0;

                const targetNum = m + 1;
                const pattern = new RegExp(`^bar[-_]?0*(${targetNum})$`);

                const barLayer = barInst.children.find((n: SceneNode) => pattern.test(n.name)) as (SceneNode & LayoutMixin);

                if (barLayer) {
                    if (val === 0) {
                        barLayer.visible = false;
                    } else {
                        barLayer.visible = true;
                        let ratio = (mode === "raw") ? (val / maxVal) : (val / 100);
                        const finalH = Math.round((H * ratio) * 10) / 10;

                        if ('paddingBottom' in barLayer) {
                            (barLayer as any).paddingBottom = finalH;
                        }
                    }
                }
            }
        }
    });
}
