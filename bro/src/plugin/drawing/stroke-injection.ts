import { MARK_NAME_PATTERNS } from '../constants';
import type {
    GridStrokeInjectionStyle,
    RowStrokeStyle,
    SideStrokeInjectionStyle,
    StrokeInjectionPayload,
    StrokeStyleSnapshot
} from '../../shared/style-types';
import { normalizeHexColor, traverse, tryApplyStroke } from '../utils';
import { collectColumns } from './shared';

type SideName = 'top' | 'right' | 'bottom' | 'left';

type StrokeInjectionRuntimePayload = StrokeInjectionPayload & {
    rowStrokeStyles?: RowStrokeStyle[];
    colStrokeStyle?: StrokeStyleSnapshot | null;
};

type NormalizedSideStyle = {
    color?: string;
    thickness?: number;
    visible?: boolean;
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

export type StrokeInjectionResult = {
    cellBottom: ScopeResult;
    tabRight: ScopeResult;
    gridContainer: ScopeResult;
    resolved: {
        cellBottom: boolean;
        tabRight: boolean;
        gridContainer: boolean;
    };
};

type IndividualStrokeNode = SceneNode & IndividualStrokesMixin;
type StrokeWeightNode = SceneNode & GeometryMixin;
type IndividualStrokeToggleNode = SceneNode & { individualStrokeWeights: boolean };

function createScopeResult(): ScopeResult {
    return {
        candidates: 0,
        applied: 0,
        skipped: 0,
        errors: 0
    };
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

    if (!color && thickness === undefined && visible === undefined) return null;
    return { color: color || undefined, thickness, visible };
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

    if (!color && thickness === undefined && visible === undefined) return null;
    return { color: color || undefined, thickness, visible };
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

    if (!color && thickness === undefined && visible === undefined) return null;
    return {
        color: color || undefined,
        thickness,
        visible,
        enableIndividualStroke: true,
        sides: {
            top: true,
            right: true,
            bottom: true,
            left: true
        }
    };
}

function resolveCellBottomStyle(payload: StrokeInjectionRuntimePayload): NormalizedSideStyle | null {
    const preferred = normalizeSideStyle(payload.cellBottomStyle);
    if (preferred) return preferred;

    const rowZero = toSideStyleFromSnapshot(resolveRowZeroStroke(payload.rowStrokeStyles), 'bottom');
    if (rowZero) return rowZero;

    return toSideStyleFromSnapshot(payload.colStrokeStyle || null, 'bottom');
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

function enableIndividualStrokeWeights(node: SceneNode): boolean {
    if (!hasIndividualStrokeToggle(node)) return false;
    try {
        node.individualStrokeWeights = true;
        return true;
    } catch {
        return false;
    }
}

function setSideThickness(node: IndividualStrokeNode, side: SideName, thickness: number) {
    if (side === 'top') node.strokeTopWeight = thickness;
    else if (side === 'right') node.strokeRightWeight = thickness;
    else if (side === 'bottom') node.strokeBottomWeight = thickness;
    else node.strokeLeftWeight = thickness;
}

function applySideStrokeStyle(node: SceneNode, side: SideName, style: NormalizedSideStyle): boolean {
    let applied = false;

    if (style.color && tryApplyStroke(node, style.color)) {
        applied = true;
    }

    const targetThickness = style.visible === false ? 0 : style.thickness;
    if (typeof targetThickness === 'number') {
        if (hasIndividualStrokeWeights(node)) {
            setSideThickness(node, side, targetThickness);
            applied = true;
        } else if (hasStrokeWeight(node)) {
            node.strokeWeight = targetThickness;
            applied = true;
        }
    }

    return applied;
}

function applyGridStrokeStyle(node: SceneNode, style: NormalizedGridStyle): boolean {
    let applied = false;
    const allSidesSelected = style.sides.top && style.sides.right && style.sides.bottom && style.sides.left;

    // Figma stroke color is shared across sides; apply it only when all sides are targeted.
    if (allSidesSelected && style.color && tryApplyStroke(node, style.color)) {
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
            node.strokeWeight = targetThickness;
            return true;
        }
        return applied;
    }

    let sideApplied = false;
    node.strokeTopWeight = style.sides.top ? targetThickness : 0;
    node.strokeRightWeight = style.sides.right ? targetThickness : 0;
    node.strokeBottomWeight = style.sides.bottom ? targetThickness : 0;
    node.strokeLeftWeight = style.sides.left ? targetThickness : 0;
    sideApplied = true;
    return applied || sideApplied;
}

function applyCellBottomStroke(graph: SceneNode, style: NormalizedSideStyle): ScopeResult {
    const result = createScopeResult();
    const columns = collectColumns(graph);

    columns.forEach((col) => {
        traverse(col.node, (node) => {
            if (!MARK_NAME_PATTERNS.CEL.test(node.name)) return;
            result.candidates += 1;
            try {
                if (applySideStrokeStyle(node, 'bottom', style)) result.applied += 1;
                else result.skipped += 1;
            } catch {
                result.errors += 1;
            }
        });
    });

    return result;
}

function applyTabRightStroke(graph: SceneNode, style: NormalizedSideStyle): ScopeResult {
    const result = createScopeResult();
    const columns = collectColumns(graph);
    result.candidates = columns.length;

    columns.forEach((col) => {
        if (!('children' in col.node)) {
            result.skipped += 1;
            return;
        }

        const tab = (col.node as SceneNode & ChildrenMixin).children.find((child) => child.name === 'tab');
        if (!tab) {
            result.skipped += 1;
            return;
        }

        try {
            if (applySideStrokeStyle(tab, 'right', style)) result.applied += 1;
            else result.skipped += 1;
        } catch {
            result.errors += 1;
        }
    });

    return result;
}

function findColContainer(graph: SceneNode): SceneNode | null {
    if (!('children' in graph)) return null;
    const rootChildren = (graph as SceneNode & ChildrenMixin).children;
    const direct = rootChildren.find((child) => child.name === 'col');
    return direct || null;
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

export function applyStrokeInjection(graph: SceneNode, payload: StrokeInjectionRuntimePayload): StrokeInjectionResult {
    const cellBottomStyle = resolveCellBottomStyle(payload);
    const tabRightStyle = resolveTabRightStyle(payload);
    const gridContainerStyle = resolveGridContainerStyle(payload);

    return {
        cellBottom: cellBottomStyle ? applyCellBottomStroke(graph, cellBottomStyle) : createScopeResult(),
        tabRight: tabRightStyle ? applyTabRightStroke(graph, tabRightStyle) : createScopeResult(),
        gridContainer: gridContainerStyle ? applyGridContainerStroke(graph, gridContainerStyle) : createScopeResult(),
        resolved: {
            cellBottom: Boolean(cellBottomStyle),
            tabRight: Boolean(tabRightStyle),
            gridContainer: Boolean(gridContainerStyle)
        }
    };
}
