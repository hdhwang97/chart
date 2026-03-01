import { ui } from './dom';
import {
    type AssistLineStyleInjectionDraftItem,
    DEFAULT_STYLE_INJECTION_DRAFT,
    DEFAULT_STYLE_INJECTION_ITEM,
    type GridStyleInjectionDraftItem,
    type MarkStyleInjectionDraftItem,
    type StyleInjectionDraft,
    type StyleInjectionDraftItem,
    ensureColHeaderColorEnabledLength,
    ensureColHeaderColorsLength,
    getGridColsForChart,
    getRowColor,
    getTotalStackedCols,
    state,
    normalizeHexColorInput
} from './state';
import type {
    AssistLineInjectionStyle,
    CellFillInjectionStyle,
    GridStrokeInjectionStyle,
    MarkInjectionStyle,
    RowStrokeStyle,
    SideStrokeInjectionStyle,
    StyleTemplateItem,
    StyleTemplatePayload,
    StrokeInjectionPayload,
    StrokeStyleSnapshot
} from '../shared/style-types';

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

let styleColorPicker: any = null;
let styleColorPopoverOpen = false;
let styleColorTargetInput: HTMLInputElement | null = null;
let isSyncingStyleColorPicker = false;

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
    const rounded = Math.round(n);
    return Math.max(THICKNESS_MIN, Math.min(THICKNESS_MAX, rounded));
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

function getHeaderColorForSeries(seriesIndex: number): string {
    const sourceIndex = state.chartType === 'stackedBar' ? seriesIndex + 1 : seriesIndex;
    return normalizeHexColorInput(state.rowColors[sourceIndex]) || DEFAULT_STYLE_INJECTION_DRAFT.mark.fillColor;
}

