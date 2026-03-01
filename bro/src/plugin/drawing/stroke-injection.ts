import { MARK_NAME_PATTERNS } from '../constants';
import type {
    CellFillInjectionStyle,
    ColorMode,
    GridStrokeInjectionStyle,
    MarkInjectionStyle,
    RowStrokeStyle,
    SideStrokeInjectionStyle,
    StrokeInjectionPayload,
    StrokeStyleSnapshot
} from '../../shared/style-types';
import { normalizeHexColor, traverse, tryApplyDashPattern, tryApplyFill, tryApplyStroke } from '../utils';
import { collectColumns, type ColRef } from './shared';

type SideName = 'top' | 'right' | 'bottom' | 'left';

type StrokeInjectionRuntimePayload = StrokeInjectionPayload & {
    chartType?: string;
    rowColors?: string[];
    rowColorModes?: ColorMode[];
    colColors?: string[];
    colColorEnabled?: boolean[];
    rowHeaderLabels?: string[];
    xAxisLabels?: string[];
    markNum?: number | number[];
    rowStrokeStyles?: RowStrokeStyle[];
    colStrokeStyle?: StrokeStyleSnapshot | null;
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
    thickness?: number;
    strokeStyle?: 'solid' | 'dash';
};

export type StrokeInjectionResult = {
    cellFill: ScopeResult;
    mark: ScopeResult;
    legend: ScopeResult;
    cellTop: ScopeResult;
    tabRight: ScopeResult;
    gridContainer: ScopeResult;
    resolved: {
        cellTop: boolean;
        cellFill: boolean;
        mark: boolean;
        legend: boolean;
        tabRight: boolean;
        gridContainer: boolean;
    };
};

function normalizeCellFillStyle(input: unknown): { color?: string } | null {
    if (!input || typeof input !== 'object') return null;
    const source = input as CellFillInjectionStyle;
    const color = normalizeHexColor(source.color);
    if (!color) return null;
    return { color };
}

function normalizeMarkStyle(input: unknown): NormalizedMarkStyle | null {
    if (!input || typeof input !== 'object') return null;
    const source = input as MarkInjectionStyle;
    const fillColor = normalizeHexColor(source.fillColor);
    const strokeColor = normalizeHexColor(source.strokeColor);
    const thickness = normalizeThickness(source.thickness);
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);
    if (!fillColor && !strokeColor && thickness === undefined && !strokeStyle) return null;
    return {
        fillColor: fillColor || undefined,
        strokeColor: strokeColor || undefined,
        thickness,
        strokeStyle
    };
}

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

function resolveCellTopStyle(payload: StrokeInjectionRuntimePayload): NormalizedSideStyle | null {
    const preferred = normalizeSideStyle(payload.cellTopStyle ?? payload.cellBottomStyle);
    if (preferred) return preferred;

    const rowZero = toSideStyleFromSnapshot(resolveRowZeroStroke(payload.rowStrokeStyles), 'top');
    if (rowZero) return rowZero;

    return toSideStyleFromSnapshot(payload.colStrokeStyle || null, 'top');
}

