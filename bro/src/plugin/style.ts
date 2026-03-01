import { MARK_NAME_PATTERNS } from './constants';
import { rgbToHex, findAllLineLayers, traverse } from './utils';
import { collectColumns, type ColRef } from './drawing/shared';
import type { CellFillInjectionStyle, CellStrokeStyle, MarkInjectionStyle, RowStrokeStyle, StrokeStyleSnapshot } from '../shared/style-types';

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

function pickDominantStrokeWeight(weights: number[]): number | null {
    if (weights.length === 0) return null;
    const counts = new Map<number, number>();
    for (const raw of weights) {
        if (!Number.isFinite(raw) || raw <= 0) continue;
        const rounded = Math.round(raw * 100) / 100;
        counts.set(rounded, (counts.get(rounded) || 0) + 1);
    }
    if (counts.size === 0) return null;
    let winner = 0;
    let winnerCount = -1;
    counts.forEach((count, weight) => {
        if (count > winnerCount) {
            winner = weight;
            winnerCount = count;
        }
    });
    return winner > 0 ? winner : null;
}

function collectLineStrokeWeights(layer: SceneNode): number[] {
    const upDownRoots: SceneNode[] = [];
    if ('children' in layer) {
        for (const child of (layer as SceneNode & ChildrenMixin).children) {
            const lower = child.name.toLowerCase();
            if (lower === 'up' || lower === 'down') {
                upDownRoots.push(child);
            }
        }
    }

    const roots = upDownRoots.length > 0 ? upDownRoots : [layer];
    const weights: number[] = [];
    roots.forEach((root) => {
        traverse(root, (n) => {
            if (!n.visible) return;
            if (!('strokeWeight' in n)) return;
            const target = n as SceneNode & GeometryMixin;
            if (typeof target.strokeWeight === 'number' && target.strokeWeight > 0) {
                weights.push(target.strokeWeight);
            }
        });
    });
    return weights;
}

function parseAssistMetricFromName(name: string): 'min' | 'max' | 'avg' | 'ctr' | null {
    const lower = name.toLowerCase();
    if (!lower.includes('asst_line')) return null;
    if (lower.includes('min') || lower.includes('최소')) return 'min';
    if (lower.includes('max') || lower.includes('최대')) return 'max';
    if (lower.includes('avg') || lower.includes('average') || lower.includes('평균')) return 'avg';
    if (lower.includes('ctr') || lower.includes('center') || lower.includes('mid') || lower.includes('중앙')) return 'ctr';
    return null;
}

export function extractAssistLineStrokeStyle(graph: SceneNode): StrokeStyleSnapshot | null {
    let firstAssistNode: SceneNode | null = null;
    traverse(graph, (node) => {
        if (firstAssistNode) return;
        if (!parseAssistMetricFromName(node.name)) return;
        firstAssistNode = node;
    });
    if (!firstAssistNode) return null;

    const direct = getStrokeSnapshot(firstAssistNode);
    if (direct) return direct;

    let nestedStroke: StrokeStyleSnapshot | null = null;
    traverse(firstAssistNode, (node) => {
        if (nestedStroke) return;
        if (node.id === firstAssistNode!.id) return;
        const snapshot = getStrokeSnapshot(node);
        if (snapshot) nestedStroke = snapshot;
    });
    return nestedStroke;
}

export function extractColStrokeStyle(graph: SceneNode, precomputedCols?: ColRef[]): StrokeStyleSnapshot | null {
    const columns = resolveColumns(graph, precomputedCols);
    for (const col of columns) {
        const target = findColumnStrokeNode(col.node);
        if (!target) continue;
        const snapshot = getStrokeSnapshot(target);
        if (snapshot) return snapshot;
    }
    return null;
}

