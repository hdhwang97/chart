import { MARK_NAME_PATTERNS } from '../constants';
import type {
    CellFillInjectionStyle,
    ColorMode,
    GridStrokeInjectionStyle,
    LineBackgroundInjectionStyle,
    MarkInjectionStyle,
    RowStrokeStyle,
    SideStrokeInjectionStyle,
    StrokeInjectionPayload,
    StrokeStyleSnapshot
} from '../../shared/style-types';
import { normalizeHexColor, rgbToHex, traverse, tryApplyDashPattern, tryApplyFill, tryApplyStroke, tryApplyStrokeStyleLink } from '../utils';
import { debugLog } from '../log';
import { collectColumns, type ColRef } from './shared';
import { collectLineBundlesInColumn, isLineBundleFlat, type LineBundle } from './line-structure';
import { MarkVariableBinder } from './mark-variables';

type SideName = 'top' | 'right' | 'bottom' | 'left';

type StrokeInjectionRuntimePayload = StrokeInjectionPayload & {
    chartType?: string;
    rowColors?: string[];
    rowColorModes?: ColorMode[];
    rowPaintStyleIds?: Array<string | null>;
    colColors?: string[];
    colColorEnabled?: boolean[];
    rowHeaderLabels?: string[];
    xAxisLabels?: string[];
    markNum?: number | number[];
    rowStrokeStyles?: RowStrokeStyle[];
    colStrokeStyle?: StrokeStyleSnapshot | null;
    lineBackgroundStyle?: LineBackgroundInjectionStyle;
};

type NormalizedSideStyle = {
    color?: string;
    thickness?: number;
    visible?: boolean;
    strokeStyle?: 'solid' | 'dash';
};

type NormalizedGridStyle = NormalizedSideStyle & {
    enableIndividualStroke: boolean;
    sides: {
        top: boolean;
        right: boolean;
        bottom: boolean;
        left: boolean;
    };
};

type ScopeResult = {
    candidates: number;
    applied: number;
    skipped: number;
    errors: number;
};

type NormalizedMarkStyle = {
    fillColor?: string;
    strokeColor?: string;
    linePointStrokeColor?: string;
    linePointFillColor?: string;
    linePointThickness?: number;
    linePointPadding?: number;
    lineBackgroundColor?: string;
    lineBackgroundOpacity?: number;
    lineBackgroundVisible?: boolean;
    thickness?: number;
    strokeStyle?: 'solid' | 'dash';
    enabled?: boolean;
    sides?: {
        top: boolean;
        left: boolean;
        right: boolean;
    };
};

type NormalizedLineBackgroundStyle = {
    color?: string;
    visible?: boolean;
};

export type StrokeInjectionResult = {
    cellFill: ScopeResult;
    lineBackground: ScopeResult;
    mark: ScopeResult;
    legend: ScopeResult;
    cellTop: ScopeResult;
    tabRight: ScopeResult;
    gridContainer: ScopeResult;
    resolved: {
        cellTop: boolean;
        cellFill: boolean;
        lineBackground: boolean;
        mark: boolean;
        legend: boolean;
        tabRight: boolean;
        gridContainer: boolean;
    };
    markVariableSlotMap?: Record<string, string>;
};

export type StrokeInjectionApplyOptions = {
    applyColumnScopes?: boolean;
    applyLegendScope?: boolean;
    applyGridContainerScope?: boolean;
    variableBinder?: MarkVariableBinder | null;
};

function normalizeCellFillStyle(input: unknown): { color?: string; visible?: boolean } | null {
    if (!input || typeof input !== 'object') return null;
    const source = input as CellFillInjectionStyle;
    const color = normalizeHexColor(source.color);
    const visible = typeof source.visible === 'boolean' ? source.visible : undefined;
    if (!color && visible === undefined) return null;
    return {
        color: color || undefined,
        visible
    };
}

function normalizeLineBackgroundStyle(input: unknown): NormalizedLineBackgroundStyle | null {
    if (!input || typeof input !== 'object') return null;
    const source = input as LineBackgroundInjectionStyle;
    const color = normalizeHexColor(source.color);
    const visible = typeof source.visible === 'boolean' ? source.visible : undefined;
    if (!color && visible === undefined) return null;
    return {
        color: color || undefined,
        visible
    };
}

function normalizeMarkStyle(input: unknown): NormalizedMarkStyle | null {
    if (!input || typeof input !== 'object') return null;
    const source = input as MarkInjectionStyle;
    const fillColor = normalizeHexColor(source.fillColor);
    const strokeColor = normalizeHexColor(source.strokeColor);
    const linePointStrokeColor = normalizeHexColor(source.linePointStrokeColor);
    const linePointFillColor = normalizeHexColor(source.linePointFillColor);
    const linePointThickness = normalizeThickness(source.linePointThickness);
    const linePointPadding = normalizeThickness(source.linePointPadding);
    const lineBackgroundColor = normalizeHexColor(source.lineBackgroundColor);
    const lineBackgroundOpacityRaw = Number(source.lineBackgroundOpacity);
    const lineBackgroundOpacity = Number.isFinite(lineBackgroundOpacityRaw)
        ? Math.max(0, Math.min(1, lineBackgroundOpacityRaw))
        : undefined;
    const lineBackgroundVisible = typeof source.lineBackgroundVisible === 'boolean' ? source.lineBackgroundVisible : undefined;
    const thickness = normalizeThickness(source.thickness);
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);
    const enabled = typeof source.enabled === 'boolean' ? source.enabled : undefined;
    const sides = source.sides && typeof source.sides === 'object'
        ? {
            top: source.sides.top !== false,
            left: source.sides.left !== false,
            right: source.sides.right !== false
        }
        : undefined;
    if (!fillColor && !strokeColor && !linePointStrokeColor && !linePointFillColor && linePointThickness === undefined && linePointPadding === undefined && !lineBackgroundColor && lineBackgroundOpacity === undefined && lineBackgroundVisible === undefined && thickness === undefined && !strokeStyle && enabled === undefined && !sides) return null;
    return {
        fillColor: fillColor || undefined,
        strokeColor: strokeColor || undefined,
        linePointStrokeColor: linePointStrokeColor || undefined,
        linePointFillColor: linePointFillColor || undefined,
        linePointThickness,
        linePointPadding,
        lineBackgroundColor: lineBackgroundColor || undefined,
        lineBackgroundOpacity,
        lineBackgroundVisible,
        thickness,
        strokeStyle,
        enabled,
        sides
    };
}

type IndividualStrokeNode = SceneNode & IndividualStrokesMixin;
type StrokeWeightNode = SceneNode & GeometryMixin;
type IndividualStrokeToggleNode = SceneNode & { individualStrokeWeights: boolean };
type CellNodeRef = {
    node: SceneNode;
    rowIndex: number;
};
type LineBundleStyleTargets = {
    rowIndex: number;
    bundle: LineBundle;
    isFlat: boolean;
    strokeTargets: SceneNode[];
    pointTargets: SceneNode[];
    backgroundTargets: SceneNode[];
};
type ColumnStrokeContext = {
    ref: ColRef;
    visible: boolean;
    tabNode: SceneNode | null;
    cells: CellNodeRef[];
    lastVisibleCellIndex: number | null;
    lineBundles: LineBundleStyleTargets[];
};