function resolveCellFillStyle(payload: StrokeInjectionRuntimePayload): { color?: string } | null {
    const preferred = normalizeCellFillStyle(payload.cellFillStyle);
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

    if (applyStrokeStyleMode(node, style.strokeStyle)) {
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

function applyCellTopStroke(columns: ColRef[], style: NormalizedSideStyle): ScopeResult {
    const result = createScopeResult();

    columns.forEach((col) => {
        const lastVisibleCellIndex = (() => {
            let maxIndex: number | null = null;
            traverse(col.node, (node) => {
                if (!node.visible) return;
                const match = MARK_NAME_PATTERNS.CEL.exec(node.name);
                if (!match) return;
                const idx = Number.parseInt(match[1], 10);
                if (!Number.isFinite(idx)) return;
                if (maxIndex === null || idx > maxIndex) {
                    maxIndex = idx;
                }
            });
            return maxIndex;
        })();

        traverse(col.node, (node) => {
            const match = MARK_NAME_PATTERNS.CEL.exec(node.name);
            if (!match) return;
            result.candidates += 1;
            try {
                const idx = Number.parseInt(match[1], 10);
                const isLastVisibleCell = Number.isFinite(idx) && lastVisibleCellIndex !== null && idx === lastVisibleCellIndex;
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

function applyCellFill(columns: ColRef[], style: { color?: string }): ScopeResult {
    const result = createScopeResult();
    if (!style.color) return result;
    columns.forEach((col) => {
        traverse(col.node, (node) => {
            if (!MARK_NAME_PATTERNS.CEL.test(node.name)) return;
            result.candidates += 1;
            try {
                if (tryApplyFill(node, style.color!)) result.applied += 1;
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

function isLineLikeNode(node: SceneNode): boolean {
    if (MARK_NAME_PATTERNS.LINE.test(node.name)) return true;
    const lower = node.name.toLowerCase();
    if (lower.includes('point') || lower.includes('dot')) return true;
    return false;
}

function applyMarkStyleToNode(
    node: SceneNode,
    style: NormalizedMarkStyle,
    options?: { skipFill?: boolean; skipStrokeColor?: boolean }
): boolean {
    let applied = false;
    if (!options?.skipFill && style.fillColor && tryApplyFill(node, style.fillColor)) applied = true;
    if (!options?.skipStrokeColor && style.strokeColor && tryApplyStroke(node, style.strokeColor)) applied = true;
    if (applyStrokeStyleMode(node, style.strokeStyle)) applied = true;
    if (typeof style.thickness === 'number' && hasStrokeWeight(node)) {
        node.strokeWeight = style.thickness;
        applied = true;
    }
    return applied;
}

function applyMarkStyles(
    columns: ColRef[],
    styles: NormalizedMarkStyle[],
    options?: { chartType?: string; colColorEnabled?: boolean[]; rowColorModes?: ColorMode[] }
): ScopeResult {
    const result = createScopeResult();
    if (styles.length === 0) return result;
    columns.forEach((col) => {
        const colIndex = Math.max(0, col.index - 1);
        const skipColorForColumn = options?.chartType === 'bar' && Boolean(options?.colColorEnabled?.[colIndex]);
        traverse(col.node, (node) => {
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
                    })) result.applied += 1;
                    else result.skipped += 1;
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
                    const isPointLike = child.type === 'ELLIPSE' || lower.includes('point') || lower.includes('dot');
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
        console.log('[chart-plugin][legend-sync][line]', {
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

function applyTabRightStroke(columns: ColRef[], style: NormalizedSideStyle): ScopeResult {
    const result = createScopeResult();
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
    const isStacked = payload.chartType === 'stackedBar' || payload.chartType === 'stacked';
    if (!isStacked) return false;
    const hasEffectiveStyle = markStyles.some((style) => (
        Boolean(style.fillColor)
        || Boolean(style.strokeColor)
        || typeof style.thickness === 'number'
        || Boolean(style.strokeStyle)
    ));
    return !hasEffectiveStyle;
}

export function applyStrokeInjection(graph: SceneNode, payload: StrokeInjectionRuntimePayload, precomputedCols?: ColRef[]): StrokeInjectionResult {
    const columns = precomputedCols ?? collectColumns(graph);
    const cellFillStyle = resolveCellFillStyle(payload);
    const markStyles = resolveMarkStyles(payload);
    const legendSync = applyLegendMarkSync(graph, markStyles, payload, payload.markNum, payload.chartType, payload.rowColors, columns);
    const cellTopStyle = resolveCellTopStyle(payload);
    const tabRightStyle = resolveTabRightStyle(payload);
    const gridContainerStyle = resolveGridContainerStyle(payload);
    const skipMarkStyleApply = shouldSkipMarkStyleApply(payload, markStyles);

    return {
        cellFill: cellFillStyle ? applyCellFill(columns, cellFillStyle) : createScopeResult(),
        mark: skipMarkStyleApply
            ? createScopeResult()
            : applyMarkStyles(columns, markStyles, {
                chartType: payload.chartType,
                colColorEnabled: payload.colColorEnabled,
                rowColorModes: payload.rowColorModes
            }),
        legend: legendSync.result,
        cellTop: cellTopStyle ? applyCellTopStroke(columns, cellTopStyle) : createScopeResult(),
        tabRight: tabRightStyle ? applyTabRightStroke(columns, tabRightStyle) : createScopeResult(),
        gridContainer: gridContainerStyle ? applyGridContainerStroke(graph, gridContainerStyle) : createScopeResult(),
        resolved: {
            cellFill: Boolean(cellFillStyle),
            mark: !skipMarkStyleApply,
            legend: legendSync.enabled,
            cellTop: Boolean(cellTopStyle),
            tabRight: Boolean(tabRightStyle),
            gridContainer: Boolean(gridContainerStyle)
        }
    };
}