export function extractCellStrokeStyles(graph: SceneNode, precomputedCols?: ColRef[]): CellStrokeStyle[] {
    const columns = resolveColumns(graph, precomputedCols);
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

export function extractCellFillStyle(graph: SceneNode, precomputedCols?: ColRef[]): CellFillInjectionStyle | null {
    const columns = resolveColumns(graph, precomputedCols);
    for (const col of columns) {
        let fillColor: string | null = null;
        traverse(col.node, (node) => {
            if (fillColor) return;
            if (!MARK_NAME_PATTERNS.CEL.test(node.name)) return;
            if (!('fills' in node) || !Array.isArray(node.fills) || node.fills.length === 0) return;
            const first = node.fills[0];
            if (first.type === 'SOLID') {
                fillColor = rgbToHex(first.color.r, first.color.g, first.color.b);
            }
        });
        if (fillColor) return { color: fillColor };
    }
    return null;
}

function getSolidFillColor(node: SceneNode): string | null {
    if (!('fills' in node) || !Array.isArray(node.fills) || node.fills.length === 0) return null;
    const first = node.fills[0];
    if (first.type !== 'SOLID') return null;
    return rgbToHex(first.color.r, first.color.g, first.color.b);
}

function getSolidStrokeColor(node: SceneNode): string | null {
    if (!('strokes' in node) || !Array.isArray(node.strokes) || node.strokes.length === 0) return null;
    const first = node.strokes[0];
    if (first.type !== 'SOLID') return null;
    return rgbToHex(first.color.r, first.color.g, first.color.b);
}

function parseMarkSeriesIndex(name: string): number | null {
    if (MARK_NAME_PATTERNS.BAR_ITEM_SINGLE.test(name)) return 1;
    const barMulti = MARK_NAME_PATTERNS.BAR_ITEM_MULTI.exec(name);
    if (barMulti) {
        const idx = Number(barMulti[1]);
        return Number.isFinite(idx) && idx > 0 ? idx : null;
    }
    const stackedSeg = MARK_NAME_PATTERNS.STACKED_SEGMENT.exec(name);
    if (stackedSeg) {
        const idx = Number(stackedSeg[1]);
        return Number.isFinite(idx) && idx > 0 ? idx : null;
    }
    const line = MARK_NAME_PATTERNS.LINE.exec(name);
    if (line) {
        const idx = Number(line[1] || 1);
        return Number.isFinite(idx) && idx > 0 ? idx : 1;
    }
    return null;
}

function toMarkStyleSnapshot(node: SceneNode): MarkInjectionStyle | null {
    const fillColor = getSolidFillColor(node);
    const strokeColor = getSolidStrokeColor(node);
    const thickness = 'strokeWeight' in node && typeof node.strokeWeight === 'number' ? node.strokeWeight : undefined;
    const strokeStyle = 'dashPattern' in node && Array.isArray(node.dashPattern) && node.dashPattern.length > 0 ? 'dash' : 'solid';
    if (!fillColor && !strokeColor && thickness === undefined) return null;
    return {
        fillColor: fillColor || undefined,
        strokeColor: strokeColor || undefined,
        thickness,
        strokeStyle
    };
}

function toLineInstanceMarkStyle(node: SceneNode): MarkInjectionStyle | null {
    let found: MarkInjectionStyle | null = null;
    traverse(node, (child) => {
        if (found) return;
        if (child.id === node.id || !child.visible) return;
        const lower = child.name.toLowerCase();
        const isPointLike = child.type === 'ELLIPSE' || lower.includes('point') || lower.includes('dot');
        const isVectorLike = child.type === 'VECTOR' || child.type === 'LINE' || child.type === 'POLYGON' || child.type === 'RECTANGLE';
        if (!isPointLike && !isVectorLike) return;
        found = toMarkStyleSnapshot(child);
    });
    return found;
}

export function extractMarkStyles(graph: SceneNode, precomputedCols?: ColRef[]): MarkInjectionStyle[] {
    const columns = resolveColumns(graph, precomputedCols);
    const byIndex = new Map<number, MarkInjectionStyle>();

    columns.forEach((col) => {
        traverse(col.node, (node) => {
            if (!node.visible) return;
            const idx = parseMarkSeriesIndex(node.name);
            if (!idx || byIndex.has(idx)) return;

            if (node.type === 'INSTANCE' && MARK_NAME_PATTERNS.LINE.test(node.name)) {
                const lineStyle = toLineInstanceMarkStyle(node);
                if (lineStyle) byIndex.set(idx, lineStyle);
                return;
            }

            const markStyle = toMarkStyleSnapshot(node);
            if (markStyle) byIndex.set(idx, markStyle);
        });
    });

    return Array.from(byIndex.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, style]) => style);
}

export function extractMarkStyle(graph: SceneNode): MarkInjectionStyle | null {
    const styles = extractMarkStyles(graph);
    if (styles.length > 0) return styles[0];
    const columns = collectColumns(graph);
    for (const col of columns) {
        let found: MarkInjectionStyle | null = null;
        traverse(col.node, (node) => {
            if (found) return;
            if (!node.visible) return;
            const isBarLike =
                MARK_NAME_PATTERNS.BAR_ITEM_SINGLE.test(node.name)
                || MARK_NAME_PATTERNS.BAR_ITEM_MULTI.test(node.name)
                || MARK_NAME_PATTERNS.STACKED_SEGMENT.test(node.name);
            const lower = node.name.toLowerCase();
            const isLineOrPoint = MARK_NAME_PATTERNS.LINE.test(node.name) || lower.includes('point') || lower.includes('dot');
            if (!isBarLike && !isLineOrPoint) return;

            const fillColor = getSolidFillColor(node);
            const strokeColor = getSolidStrokeColor(node);
            const thickness = 'strokeWeight' in node && typeof node.strokeWeight === 'number' ? node.strokeWeight : undefined;
            const strokeStyle = 'dashPattern' in node && Array.isArray(node.dashPattern) && node.dashPattern.length > 0 ? 'dash' : 'solid';

            if (!fillColor && !strokeColor && thickness === undefined) return;
            found = {
                fillColor: fillColor || undefined,
                strokeColor: strokeColor || undefined,
                thickness,
                strokeStyle
            };
        });
        if (found) return found;
    }
    return null;
}

