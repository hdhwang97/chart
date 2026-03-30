import { LINE_VARIANT_KEY_DEFAULT, LINE_VARIANT_VALUES, VARIANT_PROPERTY_LINE_NUM } from '../constants';
import { clamp, normalizeHexColor, traverse, tryApplyFill, tryApplyStroke, tryApplyStrokeStyleLink } from '../utils';
import { collectColumns } from './shared';
import { debugLog } from '../log';
import {
    buildLineBundleMatrix,
    detectLineSeriesCountInColumns,
    type LineBundle,
    type LineBundleMatrix,
    type LineStructureIssue,
    type LineStructureIssueReason,
    readInstanceVariantValue,
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
    }
    | {
        ok: false;
        errorCode: 'cancelled';
        message: string;
    };

export type LineDrawChunkControl = {
    chunkSize?: number;
    shouldCancel?: () => boolean;
    yieldControl?: () => Promise<void>;
};

export type LinePrecomputedLayout = {
    cols?: ReturnType<typeof collectColumns>;
    matrix?: LineBundleMatrix;
};

const LINE_POINT_PROPERTY_KEY = 'line_point';
const LINE_LAST_POINT_PROPERTY_KEY = 'last_point';
const LINE_FILL_TYPE_PROPERTY_KEY = 'lineType';
const LINE_NUM_DEFAULT_VALUE = '1';
const LINE_NUM_CURVE_VALUE = '2';
const LINE_FILL_TYPE_DEFAULT_VALUE = 'Default';
const LINE_FILL_TYPE_CURVE_VALUE = 'R';

function canSetPaddingTop(node: SceneNode): node is SceneNode & { paddingTop: number } {
    return 'paddingTop' in node;
}

function canSetPaddingBottom(node: SceneNode): node is SceneNode & { paddingBottom: number } {
    return 'paddingBottom' in node;
}

