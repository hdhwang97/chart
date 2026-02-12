import { MARK_NAME_PATTERNS } from './constants';
import { rgbToHex, findAllLineLayers, traverse } from './utils';
import { collectColumns } from './drawing/shared';
import type { CellStrokeStyle, RowStrokeStyle, StrokeStyleSnapshot } from '../shared/style-types';

// ==========================================
// STYLE EXTRACTION LOGIC
// ==========================================

function getStrokeSnapshot(target: SceneNode): StrokeStyleSnapshot | null {
    const snapshot: StrokeStyleSnapshot = {};

    if ('strokes' in target && Array.isArray(target.strokes) && target.strokes.length > 0) {
        const first = target.strokes[0];
        if (first.type === 'SOLID') {
            snapshot.color = rgbToHex(first.color.r, first.color.g, first.color.b);
            snapshot.opacity = first.opacity ?? 1;
        }
    }

    if ('strokeWeight' in target && typeof target.strokeWeight === 'number') {
        snapshot.weight = target.strokeWeight;
    }

    if ('strokeTopWeight' in target && typeof target.strokeTopWeight === 'number') {
        snapshot.weightTop = target.strokeTopWeight;
    }
    if ('strokeRightWeight' in target && typeof target.strokeRightWeight === 'number') {
        snapshot.weightRight = target.strokeRightWeight;
    }
    if ('strokeBottomWeight' in target && typeof target.strokeBottomWeight === 'number') {
        snapshot.weightBottom = target.strokeBottomWeight;
    }
    if ('strokeLeftWeight' in target && typeof target.strokeLeftWeight === 'number') {
        snapshot.weightLeft = target.strokeLeftWeight;
    }

    if ('strokeAlign' in target) {
        snapshot.align = target.strokeAlign;
    }

    if ('dashPattern' in target && Array.isArray(target.dashPattern) && target.dashPattern.length > 0) {
        snapshot.dashPattern = [...target.dashPattern];
    }

    if (Object.keys(snapshot).length === 0) {
        return null;
    }

    return snapshot;
}

function findColumnStrokeNode(colNode: SceneNode): SceneNode | null {
    const direct = getStrokeSnapshot(colNode);
    if (direct) return colNode;

    if ('children' in colNode) {
        const tab = (colNode as any).children.find((n: SceneNode) => n.name === 'tab');
        if (tab && getStrokeSnapshot(tab)) {
            return tab;
        }
    }

    return null;
}

function collectCellsInColumn(colNode: SceneNode): { row: number; node: SceneNode }[] {
    const rows: { row: number; node: SceneNode }[] = [];

    traverse(colNode, (node) => {
        const match = MARK_NAME_PATTERNS.CEL.exec(node.name);
        if (!match) return;
        const rowIndex = Number(match[1]) - 1;
        if (rowIndex >= 0) {
            rows.push({ row: rowIndex, node });
        }
    });

    const deduped = new Map<number, SceneNode>();
    rows.forEach(item => {
        if (!deduped.has(item.row)) {
            deduped.set(item.row, item.node);
        }
    });

    return Array.from(deduped.entries())
        .map(([row, node]) => ({ row, node }))
        .sort((a, b) => a.row - b.row);
}

