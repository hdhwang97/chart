import { DEFAULT_MARK_STROKE_SIDES, DEFAULT_STYLE_INJECTION_DRAFT, DEFAULT_STYLE_INJECTION_ITEM, chartTypeUsesMarkFill, chartTypeUsesMarkLineBackground, deriveRowColorsFromMarkStyles, ensureColHeaderColorEnabledLength, ensureColHeaderColorModesLength, ensureColHeaderColorsLength, ensureColHeaderPaintStyleIdsLength, ensureRowColorModesLength, ensureRowColorsLength, ensureRowPaintStyleIdsLength, getGridColsForChart, getRowColor, getTotalStackedCols, normalizeHexColorInput, recomputeEffectiveStyleSnapshot, seedMarkStylesFromRowColorsIfNeeded, setLocalStyleOverrideField, state, type AssistLineStyleInjectionDraftItem, type GridStyleInjectionDraftItem, type LineBackgroundStyleInjectionDraftItem, type MarkStyleInjectionDraftItem, type StyleInjectionDraft, type StyleInjectionDraftItem } from './state';
import { setInputError, normalizeFromDom, normalizeColorThicknessFromDom } from './style-tab';
import { ui } from './dom';

export type SavedStylePayload = {
    savedCellFillStyle?: unknown;
    savedLineBackgroundStyle?: unknown;
    savedCellTopStyle?: unknown;
    savedTabRightStyle?: unknown;
    savedGridContainerStyle?: unknown;
    savedAssistLineStyle?: unknown;
    savedMarkStyle?: unknown;
    savedMarkStyles?: unknown;
    savedRowColors?: unknown;
}

export type ExtractedStylePayload = {
    cellFillStyle?: unknown;
    lineBackgroundStyle?: unknown;
    markStyle?: unknown;
    markStyles?: unknown;
    rowStrokeStyles?: unknown;
    colStrokeStyle?: unknown;
    chartContainerStrokeStyle?: unknown;
    assistLineStrokeStyle?: unknown;
}

import type {
    AssistLineInjectionStyle,
    CellFillInjectionStyle,
    ColorMode,
    GridStrokeInjectionStyle,
    LineBackgroundInjectionStyle,
    LocalStyleOverrideMask,
    LocalStyleOverrides,
    MarkInjectionStyle,
    MarkStrokeSides,
    PaintStyleSelection,
    RowStrokeStyle,
    SideStrokeInjectionStyle,
    StyleTemplateItem,
    StyleTemplatePayload,
    StrokeInjectionPayload,
    StrokeStyleSnapshot
} from '../shared/style-types';

const THICKNESS_MIN = 0;
const THICKNESS_MAX = 20;

function markFillEnabled() {
    return chartTypeUsesMarkFill(state.chartType);
}

function markLineBackgroundEnabled() {
    return chartTypeUsesMarkLineBackground(state.chartType);
}

function isStackedChartType(chartType: string = state.chartType) {
    return chartType === 'stackedBar' || chartType === 'stacked';
}

function resolveStackedStrokeSourceIndex(length: number) {
    if (length <= 0) return 0;
    return Math.max(0, Math.min(state.activeMarkStyleIndex, length - 1));
}

function resolveStackedSharedStrokeState(
    markStyles: MarkStyleInjectionDraftItem[],
    strokeLinks: boolean[],
    strokeSides: Array<Required<MarkStrokeSides>>
) {
    if (!isStackedChartType() || markStyles.length === 0) return null;
    const sourceIndex = resolveStackedStrokeSourceIndex(markStyles.length);
    const sourceStyle = markStyles[sourceIndex] || markStyles[0] || { ...DEFAULT_STYLE_INJECTION_DRAFT.mark };
    const sourceLinked = Boolean(strokeLinks[sourceIndex] ?? strokeLinks[0] ?? true);
    const sourceSides = strokeSides[sourceIndex] || strokeSides[0] || { ...DEFAULT_MARK_STROKE_SIDES };
    return { sourceIndex, sourceStyle, sourceLinked, sourceSides };
}

export function toHex6FromRgb(color: any): string | null {
    const rgb = color?.rgb;
    if (!rgb) return null;
    const r = Number(rgb.r);
    const g = Number(rgb.g);
    const b = Number(rgb.b);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    const toHex = (v: number) => clamp(v).toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function clampThickness(value: unknown, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    const normalized = Math.round(n * 100) / 100;
    return Math.max(THICKNESS_MIN, Math.min(THICKNESS_MAX, normalized));
}

export function clampOpacityPercent(value: unknown, fallback = 100): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
}

export function cloneDraft(draft: StyleInjectionDraft): StyleInjectionDraft {
    return {
        cellFill: { ...draft.cellFill },
        lineBackground: { ...draft.lineBackground },
        cellTop: { ...draft.cellTop },
        tabRight: { ...draft.tabRight },
        gridContainer: {
            ...draft.gridContainer,
            sides: { ...draft.gridContainer.sides }
        },
        assistLine: { ...draft.assistLine },
        mark: { ...draft.mark }
    };
}

export function normalizeLineBackgroundStyle(value: unknown): LineBackgroundInjectionStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as LineBackgroundInjectionStyle;
    const color = normalizeHexColorInput(source.color);
    const opacityRaw = Number((source as any).opacity);
    const opacity = Number.isFinite(opacityRaw) ? Math.max(0, Math.min(1, opacityRaw)) : undefined;
    const visible = typeof source.visible === 'boolean' ? source.visible : undefined;
    if (!color && opacity === undefined && visible === undefined) return null;
    return {
        color: color || undefined,
        opacity,
        visible
    } as any;
}

export function draftItemFromLineBackgroundStyle(
    style: LineBackgroundInjectionStyle | null | undefined,
    fallback: LineBackgroundStyleInjectionDraftItem
): LineBackgroundStyleInjectionDraftItem {
    const color = normalizeHexColorInput(style?.color) || fallback.color;
    const opacity = typeof (style as any)?.opacity === 'number'
        ? Math.max(0, Math.min(1, (style as any).opacity))
        : fallback.opacity;
    const visible = typeof style?.visible === 'boolean' ? style.visible : fallback.visible;
    return { color, opacity: opacity as any, visible };
}

export function normalizeCellFillStyle(value: unknown): CellFillInjectionStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as CellFillInjectionStyle;
    const color = normalizeHexColorInput(source.color);
    if (!color) return null;
    return { color };
}

