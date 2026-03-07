import { LINE_VARIANT_KEY_DEFAULT, LINE_VARIANT_VALUES } from '../constants';
import { clamp, normalizeHexColor, tryApplyFill, tryApplyStroke, tryApplyStrokeStyleLink, traverse } from '../utils';
import { collectColumns, setVariantProperty } from './shared';

// ==========================================
// LINE CHART DRAWING
// ==========================================

type LineInstanceSource = 'currentCol' | 'nextCol' | 'fallback';

type LineTestBundle = {
    container: SceneNode;
    lineNode: SceneNode;
    fillNode: SceneNode;
    fillTop: SceneNode;
    fillBottom: SceneNode;
};

type LineTargetResolution =
    | { kind: 'line_test'; source: LineInstanceSource; bundle: LineTestBundle }
    | { kind: 'legacy'; source: LineInstanceSource; inst: InstanceNode };

function normalizeToken(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

function readInstancePropValueCI(instance: InstanceNode, canonicalKey: string): string | null {
    try {
        const props = instance.componentProperties || {};
        const target = normalizeToken(canonicalKey);
        const keys = Object.keys(props);
        for (const rawKey of keys) {
            const keyBase = normalizeToken(rawKey.split('#')[0]);
            if (keyBase !== target) continue;
            const rawValue = props[rawKey]?.value;
            if (rawValue === null || rawValue === undefined) return '';
            return typeof rawValue === 'string' ? rawValue : String(rawValue);
        }
    } catch {
        return null;
    }
    return null;
}

function findFirstInstanceDepthFirst(node: SceneNode): InstanceNode | null {
    if (node.type === 'INSTANCE') return node;
    if (!('children' in node)) return null;
    for (const child of (node as SceneNode & ChildrenMixin).children) {
        const found = findFirstInstanceDepthFirst(child);
        if (found) return found;
    }
    return null;
}

function findFirstInstanceInColumn(colNode: SceneNode): InstanceNode | null {
    if (!('children' in colNode)) return null;
    const children = (colNode as SceneNode & ChildrenMixin).children;
    const tab = children.find((child) => child.name === 'tab') || null;
    if (tab) {
        const foundInTab = findFirstInstanceDepthFirst(tab);
        if (foundInTab) return foundInTab;
    }
    for (const child of children) {
        if (tab && child.id === tab.id) continue;
        const found = findFirstInstanceDepthFirst(child);
        if (found) return found;
    }
    return null;
}

export function isLineTestColumn(colNode: SceneNode): boolean {
    let targetInstance: InstanceNode | null = null;
    if (colNode.type === 'INSTANCE') {
        targetInstance = colNode;
    } else {
        targetInstance = findFirstInstanceInColumn(colNode);
    }
    if (!targetInstance) return false;
    const value = readInstancePropValueCI(targetInstance, 'mark type');
    return normalizeToken(value) === 'line_test';
}

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

function resolveLegacyLineInstanceForSegment(
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

function findChildByExactName(parent: SceneNode, name: string): SceneNode | null {
    if (!('children' in parent)) return null;
    const children = (parent as SceneNode & ChildrenMixin).children;
    const direct = children.find((child) => child.name === name);
    if (direct) return direct;
    for (const child of children) {
        const nested = findChildByExactName(child, name);
        if (nested) return nested;
    }
    return null;
}

function findLineNContainer(parent: SceneNode, rowIndex: number): SceneNode | null {
    const rowNum = rowIndex + 1;
    // line_test container naming convention starts at line-01, line-02, ...
    const paddedName = `line-${String(rowNum).padStart(2, '0')}`;
    return findChildByExactName(parent, paddedName) || findChildByExactName(parent, `line-${rowNum}`);
}

function resolveLineTestBundleInColumn(colNode: SceneNode, rowIndex: number): LineTestBundle | null {
    const targetParent = findTabContainer(colNode);
    const container = findLineNContainer(targetParent, rowIndex);
    if (!container) return null;
    const lineNode = findChildByExactName(container, 'line');
    const fillNode = findChildByExactName(container, 'fill');
    if (!lineNode || !fillNode) return null;
    const fillTop = findChildByExactName(fillNode, 'fill_top');
    const fillBottom = findChildByExactName(fillNode, 'fill_bot');
    if (!fillTop || !fillBottom) return null;
    return { container, lineNode, fillNode, fillTop, fillBottom };
}

function canSetPaddingTop(node: SceneNode): node is SceneNode & { paddingTop: number } {
    return 'paddingTop' in node;
}

function canSetPaddingBottom(node: SceneNode): node is SceneNode & { paddingBottom: number } {
    return 'paddingBottom' in node;
}

function hasDirectionVariant(instance: InstanceNode): boolean {
    return readInstancePropValueCI(instance, 'direction') !== null;
}

function setPaddingTop(node: SceneNode, value: number): boolean {
    if (!canSetPaddingTop(node)) return false;
    try {
        node.paddingTop = Math.max(0, value);
        return true;
    } catch {
        return false;
    }
}

function setPaddingBottom(node: SceneNode, value: number): boolean {
    if (!canSetPaddingBottom(node)) return false;
    try {
        node.paddingBottom = Math.max(0, value);
        return true;
    } catch {
        return false;
    }
}

function setDirectionVariant(target: SceneNode, direction: string): boolean {
    if (target.type !== 'INSTANCE') return false;
    return setVariantProperty(target, LINE_VARIANT_KEY_DEFAULT, direction)
        || setVariantProperty(target, 'Direction', direction);
}

function canApplyLineTestBundle(bundle: LineTestBundle): boolean {
    if (bundle.lineNode.type !== 'INSTANCE' || bundle.fillNode.type !== 'INSTANCE') return false;
    if (!hasDirectionVariant(bundle.lineNode) || !hasDirectionVariant(bundle.fillNode)) return false;
    if (!canSetPaddingTop(bundle.lineNode) || !canSetPaddingBottom(bundle.lineNode)) return false;
    if (!canSetPaddingTop(bundle.fillTop)) return false;
    if (!canSetPaddingBottom(bundle.fillBottom)) return false;
    return true;
}

function resolveLineTargetForSegment(
    cols: { node: SceneNode; index: number }[],
    lineTestFlags: boolean[],
    graph: SceneNode,
    rowIndex: number,
    segmentIndex: number,
    fallbackCache: Map<number, InstanceNode[]>
): LineTargetResolution | null {
    const canTryCurrentLineTest = segmentIndex < cols.length && lineTestFlags[segmentIndex];
    if (canTryCurrentLineTest) {
        const currentBundle = resolveLineTestBundleInColumn(cols[segmentIndex].node, rowIndex);
        if (currentBundle && canApplyLineTestBundle(currentBundle)) {
            return { kind: 'line_test', source: 'currentCol', bundle: currentBundle };
        }
        const canTryNextLineTest = segmentIndex + 1 < cols.length && lineTestFlags[segmentIndex + 1];
        if (canTryNextLineTest) {
            const nextBundle = resolveLineTestBundleInColumn(cols[segmentIndex + 1].node, rowIndex);
            if (nextBundle && canApplyLineTestBundle(nextBundle)) {
                return { kind: 'line_test', source: 'nextCol', bundle: nextBundle };
            }
        }
        const legacy = resolveLegacyLineInstanceForSegment(cols, graph, rowIndex, segmentIndex, fallbackCache);
        if (legacy.inst) return { kind: 'legacy', source: legacy.source, inst: legacy.inst };
        return null;
    }

    const legacy = resolveLegacyLineInstanceForSegment(cols, graph, rowIndex, segmentIndex, fallbackCache);
    if (legacy.inst) return { kind: 'legacy', source: legacy.source, inst: legacy.inst };
    return null;
}

function resolveLineSegmentTargets(lineRoot: SceneNode): SceneNode[] {
    const targets: SceneNode[] = [];
    const upDownRoots: SceneNode[] = [];
    if (!('children' in lineRoot)) return targets;
    (lineRoot as SceneNode & ChildrenMixin).children.forEach((child) => {
        const lower = child.name.toLowerCase();
        if (lower === 'up' || lower === 'down') {
            upDownRoots.push(child);
        }
    });

    const searchRoots = upDownRoots.length > 0 ? upDownRoots : [...(lineRoot as SceneNode & ChildrenMixin).children];
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
        const fallback = (lineRoot as SceneNode & ChildrenMixin).children.find((n) => n.type === 'VECTOR' || n.type === 'LINE' || n.type === 'POLYGON');
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

function applyLineColorAndStroke(targetNode: SceneNode, rowColor: string | null, rowStyleId: string | null, thickness: number) {
    const segmentTargets = resolveLineSegmentTargets(targetNode);
    segmentTargets.forEach((target) => {
        applyStrokeThickness(target, thickness);
        const isVectorLike = target.type === 'VECTOR' || target.type === 'LINE' || target.type === 'POLYGON' || target.type === 'RECTANGLE';
        if (rowStyleId && isVectorLike) {
            tryApplyStrokeStyleLink(target, rowStyleId);
            return;
        }
        if (rowColor) tryApplyStroke(target, rowColor);
    });

    if (!rowColor) return;
    traverse(targetNode, (child) => {
        if (child.id === targetNode.id || !child.visible) return;
        const lower = child.name.toLowerCase();
        const isPointLike = child.type === 'ELLIPSE' || lower.includes('point') || lower.includes('dot');
        if (!isPointLike) return;
        tryApplyFill(child, rowColor);
        tryApplyStroke(child, rowColor);
    });
}

function applyLineTestLayout(bundle: LineTestBundle, pTop: number, pBottom: number, direction: string): boolean {
    if (!setPaddingTop(bundle.lineNode, pTop)) return false;
    if (!setPaddingBottom(bundle.lineNode, pBottom)) return false;
    if (!setPaddingTop(bundle.fillTop, pTop)) return false;
    if (!setPaddingBottom(bundle.fillBottom, pBottom)) return false;
    if (!setDirectionVariant(bundle.lineNode, direction)) return false;
    if (!setDirectionVariant(bundle.fillNode, direction)) return false;
    return true;
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
    const lineTestFlags = cols.map((col) => isLineTestColumn(col.node));
    const segmentCols = Math.max(1, cols.length);
    const fallbackCache = new Map<number, InstanceNode[]>();
    let lineTestApplied = 0;
    let lineTestFallback = 0;
    let legacyApplied = 0;
    let unresolved = 0;

    for (let r = 0; r < rowCount; r++) {
        const rowColor = normalizeHexColor(rowColors[r]);
        const rowStyleId = getLineStyleId(config, r);
        const seriesData = values[r];
        if (!Array.isArray(seriesData)) continue;

        for (let c = 0; c < seriesData.length - 1; c++) {
            if (c >= segmentCols) break;
            const startVal = Number(seriesData[c]);
            const endVal = Number(seriesData[c + 1]);
            const startRatio = (startVal - min) / safeRange;
            const endRatio = (endVal - min) / safeRange;
            const startPx = H * clamp(startRatio, 0, 1);
            const endPx = H * clamp(endRatio, 0, 1);
            const pBottom = Math.min(startPx, endPx);
            const pTop = H - Math.max(startPx, endPx);
            let dir: string = LINE_VARIANT_VALUES.FLAT;
            if (endPx > startPx) dir = LINE_VARIANT_VALUES.UP;
            if (endPx < startPx) dir = LINE_VARIANT_VALUES.DOWN;

            const resolved = resolveLineTargetForSegment(cols, lineTestFlags, graph, r, c, fallbackCache);
            if (!resolved) {
                unresolved += 1;
                continue;
            }

            if (resolved.kind === 'line_test') {
                applyLineColorAndStroke(resolved.bundle.lineNode, rowColor, rowStyleId, thickness);
                const applied = applyLineTestLayout(resolved.bundle, pTop, pBottom, dir);
                if (applied) {
                    lineTestApplied += 1;
                    continue;
                }
                const fallbackLegacy = resolveLegacyLineInstanceForSegment(cols, graph, r, c, fallbackCache);
                if (!fallbackLegacy.inst) {
                    unresolved += 1;
                    continue;
                }
                fallbackLegacy.inst.visible = true;
                applyLineColorAndStroke(fallbackLegacy.inst, rowColor, rowStyleId, thickness);
                fallbackLegacy.inst.paddingBottom = Math.max(0, pBottom);
                fallbackLegacy.inst.paddingTop = Math.max(0, pTop);
                setDirectionVariant(fallbackLegacy.inst, dir);
                lineTestFallback += 1;
                legacyApplied += 1;
                continue;
            }

            const isLineTestSegment = c < lineTestFlags.length && lineTestFlags[c];
            resolved.inst.visible = true;
            applyLineColorAndStroke(resolved.inst, rowColor, rowStyleId, thickness);
            resolved.inst.paddingBottom = Math.max(0, pBottom);
            resolved.inst.paddingTop = Math.max(0, pTop);
            setDirectionVariant(resolved.inst, dir);
            if (isLineTestSegment) lineTestFallback += 1;
            legacyApplied += 1;
        }
    }

    if (lineTestApplied > 0 || lineTestFallback > 0) {
        console.log('[chart-plugin][line-test-summary]', {
            lineTestApplied,
            lineTestFallback,
            legacyApplied,
            unresolved
        });
    }
}
