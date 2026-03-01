import { LINE_VARIANT_KEY_DEFAULT, LINE_VARIANT_VALUES } from '../constants';
import { clamp, normalizeHexColor, tryApplyFill, tryApplyStroke, tryApplyStrokeStyleLink, traverse } from '../utils';
import { collectColumns, setVariantProperty } from './shared';

// ==========================================
// LINE CHART DRAWING
// ==========================================

type LineInstanceSource = 'currentCol' | 'nextCol' | 'fallback';

function findTabContainer(colNode: SceneNode): SceneNode {
    if ('children' in colNode) {
        const tab = (colNode as SceneNode & ChildrenMixin).children.find((n) => n.name === 'tab');
        if (tab) return tab as SceneNode;
    }
    return colNode;
}

function findLineInstanceByRow(parent: SceneNode, rowIndex: number): InstanceNode | null {
    if (!('children' in parent)) return null;
    const pattern = new RegExp(`^line[-_]?0*(${rowIndex + 1})$`);
    const direct = (parent as SceneNode & ChildrenMixin).children.find((n) => pattern.test(n.name));
    if (direct && direct.type === 'INSTANCE') return direct;

    let found: InstanceNode | null = null;
    traverse(parent, (node) => {
        if (found || node.type !== 'INSTANCE') return;
        if (pattern.test(node.name)) found = node;
    });
    return found;
}

function collectLineInstancesForRow(graph: SceneNode, rowIndex: number): InstanceNode[] {
    const pattern = new RegExp(`^line[-_]?0*(${rowIndex + 1})$`);
    const result: InstanceNode[] = [];
    traverse(graph, (node) => {
        if (node.type === 'INSTANCE' && pattern.test(node.name)) {
            result.push(node);
        }
    });
    result.sort((a, b) => (a.x || 0) - (b.x || 0));
    return result;
}

function resolveLineInstanceForSegment(
    cols: { node: SceneNode; index: number }[],
    graph: SceneNode,
    rowIndex: number,
    segmentIndex: number,
    fallbackCache: Map<number, InstanceNode[]>
): { inst: InstanceNode | null; source: LineInstanceSource } {
    if (segmentIndex < cols.length) {
        const currentParent = findTabContainer(cols[segmentIndex].node);
        const inCurrent = findLineInstanceByRow(currentParent, rowIndex);
        if (inCurrent) return { inst: inCurrent, source: 'currentCol' };
    }

    if (segmentIndex + 1 < cols.length) {
        const nextParent = findTabContainer(cols[segmentIndex + 1].node);
        const inNext = findLineInstanceByRow(nextParent, rowIndex);
        if (inNext) return { inst: inNext, source: 'nextCol' };
    }

    if (!fallbackCache.has(rowIndex)) {
        fallbackCache.set(rowIndex, collectLineInstancesForRow(graph, rowIndex));
    }
    const fallback = fallbackCache.get(rowIndex) || [];
    return { inst: fallback[segmentIndex] || null, source: 'fallback' };
}

function resolveLineSegmentTargets(lineInst: InstanceNode): SceneNode[] {
    const targets: SceneNode[] = [];
    const upDownRoots: SceneNode[] = [];
    lineInst.children.forEach((child) => {
        const lower = child.name.toLowerCase();
        if (lower === 'up' || lower === 'down') {
            upDownRoots.push(child);
        }
    });

    const searchRoots = upDownRoots.length > 0 ? upDownRoots : [...lineInst.children];
    searchRoots.forEach((root) => {
        traverse(root, (node) => {
            if (!node.visible) return;
            if (!('strokes' in node)) return;
            if (node.type === 'VECTOR' || node.type === 'LINE' || node.type === 'POLYGON' || node.type === 'ELLIPSE' || node.type === 'RECTANGLE') {
                targets.push(node);
            }
        });
    });

    if (targets.length === 0) {
        const fallback = lineInst.children.find((n) => n.type === 'VECTOR' || n.type === 'LINE' || n.type === 'POLYGON');
        if (fallback) targets.push(fallback);
    }

    return targets;
}