export function extractSideThickness(stroke: StrokeStyleSnapshot | null, side: 'top' | 'right' | 'bottom' | 'left'): number | undefined {
    if (!stroke) return undefined;
    if (side === 'top' && typeof stroke.weightTop === 'number') return stroke.weightTop;
    if (side === 'right' && typeof stroke.weightRight === 'number') return stroke.weightRight;
    if (side === 'bottom' && typeof stroke.weightBottom === 'number') return stroke.weightBottom;
    if (side === 'left' && typeof stroke.weightLeft === 'number') return stroke.weightLeft;
    if (typeof stroke.weight === 'number') return stroke.weight;
    return undefined;
}

export function resolveRowZeroStroke(rowStrokeStyles: RowStrokeStyle[] | null): StrokeStyleSnapshot | null {
    if (!Array.isArray(rowStrokeStyles) || rowStrokeStyles.length === 0) return null;
    const rowZero = rowStrokeStyles.find((item) => item.row === 0);
    if (rowZero?.stroke) return rowZero.stroke;
    return rowStrokeStyles[0]?.stroke || null;
}

export function normalizeSideStyle(value: unknown): SideStrokeInjectionStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as SideStrokeInjectionStyle;
    const color = normalizeHexColorInput(source.color);
    const thickness = Number.isFinite(Number(source.thickness)) ? clampThickness(source.thickness, DEFAULT_STYLE_INJECTION_ITEM.thickness) : undefined;
    const visible = typeof source.visible === 'boolean' ? source.visible : undefined;
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);
    if (!color && thickness === undefined && visible === undefined && !strokeStyle) return null;
    return {
        color: color || undefined,
        thickness,
        visible,
        strokeStyle
    };
}

export function normalizeGridStyle(value: unknown): GridStrokeInjectionStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as GridStrokeInjectionStyle;
    const side = normalizeSideStyle(source);
    const enableIndividualStroke = source.enableIndividualStroke !== false;
    const sides = {
        top: source.sides?.top !== false,
        right: source.sides?.right !== false,
        bottom: source.sides?.bottom !== false,
        left: source.sides?.left !== false
    };
    if (!side && source.enableIndividualStroke === undefined && source.sides === undefined) return null;
    return {
        ...(side || {}),
        enableIndividualStroke,
        sides
    };
}

export function normalizeAssistLineStyle(value: unknown): AssistLineInjectionStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as AssistLineInjectionStyle;
    const color = normalizeHexColorInput(source.color);
    const thickness = Number.isFinite(Number(source.thickness)) ? clampThickness(source.thickness, DEFAULT_STYLE_INJECTION_DRAFT.assistLine.thickness) : undefined;
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);
    if (!color && thickness === undefined && !strokeStyle) return null;
    return {
        color: color || undefined,
        thickness,
        strokeStyle
    };
}

export function normalizeMarkStyle(value: unknown): MarkInjectionStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as MarkInjectionStyle;
    const fillColor = normalizeHexColorInput(source.fillColor);
    const strokeColor = normalizeHexColorInput(source.strokeColor);
    const lineBackgroundColor = normalizeHexColorInput(source.lineBackgroundColor);
    const lineBackgroundOpacityRaw = Number(source.lineBackgroundOpacity);
    const lineBackgroundOpacity = Number.isFinite(lineBackgroundOpacityRaw)
        ? (lineBackgroundOpacityRaw <= 1
            ? clampOpacityPercent(lineBackgroundOpacityRaw * 100, 100)
            : clampOpacityPercent(lineBackgroundOpacityRaw, 100))
        : undefined;
    const lineBackgroundVisible = typeof source.lineBackgroundVisible === 'boolean' ? source.lineBackgroundVisible : undefined;
    const thickness = Number.isFinite(Number(source.thickness)) ? clampThickness(source.thickness, DEFAULT_STYLE_INJECTION_DRAFT.mark.thickness) : undefined;
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);
    const enabled = typeof source.enabled === 'boolean' ? source.enabled : undefined;
    const sides = source.sides && typeof source.sides === 'object'
        ? {
            top: source.sides.top !== false,
            left: source.sides.left !== false,
            right: source.sides.right !== false
        }
        : undefined;
    if (!fillColor && !strokeColor && !lineBackgroundColor && lineBackgroundOpacity === undefined && lineBackgroundVisible === undefined && thickness === undefined && !strokeStyle && enabled === undefined && !sides) return null;
    return {
        fillColor: fillColor || undefined,
        strokeColor: strokeColor || undefined,
        lineBackgroundColor: lineBackgroundColor || undefined,
        lineBackgroundOpacity: lineBackgroundOpacity !== undefined ? lineBackgroundOpacity / 100 : undefined,
        lineBackgroundVisible,
        thickness,
        strokeStyle,
        enabled,
        sides
    };
}

export function normalizeMarkStyles(value: unknown): MarkInjectionStyle[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeMarkStyle(item))
        .filter((item): item is MarkInjectionStyle => Boolean(item));
}

export function draftItemFromSideStyle(style: SideStrokeInjectionStyle | null, fallback: StyleInjectionDraftItem): StyleInjectionDraftItem {
    if (!style) return { ...fallback };
    const color = normalizeHexColorInput(style.color) || fallback.color;
    const baseThickness = clampThickness(style.thickness, fallback.thickness);
    const visible = typeof style.visible === 'boolean' ? style.visible : baseThickness > 0;
    return {
        color,
        thickness: visible ? baseThickness : 0,
        visible,
        strokeStyle: style.strokeStyle === 'dash' ? 'dash' : 'solid'
    };
}

export function draftItemFromGridStyle(style: GridStrokeInjectionStyle | null, fallback: GridStyleInjectionDraftItem): GridStyleInjectionDraftItem {
    if (!style) return { ...fallback };
    const color = normalizeHexColorInput(style.color) || fallback.color;
    const baseThickness = clampThickness(style.thickness, fallback.thickness);
    const visible = typeof style.visible === 'boolean' ? style.visible : baseThickness > 0;
    const sides = {
        top: style.sides?.top !== false,
        right: style.sides?.right !== false,
        bottom: style.sides?.bottom !== false,
        left: style.sides?.left !== false
    };
    return {
        color,
        thickness: visible ? baseThickness : 0,
        visible,
        strokeStyle: style.strokeStyle === 'dash' ? 'dash' : 'solid',
        sides
    };
}

