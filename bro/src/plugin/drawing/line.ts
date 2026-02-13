import { LINE_VARIANT_KEY_DEFAULT, LINE_VARIANT_VALUES } from '../constants';
import { clamp } from '../utils';
import { collectColumns, setVariantProperty } from './shared';

// ==========================================
// LINE CHART DRAWING
// ==========================================

export function applyLine(config: any, H: number, graph: SceneNode) {
    const { values, mode } = config;
    const thickness = config.strokeWidth || 2;

    let min = 0, max = 100;

    if (mode === "raw") {
        min = 0;
        const configuredMax = Number(config.yMax);
        if (Number.isFinite(configuredMax) && configuredMax > 0) {
            max = configuredMax;
        } else {
            const flat = values.flat().map((v: any) => Number(v) || 0);
            max = Math.max(...flat, 1);
        }
    } else {
        min = config.yMin !== undefined ? config.yMin : 0;
        max = config.yMax !== undefined ? config.yMax : 100;
    }
    const range = max - min;
    const safeRange = range === 0 ? 1 : range;

    const cols = collectColumns(graph);
    const rowCount = values.length;

    for (let r = 0; r < rowCount; r++) {
        const seriesData = values[r];
        for (let c = 0; c < seriesData.length - 1; c++) {
            if (c >= cols.length) break;
            const startVal = Number(seriesData[c]);
            const endVal = Number(seriesData[c + 1]);

            let parent: any = cols[c].node;
            if ("children" in parent) {
                const tab = parent.children.find((n: SceneNode) => n.name === "tab");
                if (tab) parent = tab;
            }

            const lineInst = parent.children.find((n: SceneNode) => n.name.match(new RegExp(`^line[-_]?0*(${r + 1})$`)));

            if (lineInst && lineInst.type === "INSTANCE") {
                lineInst.visible = true;

                // 인스턴스 내부의 Vector(선) 레이어를 찾아 두께 적용
                const vectorLayer = lineInst.children.find((n: SceneNode) => n.type === "VECTOR" || n.type === "LINE") as (VectorNode | LineNode);
                if (vectorLayer) {
                    if (vectorLayer.strokeWeight !== thickness) {
                        vectorLayer.strokeWeight = thickness;
                    }
                }

                const startRatio = (startVal - min) / safeRange;
                const endRatio = (endVal - min) / safeRange;
                const startPx = H * clamp(startRatio, 0, 1);
                const endPx = H * clamp(endRatio, 0, 1);
                const pBottom = Math.min(startPx, endPx);
                const pTop = H - Math.max(startPx, endPx);

                lineInst.paddingBottom = Math.max(0, pBottom);
                lineInst.paddingTop = Math.max(0, pTop);

                let dir: string = LINE_VARIANT_VALUES.FLAT;
                if (endPx > startPx) dir = LINE_VARIANT_VALUES.UP;
                if (endPx < startPx) dir = LINE_VARIANT_VALUES.DOWN;
                setVariantProperty(lineInst, LINE_VARIANT_KEY_DEFAULT, dir);
            }
        }
    }
}
