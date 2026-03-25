import { LINE_VARIANT_KEY_DEFAULT, LINE_VARIANT_VALUES } from '../constants';
import { clamp, normalizeHexColor, traverse, tryApplyFill, tryApplyStroke, tryApplyStrokeStyleLink } from '../utils';
import { collectColumns, setVariantProperty } from './shared';
import { debugLog } from '../log';
import {
    buildLineBundleMatrix,
    detectLineSeriesCountInColumns,
    type LineBundle,
    type LineStructureIssue,
    type LineStructureIssueReason,
    validateLineStructureOrError,
    isLineBundleFlat
} from './line-structure';

// ==========================================
// LINE CHART DRAWING
// ==========================================

export type LineApplyResult =
    | {
        ok: true;
        rowCount: number;
        segmentCount: number;
        appliedSegments: number;
    }
    | {
        ok: false;
        errorCode: 'line_structure_missing';
        message: string;
        missing: LineStructureIssue[];
    };

const LINE_POINT_PROPERTY_KEY = 'line_point';
const LINE_LAST_POINT_PROPERTY_KEY = 'last_point';

function canSetPaddingTop(node: SceneNode): node is SceneNode & { paddingTop: number } {
    return 'paddingTop' in node;
}

function canSetPaddingBottom(node: SceneNode): node is SceneNode & { paddingBottom: number } {
    return 'paddingBottom' in node;
}

function getComponentPropKey(instance: InstanceNode, key: string): string | null {
    try {
        const props = instance.componentProperties || {};
        const found = Object.keys(props).find((rawKey) => rawKey === key || rawKey.startsWith(`${key}#`));
        return found || null;
    } catch {
        return null;
    }
}

function hasDirectionVariant(instance: InstanceNode): boolean {
    return Boolean(getComponentPropKey(instance, LINE_VARIANT_KEY_DEFAULT));
}

function setPaddingTop(node: SceneNode, value: number): boolean {
    if (!canSetPaddingTop(node)) return false;
    try {
        const next = Math.max(0, value);
        if (Math.abs(node.paddingTop - next) <= 1e-6) return true;
        node.paddingTop = next;
        return true;
    } catch {
        return false;
    }
}

function setPaddingBottom(node: SceneNode, value: number): boolean {
    if (!canSetPaddingBottom(node)) return false;
    try {
        const next = Math.max(0, value);
        if (Math.abs(node.paddingBottom - next) <= 1e-6) return true;
        node.paddingBottom = next;
        return true;
    } catch {
        return false;
    }
}

function setStrokeVisibility(node: SceneNode, visible: boolean): boolean {
    if (!('strokes' in node)) return false;
    try {
        const target = node as SceneNode & GeometryMixin;
        if (!Array.isArray(target.strokes)) return false;
        if (target.strokes.every((paint) => paint.visible === visible)) return false;
        target.strokes = target.strokes.map((paint) => ({ ...paint, visible }));
        return true;
    } catch {
        return false;
    }
}

function setDirectionVariant(target: SceneNode, direction: string): boolean {
    if (target.type !== 'INSTANCE') return false;
    const propKey = getComponentPropKey(target, LINE_VARIANT_KEY_DEFAULT);
    if (!propKey) return false;
    const current = target.componentProperties?.[propKey]?.value;
    if (current === direction) return true;
    try {
        target.setProperties({ [propKey]: direction });
        return true;
    } catch {
        return false;
    }
}