function buildMarkStylesFromRowHeaders(): MarkStyleInjectionDraftItem[] {
    const count = getDefaultSeriesCountFromState();
    const next: MarkStyleInjectionDraftItem[] = [];
    for (let i = 0; i < count; i++) {
        const color = getHeaderColorForSeries(i);
        next.push({
            fillColor: color,
            strokeColor: color,
            thickness: DEFAULT_STYLE_INJECTION_DRAFT.mark.thickness,
            strokeStyle: DEFAULT_STYLE_INJECTION_DRAFT.mark.strokeStyle
        });
    }
    return next;
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

function getActiveMarkDraft(): MarkStyleInjectionDraftItem {
    const styles = state.markStylesDraft;
    const idx = Math.max(0, Math.min(state.activeMarkStyleIndex, styles.length - 1));
    return styles[idx] || { ...DEFAULT_STYLE_INJECTION_DRAFT.mark };
}

function syncMarkIndexSelector() {
    const select = ui.styleMarkIndexInput;
    const count = Math.max(1, state.markStylesDraft.length);
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
    if (input === ui.styleCellFillColorInput) return 'Cell Fill';
    if (input === ui.styleMarkFillColorInput) return 'Mark Fill';
    if (input === ui.styleMarkStrokeColorInput) return 'Mark Stroke';
    if (input === ui.styleCellTopColorInput) return 'Cell Top';
    if (input === ui.styleTabRightColorInput) return 'Tab Right';
    if (input === ui.styleGridColorInput) return 'Grid';
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
    styleColorPicker = new iro.ColorPicker(ui.styleColorWheel, {
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
        if (!styleColorTargetInput) return;
        if (isSyncingStyleColorPicker) return;
        const hex = normalizeHexColorInput(color?.hexString || '') || toHex6FromRgb(color);
        if (!hex) return;
        applyStyleColorToTarget(hex);
    });
}

function positionStyleColorPopover(anchorRect: DOMRect) {
    const pop = ui.styleColorPopover;
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

function updateStyleColorPopoverUi(input: HTMLInputElement, colorHex: string) {
    const color = normalizeHexColorInput(colorHex) || DEFAULT_STYLE_INJECTION_ITEM.color;
    ui.styleColorPopoverTitle.textContent = resolveStyleColorLabel(input);
    ui.styleColorPreview.style.backgroundColor = color;
    ui.styleColorHexInput.value = color;
    ui.styleColorHexInput.classList.remove('style-color-hex-error');

    if (styleColorPicker) {
        isSyncingStyleColorPicker = true;
        styleColorPicker.color.hexString = color;
        isSyncingStyleColorPicker = false;
    }
}

function closeStyleColorPopover() {
    styleColorPopoverOpen = false;
    styleColorTargetInput = null;
    ui.styleColorPopover.classList.add('hidden');
    ui.styleColorHexInput.classList.remove('style-color-hex-error');
}

export function forceCloseStyleColorPopover() {
    closeStyleColorPopover();
}

export function commitStyleColorPopoverIfOpen() {
    if (!styleColorPopoverOpen || !styleColorTargetInput) return false;
    const candidate = normalizeHexColorInput(ui.styleColorHexInput.value)
        || normalizeHexColorInput(styleColorTargetInput.value);
    if (!candidate) {
        ui.styleColorHexInput.classList.add('style-color-hex-error');
        return false;
    }
    const applied = applyStyleColorToTarget(candidate);
    closeStyleColorPopover();
    return applied;
}

function applyStyleColorToTarget(hex: string) {
    if (!styleColorTargetInput) return false;
    const normalized = normalizeHexColorInput(hex);
    if (!normalized) {
        ui.styleColorHexInput.classList.add('style-color-hex-error');
        return false;
    }

    styleColorTargetInput.value = normalized;
    ui.styleColorPreview.style.backgroundColor = normalized;
    ui.styleColorHexInput.value = normalized;
    ui.styleColorHexInput.classList.remove('style-color-hex-error');
    const swatch = getHexPreviewElement(styleColorTargetInput);
    if (swatch) updateHexPreview(styleColorTargetInput, swatch, getHexPreviewFallback(styleColorTargetInput));
    styleColorTargetInput.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

function openStyleColorPopover(input: HTMLInputElement) {
    initializeStyleColorPicker();
    styleColorTargetInput = input;
    styleColorPopoverOpen = true;
    ui.styleColorPopover.classList.remove('hidden');
    updateStyleColorPopoverUi(input, input.value);
    positionStyleColorPopover(input.getBoundingClientRect());
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
    const thicknessValid = Number.isFinite(thicknessRaw) && Number.isInteger(thicknessRaw) && thicknessRaw >= THICKNESS_MIN && thicknessRaw <= THICKNESS_MAX;
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
    const thicknessValid = Number.isFinite(thicknessRaw) && Number.isInteger(thicknessRaw) && thicknessRaw >= THICKNESS_MIN && thicknessRaw <= THICKNESS_MAX;
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
    const resolvedMarkStylesRaw = savedMarks.length > 0
        ? savedMarks
        : (extractedMarks.length > 0 ? extractedMarks : rowHeaderDerivedMarks);
    const resolvedMarkStyles = ensureMarkDraftSeriesCount(
        resolvedMarkStylesRaw.length > 0
            ? resolvedMarkStylesRaw.map((item) => draftItemFromMarkStyle(item, DEFAULT_STYLE_INJECTION_DRAFT.mark))
            : [draftItemFromMarkStyle(savedMark || extractedMark, DEFAULT_STYLE_INJECTION_DRAFT.mark)]
    );
    state.markStylesDraft = resolvedMarkStyles;
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

    if (styleColorPopoverOpen && styleColorTargetInput) {
        updateStyleColorPopoverUi(styleColorTargetInput, styleColorTargetInput.value);
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
    const markFillValid = Boolean(normalizeHexColorInput(ui.styleMarkFillColorInput.value));
    const markStrokeValid = Boolean(normalizeHexColorInput(ui.styleMarkStrokeColorInput.value));
    const markThicknessRaw = Number(ui.styleMarkThicknessInput.value);
    const markThicknessValid = Number.isFinite(markThicknessRaw) && Number.isInteger(markThicknessRaw) && markThicknessRaw >= THICKNESS_MIN && markThicknessRaw <= THICKNESS_MAX;
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
    setInputError(ui.styleMarkFillColorInput, !markFillValid);
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
                fillColor: normalizeHexColorInput(ui.styleMarkFillColorInput.value) || draft.mark.fillColor,
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
    const headerDerived = buildMarkStylesFromRowHeaders();
    const previous = ensureMarkDraftSeriesCount(state.markStylesDraft);
    const merged = headerDerived.map((item, idx) => ({
        ...(previous[idx] || DEFAULT_STYLE_INJECTION_DRAFT.mark),
        fillColor: item.fillColor,
        strokeColor: item.strokeColor
    }));
    state.markStylesDraft = ensureMarkDraftSeriesCount(merged);
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
        markStyleInjectionDirty();
        const normalized = validateStyleTabDraft(readStyleTabDraft());
        setStyleInjectionDraft(normalized.draft);
        syncAllHexPreviewsFromDom();
        emitStyleDraftUpdated();
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
        markStyleInjectionDirty();
        const normalized = validateStyleTabDraft(readStyleTabDraft());
        setStyleInjectionDraft(normalized.draft);
        emitStyleDraftUpdated();
    });

    [ui.styleCellFillColorInput, ui.styleMarkFillColorInput, ui.styleMarkStrokeColorInput, ui.styleCellTopColorInput, ui.styleTabRightColorInput, ui.styleGridColorInput, ui.styleAssistLineColorInput].forEach((input) => {
        input.addEventListener('focus', () => openStyleColorPopover(input));
        input.addEventListener('click', () => openStyleColorPopover(input));
    });

    ui.styleColorPopover.addEventListener('click', (e) => e.stopPropagation());
    ui.styleColorHexInput.addEventListener('input', () => {
        if (!styleColorTargetInput) return;
        const normalized = normalizeHexColorInput(ui.styleColorHexInput.value);
        if (!normalized) {
            ui.styleColorHexInput.classList.add('style-color-hex-error');
            return;
        }
        applyStyleColorToTarget(normalized);
    });
    ui.styleColorHexInput.addEventListener('blur', () => {
        if (!styleColorTargetInput) return;
        updateStyleColorPopoverUi(styleColorTargetInput, styleColorTargetInput.value);
    });
    ui.styleColorSaveBtn.addEventListener('click', () => {
        commitStyleColorPopoverIfOpen();
    });

    document.addEventListener('click', (e) => {
        if (!styleColorPopoverOpen) return;
        const target = e.target as Node | null;
        if (!target) return;
        if (ui.styleColorPopover.contains(target)) return;
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
        closeStyleColorPopover();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && styleColorPopoverOpen) {
            closeStyleColorPopover();
        }
    });

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