export function draftItemFromAssistLineStyle(
    style: AssistLineInjectionStyle | null,
    fallback: AssistLineStyleInjectionDraftItem
): AssistLineStyleInjectionDraftItem {
    if (!style) return { ...fallback };
    return {
        color: normalizeHexColorInput(style.color) || fallback.color,
        thickness: clampThickness(style.thickness, fallback.thickness),
        strokeStyle: style.strokeStyle === 'dash' ? 'dash' : 'solid'
    };
}

export function draftItemFromMarkStyle(style: MarkInjectionStyle | null, fallback: MarkStyleInjectionDraftItem): MarkStyleInjectionDraftItem {
    if (!style) return { ...fallback };
    return {
        fillColor: normalizeHexColorInput(style.fillColor) || fallback.fillColor,
        strokeColor: normalizeHexColorInput(style.strokeColor) || fallback.strokeColor,
        lineBackgroundColor: normalizeHexColorInput(style.lineBackgroundColor) || normalizeHexColorInput(style.strokeColor) || fallback.lineBackgroundColor,
        lineBackgroundOpacity: clampOpacityPercent(
            typeof style.lineBackgroundOpacity === 'number' ? style.lineBackgroundOpacity * 100 : undefined,
            fallback.lineBackgroundOpacity
        ),
        lineBackgroundVisible: typeof style.lineBackgroundVisible === 'boolean' ? style.lineBackgroundVisible : fallback.lineBackgroundVisible,
        thickness: clampThickness(style.thickness, fallback.thickness),
        strokeStyle: style.strokeStyle === 'dash' ? 'dash' : 'solid'
    };
}

function normalizeMarkStrokeSides(value: unknown): Required<MarkStrokeSides> {
    if (!value || typeof value !== 'object') {
        return { ...DEFAULT_MARK_STROKE_SIDES };
    }
    const source = value as MarkStrokeSides;
    return {
        top: source.top !== false,
        left: source.left !== false,
        right: source.right !== false
    };
}

export function sideStyleFromSnapshot(stroke: StrokeStyleSnapshot | null, side: 'top' | 'right' | 'bottom' | 'left'): SideStrokeInjectionStyle | null {
    if (!stroke) return null;
    const color = normalizeHexColorInput(stroke.color);
    const thicknessRaw = extractSideThickness(stroke, side);
    const thickness = typeof thicknessRaw === 'number' ? clampThickness(thicknessRaw, DEFAULT_STYLE_INJECTION_ITEM.thickness) : undefined;
    const visible = thickness === undefined ? undefined : thickness > 0;
    if (!color && thickness === undefined && visible === undefined) return null;
    return {
        color: color || undefined,
        thickness,
        visible,
        strokeStyle: Array.isArray(stroke.dashPattern) && stroke.dashPattern.length > 0 ? 'dash' : 'solid'
    };
}

function scaleSideStyleThickness(style: SideStrokeInjectionStyle | null, factor: number): SideStrokeInjectionStyle | null {
    if (!style || typeof style.thickness !== 'number') return style;
    const thickness = clampThickness(style.thickness * factor, style.thickness);
    return {
        ...style,
        thickness,
        visible: thickness > 0
    };
}

export function gridStyleFromSnapshot(stroke: StrokeStyleSnapshot | null): GridStrokeInjectionStyle | null {
    if (!stroke) return null;
    const color = normalizeHexColorInput(stroke.color);
    const weightRaw =
        typeof stroke.weight === 'number'
            ? stroke.weight
            : stroke.weightTop ?? stroke.weightRight ?? stroke.weightBottom ?? stroke.weightLeft;
    const thickness = typeof weightRaw === 'number' ? clampThickness(weightRaw, DEFAULT_STYLE_INJECTION_ITEM.thickness) : undefined;
    const visible = thickness === undefined ? undefined : thickness > 0;
    if (!color && thickness === undefined && visible === undefined) return null;
    const topWeight = typeof stroke.weightTop === 'number' ? stroke.weightTop : stroke.weight;
    const rightWeight = typeof stroke.weightRight === 'number' ? stroke.weightRight : stroke.weight;
    const bottomWeight = typeof stroke.weightBottom === 'number' ? stroke.weightBottom : stroke.weight;
    const leftWeight = typeof stroke.weightLeft === 'number' ? stroke.weightLeft : stroke.weight;
    return {
        color: color || undefined,
        thickness,
        visible,
        strokeStyle: Array.isArray(stroke.dashPattern) && stroke.dashPattern.length > 0 ? 'dash' : 'solid',
        enableIndividualStroke: true,
        sides: {
            top: typeof topWeight === 'number' ? topWeight > 0 : true,
            right: typeof rightWeight === 'number' ? rightWeight > 0 : true,
            bottom: typeof bottomWeight === 'number' ? bottomWeight > 0 : true,
            left: typeof leftWeight === 'number' ? leftWeight > 0 : true
        }
    };
}

export function asRowStrokeStyles(value: unknown): RowStrokeStyle[] | null {
    if (!Array.isArray(value)) return null;
    return value as RowStrokeStyle[];
}

export function asStrokeSnapshot(value: unknown): StrokeStyleSnapshot | null {
    if (!value || typeof value !== 'object') return null;
    return value as StrokeStyleSnapshot;
}

export function assistLineStyleFromSnapshot(stroke: StrokeStyleSnapshot | null): AssistLineInjectionStyle | null {
    if (!stroke) return null;
    const color = normalizeHexColorInput(stroke.color);
    const thickness = typeof stroke.weight === 'number'
        ? clampThickness(stroke.weight, DEFAULT_STYLE_INJECTION_DRAFT.assistLine.thickness)
        : undefined;
    if (!color && thickness === undefined) return null;
    return {
        color: color || undefined,
        thickness,
        strokeStyle: Array.isArray(stroke.dashPattern) && stroke.dashPattern.length > 0 ? 'dash' : 'solid'
    };
}