function canSetUniformPadding(node: SceneNode): node is SceneNode & {
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
} {
    return 'paddingTop' in node && 'paddingRight' in node && 'paddingBottom' in node && 'paddingLeft' in node;
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

function setUniformPadding(node: SceneNode, value: number): boolean {
    if (!canSetUniformPadding(node)) return false;
    try {
        const next = Math.max(0, value);
        let changed = false;
        if (Math.abs(node.paddingTop - next) > 1e-6) { node.paddingTop = next; changed = true; }
        if (Math.abs(node.paddingRight - next) > 1e-6) { node.paddingRight = next; changed = true; }
        if (Math.abs(node.paddingBottom - next) > 1e-6) { node.paddingBottom = next; changed = true; }
        if (Math.abs(node.paddingLeft - next) > 1e-6) { node.paddingLeft = next; changed = true; }
        return changed;
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

function isPointLikeNode(node: SceneNode): boolean {
    const lower = node.name.toLowerCase();
    const hasPointLikeName = lower.includes('point') || lower.includes('dot');
    if (hasPointLikeName && lower.includes('container')) return false;
    return node.type === 'ELLIPSE' || hasPointLikeName;
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

function readStringComponentProperty(node: SceneNode, key: string): string | null {
    if (node.type !== 'INSTANCE') return null;
    const propKey = getComponentPropKey(node, key);
    if (!propKey) return null;
    const rawValue = node.componentProperties?.[propKey]?.value;
    if (typeof rawValue === 'string') return rawValue;
    if (typeof rawValue === 'number') return String(rawValue);
    return null;
}

function setComponentProperties(
    node: SceneNode,
    updates: Record<string, string | boolean>
): boolean {
    if (node.type !== 'INSTANCE') return false;
    const resolved: Record<string, string | boolean> = {};
    let hasAnyKey = false;

    Object.entries(updates).forEach(([logicalKey, value]) => {
        const propKey = getComponentPropKey(node, logicalKey);
        if (!propKey) return;
        hasAnyKey = true;
        const current = node.componentProperties?.[propKey]?.value;
        if (current === value) return;
        resolved[propKey] = value;
    });

    if (!hasAnyKey) return false;
    if (Object.keys(resolved).length === 0) return true;

    try {
        node.setProperties(resolved);
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
            if (isPointLikeNode(node)) return;
            if (!('strokes' in node)) return;
            if (node.type === 'VECTOR' || node.type === 'LINE' || node.type === 'POLYGON' || node.type === 'RECTANGLE') {
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

function resolveLinePointTargets(lineRoot: SceneNode): SceneNode[] {
    const targets: SceneNode[] = [];
    traverse(lineRoot, (node) => {
        if (node.id === lineRoot.id || !node.visible) return;
        if (!isPointLikeNode(node)) return;
        targets.push(node);
    });
    return targets;
}

type LineNodeTargetCacheEntry = {
    segmentTargets: SceneNode[];
    pointTargets: SceneNode[];
};

function resolveLineNodeTargets(
    lineRoot: SceneNode,
    cache: Map<string, LineNodeTargetCacheEntry>
): LineNodeTargetCacheEntry {
    const cached = cache.get(lineRoot.id);
    if (cached) return cached;
    const entry: LineNodeTargetCacheEntry = {
        segmentTargets: resolveLineSegmentTargets(lineRoot),
        pointTargets: resolveLinePointTargets(lineRoot)
    };
    cache.set(lineRoot.id, entry);
    return entry;
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

function applyLineColorAndStroke(segmentTargets: SceneNode[], rowColor: string | null, rowStyleId: string | null, thickness: number) {
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

function resolveLinePointStyle(config: any, rowIndex: number, fallbackColor: string | null, fallbackThickness: number) {
    const styles = Array.isArray(config?.markStyles) ? config.markStyles : [];
    const fallbackStyle = config?.markStyle && typeof config.markStyle === 'object' ? config.markStyle : null;
    const source = styles[rowIndex] || fallbackStyle || null;
    const strokeColor = normalizeHexColor(source?.linePointStrokeColor)
        || normalizeHexColor(source?.strokeColor)
        || fallbackColor;
    const fillColor = normalizeHexColor(source?.linePointFillColor)
        || normalizeHexColor(source?.fillColor)
        || fallbackColor
        || strokeColor;
    const thicknessRaw = Number(source?.linePointThickness);
    const thickness = Number.isFinite(thicknessRaw) ? Math.max(0, thicknessRaw) : Math.max(0, fallbackThickness);
    const paddingRaw = Number(source?.linePointPadding);
    const padding = Number.isFinite(paddingRaw) ? Math.max(0, paddingRaw) : undefined;
    return {
        strokeColor,
        fillColor,
        thickness,
        padding
    };
}

function applyLinePointColors(
    pointTargets: SceneNode[],
    style: { strokeColor: string | null; fillColor: string | null; thickness: number; padding?: number }
) {
    if (!style.strokeColor && !style.fillColor) return;
    pointTargets.forEach((target) => {
        if (style.fillColor) tryApplyFill(target, style.fillColor);
        if (style.strokeColor) tryApplyStroke(target, style.strokeColor);
        applyStrokeThickness(target, style.thickness);
        if (typeof style.padding === 'number') {
            setUniformPadding(target, style.padding);
        }
    });
}

function setLineStrokeVisibility(segmentTargets: SceneNode[], visible: boolean) {
    segmentTargets.forEach((target) => {
        setStrokeVisibility(target, visible);
    });
}

function resolveBundleLinePointVisible(bundle: LineBundle): boolean | null {
    return readBooleanComponentProperty(bundle.lineNode, LINE_POINT_PROPERTY_KEY);
}

function resolveBundleLineCurveEnabled(bundle: LineBundle): boolean | null {
    const lineNumValue = readInstanceVariantValue(bundle.lineNode, VARIANT_PROPERTY_LINE_NUM)?.trim();
    const fillTypeValue = readInstanceVariantValue(bundle.fillNode, LINE_FILL_TYPE_PROPERTY_KEY)?.trim().toLowerCase();
    if (lineNumValue === LINE_NUM_CURVE_VALUE || fillTypeValue === LINE_FILL_TYPE_CURVE_VALUE.toLowerCase()) {
        return true;
    }
    if (lineNumValue === LINE_NUM_DEFAULT_VALUE || fillTypeValue === LINE_FILL_TYPE_DEFAULT_VALUE.toLowerCase()) {
        return false;
    }
    if (lineNumValue !== null || fillTypeValue !== null) {
        return false;
    }
    return null;
}

function applyLineBundleLayout(
    bundle: LineBundle,
    pTop: number,
    pBottom: number,
    lineDirection: string,
    fillDirection: string,
    fillBottomOffset = 0,
    options?: {
        linePointVisible?: boolean;
        lastPointVisible?: boolean;
        curveEnabled?: boolean;
    }
): LineStructureIssueReason | null {
    if (!setPaddingTop(bundle.lineNode, pTop) || !setPaddingBottom(bundle.lineNode, pBottom)) {
        return 'line_padding_unsupported';
    }
    if (!setPaddingTop(bundle.fillTop, pTop)) return 'fill_top_padding_unsupported';
    if (!setPaddingBottom(bundle.fillBot, pBottom + fillBottomOffset)) return 'fill_bot_padding_unsupported';

    const curveEnabled = options?.curveEnabled === true;
    const lineResult = setComponentProperties(bundle.lineNode, {
        [LINE_VARIANT_KEY_DEFAULT]: lineDirection,
        [VARIANT_PROPERTY_LINE_NUM]: curveEnabled ? LINE_NUM_CURVE_VALUE : LINE_NUM_DEFAULT_VALUE,
        [LINE_POINT_PROPERTY_KEY]: options?.linePointVisible !== false,
        [LINE_LAST_POINT_PROPERTY_KEY]: options?.lastPointVisible === true
    });
    if (!lineResult) return 'line_direction_variant_missing';

    const fillTypeValue = curveEnabled && fillDirection !== LINE_VARIANT_VALUES.FLAT
        ? LINE_FILL_TYPE_CURVE_VALUE
        : LINE_FILL_TYPE_DEFAULT_VALUE;
    const fillResult = setComponentProperties(bundle.fillNode, {
        [LINE_VARIANT_KEY_DEFAULT]: fillDirection,
        [LINE_FILL_TYPE_PROPERTY_KEY]: fillTypeValue
    });
    if (!fillResult) return 'fill_direction_variant_missing';

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

export async function applyLine(
    config: any,
    H: number,
    graph: SceneNode,
    control?: LineDrawChunkControl,
    precomputed?: LinePrecomputedLayout
): Promise<LineApplyResult> {
    const flatEpsilon = 1e-6;
    const values = Array.isArray(config?.values) ? config.values : [];
    const rowCount = values.length;
    const thickness = Number.isFinite(Number(config?.strokeWidth)) ? Number(config.strokeWidth) : 2;
    const linePointVisible = config?.linePointVisible !== false;
    const lineCurveEnabled = config?.lineFeature2Enabled === true;
    const deferSegmentStrokeStyling = config?.deferLineSegmentStrokeStyling === true;
    const layoutOnly = config?.layoutOnly === true;
    const shouldApplyStrokeStyling = !deferSegmentStrokeStyling && !layoutOnly;
    const shouldApplyPointStyling = !layoutOnly;
    const cols = (precomputed?.cols ?? collectColumns(graph)).filter((col) => col.node.visible);
    const maxSegmentsFromValues = values.reduce((max: number, row: any) => {
        const count = Array.isArray(row) ? Math.max(0, row.length - 1) : 0;
        return Math.max(max, count);
    }, 0);
    const segmentCount = Math.max(0, Math.min(cols.length, maxSegmentsFromValues));

    if (rowCount === 0 || segmentCount === 0) {
        return { ok: true, rowCount, segmentCount, appliedSegments: 0 };
    }

    const resolveStart = Date.now();
    const matrix = precomputed?.matrix ?? buildLineBundleMatrix(cols, rowCount);
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
    const chunkSize = Math.max(1, Number(control?.chunkSize) || 10);
    let processedSegmentsForYield = 0;
    let appliedSegments = 0;
    const lineNodeTargetCache = new Map<string, LineNodeTargetCacheEntry>();
    for (let r = 0; r < rowCount; r++) {
        if (control?.shouldCancel?.()) {
            return {
                ok: false,
                errorCode: 'cancelled',
                message: 'Line apply cancelled.'
            };
        }
        const rowColor = (shouldApplyStrokeStyling || shouldApplyPointStyling)
            ? normalizeHexColor(Array.isArray(config?.rowColors) ? config.rowColors[r] : null)
            : null;
        const rowStyleId = shouldApplyStrokeStyling ? getLineStyleId(config, r) : null;
        const pointStyle = shouldApplyPointStyling
            ? resolveLinePointStyle(config, r, rowColor, thickness)
            : null;
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
            const bundleTargets = resolveLineNodeTargets(bundle.lineNode, lineNodeTargetCache);
            if (shouldApplyStrokeStyling) {
                applyLineColorAndStroke(bundleTargets.segmentTargets, rowColor, rowStyleId, thickness);
            }
            if (pointStyle) {
                applyLinePointColors(bundleTargets.pointTargets, pointStyle);
            }
            setLineStrokeVisibility(bundleTargets.segmentTargets, !isFlat);
            const layoutIssue = applyLineBundleLayout(
                bundle,
                pTop,
                pBottom,
                lineDirection,
                fillDirection,
                isFlat ? (thickness / 2) : 0,
                {
                    linePointVisible,
                    lastPointVisible: linePointVisible && c === rowSegmentCount - 1,
                    curveEnabled: lineCurveEnabled
                }
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
            processedSegmentsForYield += 1;
            if (processedSegmentsForYield % chunkSize === 0) {
                if (control?.shouldCancel?.()) {
                    return {
                        ok: false,
                        errorCode: 'cancelled',
                        message: 'Line apply cancelled.'
                    };
                }
                if (control?.yieldControl) await control.yieldControl();
                if (control?.shouldCancel?.()) {
                    return {
                        ok: false,
                        errorCode: 'cancelled',
                        message: 'Line apply cancelled.'
                    };
                }
            }
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

export function syncFlatLineFillBottomPadding(
    graph: SceneNode,
    precomputedCols?: ReturnType<typeof collectColumns>,
    precomputedMatrix?: LineBundleMatrix
) {
    const cols = (precomputedCols ?? collectColumns(graph)).filter((col) => col.node.visible);
    if (cols.length === 0) return;

    const matrix = precomputedMatrix ?? buildLineBundleMatrix(cols, detectLineSeriesCountInColumns(cols));

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

export function resolveLineFeature2Enabled(graph: SceneNode, precomputedCols?: ReturnType<typeof collectColumns>): boolean {
    const cols = (precomputedCols ?? collectColumns(graph)).filter((col) => col.node.visible);
    const searchCols = cols.length > 0 ? cols : (precomputedCols ?? collectColumns(graph));
    const rowCount = Math.max(1, detectLineSeriesCountInColumns(searchCols));
    const matrix = buildLineBundleMatrix(searchCols, rowCount);
    for (const row of matrix) {
        for (const bundle of row) {
            if (!bundle) continue;
            const enabled = resolveBundleLineCurveEnabled(bundle);
            if (enabled === null) continue;
            return enabled;
        }
    }
    return false;
}