function readBooleanComponentProperty(node: SceneNode, key: string): boolean | null {
    if (node.type !== 'INSTANCE') return null;
    const propKey = getComponentPropKey(node, key);
    if (!propKey) return null;
    const rawValue = node.componentProperties?.[propKey]?.value;
    if (typeof rawValue === 'boolean') return rawValue;
    if (typeof rawValue === 'string') {
        const normalized = rawValue.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return null;
}

function setBooleanComponentProperty(node: SceneNode, key: string, value: boolean): boolean {
    if (node.type !== 'INSTANCE') return false;
    const propKey = getComponentPropKey(node, key);
    if (!propKey) return false;
    const current = readBooleanComponentProperty(node, key);
    if (current === value) return true;
    try {
        node.setProperties({ [propKey]: value });
        return true;
    } catch {
        return false;
    }
}

function validateBundleCompatibility(bundle: LineBundle): LineStructureIssueReason | null {
    if (bundle.lineNode.type !== 'INSTANCE') return 'line_not_instance';
    if (bundle.fillNode.type !== 'INSTANCE') return 'fill_not_instance';
    if (!hasDirectionVariant(bundle.lineNode)) return 'line_direction_variant_missing';
    if (!hasDirectionVariant(bundle.fillNode)) return 'fill_direction_variant_missing';
    if (!canSetPaddingTop(bundle.lineNode) || !canSetPaddingBottom(bundle.lineNode)) return 'line_padding_unsupported';
    if (!canSetPaddingTop(bundle.fillTop)) return 'fill_top_padding_unsupported';
    if (!canSetPaddingBottom(bundle.fillBot)) return 'fill_bot_padding_unsupported';
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

function readStrokeThickness(target: SceneNode): number {
    let maxThickness = 0;
    if ('strokeWeight' in target && typeof target.strokeWeight === 'number') {
        maxThickness = Math.max(maxThickness, target.strokeWeight);
    }
    if ('strokeTopWeight' in target && typeof target.strokeTopWeight === 'number') {
        maxThickness = Math.max(maxThickness, target.strokeTopWeight);
    }
    if ('strokeRightWeight' in target && typeof target.strokeRightWeight === 'number') {
        maxThickness = Math.max(maxThickness, target.strokeRightWeight);
    }
    if ('strokeBottomWeight' in target && typeof target.strokeBottomWeight === 'number') {
        maxThickness = Math.max(maxThickness, target.strokeBottomWeight);
    }
    if ('strokeLeftWeight' in target && typeof target.strokeLeftWeight === 'number') {
        maxThickness = Math.max(maxThickness, target.strokeLeftWeight);
    }
    return maxThickness;
}

function resolveLineStrokeThickness(lineRoot: SceneNode, fallback: number): number {
    const segmentTargets = resolveLineSegmentTargets(lineRoot);
    const maxThickness = segmentTargets.reduce((max, target) => Math.max(max, readStrokeThickness(target)), 0);
    return maxThickness > 0 ? maxThickness : fallback;
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
}

function applyLinePointColors(targetNode: SceneNode, rowColor: string | null) {
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

function setLineStrokeVisibility(lineRoot: SceneNode, visible: boolean) {
    const segmentTargets = resolveLineSegmentTargets(lineRoot);
    segmentTargets.forEach((target) => {
        setStrokeVisibility(target, visible);
    });
}

function setLinePointVisibility(bundle: LineBundle, visible: boolean): boolean {
    return setBooleanComponentProperty(bundle.lineNode, LINE_POINT_PROPERTY_KEY, visible);
}

function resolveBundleLinePointVisible(bundle: LineBundle): boolean | null {
    return readBooleanComponentProperty(bundle.lineNode, LINE_POINT_PROPERTY_KEY);
}

function applyLineBundleLayout(
    bundle: LineBundle,
    pTop: number,
    pBottom: number,
    lineDirection: string,
    fillDirection: string,
    fillBottomOffset = 0
): LineStructureIssueReason | null {
    if (!setPaddingTop(bundle.lineNode, pTop) || !setPaddingBottom(bundle.lineNode, pBottom)) {
        return 'line_padding_unsupported';
    }
    if (!setPaddingTop(bundle.fillTop, pTop)) return 'fill_top_padding_unsupported';
    if (!setPaddingBottom(bundle.fillBot, pBottom + fillBottomOffset)) return 'fill_bot_padding_unsupported';
    if (!setDirectionVariant(bundle.lineNode, lineDirection)) return 'line_direction_variant_missing';
    if (!setDirectionVariant(bundle.fillNode, fillDirection)) return 'fill_direction_variant_missing';
    return null;
}

function computeYRange(config: any, values: any[][]): { min: number; max: number } {
    const mode = config?.mode;
    if (mode === 'raw') {
        const min = 0;
        const configuredMax = Number(config?.yMax);
        if (Number.isFinite(configuredMax) && configuredMax > 0) {
            return { min, max: configuredMax };
        }
        const flat = values.flat().map((v: any) => Number(v) || 0);
        return { min, max: Math.max(...flat, 1) };
    }
    const yMin = Number(config?.yMin);
    const yMax = Number(config?.yMax);
    return {
        min: Number.isFinite(yMin) ? yMin : 0,
        max: Number.isFinite(yMax) ? yMax : 100
    };
}

function buildLineApplyFailure(message: string, missing: LineStructureIssue[]): LineApplyResult {
    return {
        ok: false,
        errorCode: 'line_structure_missing',
        message,
        missing
    };
}

export function applyLine(config: any, H: number, graph: SceneNode): LineApplyResult {
    const flatEpsilon = 1e-6;
    const values = Array.isArray(config?.values) ? config.values : [];
    const rowCount = values.length;
    const thickness = Number.isFinite(Number(config?.strokeWidth)) ? Number(config.strokeWidth) : 2;
    const linePointVisible = config?.linePointVisible !== false;
    const deferSegmentStrokeStyling = config?.deferLineSegmentStrokeStyling === true;
    const cols = collectColumns(graph).filter((col) => col.node.visible);
    const maxSegmentsFromValues = values.reduce((max: number, row: any) => {
        const count = Array.isArray(row) ? Math.max(0, row.length - 1) : 0;
        return Math.max(max, count);
    }, 0);
    const segmentCount = Math.max(0, Math.min(cols.length, maxSegmentsFromValues));

    if (rowCount === 0 || segmentCount === 0) {
        return { ok: true, rowCount, segmentCount, appliedSegments: 0 };
    }

    const resolveStart = Date.now();
    const matrix = buildLineBundleMatrix(cols, rowCount);
    const validation = validateLineStructureOrError(matrix, rowCount, segmentCount, validateBundleCompatibility);
    const resolveMs = Date.now() - resolveStart;
    if (!validation.ok) {
        console.error('[chart-plugin][line-structure-missing]', {
            rowCount,
            segmentCount,
            resolveMs,
            missingCount: validation.missing.length,
            missing: validation.missing
        });
        return buildLineApplyFailure('Line structure is missing required line-n bundle nodes.', validation.missing);
    }

    const yRange = computeYRange(config, values);
    const safeRange = yRange.max - yRange.min === 0 ? 1 : (yRange.max - yRange.min);

    const applyStart = Date.now();
    let appliedSegments = 0;
    for (let r = 0; r < rowCount; r++) {
        const rowColor = normalizeHexColor(Array.isArray(config?.rowColors) ? config.rowColors[r] : null);
        const rowStyleId = getLineStyleId(config, r);
        const seriesData = Array.isArray(values[r]) ? values[r] : [];
        const rowSegmentCount = Math.max(0, Math.min(segmentCount, seriesData.length - 1));

        for (let c = 0; c < rowSegmentCount; c++) {
            const bundle = matrix[r]?.[c];
            if (!bundle) {
                return buildLineApplyFailure('Line structure matrix was not resolved for all segments.', [{
                    rowIndex: r,
                    segmentIndex: c,
                    columnIndex: c,
                    containerName: `line-${String(r + 1).padStart(2, '0')}`,
                    reason: 'missing_bundle'
                }]);
            }

            const startVal = Number(seriesData[c]);
            const endVal = Number(seriesData[c + 1]);
            const isFlat = Math.abs(endVal - startVal) < flatEpsilon;
            const startRatio = (startVal - yRange.min) / safeRange;
            const endRatio = (endVal - yRange.min) / safeRange;
            const startPx = H * clamp(startRatio, 0, 1);
            const endPx = H * clamp(endRatio, 0, 1);
            const pBottom = Math.min(startPx, endPx);
            const pTop = H - Math.max(startPx, endPx);
            let dir: string = LINE_VARIANT_VALUES.FLAT;
            if (endPx > startPx) dir = LINE_VARIANT_VALUES.UP;
            if (endPx < startPx) dir = LINE_VARIANT_VALUES.DOWN;
            const fillDirection = isFlat ? LINE_VARIANT_VALUES.FLAT : dir;
            const lineDirection = dir === LINE_VARIANT_VALUES.DOWN ? LINE_VARIANT_VALUES.DOWN : LINE_VARIANT_VALUES.UP;

            bundle.container.visible = true;
            bundle.lineNode.visible = true;
            bundle.fillNode.visible = true;
            setLinePointVisibility(bundle, linePointVisible);
            setBooleanComponentProperty(
                bundle.lineNode,
                LINE_LAST_POINT_PROPERTY_KEY,
                linePointVisible && c === rowSegmentCount - 1
            );
            if (!deferSegmentStrokeStyling) {
                applyLineColorAndStroke(bundle.lineNode, rowColor, rowStyleId, thickness);
            }
            applyLinePointColors(bundle.lineNode, rowColor);
            setLineStrokeVisibility(bundle.lineNode, !isFlat);
            const layoutIssue = applyLineBundleLayout(
                bundle,
                pTop,
                pBottom,
                lineDirection,
                fillDirection,
                isFlat ? (thickness / 2) : 0
            );
            if (layoutIssue) {
                return buildLineApplyFailure('Line bundle layout injection failed.', [{
                    rowIndex: r,
                    segmentIndex: c,
                    columnIndex: c,
                    containerName: `line-${String(r + 1).padStart(2, '0')}`,
                    reason: layoutIssue
                }]);
            }
            appliedSegments += 1;
        }
    }

    debugLog('[chart-plugin][line-apply-summary]', {
        rowCount,
        segmentCount,
        appliedSegments,
        resolveMs,
        applyMs: Date.now() - applyStart
    });

    return {
        ok: true,
        rowCount,
        segmentCount,
        appliedSegments
    };
}

export function syncFlatLineFillBottomPadding(graph: SceneNode, precomputedCols?: ReturnType<typeof collectColumns>) {
    const cols = (precomputedCols ?? collectColumns(graph)).filter((col) => col.node.visible);
    if (cols.length === 0) return;

    const detectedRows = detectLineSeriesCountInColumns(cols);
    const matrix = buildLineBundleMatrix(cols, detectedRows);

    matrix.forEach((row) => {
        row.forEach((bundle) => {
            if (!bundle || !isLineBundleFlat(bundle)) return;
            if (!canSetPaddingBottom(bundle.lineNode) || !canSetPaddingBottom(bundle.fillBot)) return;
            const basePadding = Math.max(0, bundle.lineNode.paddingBottom);
            const strokeThickness = resolveLineStrokeThickness(bundle.lineNode, 0);
            setPaddingBottom(bundle.fillBot, basePadding + (strokeThickness / 2));
        });
    });
}

export function resolveLinePointVisible(graph: SceneNode, precomputedCols?: ReturnType<typeof collectColumns>): boolean {
    const cols = (precomputedCols ?? collectColumns(graph)).filter((col) => col.node.visible);
    const searchCols = cols.length > 0 ? cols : (precomputedCols ?? collectColumns(graph));
    const rowCount = Math.max(1, detectLineSeriesCountInColumns(searchCols));
    const matrix = buildLineBundleMatrix(searchCols, rowCount);
    for (const row of matrix) {
        for (const bundle of row) {
            if (!bundle) continue;
            const visible = resolveBundleLinePointVisible(bundle);
            if (visible === null) continue;
            return visible;
        }
    }
    return true;
}