export function markStyleFromSnapshot(stroke: MarkInjectionStyle | null): MarkInjectionStyle | null {
    if (!stroke) return null;
    const fillColor = normalizeHexColorInput(stroke.fillColor);
    const strokeColor = normalizeHexColorInput(stroke.strokeColor);
    const lineBackgroundColor = normalizeHexColorInput(stroke.lineBackgroundColor);
    const lineBackgroundOpacity = typeof stroke.lineBackgroundOpacity === 'number'
        ? Math.max(0, Math.min(1, stroke.lineBackgroundOpacity))
        : undefined;
    const lineBackgroundVisible = typeof stroke.lineBackgroundVisible === 'boolean' ? stroke.lineBackgroundVisible : undefined;
    const thickness = Number.isFinite(Number(stroke.thickness))
        ? clampThickness(stroke.thickness, DEFAULT_STYLE_INJECTION_DRAFT.mark.thickness)
        : undefined;
    const enabled = typeof stroke.enabled === 'boolean' ? stroke.enabled : undefined;
    const sides = stroke.sides ? normalizeMarkStrokeSides(stroke.sides) : undefined;
    if (!fillColor && !strokeColor && !lineBackgroundColor && lineBackgroundOpacity === undefined && lineBackgroundVisible === undefined && thickness === undefined && enabled === undefined && !sides) return null;
    return {
        fillColor: fillColor || undefined,
        strokeColor: strokeColor || undefined,
        lineBackgroundColor: lineBackgroundColor || undefined,
        lineBackgroundOpacity,
        lineBackgroundVisible,
        thickness,
        strokeStyle: stroke.strokeStyle === 'dash' ? 'dash' : 'solid',
        enabled,
        sides
    };
}

export function getDefaultSeriesCountFromState(): number {
    if (state.chartType === 'stackedBar') {
        return Math.max(1, state.rows - 1);
    }
    return Math.max(1, state.rows);
}

export function buildMarkStylesFromRowHeaders(): MarkStyleInjectionDraftItem[] {
    return seedMarkStylesFromRowColorsIfNeeded(
        state.chartType,
        state.rows,
        [],
        state.rowColors
    );
}

export function ensureMarkDraftSeriesCount(source: MarkStyleInjectionDraftItem[]): MarkStyleInjectionDraftItem[] {
    const base = source.length > 0 ? source : [{ ...DEFAULT_STYLE_INJECTION_DRAFT.mark }];
    const targetCount = Math.max(1, getDefaultSeriesCountFromState());
    const next: MarkStyleInjectionDraftItem[] = [];
    for (let i = 0; i < targetCount; i++) {
        next.push({ ...(base[i] || base[base.length - 1] || DEFAULT_STYLE_INJECTION_DRAFT.mark) });
    }
    return next;
}

export function ensureMarkStrokeLinkStateCount(count: number) {
    const target = Math.max(1, Math.floor(count));
    const next: boolean[] = [];
    for (let i = 0; i < target; i++) {
        const current = state.markStrokeLinkByIndex[i];
        next.push(typeof current === 'boolean' ? current : true);
    }
    state.markStrokeLinkByIndex = next;
    return state.markStrokeLinkByIndex;
}

export function ensureMarkStrokeSidesStateCount(count: number) {
    const target = Math.max(1, Math.floor(count));
    const next: Array<Required<MarkStrokeSides>> = [];
    for (let i = 0; i < target; i++) {
        next.push(normalizeMarkStrokeSides(state.markStrokeSidesByIndex[i]));
    }
    state.markStrokeSidesByIndex = next;
    return state.markStrokeSidesByIndex;
}

export function getActiveMarkStrokeSides(): Required<MarkStrokeSides> {
    const sides = ensureMarkStrokeSidesStateCount(state.markStylesDraft.length);
    const idx = Math.max(0, Math.min(state.activeMarkStyleIndex, sides.length - 1));
    return sides[idx] || { ...DEFAULT_MARK_STROKE_SIDES };
}

export function getActiveMarkDraft(): MarkStyleInjectionDraftItem {
    const styles = state.markStylesDraft;
    const idx = Math.max(0, Math.min(state.activeMarkStyleIndex, styles.length - 1));
    return styles[idx] || { ...DEFAULT_STYLE_INJECTION_DRAFT.mark };
}

export function isActiveMarkStrokeLinked() {
    const links = ensureMarkStrokeLinkStateCount(state.markStylesDraft.length);
    const idx = Math.max(0, Math.min(state.activeMarkStyleIndex, links.length - 1));
    return Boolean(links[idx]);
}

export function setActiveMarkStrokeLinked(next: boolean) {
    const links = ensureMarkStrokeLinkStateCount(state.markStylesDraft.length);
    if (isStackedChartType()) {
        for (let i = 0; i < links.length; i++) {
            links[i] = Boolean(next);
        }
        return;
    }
    const idx = Math.max(0, Math.min(state.activeMarkStyleIndex, links.length - 1));
    links[idx] = Boolean(next);
}