export function extractChartContainerStrokeStyle(graph: SceneNode): StrokeStyleSnapshot | null {
    let colContainer: SceneNode | null = null;
    let colFallback: SceneNode | null = null;
    traverse(graph, (node) => {
        if (colContainer) return;
        if (node.id === graph.id) return;
        if (node.name !== 'col' || !('children' in node)) return;
        if (!colFallback) colFallback = node;
        const hasChartContainer = (node as SceneNode & ChildrenMixin).children.some((child) => child.name === 'chart_container');
        if (hasChartContainer) {
            colContainer = node;
        }
    });

    const col = colContainer || colFallback;
    if (!col || !('children' in col)) return null;

    const chartContainer = (col as SceneNode & ChildrenMixin).children.find((child) => child.name === 'chart_container');
    if (!chartContainer || !('children' in chartContainer)) return null;

    const styleLayer = (chartContainer as SceneNode & ChildrenMixin).children.find((child) => child.name === 'style');
    if (!styleLayer) return null;

    return getStrokeSnapshot(styleLayer);
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

export function extractChartColors(graph: SceneNode, chartType: string, precomputedCols?: ColRef[]): string[] {
    const colors: string[] = [];
    const columns = resolveColumns(graph, precomputedCols);
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
export function extractStyleFromNode(node: SceneNode, chartType: string, options: ExtractStyleOptions = {}) {
    const cols = resolveColumns(node, options.columns);
    const colors = extractChartColors(node, chartType, cols);

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
                        // padding 기반 레이아웃을 우선으로 읽고, 없으면 width 기반으로 fallback.
                        if ('paddingLeft' in mark && 'paddingRight' in mark) {
                            const contentWidth = firstColNode.width - (mark as any).paddingLeft - (mark as any).paddingRight;
                            if (contentWidth > 0) {
                                markRatio = contentWidth / firstColNode.width;
                            }
                        } else if (mark.width > 0) {
                            markRatio = mark.width / firstColNode.width;
                        }
                        if (markRatio < 0.01) markRatio = 0.01;
                        if (markRatio > 1.0) markRatio = 1.0;

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
                            const lineLayers = findAllLineLayers(container);
                            const candidateWeights: number[] = [];
                            lineLayers.forEach((lineLayer) => {
                                candidateWeights.push(...collectLineStrokeWeights(lineLayer));
                            });
                            const dominant = pickDominantStrokeWeight(candidateWeights);
                            if (dominant !== null) {
                                strokeWidth = dominant;
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('Style Extract Error', e);
    }

    if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) {
        strokeWidth = 2;
    }

    if (options.fastPath) {
        return {
            colors,
            markRatio,
            cornerRadius,
            strokeWidth,
            cellFillStyle: null,
            markStyle: null,
            markStyles: [],
            colStrokeStyle: null,
            chartContainerStrokeStyle: null,
            assistLineStrokeStyle: null,
            cellStrokeStyles: [],
            rowStrokeStyles: []
        };
    }

    const colStrokeStyle = extractColStrokeStyle(node, cols);
    const cellFillStyle = extractCellFillStyle(node, cols);
    const markStyles = extractMarkStyles(node, cols);
    const markStyle = markStyles[0] || null;
    const chartContainerStrokeStyle = extractChartContainerStrokeStyle(node);
    const assistLineStrokeStyle = extractAssistLineStrokeStyle(node);
    const cellStrokeStyles = extractCellStrokeStyles(node, cols);
    const inferredRowCount = Math.max(0, ...cellStrokeStyles.map(c => c.row + 1));
    const rowStrokeStyles = deriveRowStrokeStyles(cellStrokeStyles, inferredRowCount, cols.length);

    return {
        colors,
        markRatio,
        cornerRadius,
        strokeWidth,
        cellFillStyle,
        markStyle,
        markStyles,
        colStrokeStyle,
        chartContainerStrokeStyle,
        assistLineStrokeStyle,
        cellStrokeStyles,
        rowStrokeStyles
    };
}
type ExtractStyleOptions = {
    columns?: ColRef[];
    fastPath?: boolean;
};

function resolveColumns(graph: SceneNode, precomputedCols?: ColRef[]): ColRef[] {
    return precomputedCols ?? collectColumns(graph);
}
