import { ui } from './dom';
import {
    DEFAULT_STYLE_INJECTION_DRAFT,
    DEFAULT_STYLE_INJECTION_ITEM,
    type GridStyleInjectionDraftItem,
    type StyleInjectionDraft,
    type StyleInjectionDraftItem,
    state,
    normalizeHexColorInput
} from './state';
import type {
    GridStrokeInjectionStyle,
    RowStrokeStyle,
    SideStrokeInjectionStyle,
    StrokeInjectionPayload,
    StrokeStyleSnapshot
} from '../shared/style-types';

declare const iro: any;

const THICKNESS_MIN = 0;
const THICKNESS_MAX = 20;
const STYLE_COLOR_POPOVER_MARGIN = 8;

type SavedStylePayload = {
    savedCellBottomStyle?: unknown;
    savedTabRightStyle?: unknown;
    savedGridContainerStyle?: unknown;
};

type ExtractedStylePayload = {
    rowStrokeStyles?: unknown;
    colStrokeStyle?: unknown;
    chartContainerStrokeStyle?: unknown;
};

let styleColorPicker: any = null;
let styleColorPopoverOpen = false;
let styleColorTargetInput: HTMLInputElement | null = null;
let isSyncingStyleColorPicker = false;

function clampThickness(value: unknown, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    const rounded = Math.round(n);
    return Math.max(THICKNESS_MIN, Math.min(THICKNESS_MAX, rounded));
}