export function buildDraftFromPayload(
    saved: SavedStylePayload,
    extracted: ExtractedStylePayload
): StyleInjectionDraft {
    const extractedCellFill = normalizeCellFillStyle(extracted.cellFillStyle);
    const extractedLineBackground = normalizeLineBackgroundStyle(extracted.lineBackgroundStyle);
    const extractedMark = markStyleFromSnapshot(normalizeMarkStyle(extracted.markStyle));
    const extractedMarks = normalizeMarkStyles(extracted.markStyles);
    const rowStrokeStyles = asRowStrokeStyles(extracted.rowStrokeStyles);
    const colStroke = asStrokeSnapshot(extracted.colStrokeStyle);
    const chartContainerStroke = asStrokeSnapshot(extracted.chartContainerStrokeStyle);
    const assistLineStroke = asStrokeSnapshot(extracted.assistLineStrokeStyle);
    const rowZeroStroke = resolveRowZeroStroke(rowStrokeStyles);

    const extractedCellTop = sideStyleFromSnapshot(rowZeroStroke, 'top');
    const extractedTabRight = scaleSideStyleThickness(sideStyleFromSnapshot(colStroke, 'right'), 2);
    const extractedGrid = gridStyleFromSnapshot(chartContainerStroke || colStroke);
    const extractedAssistLine = assistLineStyleFromSnapshot(assistLineStroke);

    const savedCellFill = normalizeCellFillStyle(saved.savedCellFillStyle);
    const savedLineBackground = normalizeLineBackgroundStyle(saved.savedLineBackgroundStyle);
    const savedMark = normalizeMarkStyle(saved.savedMarkStyle);
    const savedMarks = normalizeMarkStyles(saved.savedMarkStyles);
    const savedCellTop = normalizeSideStyle(saved.savedCellTopStyle);
    const savedTabRight = normalizeSideStyle(saved.savedTabRightStyle);
    const savedGrid = normalizeGridStyle(saved.savedGridContainerStyle);
    const savedAssistLine = normalizeAssistLineStyle(saved.savedAssistLineStyle);

    const rowHeaderDerivedMarks = buildMarkStylesFromRowHeaders().map((item) => ({
        fillColor: item.fillColor,
        strokeColor: item.strokeColor,
        lineBackgroundColor: item.lineBackgroundColor,
        lineBackgroundOpacity: Math.max(0, Math.min(1, item.lineBackgroundOpacity / 100)),
        lineBackgroundVisible: item.lineBackgroundVisible,
        thickness: item.thickness,
        strokeStyle: item.strokeStyle
    }));
    const savedRowColors = Array.isArray(saved.savedRowColors)
        ? saved.savedRowColors.map((color) => normalizeHexColorInput(color)).filter((color): color is string => Boolean(color))
        : [];
    const seededFromSavedRowColors = seedMarkStylesFromRowColorsIfNeeded(
        state.chartType,
        state.rows,
        [],
        savedRowColors.length > 0 ? savedRowColors : state.rowColors
    );
    const resolvedMarkStylesRaw = savedMarks.length > 0
        ? savedMarks
        : (extractedMarks.length > 0 ? extractedMarks : (savedRowColors.length > 0 ? seededFromSavedRowColors : rowHeaderDerivedMarks));
    const resolvedMarkStyles = ensureMarkDraftSeriesCount(
        resolvedMarkStylesRaw.length > 0
            ? resolvedMarkStylesRaw.map((item) => draftItemFromMarkStyle(item, DEFAULT_STYLE_INJECTION_DRAFT.mark))
            : [draftItemFromMarkStyle(savedMark || extractedMark, DEFAULT_STYLE_INJECTION_DRAFT.mark)]
    );
    state.markStylesDraft = resolvedMarkStyles;
    state.rowColors = deriveRowColorsFromMarkStyles(
        state.chartType,
        state.markStylesDraft,
        state.rows,
        savedRowColors.length > 0 ? savedRowColors : state.rowColors
    );
    ensureRowColorsLength(state.rows);
    const links = ensureMarkStrokeLinkStateCount(state.markStylesDraft.length);
    const enabledSeed = resolvedMarkStylesRaw.map((item) => (typeof item?.enabled === 'boolean' ? item.enabled : undefined));
    if (markFillEnabled()) {
        for (let i = 0; i < links.length; i++) {
            if (typeof enabledSeed[i] === 'boolean') {
                links[i] = !enabledSeed[i];
            }
        }
    }
    ensureMarkStrokeSidesStateCount(state.markStylesDraft.length);
    const sideSeed = resolvedMarkStylesRaw.map((item) => normalizeMarkStrokeSides((item as MarkInjectionStyle | null | undefined)?.sides));
    if (sideSeed.length > 0) {
        const sides = ensureMarkStrokeSidesStateCount(state.markStylesDraft.length);
        for (let i = 0; i < sides.length; i++) {
            if (sideSeed[i]) sides[i] = sideSeed[i];
        }
    }
    if (markFillEnabled() && Array.isArray(state.localStyleOverrides.markStrokeEnabledByIndex)) {
        const savedEnabled = state.localStyleOverrides.markStrokeEnabledByIndex;
        const links = ensureMarkStrokeLinkStateCount(state.markStylesDraft.length);
        for (let i = 0; i < links.length; i++) {
            const enabled = savedEnabled[i];
            if (typeof enabled === 'boolean') {
                links[i] = !enabled;
            }
        }
    }
    if (Array.isArray(state.localStyleOverrides.markStrokeSidesByIndex)) {
        const savedSides = state.localStyleOverrides.markStrokeSidesByIndex;
        const sides = ensureMarkStrokeSidesStateCount(state.markStylesDraft.length);
        for (let i = 0; i < sides.length; i++) {
            if (savedSides[i]) sides[i] = normalizeMarkStrokeSides(savedSides[i]);
        }
    }
    if (isStackedChartType()) {
        const stackedStyles = ensureMarkDraftSeriesCount(state.markStylesDraft);
        const stackedLinks = ensureMarkStrokeLinkStateCount(stackedStyles.length);
        const stackedSides = ensureMarkStrokeSidesStateCount(stackedStyles.length);
        const sharedStackedStroke = resolveStackedSharedStrokeState(stackedStyles, stackedLinks, stackedSides);
        if (sharedStackedStroke) {
            for (let i = 0; i < stackedStyles.length; i++) {
                stackedStyles[i] = {
                    ...stackedStyles[i],
                    strokeColor: sharedStackedStroke.sourceStyle.strokeColor,
                    thickness: sharedStackedStroke.sourceStyle.thickness,
                    strokeStyle: sharedStackedStroke.sourceStyle.strokeStyle
                };
            }
            for (let i = 0; i < stackedLinks.length; i++) {
                stackedLinks[i] = sharedStackedStroke.sourceLinked;
            }
            for (let i = 0; i < stackedSides.length; i++) {
                stackedSides[i] = { ...sharedStackedStroke.sourceSides };
            }
            state.markStylesDraft = stackedStyles;
        }
    }
    state.activeMarkStyleIndex = Math.max(0, Math.min(state.activeMarkStyleIndex, resolvedMarkStyles.length - 1));

    return {
        cellFill: { color: (savedCellFill?.color || extractedCellFill?.color || DEFAULT_STYLE_INJECTION_DRAFT.cellFill.color) as string },
        lineBackground: draftItemFromLineBackgroundStyle(
            savedLineBackground || extractedLineBackground,
            DEFAULT_STYLE_INJECTION_DRAFT.lineBackground
        ),
        mark: { ...getActiveMarkDraft() },
        cellTop: draftItemFromSideStyle(savedCellTop || extractedCellTop, DEFAULT_STYLE_INJECTION_DRAFT.cellTop),
        tabRight: draftItemFromSideStyle(savedTabRight || extractedTabRight, DEFAULT_STYLE_INJECTION_DRAFT.tabRight),
        gridContainer: draftItemFromGridStyle(savedGrid || extractedGrid, DEFAULT_STYLE_INJECTION_DRAFT.gridContainer),
        assistLine: draftItemFromAssistLineStyle(savedAssistLine || extractedAssistLine, DEFAULT_STYLE_INJECTION_DRAFT.assistLine)
    };
}