type FlatLineFillBotStyleApplyResult = {
    applied: boolean;
    targets: SceneNode[];
};

function createScopeResult(): ScopeResult {
    return {
        candidates: 0,
        applied: 0,
        skipped: 0,
        errors: 0
    };
}

function nearlyEqual(a: number, b: number, epsilon = 1e-6) {
    return Math.abs(a - b) <= epsilon;
}

function normalizeThickness(value: unknown): number | undefined {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return n;
}

function normalizeSideStyle(input: unknown): NormalizedSideStyle | null {
    if (!input || typeof input !== 'object') return null;
    const source = input as SideStrokeInjectionStyle;
    const color = normalizeHexColor(source.color);
    const thickness = normalizeThickness(source.thickness);
    const visible = typeof source.visible === 'boolean' ? source.visible : undefined;
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);

    if (!color && thickness === undefined && visible === undefined && !strokeStyle) return null;
    return { color: color || undefined, thickness, visible, strokeStyle };
}

function normalizeGridStyle(input: unknown): NormalizedGridStyle | null {
    if (!input || typeof input !== 'object') return null;
    const source = input as GridStrokeInjectionStyle;
    const base = normalizeSideStyle(source);
    const enableIndividualStroke = source.enableIndividualStroke !== false;
    const sides = {
        top: source.sides?.top !== false,
        right: source.sides?.right !== false,
        bottom: source.sides?.bottom !== false,
        left: source.sides?.left !== false
    };

    if (!base && source.enableIndividualStroke === undefined && source.sides === undefined) return null;
    return {
        ...(base || {}),
        enableIndividualStroke,
        sides
    };
}

function extractThicknessBySide(stroke: StrokeStyleSnapshot, side: SideName): number | undefined {
    if (side === 'top' && typeof stroke.weightTop === 'number') return stroke.weightTop;
    if (side === 'right' && typeof stroke.weightRight === 'number') return stroke.weightRight;
    if (side === 'bottom' && typeof stroke.weightBottom === 'number') return stroke.weightBottom;
    if (side === 'left' && typeof stroke.weightLeft === 'number') return stroke.weightLeft;
    if (typeof stroke.weight === 'number') return stroke.weight;
    return undefined;
}

function resolveRowZeroStroke(rowStrokeStyles: RowStrokeStyle[] | undefined): StrokeStyleSnapshot | null {
    if (!Array.isArray(rowStrokeStyles) || rowStrokeStyles.length === 0) return null;
    const rowZero = rowStrokeStyles.find((item) => item.row === 0);
    if (rowZero?.stroke) return rowZero.stroke;
    return rowStrokeStyles[0]?.stroke || null;
}

function toSideStyleFromSnapshot(stroke: StrokeStyleSnapshot | null | undefined, side: SideName): NormalizedSideStyle | null {
    if (!stroke) return null;
    const color = normalizeHexColor(stroke.color);
    const thickness = normalizeThickness(extractThicknessBySide(stroke, side));
    const visible = thickness === undefined ? undefined : thickness > 0;
    const strokeStyle = Array.isArray(stroke.dashPattern) && stroke.dashPattern.length > 0 ? 'dash' : 'solid';

    if (!color && thickness === undefined && visible === undefined && !strokeStyle) return null;
    return { color: color || undefined, thickness, visible, strokeStyle };
}

function toGridStyleFromSnapshot(stroke: StrokeStyleSnapshot | null | undefined): NormalizedGridStyle | null {
    if (!stroke) return null;
    const color = normalizeHexColor(stroke.color);
    const thickness = normalizeThickness(
        typeof stroke.weight === 'number'
            ? stroke.weight
            : stroke.weightTop ?? stroke.weightRight ?? stroke.weightBottom ?? stroke.weightLeft
    );
    const visible = thickness === undefined ? undefined : thickness > 0;
    const strokeStyle = Array.isArray(stroke.dashPattern) && stroke.dashPattern.length > 0 ? 'dash' : 'solid';

    if (!color && thickness === undefined && visible === undefined && !strokeStyle) return null;
    return {
        color: color || undefined,
        thickness,
        visible,
        strokeStyle,
        enableIndividualStroke: true,
        sides: {
            top: true,
            right: true,
            bottom: true,
            left: true
        }
    };
}

function applyStrokeStyleMode(node: SceneNode, mode: 'solid' | 'dash' | undefined) {
    if (!mode) return false;
    if (mode === 'dash') return tryApplyDashPattern(node, [4, 2]);
    return tryApplyDashPattern(node, []);
}

function isPointLikeNode(node: SceneNode) {
    const lower = node.name.toLowerCase();
    const hasPointLikeName = lower.includes('point') || lower.includes('dot');
    if (hasPointLikeName && lower.includes('container')) return false;
    return node.type === 'ELLIPSE' || hasPointLikeName;
}

function isVectorLikeNode(node: SceneNode) {
    return node.type === 'VECTOR' || node.type === 'LINE' || node.type === 'POLYGON' || node.type === 'RECTANGLE';
}

function collectColumnCells(colNode: SceneNode): CellNodeRef[] {
    const cells: CellNodeRef[] = [];
    traverse(colNode, (node) => {
        const match = MARK_NAME_PATTERNS.CEL.exec(node.name);
        if (!match) return;
        const rowIndex = Number.parseInt(match[1], 10);
        if (!Number.isFinite(rowIndex)) return;
        cells.push({ node, rowIndex });
    });
    return cells;
}

function collectLineStyleTargets(root: SceneNode): { strokeTargets: SceneNode[]; pointTargets: SceneNode[] } {
    const strokeTargets: SceneNode[] = [];
    const pointTargets: SceneNode[] = [];
    const pushTarget = (node: SceneNode) => {
        if (isPointLikeNode(node)) {
            pointTargets.push(node);
            return;
        }
        if (isVectorLikeNode(node)) {
            strokeTargets.push(node);
        }
    };

    if (root.type === 'INSTANCE' || 'children' in root) {
        traverse(root, (child) => {
            if (child.id === root.id || !child.visible) return;
            pushTarget(child);
        });
        return { strokeTargets, pointTargets };
    }

    if (root.visible) pushTarget(root);
    return { strokeTargets, pointTargets };
}

function buildColumnStrokeContexts(columns: ColRef[], chartType?: string): ColumnStrokeContext[] {
    return columns.map((ref) => {
        const cells = collectColumnCells(ref.node);
        const tabNode = 'children' in ref.node
            ? ((ref.node as SceneNode & ChildrenMixin).children.find((child) => child.name === 'tab') || null)
            : null;
        const lastVisibleCellIndex = cells.reduce<number | null>((max, cell) => {
            if (!cell.node.visible) return max;
            return max === null || cell.rowIndex > max ? cell.rowIndex : max;
        }, null);
        const lineBundles = chartType === 'line'
            ? Array.from(collectLineBundlesInColumn(ref.node, Math.max(0, ref.index - 1)).entries())
                .sort((a, b) => a[0] - b[0])
                .map(([rowIndex, bundle]) => {
                    const { strokeTargets, pointTargets } = collectLineStyleTargets(bundle.lineNode);
                    const isFlat = isLineBundleFlat(bundle);
                    return {
                        rowIndex,
                        bundle,
                        isFlat,
                        strokeTargets,
                        pointTargets,
                        backgroundTargets: (isFlat ? [bundle.fillBot] : [bundle.triNode, bundle.fillBot])
                            .filter((target): target is SceneNode => Boolean(target))
                    };
                })
            : [];

        return {
            ref,
            visible: ref.node.visible,
            tabNode,
            cells,
            lastVisibleCellIndex,
            lineBundles
        };
    });
}

