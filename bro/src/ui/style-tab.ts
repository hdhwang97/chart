import { ui } from './dom';
import {
    type AssistLineStyleInjectionDraftItem,
    DEFAULT_STYLE_INJECTION_DRAFT,
    DEFAULT_STYLE_INJECTION_ITEM,
    deriveRowColorsFromMarkStyles,
    ensureRowColorModesLength,
    ensureRowColorsLength,
    ensureRowPaintStyleIdsLength,
    type GridStyleInjectionDraftItem,
    type MarkStyleInjectionDraftItem,
    seedMarkStylesFromRowColorsIfNeeded,
    type StyleInjectionDraft,
    type StyleInjectionDraftItem,
    ensureColHeaderColorEnabledLength,
    ensureColHeaderColorsLength,
    getGridColsForChart,
    getRowColor,
    getTotalStackedCols,
    recomputeEffectiveStyleSnapshot,
    setLocalStyleOverrideField,
    state,
    normalizeHexColorInput
} from './state';
import type {
    AssistLineInjectionStyle,
    CellFillInjectionStyle,
    ColorMode,
    GridStrokeInjectionStyle,
    LocalStyleOverrideMask,
    LocalStyleOverrides,
    MarkInjectionStyle,
    PaintStyleSelection,
    RowStrokeStyle,
    SideStrokeInjectionStyle,
    StyleTemplateItem,
    StyleTemplatePayload,
    StrokeInjectionPayload,
    StrokeStyleSnapshot
} from '../shared/style-types';
import type { StylePreviewTarget } from './preview';

declare const iro: any;

const THICKNESS_MIN = 0;
const THICKNESS_MAX = 20;
const STYLE_COLOR_POPOVER_MARGIN = 8;
const MAX_STYLE_TEMPLATES = 20;

type SavedStylePayload = {
    savedCellFillStyle?: unknown;
    savedCellTopStyle?: unknown;
    savedTabRightStyle?: unknown;
    savedGridContainerStyle?: unknown;
    savedAssistLineStyle?: unknown;
    savedMarkStyle?: unknown;
    savedMarkStyles?: unknown;
    savedRowColors?: unknown;
};

type ExtractedStylePayload = {
    cellFillStyle?: unknown;
    markStyle?: unknown;
    markStyles?: unknown;
    rowStrokeStyles?: unknown;
    colStrokeStyle?: unknown;
    chartContainerStrokeStyle?: unknown;
    assistLineStrokeStyle?: unknown;
};

type StyleItemPopoverTarget = StylePreviewTarget | 'input-color';

type StylePopoverConfig = {
    title: string;
    primaryLabel: string;
    primaryInput: HTMLInputElement;
    secondaryLabel?: string;
    secondaryInput?: HTMLInputElement;
    strokeStyleInput?: HTMLSelectElement;
    thicknessInput?: HTMLInputElement;
    visibleInput?: HTMLInputElement;
    sides?: {
        top: HTMLInputElement;
        right: HTMLInputElement;
        bottom: HTMLInputElement;
        left: HTMLInputElement;
    };
};

type AnchorRectLike = { left: number; top: number; right: number; bottom: number };

type StyleFormSnapshot = {
    [key: string]: string | boolean;
};

let styleColorPicker: any = null;
let styleItemPopoverOpen = false;
let styleItemPopoverMode: ColorMode = 'hex';
let styleItemPopoverConfig: StylePopoverConfig | null = null;
let styleItemPopoverTarget: StyleItemPopoverTarget | null = null;
let styleItemPopoverSourceInput: HTMLInputElement | null = null;
let styleItemPopoverSnapshot: StyleFormSnapshot | null = null;
let styleItemPopoverSelectedStyleId: string | null = null;
let styleItemPopoverActiveColorField: 'primary' | 'secondary' = 'primary';
let styleItemPopoverAnchorRect: AnchorRectLike | null = null;
let isSyncingStyleColorPicker = false;
let stylePopoverPaintStyles: PaintStyleSelection[] = [];