export function toStrokeInjectionPayload(draft: StyleInjectionDraft): StrokeInjectionPayload {
    const allowMarkFill = markFillEnabled();
    const allowLineBackground = markLineBackgroundEnabled();
    const totalCols = state.chartType === 'stackedBar'
        ? getTotalStackedCols()
        : getGridColsForChart(state.chartType, state.cols);
    const normalizedColColors = ensureColHeaderColorsLength(totalCols).slice(0, totalCols);
    const normalizedColEnabled = ensureColHeaderColorEnabledLength(totalCols).slice(0, totalCols);
    const normalizedColModes = ensureColHeaderColorModesLength(totalCols).slice(0, totalCols);
    const normalizedColPaintStyleIds = ensureColHeaderPaintStyleIdsLength(totalCols).slice(0, totalCols);
    const normalizedMarkStyles = ensureMarkDraftSeriesCount(state.markStylesDraft);
    const strokeLinks = ensureMarkStrokeLinkStateCount(normalizedMarkStyles.length);
    const strokeSides = ensureMarkStrokeSidesStateCount(normalizedMarkStyles.length);
    const sharedStackedStroke = resolveStackedSharedStrokeState(normalizedMarkStyles, strokeLinks, strokeSides);
    const markStrokeEnabledAtIndex = (index: number) => (
        markFillEnabled()
            ? !(sharedStackedStroke
                ? sharedStackedStroke.sourceLinked
                : (strokeLinks[index] ?? true))
            : true
    );
    const resolveStrokeSidesAtIndex = (index: number) => (
        sharedStackedStroke
            ? sharedStackedStroke.sourceSides
            : (strokeSides[index] || { ...DEFAULT_MARK_STROKE_SIDES })
    );
    const activeStrokeSource = sharedStackedStroke
        ? sharedStackedStroke.sourceStyle
        : draft.mark;
    return {
        cellFillStyle: {
            color: draft.cellFill.color
        },
        ...(allowLineBackground ? {
            lineBackgroundStyle: {
                color: draft.lineBackground.color,
                visible: draft.lineBackground.visible
            }
        } : {}),
        markStyle: {
            fillColor: allowMarkFill ? draft.mark.fillColor : undefined,
            strokeColor: activeStrokeSource.strokeColor,
            lineBackgroundColor: allowLineBackground ? draft.mark.lineBackgroundColor : undefined,
            lineBackgroundOpacity: allowLineBackground ? Math.max(0, Math.min(1, draft.mark.lineBackgroundOpacity / 100)) : undefined,
            lineBackgroundVisible: allowLineBackground ? draft.mark.lineBackgroundVisible : undefined,
            thickness: activeStrokeSource.thickness,
            strokeStyle: activeStrokeSource.strokeStyle,
            enabled: markStrokeEnabledAtIndex(Math.max(0, Math.min(state.activeMarkStyleIndex, Math.max(0, strokeLinks.length - 1)))),
            sides: sharedStackedStroke ? sharedStackedStroke.sourceSides : getActiveMarkStrokeSides()
        },
        markStyles: normalizedMarkStyles.map((item, index) => ({
            fillColor: allowMarkFill ? item.fillColor : undefined,
            strokeColor: sharedStackedStroke ? sharedStackedStroke.sourceStyle.strokeColor : item.strokeColor,
            lineBackgroundColor: allowLineBackground ? item.lineBackgroundColor : undefined,
            lineBackgroundOpacity: allowLineBackground ? Math.max(0, Math.min(1, item.lineBackgroundOpacity / 100)) : undefined,
            lineBackgroundVisible: allowLineBackground ? item.lineBackgroundVisible : undefined,
            thickness: sharedStackedStroke ? sharedStackedStroke.sourceStyle.thickness : item.thickness,
            strokeStyle: sharedStackedStroke ? sharedStackedStroke.sourceStyle.strokeStyle : item.strokeStyle,
            enabled: markStrokeEnabledAtIndex(index),
            sides: resolveStrokeSidesAtIndex(index)
        })),
        rowColors: deriveRowColorsFromMarkStyles(
            state.chartType,
            state.markStylesDraft,
            state.rows,
            state.rowColors
        ),
        cellTopStyle: {
            color: draft.cellTop.color,
            thickness: draft.cellTop.thickness,
            visible: draft.cellTop.visible,
            strokeStyle: draft.cellTop.strokeStyle
        },
        tabRightStyle: {
            color: draft.tabRight.color,
            thickness: draft.tabRight.thickness,
            visible: draft.tabRight.visible,
            strokeStyle: draft.tabRight.strokeStyle
        },
        gridContainerStyle: {
            color: draft.gridContainer.color,
            thickness: draft.gridContainer.thickness,
            visible: draft.gridContainer.visible,
            strokeStyle: draft.gridContainer.strokeStyle,
            enableIndividualStroke: true,
            sides: {
                top: draft.gridContainer.sides.top,
                right: draft.gridContainer.sides.right,
                bottom: draft.gridContainer.sides.bottom,
                left: draft.gridContainer.sides.left
            }
        },
        assistLineStyle: {
            color: draft.assistLine.color,
            thickness: draft.assistLine.thickness,
            strokeStyle: draft.assistLine.strokeStyle
        },
        colColors: normalizedColColors,
        colColorEnabled: normalizedColEnabled,
        colColorModes: normalizedColModes,
        colPaintStyleIds: normalizedColPaintStyleIds
    };
}

export function buildTemplatePayloadFromDraft(draft: StyleInjectionDraft): StyleTemplatePayload {
    return toStrokeInjectionPayload(draft);
}