function setNodeStrokeVisibility(node: SceneNode, visible: boolean) {
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

function setNodeFillVisibility(node: SceneNode, visible: boolean) {
    if (!('fills' in node)) return false;
    try {
        const target = node as SceneNode & GeometryMixin;
        if (!Array.isArray(target.fills)) return false;
        if (target.fills.every((paint) => paint.visible === visible)) return false;
        target.fills = target.fills.map((paint) => ({ ...paint, visible }));
        return true;
    } catch {
        return false;
    }
}

function getFirstSolidFillHex(node: SceneNode): string | null {
    if (!('fills' in node)) return null;
    const target = node as SceneNode & GeometryMixin;
    if (!Array.isArray(target.fills) || target.fills.length === 0) return null;
    const first = target.fills[0];
    if (!first || first.type !== 'SOLID') return null;
    return normalizeHexColor(rgbToHex(first.color.r, first.color.g, first.color.b));
}

function resolveCellTopStyle(payload: StrokeInjectionRuntimePayload): NormalizedSideStyle | null {
    const preferred = normalizeSideStyle(payload.cellTopStyle ?? payload.cellBottomStyle);
    if (preferred) return preferred;

    const rowZero = toSideStyleFromSnapshot(resolveRowZeroStroke(payload.rowStrokeStyles), 'top');
    if (rowZero) return rowZero;

    return toSideStyleFromSnapshot(payload.colStrokeStyle || null, 'top');
}

function resolveCellFillStyle(payload: StrokeInjectionRuntimePayload): { color?: string; visible?: boolean } | null {
    const preferred = normalizeCellFillStyle(payload.cellFillStyle);
    if (preferred) return preferred;
    return null;
}

function resolveLineBackgroundStyle(payload: StrokeInjectionRuntimePayload): NormalizedLineBackgroundStyle | null {
    const preferred = normalizeLineBackgroundStyle(payload.lineBackgroundStyle);
    if (preferred) return preferred;
    return null;
}

function resolveMarkStyle(payload: StrokeInjectionRuntimePayload): NormalizedMarkStyle | null {
    return normalizeMarkStyle(payload.markStyle);
}

function resolveMarkStyles(payload: StrokeInjectionRuntimePayload): NormalizedMarkStyle[] {
    const explicit = Array.isArray(payload.markStyles)
        ? payload.markStyles
            .map((item) => normalizeMarkStyle(item))
            .filter((item): item is NormalizedMarkStyle => Boolean(item))
        : [];
    if (explicit.length > 0) return explicit;
    const single = resolveMarkStyle(payload);
    return single ? [single] : [];
}

function resolveTabRightStyle(payload: StrokeInjectionRuntimePayload): NormalizedSideStyle | null {
    const preferred = normalizeSideStyle(payload.tabRightStyle);
    if (preferred) return preferred;
    return toSideStyleFromSnapshot(payload.colStrokeStyle || null, 'right');
}

function resolveGridContainerStyle(payload: StrokeInjectionRuntimePayload): NormalizedGridStyle | null {
    const preferred = normalizeGridStyle(payload.gridContainerStyle);
    if (preferred) return preferred;
    return toGridStyleFromSnapshot(payload.colStrokeStyle || null);
}

function hasIndividualStrokeWeights(node: SceneNode): node is IndividualStrokeNode {
    return (
        'strokeTopWeight' in node
        && 'strokeRightWeight' in node
        && 'strokeBottomWeight' in node
        && 'strokeLeftWeight' in node
    );
}

function hasStrokeWeight(node: SceneNode): node is StrokeWeightNode {
    return 'strokeWeight' in node;
}

function hasIndividualStrokeToggle(node: SceneNode): node is IndividualStrokeToggleNode {
    return 'individualStrokeWeights' in node;
}

function supportsIndividualStrokeSideControl(node: SceneNode): boolean {
    return hasIndividualStrokeWeights(node) || hasIndividualStrokeToggle(node);
}

function enableIndividualStrokeWeights(node: SceneNode): boolean {
    if (!hasIndividualStrokeToggle(node)) return false;
    try {
        if (node.individualStrokeWeights) return false;
        node.individualStrokeWeights = true;
        return true;
    } catch {
        return false;
    }
}

function disableIndividualStrokeWeights(node: SceneNode): boolean {
    if (!hasIndividualStrokeToggle(node)) return false;
    try {
        if (!node.individualStrokeWeights) return false;
        node.individualStrokeWeights = false;
        return true;
    } catch {
        return false;
    }
}

function setStrokeWeight(node: StrokeWeightNode, thickness: number) {
    if (typeof node.strokeWeight === 'number' && nearlyEqual(node.strokeWeight, thickness)) return false;
    node.strokeWeight = thickness;
    return true;
}

function setSideThickness(node: IndividualStrokeNode, side: SideName, thickness: number) {
    const current = side === 'top'
        ? node.strokeTopWeight
        : side === 'right'
            ? node.strokeRightWeight
            : side === 'bottom'
                ? node.strokeBottomWeight
                : node.strokeLeftWeight;
    if (nearlyEqual(current, thickness)) return false;
    if (side === 'top') node.strokeTopWeight = thickness;
    else if (side === 'right') node.strokeRightWeight = thickness;
    else if (side === 'bottom') node.strokeBottomWeight = thickness;
    else node.strokeLeftWeight = thickness;
    return true;
}

function setUniformPadding(node: SceneNode, padding: number): boolean {
    if (!('paddingTop' in node) || !('paddingRight' in node) || !('paddingBottom' in node) || !('paddingLeft' in node)) return false;
    try {
        const target = node as SceneNode & { paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number };
        const next = Math.max(0, padding);
        let changed = false;
        if (!nearlyEqual(target.paddingTop, next)) { target.paddingTop = next; changed = true; }
        if (!nearlyEqual(target.paddingRight, next)) { target.paddingRight = next; changed = true; }
        if (!nearlyEqual(target.paddingBottom, next)) { target.paddingBottom = next; changed = true; }
        if (!nearlyEqual(target.paddingLeft, next)) { target.paddingLeft = next; changed = true; }
        return changed;
    } catch {
        return false;
    }
}

function clearNodeStrokes(node: SceneNode) {
    if (!('strokes' in node)) return false;
    try {
        const target = node as SceneNode & GeometryMixin;
        if (!Array.isArray(target.strokes) || target.strokes.length === 0) return false;
        target.strokes = [];
        return true;
    } catch {
        return false;
    }
}

function applySideStrokeStyle(node: SceneNode, side: SideName, style: NormalizedSideStyle): boolean {
    let applied = false;

    if (style.color && tryApplyStroke(node, style.color)) {
        applied = true;
    }

    if (applyStrokeStyleMode(node, style.strokeStyle)) {
        applied = true;
    }

    const targetThickness = style.visible === false ? 0 : style.thickness;
    if (typeof targetThickness === 'number') {
        if (hasIndividualStrokeWeights(node)) {
            applied = setSideThickness(node, side, targetThickness) || applied;
        } else if (hasStrokeWeight(node)) {
            applied = setStrokeWeight(node, targetThickness) || applied;
        }
    }

    return applied;
}

function applyDistributedTabRightStrokeStyle(
    node: SceneNode,
    style: NormalizedSideStyle,
    options: { isFirst: boolean; isLast: boolean }
): boolean {
    let applied = false;

    if (style.color && tryApplyStroke(node, style.color)) {
        applied = true;
    }

    if (applyStrokeStyleMode(node, style.strokeStyle)) {
        applied = true;
    }

    const targetThickness = style.visible === false ? 0 : style.thickness;
    if (typeof targetThickness !== 'number') {
        return applied;
    }

    enableIndividualStrokeWeights(node);
    if (!hasIndividualStrokeWeights(node)) {
        return applied;
    }

    const halfThickness = targetThickness / 2;
    applied = setSideThickness(node, 'top', 0) || applied;
    applied = setSideThickness(node, 'bottom', 0) || applied;
    applied = setSideThickness(node, 'left', options.isFirst ? 0 : halfThickness) || applied;
    applied = setSideThickness(node, 'right', options.isLast ? 0 : halfThickness) || applied;
    return applied;
}

function applyGridStrokeStyle(node: SceneNode, style: NormalizedGridStyle): boolean {
    let applied = false;
    const allSidesSelected = style.sides.top && style.sides.right && style.sides.bottom && style.sides.left;

    if (style.color && tryApplyStroke(node, style.color)) {
        applied = true;
    }
    if (applyStrokeStyleMode(node, style.strokeStyle)) {
        applied = true;
    }

    if (!style.enableIndividualStroke) {
        return applied;
    }

    const targetThickness = style.visible === false ? 0 : style.thickness;
    if (typeof targetThickness !== 'number') {
        return applied;
    }

    enableIndividualStrokeWeights(node);

    if (!hasIndividualStrokeWeights(node)) {
        if (allSidesSelected && hasStrokeWeight(node)) {
            return setStrokeWeight(node, targetThickness) || applied;
        }
        return applied;
    }

    let sideApplied = false;
    sideApplied = setSideThickness(node, 'top', style.sides.top ? targetThickness : 0) || sideApplied;
    sideApplied = setSideThickness(node, 'right', style.sides.right ? targetThickness : 0) || sideApplied;
    sideApplied = setSideThickness(node, 'bottom', style.sides.bottom ? targetThickness : 0) || sideApplied;
    sideApplied = setSideThickness(node, 'left', style.sides.left ? targetThickness : 0) || sideApplied;
    return applied || sideApplied;
}

function applyCellTopStroke(columns: ColumnStrokeContext[], style: NormalizedSideStyle): ScopeResult {
    const result = createScopeResult();

    columns.forEach((col) => {
        col.cells.forEach(({ node, rowIndex }) => {
            result.candidates += 1;
            try {
                const isLastVisibleCell = col.lastVisibleCellIndex !== null && rowIndex === col.lastVisibleCellIndex;
                const effectiveStyle = isLastVisibleCell
                    ? { ...style, visible: false, thickness: 0 }
                    : style;

                if (applySideStrokeStyle(node, 'top', effectiveStyle)) result.applied += 1;
                else result.skipped += 1;
            } catch {
                result.errors += 1;
            }
        });
    });

    return result;
}

function applyCellFill(columns: ColumnStrokeContext[], style: { color?: string; visible?: boolean }, chartType?: string): ScopeResult {
    const result = createScopeResult();
    if (!style.color && typeof style.visible !== 'boolean') return result;

    const isLineChart = chartType === 'line';

    columns.forEach((col) => {
        if (isLineChart) {
            result.candidates += 1;
            if (col.tabNode) {
                try {
                    let applied = false;
                    if (style.color) {
                        applied = tryApplyFill(col.tabNode, style.color) || applied;
                    }
                    if (typeof style.visible === 'boolean') {
                        applied = setNodeFillVisibility(col.tabNode, style.visible) || applied;
                    }
                    if (applied) result.applied += 1;
                    else result.skipped += 1;
                } catch {
                    result.errors += 1;
                }
            } else {
                result.skipped += 1;
            }

            // In line charts, background is tab fill. Keep CEL strokes but disable CEL fill visibility.
            col.cells.forEach(({ node }) => {
                setNodeFillVisibility(node, false);
            });
            return;
        }
        col.cells.forEach(({ node }) => {
            result.candidates += 1;
            try {
                let applied = false;
                if (style.color) {
                    applied = tryApplyFill(node, style.color) || applied;
                }
                if (typeof style.visible === 'boolean') {
                    applied = setNodeFillVisibility(node, style.visible) || applied;
                }
                if (applied) result.applied += 1;
                else result.skipped += 1;
            } catch {
                result.errors += 1;
            }
        });
    });
    return result;
}

function isBarLikeMarkName(name: string): boolean {
    return (
        MARK_NAME_PATTERNS.BAR_ITEM_MULTI.test(name)
        || MARK_NAME_PATTERNS.STACKED_SEGMENT.test(name)
    );
}

function isStackedChartType(chartType?: string): boolean {
    return chartType === 'stackedBar' || chartType === 'stacked';
}

function isStackedSubInstanceNode(node: SceneNode): boolean {
    if (!MARK_NAME_PATTERNS.STACKED_SUB_INSTANCE.test(node.name)) return false;
    if (!('children' in node)) return false;
    const children = (node as SceneNode & ChildrenMixin).children;
    return children.some((child) => MARK_NAME_PATTERNS.STACKED_SEGMENT.test(child.name));
}

function resolveStackedSharedMarkStyle(styles: NormalizedMarkStyle[]): NormalizedMarkStyle | null {
    if (styles.length === 0) return null;
    const explicit = styles.find((style) => (
        style.enabled === false
        || Boolean(style.strokeColor)
        || typeof style.thickness === 'number'
        || Boolean(style.strokeStyle)
        || Boolean(style.sides)
    ));
    return explicit || styles[0] || null;
}

function parseMarkSeriesIndex(name: string): number | null {
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

function getMarkStyleBySeries(styles: NormalizedMarkStyle[], seriesIndex: number): NormalizedMarkStyle | null {
    if (styles.length === 0) return null;
    if (seriesIndex <= styles.length) return styles[seriesIndex - 1];
    return styles[0];
}

function getRowPaintStyleId(payload: StrokeInjectionRuntimePayload | undefined, seriesIndex: number): string | null {
    if (!payload || !Array.isArray(payload.rowPaintStyleIds)) return null;
    const value = payload.rowPaintStyleIds[seriesIndex - 1];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isLineLikeNode(node: SceneNode): boolean {
    if (MARK_NAME_PATTERNS.LINE.test(node.name)) return true;
    const lower = node.name.toLowerCase();
    if ((lower.includes('point') || lower.includes('dot')) && !lower.includes('container')) return true;
    return false;
}

function applyLineSeriesStrokeTargets(
    targets: SceneNode[],
    style: NormalizedMarkStyle,
    skipStrokeColorForSeries: boolean,
    rowStyleId: string | null,
    result: ScopeResult,
    options?: { markIndex: number; variableBinder?: MarkVariableBinder }
) {
    targets.forEach((target) => {
        result.candidates += 1;
        try {
            let applied = false;
            if (rowStyleId) {
                applied = tryApplyStrokeStyleLink(target, rowStyleId) || applied;
            }
            if (applyMarkStyleToNode(target, style, {
                skipFill: true,
                skipStrokeColor: skipStrokeColorForSeries || Boolean(rowStyleId)
            })) applied = true;
            options?.variableBinder?.bindStrokeThickness(target, options.markIndex, style.thickness);
            if (!skipStrokeColorForSeries && !rowStyleId) {
                options?.variableBinder?.bindStrokeColor(target, options.markIndex, style.strokeColor);
            }
            if (applied) result.applied += 1;
            else result.skipped += 1;
        } catch {
            result.errors += 1;
        }
    });
}

function applyLinePointTargets(
    targets: SceneNode[],
    style: NormalizedMarkStyle,
    skipStrokeColorForSeries: boolean,
    result: ScopeResult,
    options?: { markIndex: number; variableBinder?: MarkVariableBinder }
) {
    const resolvedPointStroke = style.linePointStrokeColor
        || (!skipStrokeColorForSeries ? style.strokeColor : undefined);
    const resolvedPointFill = style.linePointFillColor
        || style.fillColor
        || resolvedPointStroke;
    const pointStyle: NormalizedMarkStyle = {
        ...style,
        fillColor: resolvedPointFill,
        strokeColor: resolvedPointStroke,
        thickness: typeof style.linePointThickness === 'number' ? style.linePointThickness : style.thickness,
        linePointPadding: style.linePointPadding,
        sides: undefined
    };
    targets.forEach((target) => {
        result.candidates += 1;
        try {
            let applied = false;
            applied = disableIndividualStrokeWeights(target) || applied;
            if (hasIndividualStrokeWeights(target) && typeof pointStyle.thickness === 'number') {
                applied = setSideThickness(target, 'top', pointStyle.thickness) || applied;
                applied = setSideThickness(target, 'right', pointStyle.thickness) || applied;
                applied = setSideThickness(target, 'bottom', pointStyle.thickness) || applied;
                applied = setSideThickness(target, 'left', pointStyle.thickness) || applied;
            }
            const skipPointStrokeColor = !style.linePointStrokeColor && skipStrokeColorForSeries;
            if (applyMarkStyleToNode(target, pointStyle, { skipFill: false, skipStrokeColor: skipPointStrokeColor })) {
                applied = true;
            }
            if (typeof pointStyle.linePointPadding === 'number') {
                applied = setUniformPadding(target, pointStyle.linePointPadding) || applied;
            }
            options?.variableBinder?.bindLinePointThickness(target, options.markIndex, pointStyle.thickness);
            options?.variableBinder?.bindLinePointRadius(target, options.markIndex, pointStyle.linePointPadding);
            if (!skipPointStrokeColor) {
                options?.variableBinder?.bindLinePointStrokeColor(target, options.markIndex, pointStyle.strokeColor);
            }
            options?.variableBinder?.bindLinePointFillColor(target, options.markIndex, pointStyle.fillColor);
            if (applied) {
                result.applied += 1;
            } else {
                result.skipped += 1;
            }
        } catch {
            result.errors += 1;
        }
    });
}

function setLineSeriesStrokeVisibility(targets: SceneNode[], visible: boolean) {
    targets.forEach((target) => {
        setNodeStrokeVisibility(target, visible);
    });
}

function collectFlatLineFillBotStrokeTargets(node: SceneNode): SceneNode[] {
    const targets: SceneNode[] = [];
    const seen = new Set<string>();
    const pushIfEligible = (candidate: SceneNode) => {
        if (!candidate.visible) return;
        if (!('strokes' in candidate)) return;
        if (!supportsIndividualStrokeSideControl(candidate)) return;
        if (seen.has(candidate.id)) return;
        seen.add(candidate.id);
        targets.push(candidate);
    };

    pushIfEligible(node);
    if (node.type === 'INSTANCE' || 'children' in node) {
        traverse(node, (child) => {
            if (child.id === node.id) return;
            pushIfEligible(child);
        });
    }
    return targets;
}

function applyFlatLineFillBotStyle(
    node: SceneNode,
    style: NormalizedMarkStyle,
    rowStyleId: string | null,
    skipStrokeColor: boolean
): FlatLineFillBotStyleApplyResult {
    const targets = collectFlatLineFillBotStrokeTargets(node);
    if (targets.length === 0) {
        return { applied: false, targets: [] };
    }

    let applied = false;
    const topOnlyStyle: NormalizedMarkStyle = {
        ...style,
        sides: { top: true, left: false, right: false }
    };

    targets.forEach((target) => {
        if (rowStyleId) {
            applied = tryApplyStrokeStyleLink(target, rowStyleId) || applied;
        }
        if (applyMarkStyleToNode(target, topOnlyStyle, {
            skipFill: true,
            skipStrokeColor: skipStrokeColor || Boolean(rowStyleId),
            requireIndividualForSides: true
        })) {
            applied = true;
        }
    });

    return { applied, targets };
}

function applyLineBundleStylesForColumn(
    column: ColumnStrokeContext,
    styles: NormalizedMarkStyle[],
    rowColorModes: ColorMode[] | undefined,
    payload: StrokeInjectionRuntimePayload | undefined,
    result: ScopeResult,
    variableBinder?: MarkVariableBinder
) {
    column.lineBundles.forEach((entry) => {
        const seriesIndex = entry.rowIndex + 1;
        const style = getMarkStyleBySeries(styles, seriesIndex);
        if (!style) return;

        const skipStrokeColorForSeries =
            Array.isArray(rowColorModes)
            && rowColorModes[seriesIndex - 1] === 'paint_style';
        const rowStyleId = getRowPaintStyleId(payload, seriesIndex);

        applyLineSeriesStrokeTargets(entry.strokeTargets, style, skipStrokeColorForSeries, rowStyleId, result, {
            markIndex: seriesIndex,
            variableBinder
        });
        applyLinePointTargets(entry.pointTargets, style, skipStrokeColorForSeries, result, {
            markIndex: seriesIndex,
            variableBinder
        });
        setLineSeriesStrokeVisibility(entry.strokeTargets, !entry.isFlat);
        if (!entry.isFlat) return;

        result.candidates += 1;
        try {
            const flatFillBotStyleResult = applyFlatLineFillBotStyle(entry.bundle.fillBot, style, rowStyleId, skipStrokeColorForSeries);
            flatFillBotStyleResult.targets.forEach((target) => {
                variableBinder?.bindFlatTopStrokeThickness(target, seriesIndex, style.thickness);
                if (!skipStrokeColorForSeries && !rowStyleId) {
                    variableBinder?.bindStrokeColor(target, seriesIndex, style.strokeColor);
                }
            });
            if (flatFillBotStyleResult.applied) {
                result.applied += 1;
            } else {
                result.skipped += 1;
            }
        } catch {
            result.errors += 1;
        }
    });
}

function applyLineBackgroundStyles(
    columns: ColumnStrokeContext[],
    style: NormalizedLineBackgroundStyle | null,
    markStyles: NormalizedMarkStyle[],
    options?: { chartType?: string; variableBinder?: MarkVariableBinder }
): ScopeResult {
    const result = createScopeResult();
    if (options?.chartType !== 'line') return result;

    columns.forEach((col) => {
        col.lineBundles.forEach((entry) => {
            const seriesIndex = entry.rowIndex + 1;
            const markStyle = getMarkStyleBySeries(markStyles, seriesIndex);
            const color = markStyle?.lineBackgroundColor || markStyle?.fillColor || markStyle?.strokeColor || style?.color;
            const opacity = typeof markStyle?.lineBackgroundOpacity === 'number' ? markStyle.lineBackgroundOpacity : undefined;
            const visible = typeof markStyle?.lineBackgroundVisible === 'boolean' ? markStyle.lineBackgroundVisible : style?.visible;
            if (entry.backgroundTargets.length === 0) return;

            entry.backgroundTargets.forEach((target) => {
                result.candidates += 1;
                try {
                    let applied = false;
                    if (typeof visible === 'boolean') {
                        applied = setNodeFillVisibility(target, visible) || applied;
                    }
                    const effectiveColor = color || getFirstSolidFillHex(target);
                    if (effectiveColor && (color || typeof opacity === 'number')) {
                        applied = tryApplyFill(target, effectiveColor, opacity) || applied;
                        if (typeof visible === 'boolean') {
                            applied = setNodeFillVisibility(target, visible) || applied;
                        }
                        options?.variableBinder?.bindLineBackgroundColor(target, seriesIndex, effectiveColor, opacity);
                    }
                    if (applied) result.applied += 1;
                    else result.skipped += 1;
                } catch {
                    result.errors += 1;
                }
            });
        });
    });

    return result;
}

function applyMarkStyleToNode(
    node: SceneNode,
    style: NormalizedMarkStyle,
    options?: { skipFill?: boolean; skipStrokeColor?: boolean; requireIndividualForSides?: boolean }
): boolean {
    let applied = false;
    if (style.enabled === false) {
        applied = clearNodeStrokes(node) || applied;
        if (hasIndividualStrokeWeights(node)) {
            applied = setSideThickness(node, 'top', 0) || applied;
            applied = setSideThickness(node, 'right', 0) || applied;
            applied = setSideThickness(node, 'bottom', 0) || applied;
            applied = setSideThickness(node, 'left', 0) || applied;
        } else if (hasStrokeWeight(node)) {
            applied = setStrokeWeight(node, 0) || applied;
        }
        if (applyStrokeStyleMode(node, 'solid')) applied = true;
        return applied;
    }

    if (!options?.skipFill && style.fillColor && tryApplyFill(node, style.fillColor)) applied = true;
    if (!options?.skipStrokeColor && style.strokeColor && tryApplyStroke(node, style.strokeColor)) applied = true;
    if (applyStrokeStyleMode(node, style.strokeStyle)) applied = true;
    if (style.sides && hasIndividualStrokeToggle(node)) {
        enableIndividualStrokeWeights(node);
    }
    const canApplySideWeights = style.sides ? hasIndividualStrokeWeights(node) : false;
    if (style.sides && options?.requireIndividualForSides && !canApplySideWeights) {
        return applied;
    }
    if (style.sides && canApplySideWeights) {
        const targetThickness = typeof style.thickness === 'number'
            ? style.thickness
            : (hasStrokeWeight(node) && typeof node.strokeWeight === 'number' ? node.strokeWeight : 0);
        applied = setSideThickness(node, 'top', style.sides.top ? targetThickness : 0) || applied;
        applied = setSideThickness(node, 'right', style.sides.right ? targetThickness : 0) || applied;
        applied = setSideThickness(node, 'left', style.sides.left ? targetThickness : 0) || applied;
        applied = setSideThickness(node, 'bottom', 0) || applied;
    } else if (typeof style.thickness === 'number' && hasStrokeWeight(node)) {
        applied = setStrokeWeight(node, style.thickness) || applied;
    }
    return applied;
}

function applyMarkStyles(
    columns: ColumnStrokeContext[],
    styles: NormalizedMarkStyle[],
    options?: {
        chartType?: string;
        colColorEnabled?: boolean[];
        rowColorModes?: ColorMode[];
        rowPaintStyleIds?: Array<string | null>;
        variableBinder?: MarkVariableBinder;
    }
): ScopeResult {
    const result = createScopeResult();
    if (styles.length === 0) return result;
    if (isStackedChartType(options?.chartType)) {
        const sharedStyle = resolveStackedSharedMarkStyle(styles);
        if (!sharedStyle) return result;
        columns.forEach((col) => {
            traverse(col.ref.node, (node) => {
                if (!node.visible || !isStackedSubInstanceNode(node)) return;
                result.candidates += 1;
                try {
                    if (applyMarkStyleToNode(node, sharedStyle, { skipFill: true })) {
                        options?.variableBinder?.bindStrokeThickness(node, 1, sharedStyle.thickness);
                        options?.variableBinder?.bindStrokeColor(node, 1, sharedStyle.strokeColor);
                        result.applied += 1;
                    } else {
                        result.skipped += 1;
                    }
                } catch {
                    result.errors += 1;
                }
            });
        });
        return result;
    }
    columns.forEach((col) => {
        const colIndex = Math.max(0, col.ref.index - 1);
        const skipColorForColumn = options?.chartType === 'bar' && Boolean(options?.colColorEnabled?.[colIndex]);
        if (options?.chartType === 'line') {
            applyLineBundleStylesForColumn(col, styles, options?.rowColorModes, options, result, options?.variableBinder);
            return;
        }
        traverse(col.ref.node, (node) => {
            if (!node.visible) return;

            const seriesIndex = parseMarkSeriesIndex(node.name);
            if (isBarLikeMarkName(node.name) && seriesIndex) {
                const style = getMarkStyleBySeries(styles, seriesIndex);
                if (!style) return;
                result.candidates += 1;
                try {
                    if (applyMarkStyleToNode(node, style, {
                        skipFill: skipColorForColumn,
                        skipStrokeColor: skipColorForColumn
                    })) {
                        options?.variableBinder?.bindStrokeThickness(node, seriesIndex, style.thickness);
                        if (!skipColorForColumn) {
                            options?.variableBinder?.bindStrokeColor(node, seriesIndex, style.strokeColor);
                            options?.variableBinder?.bindFillColor(node, seriesIndex, style.fillColor);
                        }
                        result.applied += 1;
                    } else {
                        result.skipped += 1;
                    }
                } catch {
                    result.errors += 1;
                }
                return;
            }

            if (!isLineLikeNode(node) || !seriesIndex) return;
            const style = getMarkStyleBySeries(styles, seriesIndex);
            if (!style) return;
            const skipStrokeColorForSeries =
                options?.chartType === 'line'
                && Array.isArray(options.rowColorModes)
                && options.rowColorModes[seriesIndex - 1] === 'paint_style';
            if (node.type === 'INSTANCE' || 'children' in node) {
                traverse(node, (child) => {
                    if (child.id === node.id || !child.visible) return;
                    const lower = child.name.toLowerCase();
                    const isPointLike = child.type === 'ELLIPSE'
                        || ((lower.includes('point') || lower.includes('dot')) && !lower.includes('container'));
                    const isVectorLike = child.type === 'VECTOR' || child.type === 'LINE' || child.type === 'POLYGON' || child.type === 'RECTANGLE';
                    if (!isPointLike && !isVectorLike) return;
                    result.candidates += 1;
                    try {
                        if (applyMarkStyleToNode(child, style, {
                            skipFill: true,
                            skipStrokeColor: skipStrokeColorForSeries
                        })) result.applied += 1;
                        else result.skipped += 1;
                    } catch {
                        result.errors += 1;
                    }
                });
            }
        });
    });
    return result;
}

function resolveLegendMarkCount(markNum: number | number[] | undefined): number | null {
    if (Array.isArray(markNum)) return null;
    const parsed = Number(markNum);
    if (!Number.isFinite(parsed) || parsed < 1) return null;
    return Math.floor(parsed);
}

function resolveLegendCountForStacked(rowColors: string[] | undefined): number | null {
    if (!Array.isArray(rowColors) || rowColors.length <= 1) return null;
    const normalized = rowColors
        .map((value) => normalizeHexColor(value))
        .filter((value): value is string => Boolean(value));
    if (normalized.length <= 1) return null;
    return Math.max(0, normalized.length - 1);
}

function findLegendContainers(graph: SceneNode): SceneNode[] {
    const results: SceneNode[] = [];
    traverse(graph, (node) => {
        if (node.id === graph.id) return;
        if (!MARK_NAME_PATTERNS.LEGEND_CONTAINER.test(node.name)) return;
        if (!('children' in node)) return;
        results.push(node);
    });
    return results;
}

function collectLegendElems(container: SceneNode): Array<{ node: SceneNode; index: number }> {
    if (!('children' in container)) return [];
    const results: Array<{ node: SceneNode; index: number }> = [];
    (container as SceneNode & ChildrenMixin).children.forEach((child) => {
        const match = MARK_NAME_PATTERNS.LEGEND_ELEM.exec(child.name);
        if (!match) return;
        const index = Number(match[1]);
        if (!Number.isFinite(index) || index < 1) return;
        results.push({ node: child, index: Math.floor(index) });
    });
    return results.sort((a, b) => a.index - b.index);
}

function findLegendColorNode(legendElem: SceneNode): SceneNode | null {
    if (!('children' in legendElem)) return null;
    const isLegendColorName = (name: string) => (
        MARK_NAME_PATTERNS.LEGEND_COLOR.test(name)
        || /^legned_color$/i.test(name)
    );
    const direct = (legendElem as SceneNode & ChildrenMixin).children.find((child) => isLegendColorName(child.name));
    if (direct) return direct;

    let nested: SceneNode | null = null;
    traverse(legendElem, (child) => {
        if (nested || child.id === legendElem.id) return;
        if (isLegendColorName(child.name)) nested = child;
    });
    return nested;
}

function applyLegendMarkSync(
    graph: SceneNode,
    styles: NormalizedMarkStyle[],
    payload: StrokeInjectionRuntimePayload,
    markNum: number | number[] | undefined,
    chartType: string | undefined,
    rowColors: string[] | undefined,
    precomputedCols?: ColRef[]
): { result: ScopeResult; enabled: boolean } {
    const result = createScopeResult();

    const isStacked = chartType === 'stackedBar' || chartType === 'stacked';
    const isBar = chartType === 'bar';
    const markCount = isStacked
        ? resolveLegendCountForStacked(rowColors)
        : (isBar ? null : resolveLegendMarkCount(markNum));
    if (!isBar && markCount === null) return { result, enabled: false };

    const normalizedRowColors = Array.isArray(rowColors)
        ? rowColors.map((value) => normalizeHexColor(value))
        : [];
    const hasAnyRowColor = normalizedRowColors.some((value) => Boolean(value));
    const hasRowColorSeries = normalizedRowColors.some((value, index) => index > 0 && Boolean(value));
    if (!isStacked && !isBar && styles.length === 0 && !hasAnyRowColor) {
        return { result, enabled: false };
    }
    if (isStacked && !hasRowColorSeries) {
        return { result, enabled: false };
    }
    const columns = precomputedCols ?? collectColumns(graph);
    const visibleColIndices = columns
        .filter((col) => col.node.visible)
        .map((col) => Math.max(0, col.index - 1));
    const colColorEnabled = Array.isArray(payload.colColorEnabled)
        ? payload.colColorEnabled.map((v) => Boolean(v))
        : [];
    const enabledColIndices = visibleColIndices.filter((index) => Boolean(colColorEnabled[index]));
    const allVisibleColsEnabled = isBar
        && visibleColIndices.length > 0
        && visibleColIndices.every((index) => Boolean(colColorEnabled[index]));
    const normalizedColColors = Array.isArray(payload.colColors)
        ? payload.colColors.map((value) => normalizeHexColor(value))
        : [];
    const rowCount = typeof markNum === 'number' && Number.isFinite(markNum)
        ? Math.max(0, Math.floor(markNum))
        : (Array.isArray(payload.rowHeaderLabels) ? payload.rowHeaderLabels.length : 0);
    const barLegendColors: string[] = [];
    if (isBar) {
        if (!allVisibleColsEnabled) {
            for (let i = 0; i < rowCount; i++) {
                barLegendColors.push(normalizedRowColors[i] || '#3B82F6');
            }
        }
        enabledColIndices.forEach((colIndex) => {
            barLegendColors.push(normalizedColColors[colIndex] || normalizedRowColors[0] || '#3B82F6');
        });
    }

    const containers = findLegendContainers(graph);
    const debugEntries: Array<{
        containerId: string;
        legendNodeId: string;
        legendIndex: number;
        colorNodeId: string | null;
        colorNodeName: string | null;
        resolvedColor: string | null;
        source: 'stacked-rowColors' | 'bar-computed' | 'line-markStroke' | 'line-rowColor' | 'line-markFill' | 'none';
        applied: boolean;
    }> = [];
    containers.forEach((container) => {
        const elems = collectLegendElems(container);
        elems.forEach(({ node, index }) => {
            result.candidates += 1;
            try {
                const visibleCount = isBar ? barLegendColors.length : (markCount ?? 0);
                node.visible = index <= visibleCount;
                if (index > visibleCount) {
                    result.applied += 1;
                    return;
                }

                const colorNode = findLegendColorNode(node);
                let colorHex: string | null = null;
                let colorSource: 'stacked-rowColors' | 'bar-computed' | 'line-markStroke' | 'line-rowColor' | 'line-markFill' | 'none' = 'none';
                if (isStacked) {
                    colorHex = normalizedRowColors[index] || null;
                    colorSource = colorHex ? 'stacked-rowColors' : 'none';
                } else if (isBar) {
                    colorHex = barLegendColors[index - 1] || null;
                    colorSource = colorHex ? 'bar-computed' : 'none';
                } else {
                    const style = getMarkStyleBySeries(styles, index);
                    colorHex = style?.strokeColor || null;
                    if (colorHex) {
                        colorSource = 'line-markStroke';
                    } else {
                        colorHex = normalizedRowColors[index - 1] || null;
                        if (colorHex) {
                            colorSource = 'line-rowColor';
                        } else {
                            colorHex = style?.fillColor || null;
                            colorSource = colorHex ? 'line-markFill' : 'none';
                        }
                    }
                }
                if (!colorHex || !colorNode) {
                    debugEntries.push({
                        containerId: container.id,
                        legendNodeId: node.id,
                        legendIndex: index,
                        colorNodeId: colorNode ? colorNode.id : null,
                        colorNodeName: colorNode ? colorNode.name : null,
                        resolvedColor: colorHex,
                        source: colorSource,
                        applied: false
                    });
                    result.skipped += 1;
                    return;
                }
                const applied = tryApplyFill(colorNode, colorHex);
                debugEntries.push({
                    containerId: container.id,
                    legendNodeId: node.id,
                    legendIndex: index,
                    colorNodeId: colorNode.id,
                    colorNodeName: colorNode.name,
                    resolvedColor: colorHex,
                    source: colorSource,
                    applied
                });
                if (applied) {
                    result.applied += 1;
                } else {
                    result.skipped += 1;
                }
            } catch {
                result.errors += 1;
            }
        });
    });

    if (!isStacked && !isBar) {
        debugLog('[chart-plugin][legend-sync][line]', {
            chartType,
            markCount,
            extractedStrokeColors: styles.map((style) => style.strokeColor || null),
            extractedFillColors: styles.map((style) => style.fillColor || null),
            inputRowColors: normalizedRowColors,
            resolvedLegendColors: debugEntries
        });
    }

    return { result, enabled: true };
}

function applyTabRightStroke(columns: ColumnStrokeContext[], style: NormalizedSideStyle): ScopeResult {
    const result = createScopeResult();
    const visibleColumns = columns.filter((col) => col.visible);
    const targetColumns = visibleColumns;
    result.candidates = targetColumns.length;

    targetColumns.forEach((col, index) => {
        const tab = col.tabNode;
        if (!tab) {
            result.skipped += 1;
            return;
        }

        try {
            if (applyDistributedTabRightStrokeStyle(tab, style, {
                isFirst: index === 0,
                isLast: index === targetColumns.length - 1
            })) result.applied += 1;
            else result.skipped += 1;
        } catch {
            result.errors += 1;
        }
    });

    return result;
}

function findColContainer(graph: SceneNode): SceneNode | null {
    let withChartContainer: SceneNode | null = null;
    let fallback: SceneNode | null = null;
    traverse(graph, (node) => {
        if (withChartContainer) return;
        if (node.id === graph.id) return;
        if (node.name !== 'col' || !('children' in node)) return;
        if (!fallback) fallback = node;
        const hasChartContainer = (node as SceneNode & ChildrenMixin).children.some((child) => child.name === 'chart_container');
        if (hasChartContainer) {
            withChartContainer = node;
        }
    });
    return withChartContainer || fallback;
}

function findDirectChildByName(parent: SceneNode, name: string): SceneNode | null {
    if (!('children' in parent)) return null;
    const child = (parent as SceneNode & ChildrenMixin).children.find((item) => item.name === name);
    return child || null;
}

function applyGridContainerStroke(graph: SceneNode, style: NormalizedGridStyle): ScopeResult {
    const result = createScopeResult();
    result.candidates = 1;

    const colContainer = findColContainer(graph);
    if (!colContainer) {
        result.skipped += 1;
        return result;
    }

    const chartContainer = findDirectChildByName(colContainer, 'chart_container');
    if (!chartContainer) {
        result.skipped += 1;
        return result;
    }

    const styleLayer = findDirectChildByName(chartContainer, 'style');
    if (!styleLayer) {
        result.skipped += 1;
        return result;
    }

    try {
        if (applyGridStrokeStyle(styleLayer, style)) result.applied += 1;
        else result.skipped += 1;
    } catch {
        result.errors += 1;
    }

    return result;
}

function shouldSkipMarkStyleApply(payload: StrokeInjectionRuntimePayload, markStyles: NormalizedMarkStyle[]): boolean {
    if (markStyles.length === 0) return true;
    const isStacked = isStackedChartType(payload.chartType);
    if (!isStacked) return false;
    const hasEffectiveStyle = markStyles.some((style) => (
        Boolean(style.fillColor)
        || Boolean(style.strokeColor)
        || Boolean(style.linePointStrokeColor)
        || Boolean(style.linePointFillColor)
        || typeof style.linePointThickness === 'number'
        || typeof style.thickness === 'number'
        || Boolean(style.strokeStyle)
        || Boolean(style.sides)
        || style.enabled === false
    ));
    return !hasEffectiveStyle;
}

export function applyStrokeInjection(
    graph: SceneNode,
    payload: StrokeInjectionRuntimePayload,
    precomputedCols?: ColRef[],
    options?: StrokeInjectionApplyOptions
): StrokeInjectionResult {
    const applyColumnScopes = options?.applyColumnScopes !== false;
    const applyLegendScope = options?.applyLegendScope !== false;
    const applyGridContainerScope = options?.applyGridContainerScope !== false;
    const columns = precomputedCols ?? collectColumns(graph);
    const contexts = buildColumnStrokeContexts(columns, payload.chartType);
    const cellFillStyle = applyColumnScopes ? resolveCellFillStyle(payload) : null;
    const lineBackgroundStyle = applyColumnScopes ? resolveLineBackgroundStyle(payload) : null;
    const markStyles = resolveMarkStyles(payload);
    const variableBinder = options?.variableBinder !== undefined
        ? options.variableBinder
        : (markStyles.length > 0
        ? new MarkVariableBinder({
            graphNodeId: graph.id,
            updateMode: payload.variableUpdateMode === 'create' ? 'create' : 'overwrite',
            slotVariableIdMap: payload.markVariableSlotMap
        })
        : null);
    const legendSync = applyLegendScope
        ? applyLegendMarkSync(graph, markStyles, payload, payload.markNum, payload.chartType, payload.rowColors, columns)
        : { result: createScopeResult(), enabled: false };
    const cellTopStyle = applyColumnScopes ? resolveCellTopStyle(payload) : null;
    const tabRightStyle = applyColumnScopes ? resolveTabRightStyle(payload) : null;
    const gridContainerStyle = applyGridContainerScope ? resolveGridContainerStyle(payload) : null;
    const skipMarkStyleApply = !applyColumnScopes || shouldSkipMarkStyleApply(payload, markStyles);

    return {
        cellFill: cellFillStyle ? applyCellFill(contexts, cellFillStyle, payload.chartType) : createScopeResult(),
        lineBackground: applyLineBackgroundStyles(contexts, lineBackgroundStyle, markStyles, {
            chartType: payload.chartType,
            variableBinder: variableBinder || undefined
        }),
        mark: skipMarkStyleApply
            ? createScopeResult()
            : applyMarkStyles(contexts, markStyles, {
                chartType: payload.chartType,
                colColorEnabled: payload.colColorEnabled,
                rowColorModes: payload.rowColorModes,
                rowPaintStyleIds: payload.rowPaintStyleIds,
                variableBinder: variableBinder || undefined
            }),
        legend: legendSync.result,
        cellTop: cellTopStyle ? applyCellTopStroke(contexts, cellTopStyle) : createScopeResult(),
        tabRight: tabRightStyle ? applyTabRightStroke(contexts, tabRightStyle) : createScopeResult(),
        gridContainer: gridContainerStyle ? applyGridContainerStroke(graph, gridContainerStyle) : createScopeResult(),
        resolved: {
            cellFill: Boolean(cellFillStyle),
            lineBackground: Boolean(lineBackgroundStyle),
            mark: !skipMarkStyleApply,
            legend: legendSync.enabled,
            cellTop: Boolean(cellTopStyle),
            tabRight: Boolean(tabRightStyle),
            gridContainer: Boolean(gridContainerStyle)
        },
        markVariableSlotMap: variableBinder ? variableBinder.getSlotVariableIdMap() : payload.markVariableSlotMap
    };
}