function toHex6FromRgb(color: any): string | null {
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

function clampThickness(value: unknown, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    const normalized = Math.round(n * 100) / 100;
    return Math.max(THICKNESS_MIN, Math.min(THICKNESS_MAX, normalized));
}

function cloneDraft(draft: StyleInjectionDraft): StyleInjectionDraft {
    return {
        cellFill: { ...draft.cellFill },
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

function normalizeCellFillStyle(value: unknown): CellFillInjectionStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as CellFillInjectionStyle;
    const color = normalizeHexColorInput(source.color);
    if (!color) return null;
    return { color };
}

function extractSideThickness(stroke: StrokeStyleSnapshot | null, side: 'top' | 'right' | 'bottom' | 'left'): number | undefined {
    if (!stroke) return undefined;
    if (side === 'top' && typeof stroke.weightTop === 'number') return stroke.weightTop;
    if (side === 'right' && typeof stroke.weightRight === 'number') return stroke.weightRight;
    if (side === 'bottom' && typeof stroke.weightBottom === 'number') return stroke.weightBottom;
    if (side === 'left' && typeof stroke.weightLeft === 'number') return stroke.weightLeft;
    if (typeof stroke.weight === 'number') return stroke.weight;
    return undefined;
}

function resolveRowZeroStroke(rowStrokeStyles: RowStrokeStyle[] | null): StrokeStyleSnapshot | null {
    if (!Array.isArray(rowStrokeStyles) || rowStrokeStyles.length === 0) return null;
    const rowZero = rowStrokeStyles.find((item) => item.row === 0);
    if (rowZero?.stroke) return rowZero.stroke;
    return rowStrokeStyles[0]?.stroke || null;
}

function normalizeSideStyle(value: unknown): SideStrokeInjectionStyle | null {
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

function normalizeGridStyle(value: unknown): GridStrokeInjectionStyle | null {
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

function normalizeAssistLineStyle(value: unknown): AssistLineInjectionStyle | null {
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

function normalizeMarkStyle(value: unknown): MarkInjectionStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as MarkInjectionStyle;
    const fillColor = normalizeHexColorInput(source.fillColor);
    const strokeColor = normalizeHexColorInput(source.strokeColor);
    const thickness = Number.isFinite(Number(source.thickness)) ? clampThickness(source.thickness, DEFAULT_STYLE_INJECTION_DRAFT.mark.thickness) : undefined;
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);
    if (!fillColor && !strokeColor && thickness === undefined && !strokeStyle) return null;
    return {
        fillColor: fillColor || undefined,
        strokeColor: strokeColor || undefined,
        thickness,
        strokeStyle
    };
}

function normalizeMarkStyles(value: unknown): MarkInjectionStyle[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeMarkStyle(item))
        .filter((item): item is MarkInjectionStyle => Boolean(item));
}

function draftItemFromSideStyle(style: SideStrokeInjectionStyle | null, fallback: StyleInjectionDraftItem): StyleInjectionDraftItem {
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

function draftItemFromGridStyle(style: GridStrokeInjectionStyle | null, fallback: GridStyleInjectionDraftItem): GridStyleInjectionDraftItem {
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

function draftItemFromAssistLineStyle(
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

function draftItemFromMarkStyle(style: MarkInjectionStyle | null, fallback: MarkStyleInjectionDraftItem): MarkStyleInjectionDraftItem {
    if (!style) return { ...fallback };
    return {
        fillColor: normalizeHexColorInput(style.fillColor) || fallback.fillColor,
        strokeColor: normalizeHexColorInput(style.strokeColor) || fallback.strokeColor,
        thickness: clampThickness(style.thickness, fallback.thickness),
        strokeStyle: style.strokeStyle === 'dash' ? 'dash' : 'solid'
    };
}

function sideStyleFromSnapshot(stroke: StrokeStyleSnapshot | null, side: 'top' | 'right' | 'bottom' | 'left'): SideStrokeInjectionStyle | null {
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

function gridStyleFromSnapshot(stroke: StrokeStyleSnapshot | null): GridStrokeInjectionStyle | null {
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

function asRowStrokeStyles(value: unknown): RowStrokeStyle[] | null {
    if (!Array.isArray(value)) return null;
    return value as RowStrokeStyle[];
}

function asStrokeSnapshot(value: unknown): StrokeStyleSnapshot | null {
    if (!value || typeof value !== 'object') return null;
    return value as StrokeStyleSnapshot;
}

function assistLineStyleFromSnapshot(stroke: StrokeStyleSnapshot | null): AssistLineInjectionStyle | null {
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

function markStyleFromSnapshot(stroke: MarkInjectionStyle | null): MarkInjectionStyle | null {
    if (!stroke) return null;
    const fillColor = normalizeHexColorInput(stroke.fillColor);
    const strokeColor = normalizeHexColorInput(stroke.strokeColor);
    const thickness = Number.isFinite(Number(stroke.thickness))
        ? clampThickness(stroke.thickness, DEFAULT_STYLE_INJECTION_DRAFT.mark.thickness)
        : undefined;
    if (!fillColor && !strokeColor && thickness === undefined) return null;
    return {
        fillColor: fillColor || undefined,
        strokeColor: strokeColor || undefined,
        thickness,
        strokeStyle: stroke.strokeStyle === 'dash' ? 'dash' : 'solid'
    };
}

function getDefaultSeriesCountFromState(): number {
    if (state.chartType === 'stackedBar') {
        return Math.max(1, state.rows - 1);
    }
    return Math.max(1, state.rows);
}

function buildMarkStylesFromRowHeaders(): MarkStyleInjectionDraftItem[] {
    return seedMarkStylesFromRowColorsIfNeeded(
        state.chartType,
        state.rows,
        [],
        state.rowColors
    );
}

function ensureMarkDraftSeriesCount(source: MarkStyleInjectionDraftItem[]): MarkStyleInjectionDraftItem[] {
    const base = source.length > 0 ? source : [{ ...DEFAULT_STYLE_INJECTION_DRAFT.mark }];
    const targetCount = Math.max(1, getDefaultSeriesCountFromState());
    const next: MarkStyleInjectionDraftItem[] = [];
    for (let i = 0; i < targetCount; i++) {
        next.push({ ...(base[i] || base[base.length - 1] || DEFAULT_STYLE_INJECTION_DRAFT.mark) });
    }
    return next;
}

function ensureMarkStrokeLinkStateCount(count: number) {
    const target = Math.max(1, Math.floor(count));
    const next: boolean[] = [];
    for (let i = 0; i < target; i++) {
        const current = state.markStrokeLinkByIndex[i];
        next.push(typeof current === 'boolean' ? current : true);
    }
    state.markStrokeLinkByIndex = next;
    return state.markStrokeLinkByIndex;
}

function getActiveMarkDraft(): MarkStyleInjectionDraftItem {
    const styles = state.markStylesDraft;
    const idx = Math.max(0, Math.min(state.activeMarkStyleIndex, styles.length - 1));
    return styles[idx] || { ...DEFAULT_STYLE_INJECTION_DRAFT.mark };
}

function isActiveMarkStrokeLinked() {
    const links = ensureMarkStrokeLinkStateCount(state.markStylesDraft.length);
    const idx = Math.max(0, Math.min(state.activeMarkStyleIndex, links.length - 1));
    return Boolean(links[idx]);
}

function setActiveMarkStrokeLinked(next: boolean) {
    const links = ensureMarkStrokeLinkStateCount(state.markStylesDraft.length);
    const idx = Math.max(0, Math.min(state.activeMarkStyleIndex, links.length - 1));
    links[idx] = Boolean(next);
}

function syncMarkIndexSelector() {
    const select = ui.styleMarkIndexInput;
    const count = Math.max(1, state.markStylesDraft.length);
    ensureMarkStrokeLinkStateCount(count);
    const current = Math.max(0, Math.min(state.activeMarkStyleIndex, count - 1));
    select.innerHTML = Array.from({ length: count }, (_, i) => `<option value="${i}">Mark ${i + 1}</option>`).join('');
    select.value = String(current);
    state.activeMarkStyleIndex = current;
}

function setInputError(input: HTMLInputElement, invalid: boolean) {
    if (invalid) input.classList.add('style-input-error');
    else input.classList.remove('style-input-error');
}

function resolveStyleColorLabel(input: HTMLInputElement): string {
    if (input === ui.styleCellFillColorInput) return 'Background';
    if (input === ui.styleMarkFillColorInput) return 'Mark Fill';
    if (input === ui.styleMarkStrokeColorInput) return 'Mark Stroke';
    if (input === ui.styleCellTopColorInput) return 'Y-axis line';
    if (input === ui.styleTabRightColorInput) return 'X-axis line';
    if (input === ui.styleGridColorInput) return 'Plot area';
    if (input === ui.styleAssistLineColorInput) return 'Assist Line';
    return 'Style Color';
}

function getHexPreviewFallback(input: HTMLInputElement): string {
    if (input === ui.styleCellFillColorInput) return state.styleInjectionDraft.cellFill.color;
    if (input === ui.styleCellTopColorInput) return state.styleInjectionDraft.cellTop.color;
    if (input === ui.styleTabRightColorInput) return state.styleInjectionDraft.tabRight.color;
    if (input === ui.styleGridColorInput) return state.styleInjectionDraft.gridContainer.color;
    if (input === ui.styleMarkFillColorInput) return state.styleInjectionDraft.mark.fillColor;
    if (input === ui.styleMarkStrokeColorInput) return state.styleInjectionDraft.mark.strokeColor;
    if (input === ui.styleAssistLineColorInput) return state.styleInjectionDraft.assistLine.color;
    return DEFAULT_STYLE_INJECTION_ITEM.color;
}

function getHexPreviewElement(input: HTMLInputElement): HTMLElement | null {
    if (input === ui.styleCellFillColorInput) return ui.styleCellFillColorPreview;
    if (input === ui.styleCellTopColorInput) return ui.styleCellTopColorPreview;
    if (input === ui.styleTabRightColorInput) return ui.styleTabRightColorPreview;
    if (input === ui.styleGridColorInput) return ui.styleGridColorPreview;
    if (input === ui.styleMarkFillColorInput) return ui.styleMarkFillColorPreview;
    if (input === ui.styleMarkStrokeColorInput) return ui.styleMarkStrokeColorPreview;
    if (input === ui.styleAssistLineColorInput) return ui.styleAssistLineColorPreview;
    return null;
}

function updateHexPreview(input: HTMLInputElement, swatch: HTMLElement, fallback: string) {
    const color = normalizeHexColorInput(input.value) || normalizeHexColorInput(fallback) || DEFAULT_STYLE_INJECTION_ITEM.color;
    swatch.style.backgroundColor = color;
    swatch.title = color;
}

export function syncAllHexPreviewsFromDom() {
    const colorInputs = [
        ui.styleCellFillColorInput,
        ui.styleCellTopColorInput,
        ui.styleTabRightColorInput,
        ui.styleGridColorInput,
        ui.styleMarkFillColorInput,
        ui.styleMarkStrokeColorInput,
        ui.styleAssistLineColorInput
    ];
    colorInputs.forEach((input) => {
        const swatch = getHexPreviewElement(input);
        if (!swatch) return;
        updateHexPreview(input, swatch, getHexPreviewFallback(input));
    });
}

function initializeStyleColorPicker() {
    if (styleColorPicker || typeof iro === 'undefined') return;
    styleColorPicker = new iro.ColorPicker(ui.styleItemColorWheel, {
        width: 220,
        color: '#E5E7EB',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        layout: [
            { component: iro.ui.Wheel },
            { component: iro.ui.Slider, options: { sliderType: 'value' } }
        ]
    });

    styleColorPicker.on('color:change', (color: any) => {
        if (!styleItemPopoverOpen) return;
        if (styleItemPopoverMode !== 'hex') return;
        if (isSyncingStyleColorPicker) return;
        const hex = normalizeHexColorInput(color?.hexString || '') || toHex6FromRgb(color);
        if (!hex) return;
        const input = styleItemPopoverActiveColorField === 'secondary'
            ? ui.styleItemSecondaryColorInput
            : ui.styleItemPrimaryColorInput;
        input.value = hex;
        applyStylePopoverHexInputValue(input);
    });
}

function positionStyleItemPopover(anchorRect: AnchorRectLike) {
    const pop = ui.styleItemPopover;
    const popW = pop.offsetWidth || 256;
    const popH = pop.offsetHeight || 320;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;

    if (left + popW > window.innerWidth - STYLE_COLOR_POPOVER_MARGIN) {
        left = window.innerWidth - popW - STYLE_COLOR_POPOVER_MARGIN;
    }
    if (top + popH > window.innerHeight - STYLE_COLOR_POPOVER_MARGIN) {
        top = anchorRect.top - popH - 6;
    }

    pop.style.left = `${Math.max(STYLE_COLOR_POPOVER_MARGIN, left)}px`;
    pop.style.top = `${Math.max(STYLE_COLOR_POPOVER_MARGIN, top)}px`;
}

function getStyleFormInputsForSnapshot(): Array<HTMLInputElement | HTMLSelectElement> {
    return [
        ui.styleCellFillColorInput,
        ui.styleMarkFillColorInput,
        ui.styleMarkStrokeColorInput,
        ui.styleMarkStrokeStyleInput,
        ui.styleMarkThicknessInput,
        ui.styleCellTopColorInput,
        ui.styleCellTopStrokeStyleInput,
        ui.styleCellTopThicknessInput,
        ui.styleCellTopVisibleInput,
        ui.styleTabRightColorInput,
        ui.styleTabRightStrokeStyleInput,
        ui.styleTabRightThicknessInput,
        ui.styleTabRightVisibleInput,
        ui.styleGridColorInput,
        ui.styleGridStrokeStyleInput,
        ui.styleGridThicknessInput,
        ui.styleGridVisibleInput,
        ui.styleGridSideTopInput,
        ui.styleGridSideRightInput,
        ui.styleGridSideBottomInput,
        ui.styleGridSideLeftInput,
        ui.styleAssistLineColorInput,
        ui.styleAssistLineStrokeStyleInput,
        ui.styleAssistLineThicknessInput
    ];
}

function captureStyleFormSnapshot(): StyleFormSnapshot {
    const next: StyleFormSnapshot = {};
    getStyleFormInputsForSnapshot().forEach((input) => {
        if (input instanceof HTMLInputElement && input.type === 'checkbox') {
            next[input.id] = input.checked;
            return;
        }
        next[input.id] = input.value;
    });
    return next;
}

function restoreStyleFormSnapshot(snapshot: StyleFormSnapshot) {
    getStyleFormInputsForSnapshot().forEach((input) => {
        if (!(input.id in snapshot)) return;
        if (input instanceof HTMLInputElement && input.type === 'checkbox') {
            input.checked = Boolean(snapshot[input.id]);
            return;
        }
        const value = snapshot[input.id];
        input.value = typeof value === 'string' ? value : String(value);
    });
}

function syncStyleDraftFromDomAndEmit() {
    markStyleInjectionDirty();
    const normalized = validateStyleTabDraft(readStyleTabDraft());
    setStyleInjectionDraft(normalized.draft);
    syncRowColorsFromMarkStyles({ emitLocalOverride: true });
    syncAllHexPreviewsFromDom();
    emitStyleDraftUpdated();
}

function syncRowColorsFromMarkStyles(options: { emitLocalOverride: boolean }) {
    state.rowColors = deriveRowColorsFromMarkStyles(
        state.chartType,
        state.markStylesDraft,
        state.rows,
        state.rowColors
    );
    ensureRowColorsLength(state.rows);
    ensureRowColorModesLength(state.rows);
    ensureRowPaintStyleIdsLength(state.rows);
    if (options.emitLocalOverride && state.isInstanceTarget) {
        setLocalStyleOverrideField('rowColors', state.rowColors.slice());
        recomputeEffectiveStyleSnapshot();
    }
}

function getStylePopoverConfigForTarget(
    target: StyleItemPopoverTarget,
    sourceInput?: HTMLInputElement | null
): StylePopoverConfig | null {
    if (target === 'input-color') {
        if (!sourceInput) return null;
        return {
            title: resolveStyleColorLabel(sourceInput),
            primaryLabel: 'Color (HEX)',
            primaryInput: sourceInput
        };
    }
    if (target === 'cell-fill') {
        return {
            title: 'Background',
            primaryLabel: 'Background (HEX)',
            primaryInput: ui.styleCellFillColorInput
        };
    }
    if (target === 'cell-top') {
        return {
            title: 'Y-axis line',
            primaryLabel: 'Color (HEX)',
            primaryInput: ui.styleCellTopColorInput,
            strokeStyleInput: ui.styleCellTopStrokeStyleInput,
            thicknessInput: ui.styleCellTopThicknessInput,
            visibleInput: ui.styleCellTopVisibleInput
        };
    }
    if (target === 'tab-right') {
        return {
            title: 'X-axis line',
            primaryLabel: 'Color (HEX)',
            primaryInput: ui.styleTabRightColorInput,
            strokeStyleInput: ui.styleTabRightStrokeStyleInput,
            thicknessInput: ui.styleTabRightThicknessInput,
            visibleInput: ui.styleTabRightVisibleInput
        };
    }
    if (target === 'grid') {
        return {
            title: 'Plot area',
            primaryLabel: 'Color (HEX)',
            primaryInput: ui.styleGridColorInput,
            strokeStyleInput: ui.styleGridStrokeStyleInput,
            thicknessInput: ui.styleGridThicknessInput,
            visibleInput: ui.styleGridVisibleInput,
            sides: {
                top: ui.styleGridSideTopInput,
                right: ui.styleGridSideRightInput,
                bottom: ui.styleGridSideBottomInput,
                left: ui.styleGridSideLeftInput
            }
        };
    }
    if (target === 'assist-line') {
        return {
            title: 'Assist line',
            primaryLabel: 'Color (HEX)',
            primaryInput: ui.styleAssistLineColorInput,
            strokeStyleInput: ui.styleAssistLineStrokeStyleInput,
            thicknessInput: ui.styleAssistLineThicknessInput
        };
    }
    if (target === 'mark') {
        if (state.chartType === 'line') {
            return {
                title: `Mark ${state.activeMarkStyleIndex + 1}`,
                primaryLabel: 'Stroke (HEX)',
                primaryInput: ui.styleMarkStrokeColorInput,
                strokeStyleInput: ui.styleMarkStrokeStyleInput,
                thicknessInput: ui.styleMarkThicknessInput
            };
        }
        return {
            title: `Mark ${state.activeMarkStyleIndex + 1}`,
            primaryLabel: 'Fill (HEX)',
            primaryInput: ui.styleMarkFillColorInput,
            secondaryLabel: 'Stroke (HEX)',
            secondaryInput: ui.styleMarkStrokeColorInput,
            strokeStyleInput: ui.styleMarkStrokeStyleInput,
            thicknessInput: ui.styleMarkThicknessInput
        };
    }
    return null;
}

function updateStyleItemPopoverPreview() {
    const input = styleItemPopoverActiveColorField === 'secondary'
        ? ui.styleItemSecondaryColorInput
        : ui.styleItemPrimaryColorInput;
    const color = normalizeHexColorInput(input.value) || DEFAULT_STYLE_INJECTION_ITEM.color;
    ui.styleItemPopoverPreview.style.backgroundColor = color;
}

function syncMarkLinkUiState() {
    const isMarkTarget = styleItemPopoverTarget === 'mark' && !!styleItemPopoverConfig?.secondaryInput;
    ui.styleItemLinkRow.classList.toggle('hidden', !isMarkTarget);
    if (!isMarkTarget) {
        ui.styleItemLinkHint.classList.add('hidden');
        ui.styleItemSecondaryColorRow.classList.toggle('hidden', !styleItemPopoverConfig?.secondaryInput);
        ui.styleItemSecondaryColorInput.disabled = false;
        ui.styleItemSecondaryColorInput.classList.remove('style-item-color-input-readonly');
        return;
    }

    const linked = isActiveMarkStrokeLinked();
    const strokeEnabled = !linked;
    ui.styleItemLinkToggle.checked = strokeEnabled;
    ui.styleItemLinkHint.classList.toggle('hidden', strokeEnabled);
    ui.styleItemSecondaryColorRow.classList.toggle('hidden', !strokeEnabled);
    if (!strokeEnabled && styleItemPopoverActiveColorField === 'secondary') {
        styleItemPopoverActiveColorField = 'primary';
    }
    ui.styleItemSecondaryColorInput.disabled = !strokeEnabled;
    ui.styleItemSecondaryColorInput.classList.toggle('style-item-color-input-readonly', !strokeEnabled || styleItemPopoverMode !== 'hex');
}

function refreshStyleItemModeUi() {
    const isHex = styleItemPopoverMode === 'hex';
    ui.styleItemModeTabHex.classList.toggle('is-active', isHex);
    ui.styleItemModeTabStyle.classList.toggle('is-active', !isHex);
    ui.styleItemStyleRow.classList.toggle('hidden', isHex);

    [ui.styleItemPrimaryColorInput, ui.styleItemSecondaryColorInput].forEach((input) => {
        input.readOnly = !isHex;
        input.classList.toggle('style-item-color-input-readonly', !isHex);
    });
    syncMarkLinkUiState();
}

function setStyleItemPaintStyleOptions() {
    const select = ui.styleItemStyleSelect;
    const list = stylePopoverPaintStyles.filter((item) => item.isSolid !== false);
    if (list.length === 0) {
        select.innerHTML = '<option value="">No local paint styles</option>';
        select.disabled = true;
        styleItemPopoverSelectedStyleId = null;
        return;
    }
    select.disabled = false;
    select.innerHTML = list.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    const exists = styleItemPopoverSelectedStyleId && list.some((item) => item.id === styleItemPopoverSelectedStyleId);
    const selected = exists ? styleItemPopoverSelectedStyleId : list[0].id;
    styleItemPopoverSelectedStyleId = selected || null;
    if (selected) select.value = selected;
}

function applyStylePopoverHexInputValue(input: HTMLInputElement) {
    const config = styleItemPopoverConfig;
    if (!config) return;
    const normalized = normalizeHexColorInput(input.value);
    if (!normalized) {
        input.classList.add('style-color-hex-error');
        return;
    }
    input.classList.remove('style-color-hex-error');
    const targetInput = input === ui.styleItemSecondaryColorInput
        ? config.secondaryInput
        : config.primaryInput;
    if (!targetInput) return;

    targetInput.value = normalized;
    if (
        input === ui.styleItemPrimaryColorInput
        && styleItemPopoverTarget === 'mark'
        && config.secondaryInput
        && isActiveMarkStrokeLinked()
    ) {
        const linkedStroke = normalized;
        config.secondaryInput.value = linkedStroke;
        ui.styleItemSecondaryColorInput.value = linkedStroke;
        ui.styleItemSecondaryColorPreview.style.backgroundColor = linkedStroke;
    }
    const swatch = getHexPreviewElement(targetInput);
    if (swatch) {
        updateHexPreview(targetInput, swatch, getHexPreviewFallback(targetInput));
    }
    if (config.secondaryInput) {
        const secondarySwatch = getHexPreviewElement(config.secondaryInput);
        if (secondarySwatch) {
            updateHexPreview(config.secondaryInput, secondarySwatch, getHexPreviewFallback(config.secondaryInput));
        }
    }
    syncStyleDraftFromDomAndEmit();
    updateStyleItemPopoverPreview();
}

function applySelectedPaintStyleColor() {
    if (!styleItemPopoverConfig) return;
    const selectedId = styleItemPopoverSelectedStyleId;
    if (!selectedId) return;
    const item = stylePopoverPaintStyles.find((entry) => entry.id === selectedId);
    if (!item) return;
    const color = normalizeHexColorInput(item.colorHex);
    if (!color) return;

    ui.styleItemPrimaryColorInput.value = color;
    applyStylePopoverHexInputValue(ui.styleItemPrimaryColorInput);
    if (styleItemPopoverConfig.secondaryInput) {
        ui.styleItemSecondaryColorInput.value = color;
        applyStylePopoverHexInputValue(ui.styleItemSecondaryColorInput);
    }
}

function applyQuickSwatchColor(hex: string) {
    if (!styleItemPopoverOpen) return;
    const normalized = normalizeHexColorInput(hex);
    if (!normalized) return;
    if (styleItemPopoverMode !== 'hex') {
        styleItemPopoverMode = 'hex';
        refreshStyleItemModeUi();
    }
    const canUseSecondary = styleItemPopoverActiveColorField === 'secondary'
        && !ui.styleItemSecondaryColorRow.classList.contains('hidden')
        && !ui.styleItemSecondaryColorInput.disabled;
    const target = canUseSecondary ? ui.styleItemSecondaryColorInput : ui.styleItemPrimaryColorInput;
    target.value = normalized;
    applyStylePopoverHexInputValue(target);
    if (styleColorPicker) {
        isSyncingStyleColorPicker = true;
        styleColorPicker.color.hexString = normalized;
        isSyncingStyleColorPicker = false;
    }
}

function syncStyleItemPopoverFromConfig(config: StylePopoverConfig) {
    const primary = normalizeHexColorInput(config.primaryInput.value) || DEFAULT_STYLE_INJECTION_ITEM.color;
    ui.styleItemPopoverTitle.textContent = config.title;
    ui.styleItemPrimaryColorLabel.textContent = config.primaryLabel;
    ui.styleItemPrimaryColorInput.value = primary;
    ui.styleItemPrimaryColorPreview.style.backgroundColor = primary;
    ui.styleItemPrimaryColorInput.classList.remove('style-color-hex-error');

    const hasSecondary = Boolean(config.secondaryInput);
    ui.styleItemSecondaryColorRow.classList.toggle('hidden', !hasSecondary);
    if (hasSecondary && config.secondaryInput) {
        const secondary = normalizeHexColorInput(config.secondaryInput.value) || DEFAULT_STYLE_INJECTION_ITEM.color;
        ui.styleItemSecondaryColorLabel.textContent = config.secondaryLabel || 'Stroke (HEX)';
        ui.styleItemSecondaryColorInput.value = secondary;
        ui.styleItemSecondaryColorPreview.style.backgroundColor = secondary;
        ui.styleItemSecondaryColorInput.classList.remove('style-color-hex-error');
    }
    ui.styleItemLinkRow.classList.toggle('hidden', !(styleItemPopoverTarget === 'mark' && hasSecondary));

    const hasStroke = Boolean(config.strokeStyleInput);
    ui.styleItemStrokeRow.classList.toggle('hidden', !hasStroke);
    if (hasStroke && config.strokeStyleInput) {
        ui.styleItemStrokeStyleInput.value = config.strokeStyleInput.value === 'dash' ? 'dash' : 'solid';
    }

    const hasThickness = Boolean(config.thicknessInput);
    ui.styleItemThicknessRow.classList.toggle('hidden', !hasThickness);
    if (hasThickness && config.thicknessInput) {
        ui.styleItemThicknessInput.value = config.thicknessInput.value;
    }

    const hasVisible = Boolean(config.visibleInput);
    ui.styleItemVisibleRow.classList.toggle('hidden', !hasVisible);
    if (hasVisible && config.visibleInput) {
        ui.styleItemVisibleInput.checked = config.visibleInput.checked;
    }

    const hasSides = Boolean(config.sides);
    ui.styleItemSidesRow.classList.toggle('hidden', !hasSides);
    if (hasSides && config.sides) {
        ui.styleItemSideTop.checked = config.sides.top.checked;
        ui.styleItemSideRight.checked = config.sides.right.checked;
        ui.styleItemSideBottom.checked = config.sides.bottom.checked;
        ui.styleItemSideLeft.checked = config.sides.left.checked;
    }

    setStyleItemPaintStyleOptions();
    refreshStyleItemModeUi();
    styleItemPopoverActiveColorField = 'primary';
    if (styleItemPopoverTarget === 'mark' && hasSecondary && isActiveMarkStrokeLinked()) {
        const linkedStroke = ui.styleItemPrimaryColorInput.value;
        ui.styleItemSecondaryColorInput.value = linkedStroke;
        if (config.secondaryInput) config.secondaryInput.value = linkedStroke;
    }
    syncMarkLinkUiState();
    updateStyleItemPopoverPreview();

    if (styleColorPicker) {
        isSyncingStyleColorPicker = true;
        styleColorPicker.color.hexString = primary;
        isSyncingStyleColorPicker = false;
    }
}

function applyMarkIndexFromPreview(seriesIndex: number) {
    const count = Math.max(1, state.markStylesDraft.length);
    const nextIndex = Math.max(0, Math.min(count - 1, Math.floor(seriesIndex)));
    if (state.activeMarkStyleIndex === nextIndex) return;

    state.activeMarkStyleIndex = nextIndex;
    ui.styleMarkIndexInput.value = String(nextIndex);
    const active = getActiveMarkDraft();
    ui.styleMarkFillColorInput.value = active.fillColor;
    ui.styleMarkStrokeColorInput.value = active.strokeColor;
    ui.styleMarkStrokeStyleInput.value = active.strokeStyle;
    ui.styleMarkThicknessInput.value = String(active.thickness);
    syncAllHexPreviewsFromDom();
    syncStyleDraftFromDomAndEmit();
}

function openStyleItemPopoverInternal(
    target: StyleItemPopoverTarget,
    anchorRect: AnchorRectLike,
    sourceInput?: HTMLInputElement | null,
    seriesIndex?: number
) {
    initializeStyleColorPicker();
    if (target === 'mark' && Number.isFinite(seriesIndex)) {
        applyMarkIndexFromPreview(Number(seriesIndex));
    }
    const config = getStylePopoverConfigForTarget(target, sourceInput || null);
    if (!config) return false;

    if (styleItemPopoverOpen) {
        closeStyleItemPopover({ commit: true });
    }

    styleItemPopoverTarget = target;
    styleItemPopoverConfig = config;
    styleItemPopoverSourceInput = sourceInput || null;
    styleItemPopoverSnapshot = captureStyleFormSnapshot();
    styleItemPopoverMode = 'hex';
    styleItemPopoverSelectedStyleId = null;
    styleItemPopoverAnchorRect = anchorRect;
    styleItemPopoverOpen = true;

    ui.styleItemPopover.classList.remove('hidden');
    syncStyleItemPopoverFromConfig(config);
    positionStyleItemPopover(anchorRect);
    return true;
}

function openStyleColorPopover(input: HTMLInputElement) {
    openStyleItemPopoverInternal('input-color', input.getBoundingClientRect(), input);
}

export function openStyleItemPopover(target: StylePreviewTarget, anchorPoint: AnchorRectLike) {
    openStyleItemPopoverInternal(target, anchorPoint, null);
}

export function openStyleItemPopoverWithMeta(
    target: StylePreviewTarget,
    anchorPoint: AnchorRectLike,
    meta: { seriesIndex?: number }
) {
    openStyleItemPopoverInternal(target, anchorPoint, null, meta.seriesIndex);
}

export function closeStyleItemPopover(options: { commit: boolean }) {
    if (!styleItemPopoverOpen) return false;
    if (!options.commit && styleItemPopoverSnapshot) {
        restoreStyleFormSnapshot(styleItemPopoverSnapshot);
        syncStyleDraftFromDomAndEmit();
    } else if (options.commit) {
        // Ensure the latest popover values are reflected on preview/export before closing.
        syncStyleDraftFromDomAndEmit();
    }
    styleItemPopoverOpen = false;
    styleItemPopoverConfig = null;
    styleItemPopoverTarget = null;
    styleItemPopoverSourceInput = null;
    styleItemPopoverSnapshot = null;
    styleItemPopoverSelectedStyleId = null;
    styleItemPopoverAnchorRect = null;
    ui.styleItemPopover.classList.add('hidden');
    ui.styleItemPrimaryColorInput.classList.remove('style-color-hex-error');
    ui.styleItemSecondaryColorInput.classList.remove('style-color-hex-error');
    return true;
}

export function forceCloseStyleColorPopover() {
    closeStyleItemPopover({ commit: false });
}

export function commitStyleColorPopoverIfOpen() {
    if (!styleItemPopoverOpen) return false;
    return closeStyleItemPopover({ commit: true });
}

export function setStylePopoverPaintStyles(list: PaintStyleSelection[]) {
    stylePopoverPaintStyles = Array.isArray(list) ? list.slice() : [];
    if (styleItemPopoverOpen) {
        setStyleItemPaintStyleOptions();
    }
}

function normalizeFromDom(
    colorInput: HTMLInputElement,
    strokeStyleInput: HTMLSelectElement,
    thicknessInput: HTMLInputElement,
    visibleInput: HTMLInputElement,
    fallback: StyleInjectionDraftItem
): { item: StyleInjectionDraftItem; colorValid: boolean; thicknessValid: boolean } {
    const normalizedColor = normalizeHexColorInput(colorInput.value);
    const colorValid = Boolean(normalizedColor);
    const color = normalizedColor || fallback.color;

    const thicknessRaw = Number(thicknessInput.value);
    const thicknessValid = Number.isFinite(thicknessRaw) && thicknessRaw >= THICKNESS_MIN && thicknessRaw <= THICKNESS_MAX;
    const thickness = thicknessValid ? thicknessRaw : clampThickness(thicknessRaw, fallback.thickness);
    const visible = Boolean(visibleInput.checked);
    const strokeStyle = strokeStyleInput.value === 'dash' ? 'dash' : 'solid';

    return {
        item: {
            color,
            thickness: visible ? thickness : 0,
            visible,
            strokeStyle
        },
        colorValid,
        thicknessValid
    };
}

function normalizeColorThicknessFromDom(
    colorInput: HTMLInputElement,
    strokeStyleInput: HTMLSelectElement,
    thicknessInput: HTMLInputElement,
    fallback: AssistLineStyleInjectionDraftItem
): { item: AssistLineStyleInjectionDraftItem; colorValid: boolean; thicknessValid: boolean } {
    const normalizedColor = normalizeHexColorInput(colorInput.value);
    const colorValid = Boolean(normalizedColor);
    const color = normalizedColor || fallback.color;

    const thicknessRaw = Number(thicknessInput.value);
    const thicknessValid = Number.isFinite(thicknessRaw) && thicknessRaw >= THICKNESS_MIN && thicknessRaw <= THICKNESS_MAX;
    const thickness = thicknessValid ? thicknessRaw : clampThickness(thicknessRaw, fallback.thickness);
    const strokeStyle = strokeStyleInput.value === 'dash' ? 'dash' : 'solid';

    return {
        item: { color, thickness, strokeStyle },
        colorValid,
        thicknessValid
    };
}

function emitStyleDraftUpdated() {
    document.dispatchEvent(new CustomEvent('style-draft-updated'));
}

function formatTemplateTime(ts: number): string {
    try {
        return new Date(ts).toLocaleDateString();
    } catch {
        return '-';
    }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toSavedStylePayload(payload: StyleTemplatePayload): SavedStylePayload {
    return {
        savedCellFillStyle: payload.cellFillStyle,
        savedMarkStyle: payload.markStyle,
        savedMarkStyles: payload.markStyles,
        savedRowColors: payload.rowColors,
        savedCellTopStyle: payload.cellTopStyle,
        savedTabRightStyle: payload.tabRightStyle,
        savedGridContainerStyle: payload.gridContainerStyle,
        savedAssistLineStyle: payload.assistLineStyle
    };
}

function normalizeTemplateNameInput(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.length > 40) return null;
    return trimmed;
}

function closeTemplateNameEditor() {
    state.editingTemplateId = null;
    state.editingTemplateName = '';
}

function estimateNextTemplateName(): string {
    const names = new Set(state.styleTemplates.map((item) => item.name));
    for (let i = 1; i <= MAX_STYLE_TEMPLATES + 1; i++) {
        const candidate = `Template ${i}`;
        if (!names.has(candidate)) return candidate;
    }
    return `Template ${Date.now()}`;
}

export function buildDraftFromPayload(
    saved: SavedStylePayload,
    extracted: ExtractedStylePayload
): StyleInjectionDraft {
    const extractedCellFill = normalizeCellFillStyle(extracted.cellFillStyle);
    const extractedMark = markStyleFromSnapshot(normalizeMarkStyle(extracted.markStyle));
    const extractedMarks = normalizeMarkStyles(extracted.markStyles);
    const rowStrokeStyles = asRowStrokeStyles(extracted.rowStrokeStyles);
    const colStroke = asStrokeSnapshot(extracted.colStrokeStyle);
    const chartContainerStroke = asStrokeSnapshot(extracted.chartContainerStrokeStyle);
    const assistLineStroke = asStrokeSnapshot(extracted.assistLineStrokeStyle);
    const rowZeroStroke = resolveRowZeroStroke(rowStrokeStyles);

    const extractedCellTop = sideStyleFromSnapshot(rowZeroStroke, 'top');
    const extractedTabRight = sideStyleFromSnapshot(colStroke, 'right');
    const extractedGrid = gridStyleFromSnapshot(chartContainerStroke || colStroke);
    const extractedAssistLine = assistLineStyleFromSnapshot(assistLineStroke);

    const savedCellFill = normalizeCellFillStyle(saved.savedCellFillStyle);
    const savedMark = normalizeMarkStyle(saved.savedMarkStyle);
    const savedMarks = normalizeMarkStyles(saved.savedMarkStyles);
    const savedCellTop = normalizeSideStyle(saved.savedCellTopStyle);
    const savedTabRight = normalizeSideStyle(saved.savedTabRightStyle);
    const savedGrid = normalizeGridStyle(saved.savedGridContainerStyle);
    const savedAssistLine = normalizeAssistLineStyle(saved.savedAssistLineStyle);

    const rowHeaderDerivedMarks = buildMarkStylesFromRowHeaders().map((item) => ({
        fillColor: item.fillColor,
        strokeColor: item.strokeColor,
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
    ensureMarkStrokeLinkStateCount(state.markStylesDraft.length);
    state.activeMarkStyleIndex = Math.max(0, Math.min(state.activeMarkStyleIndex, resolvedMarkStyles.length - 1));

    return {
        cellFill: { color: (savedCellFill?.color || extractedCellFill?.color || DEFAULT_STYLE_INJECTION_DRAFT.cellFill.color) as string },
        mark: { ...getActiveMarkDraft() },
        cellTop: draftItemFromSideStyle(savedCellTop || extractedCellTop, DEFAULT_STYLE_INJECTION_DRAFT.cellTop),
        tabRight: draftItemFromSideStyle(savedTabRight || extractedTabRight, DEFAULT_STYLE_INJECTION_DRAFT.tabRight),
        gridContainer: draftItemFromGridStyle(savedGrid || extractedGrid, DEFAULT_STYLE_INJECTION_DRAFT.gridContainer),
        assistLine: draftItemFromAssistLineStyle(savedAssistLine || extractedAssistLine, DEFAULT_STYLE_INJECTION_DRAFT.assistLine)
    };
}

export function hydrateStyleTab(draft: StyleInjectionDraft) {
    ui.styleCellFillColorInput.value = draft.cellFill.color;
    syncMarkIndexSelector();
    const activeMark = getActiveMarkDraft();
    ui.styleMarkFillColorInput.value = activeMark.fillColor;
    ui.styleMarkStrokeColorInput.value = activeMark.strokeColor;
    ui.styleMarkStrokeStyleInput.value = activeMark.strokeStyle;
    ui.styleMarkThicknessInput.value = String(activeMark.thickness);
    ui.styleCellTopColorInput.value = draft.cellTop.color;
    ui.styleCellTopStrokeStyleInput.value = draft.cellTop.strokeStyle;
    ui.styleCellTopThicknessInput.value = String(draft.cellTop.thickness);
    ui.styleCellTopVisibleInput.checked = draft.cellTop.visible;

    ui.styleTabRightColorInput.value = draft.tabRight.color;
    ui.styleTabRightStrokeStyleInput.value = draft.tabRight.strokeStyle;
    ui.styleTabRightThicknessInput.value = String(draft.tabRight.thickness);
    ui.styleTabRightVisibleInput.checked = draft.tabRight.visible;

    ui.styleGridColorInput.value = draft.gridContainer.color;
    ui.styleGridStrokeStyleInput.value = draft.gridContainer.strokeStyle;
    ui.styleGridThicknessInput.value = String(draft.gridContainer.thickness);
    ui.styleGridVisibleInput.checked = draft.gridContainer.visible;
    ui.styleGridSideTopInput.checked = draft.gridContainer.sides.top;
    ui.styleGridSideRightInput.checked = draft.gridContainer.sides.right;
    ui.styleGridSideBottomInput.checked = draft.gridContainer.sides.bottom;
    ui.styleGridSideLeftInput.checked = draft.gridContainer.sides.left;

    ui.styleAssistLineColorInput.value = draft.assistLine.color;
    ui.styleAssistLineStrokeStyleInput.value = draft.assistLine.strokeStyle;
    ui.styleAssistLineThicknessInput.value = String(draft.assistLine.thickness);

    if (styleItemPopoverOpen && styleItemPopoverConfig) {
        syncStyleItemPopoverFromConfig(styleItemPopoverConfig);
    }
    syncAllHexPreviewsFromDom();
}

export function readStyleTabDraft(): StyleInjectionDraft {
    const cellFillColor = normalizeHexColorInput(ui.styleCellFillColorInput.value)
        || state.styleInjectionDraft.cellFill.color;
    const cellTop = normalizeFromDom(
        ui.styleCellTopColorInput,
        ui.styleCellTopStrokeStyleInput,
        ui.styleCellTopThicknessInput,
        ui.styleCellTopVisibleInput,
        state.styleInjectionDraft.cellTop
    ).item;

    const tabRight = normalizeFromDom(
        ui.styleTabRightColorInput,
        ui.styleTabRightStrokeStyleInput,
        ui.styleTabRightThicknessInput,
        ui.styleTabRightVisibleInput,
        state.styleInjectionDraft.tabRight
    ).item;

    const gridContainer = normalizeFromDom(
        ui.styleGridColorInput,
        ui.styleGridStrokeStyleInput,
        ui.styleGridThicknessInput,
        ui.styleGridVisibleInput,
        state.styleInjectionDraft.gridContainer
    ).item as GridStyleInjectionDraftItem;
    gridContainer.sides = {
        top: ui.styleGridSideTopInput.checked,
        right: ui.styleGridSideRightInput.checked,
        bottom: ui.styleGridSideBottomInput.checked,
        left: ui.styleGridSideLeftInput.checked
    };

    const markNormalized = normalizeMarkStyle({
        fillColor: normalizeHexColorInput(ui.styleMarkFillColorInput.value) || state.styleInjectionDraft.mark.fillColor,
        strokeColor: normalizeHexColorInput(ui.styleMarkStrokeColorInput.value) || state.styleInjectionDraft.mark.strokeColor,
        thickness: Number(ui.styleMarkThicknessInput.value),
        strokeStyle: ui.styleMarkStrokeStyleInput.value === 'dash' ? 'dash' : 'solid'
    });
    const mark: MarkStyleInjectionDraftItem = markNormalized
        ? {
            fillColor: markNormalized.fillColor || state.styleInjectionDraft.mark.fillColor,
            strokeColor: markNormalized.strokeColor || state.styleInjectionDraft.mark.strokeColor,
            thickness: typeof markNormalized.thickness === 'number' ? markNormalized.thickness : state.styleInjectionDraft.mark.thickness,
            strokeStyle: markNormalized.strokeStyle === 'dash' ? 'dash' : 'solid'
        }
        : { ...state.styleInjectionDraft.mark };
    if (state.chartType === 'line') {
        mark.fillColor = mark.strokeColor;
    }

    const styles = ensureMarkDraftSeriesCount(state.markStylesDraft);
    const idx = Math.max(0, Math.min(state.activeMarkStyleIndex, styles.length - 1));
    styles[idx] = { ...mark };
    state.markStylesDraft = styles;
    state.activeMarkStyleIndex = idx;

    return {
        cellFill: { color: cellFillColor },
        mark: { ...mark },
        cellTop,
        tabRight,
        gridContainer,
        assistLine: normalizeColorThicknessFromDom(
            ui.styleAssistLineColorInput,
            ui.styleAssistLineStrokeStyleInput,
            ui.styleAssistLineThicknessInput,
            state.styleInjectionDraft.assistLine
        ).item
    };
}

export function validateStyleTabDraft(draft: StyleInjectionDraft): { draft: StyleInjectionDraft; isValid: boolean } {
    const cellFillValid = Boolean(normalizeHexColorInput(ui.styleCellFillColorInput.value));
    const lineStrokeOnly = state.chartType === 'line';
    const markFillValid = lineStrokeOnly
        ? Boolean(normalizeHexColorInput(ui.styleMarkStrokeColorInput.value))
        : Boolean(normalizeHexColorInput(ui.styleMarkFillColorInput.value));
    const markStrokeValid = Boolean(normalizeHexColorInput(ui.styleMarkStrokeColorInput.value));
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
    setInputError(ui.styleMarkFillColorInput, !markFillValid && !lineStrokeOnly);
    setInputError(ui.styleMarkStrokeColorInput, !markStrokeValid);
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
            mark: {
                fillColor: lineStrokeOnly
                    ? (normalizeHexColorInput(ui.styleMarkStrokeColorInput.value) || draft.mark.strokeColor)
                    : (normalizeHexColorInput(ui.styleMarkFillColorInput.value) || draft.mark.fillColor),
                strokeColor: normalizeHexColorInput(ui.styleMarkStrokeColorInput.value) || draft.mark.strokeColor,
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

export function toStrokeInjectionPayload(draft: StyleInjectionDraft): StrokeInjectionPayload {
    const totalCols = state.chartType === 'stackedBar'
        ? getTotalStackedCols()
        : getGridColsForChart(state.chartType, state.cols);
    const normalizedColColors = ensureColHeaderColorsLength(totalCols).slice(0, totalCols);
    const normalizedColEnabled = ensureColHeaderColorEnabledLength(totalCols).slice(0, totalCols);
    return {
        cellFillStyle: {
            color: draft.cellFill.color
        },
        markStyle: {
            fillColor: draft.mark.fillColor,
            strokeColor: draft.mark.strokeColor,
            thickness: draft.mark.thickness,
            strokeStyle: draft.mark.strokeStyle
        },
        markStyles: ensureMarkDraftSeriesCount(state.markStylesDraft).map((item) => ({
            fillColor: item.fillColor,
            strokeColor: item.strokeColor,
            thickness: item.thickness,
            strokeStyle: item.strokeStyle
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
        colColorEnabled: normalizedColEnabled
    };
}

export function buildTemplatePayloadFromDraft(draft: StyleInjectionDraft): StyleTemplatePayload {
    return toStrokeInjectionPayload(draft);
}

export function buildLocalStyleOverridesFromDraft(draft: StyleInjectionDraft): {
    overrides: LocalStyleOverrides;
    mask: LocalStyleOverrideMask;
} {
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
                fillColor: draft.mark.fillColor,
                strokeColor: draft.mark.strokeColor,
                thickness: draft.mark.thickness,
                strokeStyle: draft.mark.strokeStyle
            },
            markStyles: ensureMarkDraftSeriesCount(state.markStylesDraft).map((item) => ({
                fillColor: item.fillColor,
                strokeColor: item.strokeColor,
                thickness: item.thickness,
                strokeStyle: item.strokeStyle
            })),
            rowStrokeStyles: state.rowStrokeStyles,
            colStrokeStyle: state.colStrokeStyle || undefined
        },
        mask: {
            rowColors: true,
            cellFillStyle: true,
            cellTopStyle: true,
            tabRightStyle: true,
            gridContainerStyle: true,
            assistLineStyle: true,
            markStyle: true,
            markStyles: true,
            rowStrokeStyles: true,
            colStrokeStyle: true
        }
    };
}

export function applyTemplateToDraft(template: StyleTemplateItem): boolean {
    const nextDraft = buildDraftFromPayload(toSavedStylePayload(template.payload), {});
    setStyleInjectionDraft(nextDraft);
    hydrateStyleTab(nextDraft);
    const totalCols = state.chartType === 'stackedBar'
        ? getTotalStackedCols()
        : getGridColsForChart(state.chartType, state.cols);
    ensureColHeaderColorsLength(totalCols);
    ensureColHeaderColorEnabledLength(totalCols);
    if (Array.isArray(template.payload.colColors)) {
        state.colHeaderColors = template.payload.colColors
            .map((color) => normalizeHexColorInput(color) || getRowColor(0))
            .slice(0, totalCols);
        ensureColHeaderColorsLength(totalCols);
    }
    if (Array.isArray(template.payload.colColorEnabled)) {
        state.colHeaderColorEnabled = template.payload.colColorEnabled
            .map((flag) => Boolean(flag))
            .slice(0, totalCols);
        ensureColHeaderColorEnabledLength(totalCols);
    }
    if (state.isInstanceTarget) {
        const draftOverrides = buildLocalStyleOverridesFromDraft(nextDraft);
        setLocalStyleOverrideField('rowColors', draftOverrides.overrides.rowColors);
        setLocalStyleOverrideField('cellFillStyle', draftOverrides.overrides.cellFillStyle);
        setLocalStyleOverrideField('cellTopStyle', draftOverrides.overrides.cellTopStyle);
        setLocalStyleOverrideField('tabRightStyle', draftOverrides.overrides.tabRightStyle);
        setLocalStyleOverrideField('gridContainerStyle', draftOverrides.overrides.gridContainerStyle);
        setLocalStyleOverrideField('assistLineStyle', draftOverrides.overrides.assistLineStyle);
        setLocalStyleOverrideField('markStyle', draftOverrides.overrides.markStyle);
        setLocalStyleOverrideField('markStyles', draftOverrides.overrides.markStyles);
        setLocalStyleOverrideField('rowStrokeStyles', draftOverrides.overrides.rowStrokeStyles);
        setLocalStyleOverrideField('colStrokeStyle', draftOverrides.overrides.colStrokeStyle);
        setLocalStyleOverrideField('colColors', ensureColHeaderColorsLength(totalCols).slice());
        setLocalStyleOverrideField('colColorEnabled', ensureColHeaderColorEnabledLength(totalCols).slice());
        recomputeEffectiveStyleSnapshot();
    }
    markStyleInjectionDirty();
    state.selectedStyleTemplateId = template.id;
    emitStyleDraftUpdated();
    renderStyleTemplateGallery();
    return true;
}

function renderTemplateCard(item: StyleTemplateItem): string {
    const selectedClass = state.selectedStyleTemplateId === item.id ? ' selected' : '';
    const inEdit = state.styleTemplateMode === 'edit';
    const editing = inEdit && state.editingTemplateId === item.id;
    const swatches = [
        item.payload.cellFillStyle?.color || '#FFFFFF',
        item.payload.markStyle?.fillColor || '#3B82F6',
        item.payload.cellTopStyle?.color || '#E5E7EB',
        item.payload.tabRightStyle?.color || '#E5E7EB',
        item.payload.gridContainerStyle?.color || '#E5E7EB',
        item.payload.assistLineStyle?.color || '#E5E7EB'
    ];
    const escapedName = escapeHtml(item.name);

    return `
<div class="style-template-card${selectedClass}" data-template-id="${item.id}">
  <div class="style-template-preview">
    ${swatches.map((color) => `<span class="style-template-swatch" style="background:${escapeHtml(color || '#E5E7EB')}"></span>`).join('')}
  </div>
  <div class="flex items-start justify-between gap-2">
    <div class="min-w-0">
      ${editing
            ? `<input class="w-full px-1.5 py-0.5 border border-border rounded text-xxs" data-template-rename-input-id="${item.id}" value="${escapeHtml(state.editingTemplateName || item.name)}" maxlength="40" />`
            : `<div class="text-xxs font-semibold text-text truncate">${escapedName}</div>`
        }
      <div class="text-[10px] text-text-sub">Updated ${formatTemplateTime(item.updatedAt)}</div>
    </div>
    ${inEdit
            ? editing
                ? `<div class="flex gap-1">
                    <button class="text-[10px] px-1.5 py-0.5 rounded border border-border text-primary hover:bg-blue-50 cursor-pointer" data-template-rename-save-id="${item.id}" type="button">Save</button>
                    <button class="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-sub hover:bg-gray-50 cursor-pointer" data-template-rename-cancel-id="${item.id}" type="button">Cancel</button>
                   </div>`
                : `<div class="flex gap-1">
                    <button class="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-sub hover:bg-gray-50 cursor-pointer" data-template-rename-id="${item.id}" type="button">Rename</button>
                    <button class="text-[10px] px-1.5 py-0.5 rounded border border-border text-danger hover:bg-red-50 cursor-pointer style-template-delete-btn" data-template-delete-id="${item.id}" type="button">Delete</button>
                   </div>`
            : ''
        }
  </div>
</div>`;
}

export function renderStyleTemplateGallery() {
    const gallery = ui.styleTemplateGallery;
    const readActive = state.styleTemplateMode === 'read';
    ui.styleTemplateModeReadBtn.className = readActive
        ? 'px-2 py-0.5 text-xxs font-semibold rounded bg-white shadow-sm text-primary transition-all border-0 cursor-pointer'
        : 'px-2 py-0.5 text-xxs font-semibold rounded text-text-sub hover:text-text bg-transparent transition-all border-0 cursor-pointer';
    ui.styleTemplateModeEditBtn.className = readActive
        ? 'px-2 py-0.5 text-xxs font-semibold rounded text-text-sub hover:text-text bg-transparent transition-all border-0 cursor-pointer'
        : 'px-2 py-0.5 text-xxs font-semibold rounded bg-white shadow-sm text-primary transition-all border-0 cursor-pointer';
    ui.styleTemplateAddBtn.disabled = state.styleTemplates.length >= MAX_STYLE_TEMPLATES;
    if (ui.styleTemplateAddBtn.disabled) ui.styleTemplateAddBtn.classList.add('read-panel-disabled');
    else ui.styleTemplateAddBtn.classList.remove('read-panel-disabled');

    if (state.styleTemplates.length === 0) {
        gallery.innerHTML = `<div class="style-template-empty">저장된 템플릿이 없습니다.</div>`;
        return;
    }
    gallery.innerHTML = state.styleTemplates.map(renderTemplateCard).join('');
}

export function setStyleTemplateList(items: StyleTemplateItem[]) {
    state.styleTemplates = Array.isArray(items) ? items : [];
    if (state.selectedStyleTemplateId && !state.styleTemplates.some((item) => item.id === state.selectedStyleTemplateId)) {
        state.selectedStyleTemplateId = null;
    }
    if (state.editingTemplateId && !state.styleTemplates.some((item) => item.id === state.editingTemplateId)) {
        closeTemplateNameEditor();
    }
    renderStyleTemplateGallery();
}

export function setStyleTemplateMode(mode: 'read' | 'edit') {
    state.styleTemplateMode = mode;
    if (mode === 'read') closeTemplateNameEditor();
    renderStyleTemplateGallery();
}

export function requestNewTemplateName(): string {
    return estimateNextTemplateName();
}

export function setStyleInjectionDraft(draft: StyleInjectionDraft) {
    state.styleInjectionDraft = cloneDraft(draft);
}

export function syncMarkStylesFromHeaderColors(emit = true) {
    const previous = ensureMarkDraftSeriesCount(state.markStylesDraft);
    if (previous.length === 0) {
        state.markStylesDraft = ensureMarkDraftSeriesCount(buildMarkStylesFromRowHeaders());
    } else {
        state.markStylesDraft = ensureMarkDraftSeriesCount(previous);
    }
    syncRowColorsFromMarkStyles({ emitLocalOverride: emit });
    ensureMarkStrokeLinkStateCount(state.markStylesDraft.length);
    state.activeMarkStyleIndex = Math.max(0, Math.min(state.activeMarkStyleIndex, state.markStylesDraft.length - 1));

    const nextDraft: StyleInjectionDraft = {
        ...state.styleInjectionDraft,
        mark: { ...getActiveMarkDraft() }
    };
    setStyleInjectionDraft(nextDraft);
    hydrateStyleTab(nextDraft);
    markStyleInjectionDirty();
    if (emit) emitStyleDraftUpdated();
}

export function markStyleInjectionDirty() {
    state.styleInjectionDirty = true;
}

export function resetStyleInjectionDirty() {
    state.styleInjectionDirty = false;
}

export function isStyleInjectionDirty() {
    return state.styleInjectionDirty;
}

export function initializeStyleTabDraft(saved: SavedStylePayload, extracted: ExtractedStylePayload) {
    const draft = buildDraftFromPayload(saved, extracted);
    setStyleInjectionDraft(draft);
    hydrateStyleTab(draft);
    resetStyleInjectionDirty();
    state.selectedStyleTemplateId = null;
    closeTemplateNameEditor();
    renderStyleTemplateGallery();
}

export function syncStyleTabDraftFromExtracted(extracted: ExtractedStylePayload) {
    if (isStyleInjectionDirty()) return false;
    const draft = buildDraftFromPayload({}, extracted);
    setStyleInjectionDraft(draft);
    hydrateStyleTab(draft);
    state.selectedStyleTemplateId = null;
    closeTemplateNameEditor();
    renderStyleTemplateGallery();
    return true;
}

export function bindStyleTabEvents() {
    const handleChange = () => {
        syncStyleDraftFromDomAndEmit();
    };

    [
        ui.styleCellFillColorInput,
        ui.styleMarkFillColorInput,
        ui.styleMarkStrokeColorInput,
        ui.styleMarkStrokeStyleInput,
        ui.styleMarkThicknessInput,
        ui.styleCellTopColorInput,
        ui.styleCellTopStrokeStyleInput,
        ui.styleCellTopThicknessInput,
        ui.styleCellTopVisibleInput,
        ui.styleTabRightColorInput,
        ui.styleTabRightStrokeStyleInput,
        ui.styleTabRightThicknessInput,
        ui.styleTabRightVisibleInput,
        ui.styleGridColorInput,
        ui.styleGridStrokeStyleInput,
        ui.styleGridThicknessInput,
        ui.styleGridVisibleInput,
        ui.styleGridSideTopInput,
        ui.styleGridSideRightInput,
        ui.styleGridSideBottomInput,
        ui.styleGridSideLeftInput,
        ui.styleAssistLineColorInput,
        ui.styleAssistLineStrokeStyleInput,
        ui.styleAssistLineThicknessInput
    ].forEach((input) => {
        input.addEventListener('input', handleChange);
        input.addEventListener('change', handleChange);
    });
    ui.styleMarkIndexInput.addEventListener('change', () => {
        const idx = Number(ui.styleMarkIndexInput.value);
        state.activeMarkStyleIndex = Number.isFinite(idx) ? Math.max(0, idx) : 0;
        const active = getActiveMarkDraft();
        ui.styleMarkFillColorInput.value = active.fillColor;
        ui.styleMarkStrokeColorInput.value = active.strokeColor;
        ui.styleMarkStrokeStyleInput.value = active.strokeStyle;
        ui.styleMarkThicknessInput.value = String(active.thickness);
        syncAllHexPreviewsFromDom();
        if (styleItemPopoverOpen && styleItemPopoverTarget === 'mark' && styleItemPopoverConfig) {
            syncStyleItemPopoverFromConfig(styleItemPopoverConfig);
        }
        syncStyleDraftFromDomAndEmit();
    });

    [ui.styleCellFillColorInput, ui.styleMarkFillColorInput, ui.styleMarkStrokeColorInput, ui.styleCellTopColorInput, ui.styleTabRightColorInput, ui.styleGridColorInput, ui.styleAssistLineColorInput].forEach((input) => {
        input.addEventListener('focus', () => openStyleColorPopover(input));
        input.addEventListener('click', () => openStyleColorPopover(input));
    });

    ui.styleItemPopover.addEventListener('click', (e) => e.stopPropagation());
    ui.styleItemModeTabHex.addEventListener('click', () => {
        styleItemPopoverMode = 'hex';
        refreshStyleItemModeUi();
    });
    ui.styleItemModeTabStyle.addEventListener('click', () => {
        styleItemPopoverMode = 'paint_style';
        refreshStyleItemModeUi();
        document.dispatchEvent(new CustomEvent('request-paint-style-list'));
    });
    ui.styleItemStyleSelect.addEventListener('change', () => {
        styleItemPopoverSelectedStyleId = ui.styleItemStyleSelect.value || null;
        applySelectedPaintStyleColor();
    });
    ui.styleItemSwatchBlack.addEventListener('click', () => applyQuickSwatchColor('#000000'));
    ui.styleItemSwatchGray.addEventListener('click', () => applyQuickSwatchColor('#808080'));
    ui.styleItemSwatchWhite.addEventListener('click', () => applyQuickSwatchColor('#FFFFFF'));
    ui.styleItemLinkToggle.addEventListener('change', () => {
        if (!styleItemPopoverOpen || styleItemPopoverTarget !== 'mark') return;
        const strokeEnabled = ui.styleItemLinkToggle.checked;
        setActiveMarkStrokeLinked(!strokeEnabled);
        syncMarkLinkUiState();
        if (!strokeEnabled) {
            const linkedStroke = normalizeHexColorInput(ui.styleItemPrimaryColorInput.value) || DEFAULT_STYLE_INJECTION_DRAFT.mark.fillColor;
            ui.styleItemSecondaryColorInput.value = linkedStroke;
            applyStylePopoverHexInputValue(ui.styleItemSecondaryColorInput);
        }
    });
    ui.styleItemPrimaryColorInput.addEventListener('focus', () => {
        styleItemPopoverActiveColorField = 'primary';
        updateStyleItemPopoverPreview();
    });
    ui.styleItemSecondaryColorInput.addEventListener('focus', () => {
        styleItemPopoverActiveColorField = 'secondary';
        updateStyleItemPopoverPreview();
    });
    ui.styleItemPrimaryColorInput.addEventListener('input', () => {
        if (!styleItemPopoverOpen || styleItemPopoverMode !== 'hex') return;
        applyStylePopoverHexInputValue(ui.styleItemPrimaryColorInput);
    });
    ui.styleItemSecondaryColorInput.addEventListener('input', () => {
        if (!styleItemPopoverOpen || styleItemPopoverMode !== 'hex') return;
        applyStylePopoverHexInputValue(ui.styleItemSecondaryColorInput);
    });
    ui.styleItemStrokeStyleInput.addEventListener('change', () => {
        if (!styleItemPopoverConfig?.strokeStyleInput) return;
        styleItemPopoverConfig.strokeStyleInput.value = ui.styleItemStrokeStyleInput.value === 'dash' ? 'dash' : 'solid';
        syncStyleDraftFromDomAndEmit();
    });
    const syncThicknessFromPopover = () => {
        if (!styleItemPopoverConfig?.thicknessInput) return;
        styleItemPopoverConfig.thicknessInput.value = ui.styleItemThicknessInput.value;
        syncStyleDraftFromDomAndEmit();
    };
    ui.styleItemThicknessInput.addEventListener('input', syncThicknessFromPopover);
    ui.styleItemThicknessInput.addEventListener('change', syncThicknessFromPopover);
    ui.styleItemVisibleInput.addEventListener('change', () => {
        if (!styleItemPopoverConfig?.visibleInput) return;
        styleItemPopoverConfig.visibleInput.checked = ui.styleItemVisibleInput.checked;
        syncStyleDraftFromDomAndEmit();
    });
    const syncSidesFromPopover = () => {
        if (!styleItemPopoverConfig?.sides) return;
        styleItemPopoverConfig.sides.top.checked = ui.styleItemSideTop.checked;
        styleItemPopoverConfig.sides.right.checked = ui.styleItemSideRight.checked;
        styleItemPopoverConfig.sides.bottom.checked = ui.styleItemSideBottom.checked;
        styleItemPopoverConfig.sides.left.checked = ui.styleItemSideLeft.checked;
        syncStyleDraftFromDomAndEmit();
    };
    ui.styleItemSideTop.addEventListener('change', syncSidesFromPopover);
    ui.styleItemSideRight.addEventListener('change', syncSidesFromPopover);
    ui.styleItemSideBottom.addEventListener('change', syncSidesFromPopover);
    ui.styleItemSideLeft.addEventListener('change', syncSidesFromPopover);
    ui.styleItemSaveBtn.addEventListener('click', () => {
        commitStyleColorPopoverIfOpen();
    });
    ui.styleItemCloseBtn.addEventListener('click', () => {
        closeStyleItemPopover({ commit: false });
    });

    document.addEventListener('click', (e) => {
        if (!styleItemPopoverOpen) return;
        const target = e.target as Node | null;
        if (!target) return;
        if (ui.styleItemPopover.contains(target)) return;
        const colorInputs = [
            ui.styleCellFillColorInput,
            ui.styleMarkFillColorInput,
            ui.styleMarkStrokeColorInput,
            ui.styleCellTopColorInput,
            ui.styleTabRightColorInput,
            ui.styleGridColorInput,
            ui.styleAssistLineColorInput
        ];
        if (colorInputs.some((input) => input === target || input.contains(target))) return;
        closeStyleItemPopover({ commit: false });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && styleItemPopoverOpen) {
            closeStyleItemPopover({ commit: false });
        }
    });
    window.addEventListener('resize', () => {
        if (!styleItemPopoverOpen || !styleItemPopoverAnchorRect) return;
        positionStyleItemPopover(styleItemPopoverAnchorRect);
    });
    ui.stepStyle.addEventListener('scroll', () => {
        if (!styleItemPopoverOpen || !styleItemPopoverAnchorRect) return;
        positionStyleItemPopover(styleItemPopoverAnchorRect);
    }, { passive: true });

    ui.styleTemplateModeReadBtn.addEventListener('click', () => setStyleTemplateMode('read'));
    ui.styleTemplateModeEditBtn.addEventListener('click', () => setStyleTemplateMode('edit'));

    ui.styleTemplateGallery.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;

        const renameBtn = target.closest<HTMLButtonElement>('[data-template-rename-id]');
        if (renameBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = renameBtn.dataset.templateRenameId;
            if (!id) return;
            const template = state.styleTemplates.find((item) => item.id === id);
            if (!template) return;
            state.editingTemplateId = id;
            state.editingTemplateName = template.name;
            renderStyleTemplateGallery();
            return;
        }

        const renameCancelBtn = target.closest<HTMLButtonElement>('[data-template-rename-cancel-id]');
        if (renameCancelBtn) {
            e.preventDefault();
            e.stopPropagation();
            closeTemplateNameEditor();
            renderStyleTemplateGallery();
            return;
        }

        const renameSaveBtn = target.closest<HTMLButtonElement>('[data-template-rename-save-id]');
        if (renameSaveBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = renameSaveBtn.dataset.templateRenameSaveId;
            if (!id) return;
            const input = ui.styleTemplateGallery.querySelector<HTMLInputElement>(`[data-template-rename-input-id="${id}"]`);
            const normalized = normalizeTemplateNameInput(input?.value || state.editingTemplateName);
            if (!normalized) {
                window.alert('템플릿 이름은 1~40자로 입력해야 합니다.');
                return;
            }
            parent.postMessage({ pluginMessage: { type: 'rename_style_template', id, name: normalized } }, '*');
            closeTemplateNameEditor();
            renderStyleTemplateGallery();
            return;
        }

        const deleteBtn = target.closest<HTMLButtonElement>('[data-template-delete-id]');
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = deleteBtn.dataset.templateDeleteId;
            if (!id) return;
            if (!window.confirm('이 템플릿을 삭제하시겠습니까?')) return;
            parent.postMessage({ pluginMessage: { type: 'delete_style_template', id } }, '*');
            return;
        }

        const card = target.closest<HTMLElement>('[data-template-id]');
        if (!card) return;
        if (state.styleTemplateMode === 'edit') return;
        const id = card.dataset.templateId;
        if (!id) return;
        const template = state.styleTemplates.find((item) => item.id === id);
        if (!template) return;
        applyTemplateToDraft(template);
    });

    ui.styleTemplateGallery.addEventListener('keydown', (e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        const input = target.closest<HTMLInputElement>('[data-template-rename-input-id]');
        if (!input) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            const id = input.dataset.templateRenameInputId;
            if (!id) return;
            const normalized = normalizeTemplateNameInput(input.value || state.editingTemplateName);
            if (!normalized) {
                window.alert('템플릿 이름은 1~40자로 입력해야 합니다.');
                return;
            }
            parent.postMessage({ pluginMessage: { type: 'rename_style_template', id, name: normalized } }, '*');
            closeTemplateNameEditor();
            renderStyleTemplateGallery();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closeTemplateNameEditor();
            renderStyleTemplateGallery();
        }
    });
}