export function validateStyleTabDraft(draft: StyleInjectionDraft): { draft: StyleInjectionDraft; isValid: boolean } {
    const cellFillValid = Boolean(normalizeHexColorInput(ui.styleCellFillColorInput.value));
    const allowMarkFill = markFillEnabled();
    const allowLineBackground = markLineBackgroundEnabled();
    const markFillValid = !allowMarkFill || Boolean(normalizeHexColorInput(ui.styleMarkFillColorInput.value));
    const markStrokeValid = Boolean(normalizeHexColorInput(ui.styleMarkStrokeColorInput.value));
    const markLineBackgroundValid = !allowLineBackground || Boolean(normalizeHexColorInput(ui.styleMarkLineBackgroundColorInput.value));
    const markLineBackgroundOpacityRaw = Number(ui.styleMarkLineBackgroundOpacityInput.value);
    const markLineBackgroundOpacityValid = !allowLineBackground || (
        Number.isFinite(markLineBackgroundOpacityRaw)
        && markLineBackgroundOpacityRaw >= 0
        && markLineBackgroundOpacityRaw <= 100
    );
    const markThicknessRaw = Number(ui.styleMarkThicknessInput.value);
    const markThicknessValid = Number.isFinite(markThicknessRaw) && markThicknessRaw >= THICKNESS_MIN && markThicknessRaw <= THICKNESS_MAX;
    const cellTopNorm = normalizeFromDom(
        ui.styleCellTopColorInput,
        ui.styleCellTopStrokeStyleInput,
        ui.styleCellTopThicknessInput,
        ui.styleCellTopVisibleInput,
        draft.cellTop
    );
    const tabRightNorm = normalizeFromDom(
        ui.styleTabRightColorInput,
        ui.styleTabRightStrokeStyleInput,
        ui.styleTabRightThicknessInput,
        ui.styleTabRightVisibleInput,
        draft.tabRight
    );
    const gridNorm = normalizeFromDom(
        ui.styleGridColorInput,
        ui.styleGridStrokeStyleInput,
        ui.styleGridThicknessInput,
        ui.styleGridVisibleInput,
        draft.gridContainer
    );
    const normalizedGrid: GridStyleInjectionDraftItem = {
        ...(gridNorm.item as GridStyleInjectionDraftItem),
        sides: {
            top: ui.styleGridSideTopInput.checked,
            right: ui.styleGridSideRightInput.checked,
            bottom: ui.styleGridSideBottomInput.checked,
            left: ui.styleGridSideLeftInput.checked
        }
    };
    const assistLineNorm = normalizeColorThicknessFromDom(
        ui.styleAssistLineColorInput,
        ui.styleAssistLineStrokeStyleInput,
        ui.styleAssistLineThicknessInput,
        draft.assistLine
    );

    setInputError(ui.styleCellFillColorInput, !cellFillValid);
    setInputError(ui.styleMarkFillColorInput, !markFillValid && allowMarkFill);
    setInputError(ui.styleMarkStrokeColorInput, !markStrokeValid);
    setInputError(ui.styleMarkLineBackgroundColorInput, !markLineBackgroundValid && allowLineBackground);
    setInputError(ui.styleMarkLineBackgroundOpacityInput, !markLineBackgroundOpacityValid && allowLineBackground);
    setInputError(ui.styleMarkThicknessInput, !markThicknessValid);
    setInputError(ui.styleCellTopColorInput, !cellTopNorm.colorValid);
    setInputError(ui.styleCellTopThicknessInput, !cellTopNorm.thicknessValid);
    setInputError(ui.styleTabRightColorInput, !tabRightNorm.colorValid);
    setInputError(ui.styleTabRightThicknessInput, !tabRightNorm.thicknessValid);
    setInputError(ui.styleGridColorInput, !gridNorm.colorValid);
    setInputError(ui.styleGridThicknessInput, !gridNorm.thicknessValid);
    setInputError(ui.styleAssistLineColorInput, !assistLineNorm.colorValid);
    setInputError(ui.styleAssistLineThicknessInput, !assistLineNorm.thicknessValid);

    const isValid = cellTopNorm.colorValid
        && cellFillValid
        && markFillValid
        && markStrokeValid
        && markLineBackgroundValid
        && markLineBackgroundOpacityValid
        && markThicknessValid
        && cellTopNorm.thicknessValid
        && tabRightNorm.colorValid
        && tabRightNorm.thicknessValid
        && gridNorm.colorValid
        && gridNorm.thicknessValid
        && assistLineNorm.colorValid
        && assistLineNorm.thicknessValid;

    return {
        draft: {
            cellFill: { color: normalizeHexColorInput(ui.styleCellFillColorInput.value) || draft.cellFill.color },
            lineBackground: allowLineBackground
                ? {
                    color: normalizeHexColorInput(ui.styleMarkLineBackgroundColorInput.value) || normalizeHexColorInput(ui.styleMarkStrokeColorInput.value) || draft.mark.strokeColor,
                    opacity: markLineBackgroundOpacityValid
                        ? Math.max(0, Math.min(1, markLineBackgroundOpacityRaw / 100))
                        : draft.lineBackground.opacity,
                    visible: ui.styleMarkLineBackgroundVisibleInput.checked
                }
                : { ...draft.lineBackground },
            mark: {
                fillColor: allowMarkFill
                    ? (normalizeHexColorInput(ui.styleMarkFillColorInput.value) || draft.mark.fillColor)
                    : draft.mark.fillColor,
                strokeColor: normalizeHexColorInput(ui.styleMarkStrokeColorInput.value) || draft.mark.strokeColor,
                lineBackgroundColor: allowLineBackground
                    ? (normalizeHexColorInput(ui.styleMarkLineBackgroundColorInput.value) || normalizeHexColorInput(ui.styleMarkStrokeColorInput.value) || draft.mark.lineBackgroundColor)
                    : draft.mark.lineBackgroundColor,
                lineBackgroundOpacity: allowLineBackground && markLineBackgroundOpacityValid
                    ? Math.max(0, Math.min(100, Math.round(markLineBackgroundOpacityRaw)))
                    : draft.mark.lineBackgroundOpacity,
                lineBackgroundVisible: allowLineBackground
                    ? ui.styleMarkLineBackgroundVisibleInput.checked
                    : draft.mark.lineBackgroundVisible,
                thickness: markThicknessValid ? markThicknessRaw : clampThickness(markThicknessRaw, draft.mark.thickness),
                strokeStyle: ui.styleMarkStrokeStyleInput.value === 'dash' ? 'dash' : 'solid'
            },
            cellTop: cellTopNorm.item,
            tabRight: tabRightNorm.item,
            gridContainer: normalizedGrid,
            assistLine: assistLineNorm.item
        },
        isValid
    };
}