function cloneDraft(draft: StyleInjectionDraft): StyleInjectionDraft {
    return {
        cellBottom: { ...draft.cellBottom },
        tabRight: { ...draft.tabRight },
        gridContainer: {
            ...draft.gridContainer,
            sides: { ...draft.gridContainer.sides }
        }
    };
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
    if (!color && thickness === undefined && visible === undefined) return null;
    return {
        color: color || undefined,
        thickness,
        visible
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

function draftItemFromSideStyle(style: SideStrokeInjectionStyle | null, fallback: StyleInjectionDraftItem): StyleInjectionDraftItem {
    if (!style) return { ...fallback };
    const color = normalizeHexColorInput(style.color) || fallback.color;
    const baseThickness = clampThickness(style.thickness, fallback.thickness);
    const visible = typeof style.visible === 'boolean' ? style.visible : baseThickness > 0;
    return {
        color,
        thickness: visible ? baseThickness : 0,
        visible
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
        sides
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
        visible
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

function setInputError(input: HTMLInputElement, invalid: boolean) {
    if (invalid) input.classList.add('style-input-error');
    else input.classList.remove('style-input-error');
}

function resolveStyleColorLabel(input: HTMLInputElement): string {
    if (input === ui.styleCellBottomColorInput) return 'Cell Bottom';
    if (input === ui.styleTabRightColorInput) return 'Tab Right';
    if (input === ui.styleGridColorInput) return 'Grid';
    return 'Style Color';
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
        const hex = normalizeHexColorInput(color?.hexString || '');
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

    return {
        item: {
            color,
            thickness: visible ? thickness : 0,
            visible
        },
        colorValid,
        thicknessValid
    };
}

export function buildDraftFromPayload(
    saved: SavedStylePayload,
    extracted: ExtractedStylePayload
): StyleInjectionDraft {
    const rowStrokeStyles = asRowStrokeStyles(extracted.rowStrokeStyles);
    const colStroke = asStrokeSnapshot(extracted.colStrokeStyle);
    const chartContainerStroke = asStrokeSnapshot(extracted.chartContainerStrokeStyle);
    const rowZeroStroke = resolveRowZeroStroke(rowStrokeStyles);

    const extractedCellBottom = sideStyleFromSnapshot(rowZeroStroke, 'bottom');
    const extractedTabRight = sideStyleFromSnapshot(colStroke, 'right');
    const extractedGrid = gridStyleFromSnapshot(chartContainerStroke || colStroke);

    const savedCellBottom = normalizeSideStyle(saved.savedCellBottomStyle);
    const savedTabRight = normalizeSideStyle(saved.savedTabRightStyle);
    const savedGrid = normalizeGridStyle(saved.savedGridContainerStyle);

    return {
        cellBottom: draftItemFromSideStyle(savedCellBottom || extractedCellBottom, DEFAULT_STYLE_INJECTION_DRAFT.cellBottom),
        tabRight: draftItemFromSideStyle(savedTabRight || extractedTabRight, DEFAULT_STYLE_INJECTION_DRAFT.tabRight),
        gridContainer: draftItemFromGridStyle(savedGrid || extractedGrid, DEFAULT_STYLE_INJECTION_DRAFT.gridContainer)
    };
}

export function hydrateStyleTab(draft: StyleInjectionDraft) {
    ui.styleCellBottomColorInput.value = draft.cellBottom.color;
    ui.styleCellBottomThicknessInput.value = String(draft.cellBottom.thickness);
    ui.styleCellBottomVisibleInput.checked = draft.cellBottom.visible;

    ui.styleTabRightColorInput.value = draft.tabRight.color;
    ui.styleTabRightThicknessInput.value = String(draft.tabRight.thickness);
    ui.styleTabRightVisibleInput.checked = draft.tabRight.visible;

    ui.styleGridColorInput.value = draft.gridContainer.color;
    ui.styleGridThicknessInput.value = String(draft.gridContainer.thickness);
    ui.styleGridVisibleInput.checked = draft.gridContainer.visible;
    ui.styleGridSideTopInput.checked = draft.gridContainer.sides.top;
    ui.styleGridSideRightInput.checked = draft.gridContainer.sides.right;
    ui.styleGridSideBottomInput.checked = draft.gridContainer.sides.bottom;
    ui.styleGridSideLeftInput.checked = draft.gridContainer.sides.left;

    if (styleColorPopoverOpen && styleColorTargetInput) {
        updateStyleColorPopoverUi(styleColorTargetInput, styleColorTargetInput.value);
    }
}

export function readStyleTabDraft(): StyleInjectionDraft {
    const cellBottom = normalizeFromDom(
        ui.styleCellBottomColorInput,
        ui.styleCellBottomThicknessInput,
        ui.styleCellBottomVisibleInput,
        state.styleInjectionDraft.cellBottom
    ).item;

    const tabRight = normalizeFromDom(
        ui.styleTabRightColorInput,
        ui.styleTabRightThicknessInput,
        ui.styleTabRightVisibleInput,
        state.styleInjectionDraft.tabRight
    ).item;

    const gridContainer = normalizeFromDom(
        ui.styleGridColorInput,
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

    return {
        cellBottom,
        tabRight,
        gridContainer
    };
}

export function validateStyleTabDraft(draft: StyleInjectionDraft): { draft: StyleInjectionDraft; isValid: boolean } {
    const cellBottomNorm = normalizeFromDom(
        ui.styleCellBottomColorInput,
        ui.styleCellBottomThicknessInput,
        ui.styleCellBottomVisibleInput,
        draft.cellBottom
    );
    const tabRightNorm = normalizeFromDom(
        ui.styleTabRightColorInput,
        ui.styleTabRightThicknessInput,
        ui.styleTabRightVisibleInput,
        draft.tabRight
    );
    const gridNorm = normalizeFromDom(
        ui.styleGridColorInput,
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

    setInputError(ui.styleCellBottomColorInput, !cellBottomNorm.colorValid);
    setInputError(ui.styleCellBottomThicknessInput, !cellBottomNorm.thicknessValid);
    setInputError(ui.styleTabRightColorInput, !tabRightNorm.colorValid);
    setInputError(ui.styleTabRightThicknessInput, !tabRightNorm.thicknessValid);
    setInputError(ui.styleGridColorInput, !gridNorm.colorValid);
    setInputError(ui.styleGridThicknessInput, !gridNorm.thicknessValid);

    const isValid = cellBottomNorm.colorValid
        && cellBottomNorm.thicknessValid
        && tabRightNorm.colorValid
        && tabRightNorm.thicknessValid
        && gridNorm.colorValid
        && gridNorm.thicknessValid;

    return {
        draft: {
            cellBottom: cellBottomNorm.item,
            tabRight: tabRightNorm.item,
            gridContainer: normalizedGrid
        },
        isValid
    };
}

export function toStrokeInjectionPayload(draft: StyleInjectionDraft): StrokeInjectionPayload {
    return {
        cellBottomStyle: {
            color: draft.cellBottom.color,
            thickness: draft.cellBottom.thickness,
            visible: draft.cellBottom.visible
        },
        tabRightStyle: {
            color: draft.tabRight.color,
            thickness: draft.tabRight.thickness,
            visible: draft.tabRight.visible
        },
        gridContainerStyle: {
            color: draft.gridContainer.color,
            thickness: draft.gridContainer.thickness,
            visible: draft.gridContainer.visible,
            enableIndividualStroke: true,
            sides: {
                top: draft.gridContainer.sides.top,
                right: draft.gridContainer.sides.right,
                bottom: draft.gridContainer.sides.bottom,
                left: draft.gridContainer.sides.left
            }
        }
    };
}

export function setStyleInjectionDraft(draft: StyleInjectionDraft) {
    state.styleInjectionDraft = cloneDraft(draft);
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
}

export function syncStyleTabDraftFromExtracted(extracted: ExtractedStylePayload) {
    if (isStyleInjectionDirty()) return false;
    const draft = buildDraftFromPayload({}, extracted);
    setStyleInjectionDraft(draft);
    hydrateStyleTab(draft);
    return true;
}

export function bindStyleTabEvents() {
    const handleChange = () => {
        markStyleInjectionDirty();
        const normalized = validateStyleTabDraft(readStyleTabDraft());
        setStyleInjectionDraft(normalized.draft);
    };

    [
        ui.styleCellBottomColorInput,
        ui.styleCellBottomThicknessInput,
        ui.styleCellBottomVisibleInput,
        ui.styleTabRightColorInput,
        ui.styleTabRightThicknessInput,
        ui.styleTabRightVisibleInput,
        ui.styleGridColorInput,
        ui.styleGridThicknessInput,
        ui.styleGridVisibleInput,
        ui.styleGridSideTopInput,
        ui.styleGridSideRightInput,
        ui.styleGridSideBottomInput,
        ui.styleGridSideLeftInput
    ].forEach((input) => {
        input.addEventListener('input', handleChange);
        input.addEventListener('change', handleChange);
    });

    [ui.styleCellBottomColorInput, ui.styleTabRightColorInput, ui.styleGridColorInput].forEach((input) => {
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

    document.addEventListener('click', (e) => {
        if (!styleColorPopoverOpen) return;
        const target = e.target as Node | null;
        if (!target) return;
        if (ui.styleColorPopover.contains(target)) return;
        if (target === ui.styleCellBottomColorInput || target === ui.styleTabRightColorInput || target === ui.styleGridColorInput) return;
        closeStyleColorPopover();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && styleColorPopoverOpen) {
            closeStyleColorPopover();
        }
    });
}
