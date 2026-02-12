import { MARK_NAME_PATTERNS } from './constants';
import { rgbToHex, findAllLineLayers } from './utils';
import { collectColumns } from './drawing/shared';

// ==========================================
// STYLE EXTRACTION LOGIC
// ==========================================

export function extractChartColors(graph: SceneNode, chartType: string): string[] {
    const colors: string[] = [];
    const columns = collectColumns(graph);
    if (columns.length === 0) return [];

    const firstCol = columns[0].node;
    let targetParent: SceneNode = firstCol;

    if ("children" in firstCol) {
        const tab = (firstCol as any).children.find((n: SceneNode) => n.name === "tab");
        if (tab) targetParent = tab;
    }

    if (chartType === "bar" || chartType === "stackedBar") {
        const barInstance = (targetParent as any).children.find((n: SceneNode) => MARK_NAME_PATTERNS.BAR_INSTANCE.test(n.name));

        if (barInstance && "children" in barInstance) {
            for (let i = 1; i <= 25; i++) {
                const pat = new RegExp(`^bar[-_]?0*(${i})$`);
                const barItem = (barInstance as any).children.find((n: SceneNode) => {
                    if (i === 1 && MARK_NAME_PATTERNS.BAR_ITEM_SINGLE.test(n.name)) return true;
                    return pat.test(n.name);
                });

                if (barItem && barItem.visible) {
                    if ("fills" in barItem && Array.isArray(barItem.fills) && barItem.fills.length > 0) {
                        const paint = barItem.fills[0];
                        let hexCode = "#CCCCCC";
                        if (paint.type === "SOLID") {
                            hexCode = rgbToHex(paint.color.r, paint.color.g, paint.color.b);
                        }
                        colors.push(hexCode);
                    }
                }
            }
        }
    }
    else if (chartType === "line") {
        const layers = findAllLineLayers(targetParent);
        layers.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        layers.forEach((layer) => {
            if (!layer.visible) return;
            let hexCode = "#CCCCCC";
            let found = false;

            if ("children" in layer) {
                const children = (layer as any).children;
                for (const child of children) {
                    if (!child.visible) continue;
                    if ("strokes" in child && Array.isArray(child.strokes) && child.strokes.length > 0) {
                        const paint = child.strokes[0];
                        if (paint.type === "SOLID") {
                            hexCode = rgbToHex(paint.color.r, paint.color.g, paint.color.b);
                            found = true;
                            break;
                        }
                    }
                }
            }
            if (!found && "strokes" in layer && Array.isArray((layer as any).strokes) && (layer as any).strokes.length > 0) {
                const paint = (layer as any).strokes[0];
                if (paint.type === "SOLID") {
                    hexCode = rgbToHex(paint.color.r, paint.color.g, paint.color.b);
                }
            }
            colors.push(hexCode);
        });
    }
    return colors;
}

// 노드에서 스타일 정보(비율, 라운드, 두께 등) 추출
export function extractStyleFromNode(node: SceneNode, chartType: string) {
    const cols = collectColumns(node);
    const colors = extractChartColors(node, chartType);

    let markRatio = 0.8;
    let cornerRadius = 0;
    let strokeWidth = 2;

    try {
        if (cols.length > 0) {
            const firstColNode = cols[0].node as FrameNode;
            if (firstColNode.width > 0) {
                // 1. Container 탐색
                let container: SceneNode = firstColNode;
                if ("children" in firstColNode) {
                    const tab = (firstColNode as any).children.find((n: SceneNode) => n.name === "tab");
                    if (tab) container = tab;
                }

                // 2. Mark 탐색
                if ("children" in container) {
                    const mark = (container as any).children.find((child: SceneNode) =>
                        child.visible &&
                        (child.name.includes("bar") || child.name.includes("mark") || child.name.includes("line"))
                    );

                    if (mark) {
                        // A. 너비 비율 (Bar Width Ratio)
                        if (mark.width > 0) {
                            markRatio = mark.width / firstColNode.width;
                            if (markRatio < 0.01) markRatio = 0.01;
                            if (markRatio > 1.0) markRatio = 1.0;
                        }

                        // B. 라운드 값 (Corner Radius) - Bar 차트용
                        if (chartType !== 'line' && 'cornerRadius' in mark) {
                            if (typeof mark.cornerRadius === 'number') {
                                cornerRadius = mark.cornerRadius;
                            } else if (typeof mark.cornerRadius === 'object') {
                                cornerRadius = (mark as any).topLeftRadius || 0;
                            }
                        }

                        // C. 선 두께 (Stroke Weight) - Line 차트용
                        if (chartType === 'line') {
                            if ('strokeWeight' in mark && typeof mark.strokeWeight === 'number') {
                                strokeWidth = mark.strokeWeight;
                            } else if ('children' in mark) {
                                const vector = (mark as any).children.find((c: SceneNode) => c.type === "VECTOR" || c.type === "LINE");
                                if (vector && 'strokeWeight' in vector) {
                                    strokeWidth = vector.strokeWeight;
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error("Style Extract Error", e);
    }

    return {
        colors,
        markRatio,
        cornerRadius,
        strokeWidth
    };
}