function applyStrokeThickness(target: SceneNode, thickness: number) {
    if (!('strokeWeight' in target)) return false;
    const t = target as SceneNode & GeometryMixin;
    if (typeof t.strokeWeight === 'number' && t.strokeWeight !== thickness) {
        t.strokeWeight = thickness;
    }
    return true;
}

function getLineStyleId(config: any, rowIndex: number): string | null {
    const rowMode = Array.isArray(config?.rowColorModes) ? config.rowColorModes[rowIndex] : null;
    if (rowMode !== 'paint_style') return null;
    if (!Array.isArray(config?.rowPaintStyleIds)) return null;
    const id = config.rowPaintStyleIds[rowIndex];
    if (typeof id !== 'string') return null;
    return id.trim() ? id : null;
}

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
    const rowColors = Array.isArray(config?.rowColors) ? config.rowColors : [];
    const segmentCols = Math.max(1, cols.length);
    const fallbackCache = new Map<number, InstanceNode[]>();

    console.log('[chart-plugin][line-debug]', {
        segmentCols,
        pointCols: Array.isArray(values[0]) ? values[0].length : 0
    });

    for (let r = 0; r < rowCount; r++) {
        const rowColor = normalizeHexColor(rowColors[r]);
        const rowStyleId = getLineStyleId(config, r);
        const seriesData = values[r];
        const pointCols = Array.isArray(seriesData) ? seriesData.length : 0;
        const expectedSegments = Math.max(0, pointCols - 1);

        console.log('[chart-plugin][line-debug]', {
            row: r,
            segmentCols,
            pointCols,
            expectedSegments,
            segmentMismatch: expectedSegments !== segmentCols
        });

        for (let c = 0; c < seriesData.length - 1; c++) {
            if (c >= segmentCols) break;
            const startVal = Number(seriesData[c]);
            const endVal = Number(seriesData[c + 1]);

            const resolved = resolveLineInstanceForSegment(cols, graph, r, c, fallbackCache);
            const lineInst = resolved.inst;

            if (lineInst && lineInst.type === "INSTANCE") {
                lineInst.visible = true;
                const segmentTargets = resolveLineSegmentTargets(lineInst);
                let thicknessApplied = 0;
                let colorApplied = 0;
                segmentTargets.forEach((target) => {
                    if (applyStrokeThickness(target, thickness)) thicknessApplied += 1;
                    const isVectorLike = target.type === 'VECTOR' || target.type === 'LINE' || target.type === 'POLYGON' || target.type === 'RECTANGLE';
                    if (rowStyleId && isVectorLike) {
                        if (tryApplyStrokeStyleLink(target, rowStyleId)) colorApplied += 1;
                        return;
                    }
                    if (rowColor && tryApplyStroke(target, rowColor)) colorApplied += 1;
                });

                let pointApplied = 0;
                if (rowColor) {
                    traverse(lineInst, (child) => {
                        if (child.id === lineInst.id || !child.visible) return;
                        const lower = child.name.toLowerCase();
                        const isPointLike = child.type === 'ELLIPSE' || lower.includes('point') || lower.includes('dot');
                        if (isPointLike) {
                            const f = tryApplyFill(child, rowColor);
                            const s = tryApplyStroke(child, rowColor);
                            if (f || s) pointApplied += 1;
                        }
                    });
                }

                console.log('[chart-plugin][line-debug]', {
                    row: r,
                    segmentIndex: c,
                    lineInstFoundFrom: resolved.source,
                    lineInstId: lineInst.id,
                    targetsApplied: segmentTargets.length,
                    thicknessApplied,
                    colorApplied,
                    pointApplied
                });

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
            } else {
                console.warn('[chart-plugin][line-debug]', {
                    row: r,
                    segmentIndex: c,
                    lineInstFoundFrom: resolved.source,
                    message: 'line instance not found'
                });
            }
        }
    }
}