function average(nums: number[]): number | undefined {
    if (nums.length === 0) return undefined;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function mode(values: string[]): string | undefined {
    if (values.length === 0) return undefined;
    const counts = new Map<string, number>();
    values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    let topVal = values[0];
    let topCount = counts.get(topVal) || 0;
    counts.forEach((count, key) => {
        if (count > topCount) {
            topCount = count;
            topVal = key;
        }
    });
    return topVal;
}

function serializeDashPattern(pattern?: number[]): string | undefined {
    if (!pattern || pattern.length === 0) return undefined;
    return JSON.stringify(pattern);
}

function parseDashPattern(serialized?: string): number[] | undefined {
    if (!serialized) return undefined;
    try {
        const parsed = JSON.parse(serialized);
        if (Array.isArray(parsed)) return parsed.map(v => Number(v));
    } catch (e) {
        return undefined;
    }
    return undefined;
}

export function extractColStrokeStyle(graph: SceneNode): StrokeStyleSnapshot | null {
    const columns = collectColumns(graph);
    for (const col of columns) {
        const target = findColumnStrokeNode(col.node);
        if (!target) continue;
        const snapshot = getStrokeSnapshot(target);
        if (snapshot) return snapshot;
    }
    return null;
}

export function extractCellStrokeStyles(graph: SceneNode): CellStrokeStyle[] {
    const columns = collectColumns(graph);
    const cellStyles: CellStrokeStyle[] = [];

    columns.forEach((col, colIndex) => {
        const cells = collectCellsInColumn(col.node);
        cells.forEach(cell => {
            const stroke = getStrokeSnapshot(cell.node);
            if (!stroke) return;
            cellStyles.push({
                row: cell.row,
                col: colIndex,
                stroke
            });
        });
    });

    return cellStyles;
}

export function deriveRowStrokeStyles(cellStrokeStyles: CellStrokeStyle[], rowCount: number, _colCount: number): RowStrokeStyle[] {
    const bucket = new Map<number, StrokeStyleSnapshot[]>();
    cellStrokeStyles.forEach(item => {
        if (item.row >= rowCount) return;
        if (!bucket.has(item.row)) {
            bucket.set(item.row, []);
        }
        bucket.get(item.row)!.push(item.stroke);
    });

    const result: RowStrokeStyle[] = [];
    bucket.forEach((strokes, row) => {
        if (strokes.length === 0) return;

        const colorMode = mode(strokes.map(s => s.color).filter((v): v is string => Boolean(v)));
        const alignMode = mode(strokes.map(s => s.align).filter((v): v is string => Boolean(v))) as StrokeStyleSnapshot['align'];
        const dashMode = mode(strokes.map(s => serializeDashPattern(s.dashPattern)).filter((v): v is string => Boolean(v)));

        const snapshot: StrokeStyleSnapshot = {};
        if (colorMode) snapshot.color = colorMode;

        const opacities = strokes.map(s => s.opacity).filter((v): v is number => typeof v === 'number');
        const avgOpacity = average(opacities);
        if (avgOpacity !== undefined) snapshot.opacity = avgOpacity;

        const weights = strokes.map(s => s.weight).filter((v): v is number => typeof v === 'number');
        const avgWeight = average(weights);
        if (avgWeight !== undefined) snapshot.weight = avgWeight;

        const topWeights = strokes.map(s => s.weightTop).filter((v): v is number => typeof v === 'number');
        const rightWeights = strokes.map(s => s.weightRight).filter((v): v is number => typeof v === 'number');
        const bottomWeights = strokes.map(s => s.weightBottom).filter((v): v is number => typeof v === 'number');
        const leftWeights = strokes.map(s => s.weightLeft).filter((v): v is number => typeof v === 'number');

        const avgTop = average(topWeights);
        const avgRight = average(rightWeights);
        const avgBottom = average(bottomWeights);
        const avgLeft = average(leftWeights);

        if (avgTop !== undefined) snapshot.weightTop = avgTop;
        if (avgRight !== undefined) snapshot.weightRight = avgRight;
        if (avgBottom !== undefined) snapshot.weightBottom = avgBottom;
        if (avgLeft !== undefined) snapshot.weightLeft = avgLeft;

        if (alignMode) snapshot.align = alignMode;
        const dash = parseDashPattern(dashMode);
        if (dash) snapshot.dashPattern = dash;

        if (Object.keys(snapshot).length > 0) {
            result.push({ row, stroke: snapshot });
        }
    });

    return result.sort((a, b) => a.row - b.row);
}

export function extractChartColors(graph: SceneNode, chartType: string): string[] {
    const colors: string[] = [];
    const columns = collectColumns(graph);
    if (columns.length === 0) return [];

    const firstCol = columns[0].node;
    let targetParent: SceneNode = firstCol;

    if ('children' in firstCol) {
        const tab = (firstCol as any).children.find((n: SceneNode) => n.name === 'tab');
        if (tab) targetParent = tab;
    }

    if (chartType === 'bar' || chartType === 'stackedBar') {
        const barInstance = (targetParent as any).children.find((n: SceneNode) => MARK_NAME_PATTERNS.BAR_INSTANCE.test(n.name));

        if (barInstance && 'children' in barInstance) {
            for (let i = 1; i <= 25; i++) {
                const pat = new RegExp(`^bar[-_]?0*(${i})$`);
                const barItem = (barInstance as any).children.find((n: SceneNode) => {
                    if (i === 1 && MARK_NAME_PATTERNS.BAR_ITEM_SINGLE.test(n.name)) return true;
                    return pat.test(n.name);
                });

                if (barItem && barItem.visible) {
                    if ('fills' in barItem && Array.isArray(barItem.fills) && barItem.fills.length > 0) {
                        const paint = barItem.fills[0];
                        let hexCode = '#CCCCCC';
                        if (paint.type === 'SOLID') {
                            hexCode = rgbToHex(paint.color.r, paint.color.g, paint.color.b);
                        }
                        colors.push(hexCode);
                    }
                }
            }
        }
    }
    else if (chartType === 'line') {
        const layers = findAllLineLayers(targetParent);
        layers.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        layers.forEach((layer) => {
            if (!layer.visible) return;
            let hexCode = '#CCCCCC';
            let found = false;

            if ('children' in layer) {
                const children = (layer as any).children;
                for (const child of children) {
                    if (!child.visible) continue;
                    if ('strokes' in child && Array.isArray(child.strokes) && child.strokes.length > 0) {
                        const paint = child.strokes[0];
                        if (paint.type === 'SOLID') {
                            hexCode = rgbToHex(paint.color.r, paint.color.g, paint.color.b);
                            found = true;
                            break;
                        }
                    }
                }
            }
            if (!found && 'strokes' in layer && Array.isArray((layer as any).strokes) && (layer as any).strokes.length > 0) {
                const paint = (layer as any).strokes[0];
                if (paint.type === 'SOLID') {
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
                if ('children' in firstColNode) {
                    const tab = (firstColNode as any).children.find((n: SceneNode) => n.name === 'tab');
                    if (tab) container = tab;
                }

                // 2. Mark 탐색
                if ('children' in container) {
                    const mark = (container as any).children.find((child: SceneNode) =>
                        child.visible &&
                        (child.name.includes('bar') || child.name.includes('mark') || child.name.includes('line'))
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
                                const vector = (mark as any).children.find((c: SceneNode) => c.type === 'VECTOR' || c.type === 'LINE');
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
        console.error('Style Extract Error', e);
    }

    const colStrokeStyle = extractColStrokeStyle(node);
    const cellStrokeStyles = extractCellStrokeStyles(node);
    const inferredRowCount = Math.max(0, ...cellStrokeStyles.map(c => c.row + 1));
    const rowStrokeStyles = deriveRowStrokeStyles(cellStrokeStyles, inferredRowCount, cols.length);

    return {
        colors,
        markRatio,
        cornerRadius,
        strokeWidth,
        colStrokeStyle,
        cellStrokeStyles,
        rowStrokeStyles
    };
}