export function buildLocalStyleOverridesFromDraft(draft: StyleInjectionDraft): {
    overrides: LocalStyleOverrides;
    mask: LocalStyleOverrideMask;
} {
    const allowMarkFill = markFillEnabled();
    const allowLineBackground = markLineBackgroundEnabled();
    const normalizedMarkStyles = ensureMarkDraftSeriesCount(state.markStylesDraft);
    const markStrokeEnabledByIndex = ensureMarkStrokeLinkStateCount(normalizedMarkStyles.length).map((linked) => !linked);
    const markStrokeSidesByIndex = ensureMarkStrokeSidesStateCount(normalizedMarkStyles.length).map((item) => ({ ...item }));
    const sharedStackedStroke = resolveStackedSharedStrokeState(
        normalizedMarkStyles,
        markStrokeEnabledByIndex.map((enabled) => !enabled),
        markStrokeSidesByIndex.map((item) => ({
            top: item.top !== false,
            left: item.left !== false,
            right: item.right !== false
        }))
    );
    if (sharedStackedStroke) {
        for (let i = 0; i < markStrokeEnabledByIndex.length; i++) {
            markStrokeEnabledByIndex[i] = !sharedStackedStroke.sourceLinked;
        }
        for (let i = 0; i < markStrokeSidesByIndex.length; i++) {
            markStrokeSidesByIndex[i] = { ...sharedStackedStroke.sourceSides };
        }
    }
    const markStrokeEnabledAtIndex = (index: number) => (
        markFillEnabled()
            ? Boolean(sharedStackedStroke
                ? !sharedStackedStroke.sourceLinked
                : (markStrokeEnabledByIndex[index] ?? false))
            : true
    );
    return {
        overrides: {
            rowColors: deriveRowColorsFromMarkStyles(
                state.chartType,
                state.markStylesDraft,
                state.rows,
                state.rowColors
            ),
            cellFillStyle: {
                color: draft.cellFill.color
            },
            ...(allowLineBackground ? {
                lineBackgroundStyle: {
                    color: draft.lineBackground.color,
                    visible: draft.lineBackground.visible
                }
            } : {}),
            cellTopStyle: {
                color: draft.cellTop.color,
                thickness: draft.cellTop.thickness,
                visible: draft.cellTop.visible,
                strokeStyle: draft.cellTop.strokeStyle
            },
            tabRightStyle: {
                color: draft.tabRight.color,
                thickness: draft.tabRight.thickness,
                visible: draft.tabRight.visible,
                strokeStyle: draft.tabRight.strokeStyle
            },
            gridContainerStyle: {
                color: draft.gridContainer.color,
                thickness: draft.gridContainer.thickness,
                visible: draft.gridContainer.visible,
                strokeStyle: draft.gridContainer.strokeStyle,
                enableIndividualStroke: true,
                sides: {
                    top: draft.gridContainer.sides.top,
                    right: draft.gridContainer.sides.right,
                    bottom: draft.gridContainer.sides.bottom,
                    left: draft.gridContainer.sides.left
                }
            },
            assistLineStyle: {
                color: draft.assistLine.color,
                thickness: draft.assistLine.thickness,
                strokeStyle: draft.assistLine.strokeStyle
            },
            markStyle: {
                fillColor: allowMarkFill ? draft.mark.fillColor : undefined,
                strokeColor: sharedStackedStroke ? sharedStackedStroke.sourceStyle.strokeColor : draft.mark.strokeColor,
                lineBackgroundColor: allowLineBackground ? draft.mark.lineBackgroundColor : undefined,
                lineBackgroundOpacity: allowLineBackground ? Math.max(0, Math.min(1, draft.mark.lineBackgroundOpacity / 100)) : undefined,
                lineBackgroundVisible: allowLineBackground ? draft.mark.lineBackgroundVisible : undefined,
                thickness: sharedStackedStroke ? sharedStackedStroke.sourceStyle.thickness : draft.mark.thickness,
                strokeStyle: sharedStackedStroke ? sharedStackedStroke.sourceStyle.strokeStyle : draft.mark.strokeStyle,
                enabled: markStrokeEnabledAtIndex(Math.max(0, Math.min(state.activeMarkStyleIndex, Math.max(0, markStrokeEnabledByIndex.length - 1)))),
                sides: sharedStackedStroke ? sharedStackedStroke.sourceSides : getActiveMarkStrokeSides()
            },
            markStyles: normalizedMarkStyles.map((item, index) => ({
                fillColor: allowMarkFill ? item.fillColor : undefined,
                strokeColor: sharedStackedStroke ? sharedStackedStroke.sourceStyle.strokeColor : item.strokeColor,
                lineBackgroundColor: allowLineBackground ? item.lineBackgroundColor : undefined,
                lineBackgroundOpacity: allowLineBackground ? Math.max(0, Math.min(1, item.lineBackgroundOpacity / 100)) : undefined,
                lineBackgroundVisible: allowLineBackground ? item.lineBackgroundVisible : undefined,
                thickness: sharedStackedStroke ? sharedStackedStroke.sourceStyle.thickness : item.thickness,
                strokeStyle: sharedStackedStroke ? sharedStackedStroke.sourceStyle.strokeStyle : item.strokeStyle,
                enabled: markStrokeEnabledAtIndex(index),
                sides: sharedStackedStroke
                    ? sharedStackedStroke.sourceSides
                    : (markStrokeSidesByIndex[index] || { ...DEFAULT_MARK_STROKE_SIDES })
            })),
            markStrokeEnabledByIndex,
            markStrokeSidesByIndex,
            colColors: ensureColHeaderColorsLength(state.chartType === 'stackedBar'
                ? getTotalStackedCols()
                : getGridColsForChart(state.chartType, state.cols)).slice(),
            colColorModes: ensureColHeaderColorModesLength(state.chartType === 'stackedBar'
                ? getTotalStackedCols()
                : getGridColsForChart(state.chartType, state.cols)).slice(),
            colPaintStyleIds: ensureColHeaderPaintStyleIdsLength(state.chartType === 'stackedBar'
                ? getTotalStackedCols()
                : getGridColsForChart(state.chartType, state.cols)).slice(),
            colColorEnabled: ensureColHeaderColorEnabledLength(state.chartType === 'stackedBar'
                ? getTotalStackedCols()
                : getGridColsForChart(state.chartType, state.cols)).slice(),
            rowStrokeStyles: state.rowStrokeStyles,
            colStrokeStyle: state.colStrokeStyle || undefined
        },
        mask: {
            rowColors: true,
            colColors: true,
            colColorModes: true,
            colPaintStyleIds: true,
            colColorEnabled: true,
            cellFillStyle: true,
            lineBackgroundStyle: allowLineBackground,
            cellTopStyle: true,
            tabRightStyle: true,
            gridContainerStyle: true,
            assistLineStyle: true,
            markStyle: true,
            markStyles: true,
            markStrokeEnabledByIndex: true,
            markStrokeSidesByIndex: true,
            rowStrokeStyles: true,
            colStrokeStyle: true
        }
    };
}
