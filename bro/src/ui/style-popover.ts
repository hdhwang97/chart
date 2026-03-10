import { type MarkStyleInjectionDraftItem } from './state';
import { clampOpacityPercent, cloneDraft, ensureMarkDraftSeriesCount, getActiveMarkDraft, setActiveMarkStrokeLinked, isActiveMarkStrokeLinked, toHex6FromRgb } from './style-normalization';
import { emitStyleDraftUpdated, getHexPreviewElement, getHexPreviewFallback, getStyleColorInputs, getStyleFormInputsForSnapshot, hydrateStyleTab, markStyleInjectionDirty, resolveStyleColorLabel, setStyleInjectionDraft, syncAllHexPreviewsFromDom, syncStyleDraftFromDomAndEmit, updateHexPreview } from './style-tab';
import { DEFAULT_STYLE_INJECTION_DRAFT, DEFAULT_STYLE_INJECTION_ITEM, ensureColHeaderColorEnabledLength, ensureColHeaderColorModesLength, ensureColHeaderColorsLength, ensureColHeaderPaintStyleIdsLength, getGridColsForChart, getRowColor, normalizeHexColorInput, recomputeEffectiveStyleSnapshot, setLocalStyleOverrideField, state } from './state';
import { ui } from './dom';

import type { ColorMode, PaintStyleSelection } from '../shared/style-types';
import type { StylePreviewTarget } from './preview';

declare const iro: any;
const STYLE_COLOR_POPOVER_MARGIN = 8;
const THICKNESS_MIN = 0;
const THICKNESS_MAX = 20;

type StyleItemPopoverTarget = StylePreviewTarget | 'input-color';

type StylePopoverConfig = {
    title: string;
    primaryLabel: string;
    primaryInput: HTMLInputElement;
    primaryValue?: string;
    secondaryLabel?: string;
    secondaryInput?: HTMLInputElement;
    strokeStyleInput?: HTMLSelectElement;
    thicknessInput?: HTMLInputElement;
    opacityInput?: HTMLInputElement;
    visibleInput?: HTMLInputElement;
    enableOverride?: boolean;
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

type ColumnPopoverSnapshot = {
    colIndex: number;
    color: string;
    enabled: boolean;
    mode: ColorMode;
    styleId: string | null;
};

type PopoverSegment = 'mark' | 'column' | 'background';
type BackgroundPopoverTarget = 'cell-fill' | 'line-background' | 'cell-top' | 'tab-right' | 'grid' | 'assist-line';

type PopoverNavigatorState = {
    segment: PopoverSegment;
    index: number;
};

type PopoverSessionSnapshot = {
    styleFormSnapshot: StyleFormSnapshot;
    styleInjectionDraft: any;
    markStylesDraft: any[];
    rowColors: string[];
    colHeaderColors: string[];
    colHeaderColorEnabled: boolean[];
    colHeaderColorModes: ColorMode[];
    colHeaderPaintStyleIds: Array<string | null>;
    activeMarkStyleIndex: number;
    markStrokeLinkByIndex: boolean[];
};

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export let styleColorPicker: any = null;
export let styleItemPopoverOpen = false;
export let styleItemPopoverMode: ColorMode = 'hex';
export let styleItemPopoverConfig: StylePopoverConfig | null = null;
export let styleItemPopoverTarget: StyleItemPopoverTarget | null = null;
export let styleItemPopoverSourceInput: HTMLInputElement | null = null;
export let styleItemPopoverSelectedStyleId: string | null = null;
export let styleItemPopoverActiveColorField: 'primary' | 'secondary' = 'primary';
export let styleItemPopoverAnchorRect: AnchorRectLike | null = null;
export let styleItemPopoverColumnIndex: number | null = null;
export let styleItemPopoverNavigator: PopoverNavigatorState | null = null;
export let styleItemPopoverSessionSnapshot: PopoverSessionSnapshot | null = null;
export let suppressOutsideCloseFromInsidePointerDown = false;
export const styleItemPopoverSegmentIndexCache: Record<PopoverSegment, number> = {
    mark: 0,
    column: 0,
    background: 0
};
export let isSyncingStyleColorPicker = false;
export let stylePopoverPaintStyles: PaintStyleSelection[] = [];

export function initializeStyleColorPicker() {
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
        if (!canApplyStylePopoverColorEdit()) return;
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

export function positionStyleItemPopover(anchorRect: AnchorRectLike) {
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

export function captureStyleFormSnapshot(): StyleFormSnapshot {
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

export function restoreStyleFormSnapshot(snapshot: StyleFormSnapshot) {
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

export function cloneMarkStylesDraft(source: MarkStyleInjectionDraftItem[]) {
    return source.map((item) => ({ ...item }));
}

export function cloneMarkStrokeLinks(source: boolean[]) {
    return source.map((item) => Boolean(item));
}

export function isBackgroundPopoverTarget(target: StyleItemPopoverTarget): target is BackgroundPopoverTarget {
    return target === 'cell-fill'
        || target === 'cell-top'
        || target === 'tab-right'
        || target === 'grid'
        || target === 'assist-line';
}

export function getBackgroundTargetLabel(target: BackgroundPopoverTarget): string {
    if (target === 'cell-fill') return 'Background';
    if (target === 'cell-top') return 'Y-axis line';
    if (target === 'tab-right') return 'X-axis line';
    if (target === 'grid') return 'Plot area';
    return 'Assist line';
}

export function getBackgroundTargetIndex(target: BackgroundPopoverTarget): number {
    return Math.max(0, getBackgroundPopoverTargets().indexOf(target));
}

export function applyLinkedColumnHighlightDom() {
    document.querySelectorAll<HTMLElement>('.col-header.style-grid-linked-col, .col-color-swatch.style-grid-linked-col')
        .forEach((node) => node.classList.remove('style-grid-linked-col'));
    if (state.stylePopoverLinkedColIndex === null || state.stylePopoverLinkedColIndex < 0) return;
    const selector = `[data-col="${state.stylePopoverLinkedColIndex}"]`;
    const header = document.querySelector<HTMLElement>(`.col-header${selector}`);
    const swatches = Array.from(document.querySelectorAll<HTMLElement>(`.col-color-swatch${selector}`));
    if (header) {
        header.classList.add('style-grid-linked-col');
        header.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    swatches.forEach((swatch) => swatch.classList.add('style-grid-linked-col'));
}

export function setStylePopoverLinkedColumn(index: number | null) {
    const next = typeof index === 'number' && Number.isFinite(index)
        ? Math.max(0, Math.floor(index))
        : null;
    state.stylePopoverLinkedColIndex = next;
    applyLinkedColumnHighlightDom();
}

export function getPopoverStepperCount(segment: PopoverSegment): number {
    if (segment === 'mark') return Math.max(1, state.markStylesDraft.length);
    if (segment === 'column') return Math.max(1, getEnabledOverrideColumnIndices().length);
    return Math.max(1, getBackgroundPopoverTargets().length);
}

export function normalizePopoverSegmentIndex(segment: PopoverSegment, index: number) {
    const max = Math.max(0, getPopoverStepperCount(segment) - 1);
    if (!Number.isFinite(index)) return 0;
    return Math.max(0, Math.min(max, Math.floor(index)));
}

export function buildPopoverSessionSnapshot(): PopoverSessionSnapshot {
    return {
        styleFormSnapshot: captureStyleFormSnapshot(),
        styleInjectionDraft: cloneDraft(state.styleInjectionDraft),
        markStylesDraft: cloneMarkStylesDraft(state.markStylesDraft),
        rowColors: state.rowColors.slice(),
        colHeaderColors: state.colHeaderColors.slice(),
        colHeaderColorEnabled: state.colHeaderColorEnabled.slice(),
        colHeaderColorModes: state.colHeaderColorModes.slice(),
        colHeaderPaintStyleIds: state.colHeaderPaintStyleIds.slice(),
        activeMarkStyleIndex: state.activeMarkStyleIndex,
        markStrokeLinkByIndex: cloneMarkStrokeLinks(state.markStrokeLinkByIndex)
    };
}

export function restorePopoverSessionSnapshot(snapshot: PopoverSessionSnapshot) {
    restoreStyleFormSnapshot(snapshot.styleFormSnapshot);
    state.markStylesDraft = cloneMarkStylesDraft(snapshot.markStylesDraft);
    state.markStrokeLinkByIndex = cloneMarkStrokeLinks(snapshot.markStrokeLinkByIndex);
    state.activeMarkStyleIndex = Math.max(0, Math.min(snapshot.activeMarkStyleIndex, Math.max(0, state.markStylesDraft.length - 1)));
    state.rowColors = snapshot.rowColors.slice();
    state.colHeaderColors = snapshot.colHeaderColors.slice();
    state.colHeaderColorEnabled = snapshot.colHeaderColorEnabled.slice();
    state.colHeaderColorModes = snapshot.colHeaderColorModes.slice();
    state.colHeaderPaintStyleIds = snapshot.colHeaderPaintStyleIds.slice();
    setStyleInjectionDraft(cloneDraft(snapshot.styleInjectionDraft));
    hydrateStyleTab(state.styleInjectionDraft);
    emitStyleDraftUpdated();
}

export function getColumnTargetCount() {
    if (state.chartType !== 'bar') return 0;
    return getGridColsForChart(state.chartType, state.cols);
}

export function getEnabledOverrideColumnIndices() {
    const totalCols = getColumnTargetCount();
    ensureColHeaderColorEnabledLength(totalCols);
    const enabled: number[] = [];
    for (let i = 0; i < totalCols; i++) {
        if (state.colHeaderColorEnabled[i]) enabled.push(i);
    }
    return enabled;
}

export function getColumnPopoverSnapshot(colIndex: number): ColumnPopoverSnapshot {
    const totalCols = getColumnTargetCount();
    ensureColHeaderColorsLength(totalCols);
    ensureColHeaderColorEnabledLength(totalCols);
    ensureColHeaderColorModesLength(totalCols);
    ensureColHeaderPaintStyleIdsLength(totalCols);

    const safeCol = Math.max(0, Math.min(totalCols - 1, Math.floor(colIndex)));
    return {
        colIndex: safeCol,
        color: normalizeHexColorInput(state.colHeaderColors[safeCol]) || getRowColor(0),
        enabled: Boolean(state.colHeaderColorEnabled[safeCol]),
        mode: state.colHeaderColorModes[safeCol] === 'paint_style' ? 'paint_style' : 'hex',
        styleId: state.colHeaderPaintStyleIds[safeCol]
    };
}

export function getActiveColumnOverrideIndex() {
    const totalCols = getColumnTargetCount();
    if (totalCols <= 0) return null;
    if (styleItemPopoverColumnIndex !== null) {
        return Math.max(0, Math.min(totalCols - 1, Math.floor(styleItemPopoverColumnIndex)));
    }
    const cached = styleItemPopoverSegmentIndexCache.column ?? 0;
    return Math.max(0, Math.min(totalCols - 1, Math.floor(cached)));
}

export function syncEnableOverrideControl() {
    const isBar = state.chartType === 'bar';
    const shouldShow = isBar && (styleItemPopoverTarget === 'mark' || styleItemPopoverTarget === 'column');
    ui.styleItemEnableRow.classList.toggle('hidden', !shouldShow);
    if (!shouldShow) return;
    const colIndex = getActiveColumnOverrideIndex();
    if (colIndex === null) {
        ui.styleItemEnableInput.checked = false;
        return;
    }
    ensureColHeaderColorEnabledLength(getColumnTargetCount());
    ui.styleItemEnableInput.checked = Boolean(state.colHeaderColorEnabled[colIndex]);
}

export function emitColumnStateUpdated() {
    const totalCols = getColumnTargetCount();
    if (totalCols <= 0) return;
    if (state.isInstanceTarget) {
        setLocalStyleOverrideField('colColors', ensureColHeaderColorsLength(totalCols).slice());
        setLocalStyleOverrideField('colColorEnabled', ensureColHeaderColorEnabledLength(totalCols).slice());
        setLocalStyleOverrideField('colColorModes', ensureColHeaderColorModesLength(totalCols).slice());
        setLocalStyleOverrideField('colPaintStyleIds', ensureColHeaderPaintStyleIdsLength(totalCols).slice());
        recomputeEffectiveStyleSnapshot();
    }
    markStyleInjectionDirty();
    emitStyleDraftUpdated();
}

export function syncColumnPopoverStateAndEmit() {
    if (styleItemPopoverTarget !== 'column' || styleItemPopoverColumnIndex === null) return;
    const totalCols = getColumnTargetCount();
    if (totalCols <= 0) return;
    ensureColHeaderColorsLength(totalCols);
    ensureColHeaderColorEnabledLength(totalCols);
    ensureColHeaderColorModesLength(totalCols);
    ensureColHeaderPaintStyleIdsLength(totalCols);
    const safeCol = Math.max(0, Math.min(totalCols - 1, Math.floor(styleItemPopoverColumnIndex)));
    const color = normalizeHexColorInput(ui.styleItemPrimaryColorInput.value)
        || normalizeHexColorInput(state.colHeaderColors[safeCol])
        || getRowColor(0);
    state.colHeaderColors[safeCol] = color;
    state.colHeaderColorEnabled[safeCol] = ui.styleItemEnableInput.checked;
    if (styleItemPopoverMode === 'paint_style' && styleItemPopoverSelectedStyleId) {
        state.colHeaderColorModes[safeCol] = 'paint_style';
        state.colHeaderPaintStyleIds[safeCol] = styleItemPopoverSelectedStyleId;
    } else {
        state.colHeaderColorModes[safeCol] = 'hex';
        state.colHeaderPaintStyleIds[safeCol] = null;
    }
    emitColumnStateUpdated();
}

export function getStylePopoverConfigForTarget(
    target: StyleItemPopoverTarget,
    sourceInput?: HTMLInputElement | null,
    colIndex?: number
): StylePopoverConfig | null {
    if (target === 'input-color') {
        if (!sourceInput) return null;
        const opacityInput =
            sourceInput === ui.styleMarkLineBackgroundColorInput
                ? ui.styleMarkLineBackgroundOpacityInput
                : undefined;
        return {
            title: resolveStyleColorLabel(sourceInput),
            primaryLabel: 'Color (HEX)',
            primaryInput: sourceInput,
            opacityInput
        };
    }
    if (target === 'cell-fill') {
        return {
            title: 'Background',
            primaryLabel: 'Background (HEX)',
            primaryInput: ui.styleCellFillColorInput
        };
    }
    if (target === 'line-background') {
        if (state.chartType !== 'line') return null;
        return {
            title: 'Line background',
            primaryLabel: 'Color (HEX)',
            primaryInput: ui.styleLineBackgroundColorInput,
            visibleInput: ui.styleLineBackgroundVisibleInput
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
    if (target === 'column') {
        if (state.chartType !== 'bar') return null;
        const totalCols = getColumnTargetCount();
        if (totalCols <= 0 || !Number.isFinite(colIndex)) return null;
        const snap = getColumnPopoverSnapshot(Number(colIndex));
        return {
            title: `Column ${snap.colIndex + 1}`,
            primaryLabel: 'Color (HEX)',
            primaryInput: ui.styleCellFillColorInput,
            primaryValue: snap.color,
            enableOverride: true
        };
    }
    return null;
}

export function updateStyleItemPopoverPreview() {
    const input = styleItemPopoverActiveColorField === 'secondary'
        ? ui.styleItemSecondaryColorInput
        : ui.styleItemPrimaryColorInput;
    const color = normalizeHexColorInput(input.value) || DEFAULT_STYLE_INJECTION_ITEM.color;
    ui.styleItemPopoverPreview.style.backgroundColor = color;
}

export function syncMarkLinkUiState() {
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
    ui.styleItemSecondaryColorInput.classList.toggle('style-item-color-input-readonly', !strokeEnabled || !canApplyStylePopoverColorEdit());
}

export function refreshStyleItemModeUi() {
    const isHex = styleItemPopoverMode === 'hex';
    const canEditColors = isHex || (styleItemPopoverMode === 'paint_style' && Boolean(styleItemPopoverSelectedStyleId));
    ui.styleItemModeTabHex.classList.toggle('is-active', isHex);
    ui.styleItemModeTabStyle.classList.toggle('is-active', !isHex);
    ui.styleItemStyleRow.classList.toggle('hidden', isHex);

    [ui.styleItemPrimaryColorInput, ui.styleItemSecondaryColorInput].forEach((input) => {
        input.readOnly = !canEditColors;
        input.classList.toggle('style-item-color-input-readonly', !canEditColors);
    });
    syncMarkLinkUiState();
}

export function canApplyStylePopoverColorEdit() {
    if (!styleItemPopoverOpen) return false;
    if (styleItemPopoverMode === 'hex') return true;
    return styleItemPopoverMode === 'paint_style' && Boolean(styleItemPopoverSelectedStyleId);
}

export function requestPaintStyleColorUpdateIfNeeded(colorHex: string) {
    if (styleItemPopoverMode !== 'paint_style') return;
    const styleId = styleItemPopoverSelectedStyleId;
    if (!styleId) return;
    const selected = stylePopoverPaintStyles.find((item) => item.id === styleId);
    if (selected?.remote) return;
    const next = normalizeHexColorInput(colorHex);
    if (!next) return;
    const current = normalizeHexColorInput(selected?.colorHex);
    if (current && current === next) return;
    parent.postMessage({ pluginMessage: { type: 'update_paint_style_color', id: styleId, colorHex: next } }, '*');
}

export function setStyleItemPaintStyleOptions() {
    const select = ui.styleItemStyleSelect;
    const list = stylePopoverPaintStyles.filter((item) => item.isSolid !== false);
    if (list.length === 0) {
        select.innerHTML = '<option value="">No local paint styles</option>';
        select.disabled = true;
        styleItemPopoverSelectedStyleId = null;
        return;
    }
    const isColumnTarget = styleItemPopoverTarget === 'column';
    const allowEmptySelection = isColumnTarget;
    select.disabled = false;
    const optionsHtml = list.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    select.innerHTML = allowEmptySelection
        ? `<option value="">Select Paint Style</option>${optionsHtml}`
        : optionsHtml;
    const exists = styleItemPopoverSelectedStyleId && list.some((item) => item.id === styleItemPopoverSelectedStyleId);
    const selected = exists
        ? styleItemPopoverSelectedStyleId
        : (allowEmptySelection ? null : list[0].id);
    styleItemPopoverSelectedStyleId = selected || null;
    select.value = selected || '';
}

export function applyStylePopoverHexInputValue(input: HTMLInputElement) {
    const config = styleItemPopoverConfig;
    if (!config) return;
    const normalized = normalizeHexColorInput(input.value);
    if (!normalized) {
        input.classList.add('style-color-hex-error');
        return;
    }
    input.classList.remove('style-color-hex-error');
    if (input === ui.styleItemPrimaryColorInput) {
        ui.styleItemPrimaryColorPreview.style.backgroundColor = normalized;
    } else if (input === ui.styleItemSecondaryColorInput) {
        ui.styleItemSecondaryColorPreview.style.backgroundColor = normalized;
    }
    if (styleItemPopoverTarget === 'column') {
        ui.styleItemPrimaryColorInput.value = normalized;
        ui.styleItemPrimaryColorPreview.style.backgroundColor = normalized;
        ui.styleItemEnableInput.checked = true;
        syncColumnPopoverStateAndEmit();
        requestPaintStyleColorUpdateIfNeeded(normalized);
        updateStyleItemPopoverPreview();
        return;
    }
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
    requestPaintStyleColorUpdateIfNeeded(normalized);
    updateStyleItemPopoverPreview();
}

export function applySelectedPaintStyleColor() {
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

export function applyQuickSwatchColor(hex: string) {
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

export function resolveNavigationTarget(
    segment: PopoverSegment,
    index: number
): { target: StyleItemPopoverTarget; seriesIndex?: number; colIndex?: number } {
    const nextIndex = normalizePopoverSegmentIndex(segment, index);
    if (segment === 'mark') {
        return { target: 'mark', seriesIndex: nextIndex };
    }
    if (segment === 'column') {
        const enabledColumns = getEnabledOverrideColumnIndices();
        const colIndex = enabledColumns[nextIndex] ?? enabledColumns[0] ?? 0;
        return { target: 'column', colIndex };
    }
    const targets = getBackgroundPopoverTargets();
    const target = targets[nextIndex] || 'cell-fill';
    return { target };
}

export function getPopoverTitleForTarget(target: StyleItemPopoverTarget): string {
    if (target === 'mark') return `Mark ${state.activeMarkStyleIndex + 1}`;
    if (target === 'column') {
        const idx = styleItemPopoverColumnIndex ?? 0;
        return `Column ${idx + 1}`;
    }
    if (isBackgroundPopoverTarget(target)) {
        return `Background: ${getBackgroundTargetLabel(target)}`;
    }
    return styleItemPopoverConfig?.title || 'Style Color';
}

export function syncPopoverNavigatorFromTarget(target: StyleItemPopoverTarget, seriesIndex?: number, colIndex?: number) {
    if (target === 'input-color' || target === 'assist-line') {
        styleItemPopoverNavigator = null;
        ui.styleItemNavRow.classList.add('hidden');
        setStylePopoverLinkedColumn(null);
        return;
    }
    if (Number.isFinite(colIndex)) {
        const enabledColumns = getEnabledOverrideColumnIndices();
        const found = enabledColumns.indexOf(Math.max(0, Math.floor(Number(colIndex))));
        styleItemPopoverSegmentIndexCache.column = normalizePopoverSegmentIndex('column', found >= 0 ? found : 0);
    }
    const segment: PopoverSegment = target === 'mark'
        ? 'mark'
        : (target === 'column' ? 'column' : 'background');
    const rawIndex = segment === 'mark'
        ? (Number.isFinite(seriesIndex) ? Number(seriesIndex) : state.activeMarkStyleIndex)
        : (segment === 'column'
            ? (() => {
                const enabledColumns = getEnabledOverrideColumnIndices();
                if (enabledColumns.length === 0) return 0;
                const requestedCol = Number.isFinite(colIndex)
                    ? Number(colIndex)
                    : (styleItemPopoverColumnIndex ?? enabledColumns[0]);
                const found = enabledColumns.indexOf(Math.max(0, Math.floor(requestedCol)));
                return found >= 0 ? found : 0;
            })()
            : (isBackgroundPopoverTarget(target)
                ? (getBackgroundPopoverTargets().includes(target) ? getBackgroundTargetIndex(target) : (styleItemPopoverSegmentIndexCache.background ?? 0))
                : 0));
    const index = normalizePopoverSegmentIndex(segment, rawIndex);
    styleItemPopoverNavigator = { segment, index };
    styleItemPopoverSegmentIndexCache[segment] = index;
}

export function syncPopoverNavigatorUi() {
    if (!styleItemPopoverOpen || !styleItemPopoverNavigator) {
        ui.styleItemNavRow.classList.add('hidden');
        setStylePopoverLinkedColumn(null);
        return;
    }
    ui.styleItemNavRow.classList.remove('hidden');
    let segment = styleItemPopoverNavigator.segment;
    const isBar = state.chartType === 'bar';
    if (segment === 'column' && !isBar) {
        segment = 'mark';
        styleItemPopoverNavigator.segment = 'mark';
        styleItemPopoverNavigator.index = normalizePopoverSegmentIndex('mark', state.activeMarkStyleIndex);
    }

    const isBackgroundSegment = segment === 'background';
    const activeOverrideCol = getActiveColumnOverrideIndex();
    const columnOverrideEnabled = activeOverrideCol !== null
        ? Boolean(ensureColHeaderColorEnabledLength(getColumnTargetCount())[activeOverrideCol])
        : false;
    const enabledColumns = getEnabledOverrideColumnIndices();
    ui.styleItemSegmentGroup.classList.toggle('hidden', isBackgroundSegment);
    ui.styleItemSegmentColumnBtn.classList.toggle('hidden', !isBar || !columnOverrideEnabled);
    if (segment === 'column' && !columnOverrideEnabled) {
        segment = 'mark';
        styleItemPopoverNavigator.segment = 'mark';
        styleItemPopoverNavigator.index = normalizePopoverSegmentIndex('mark', state.activeMarkStyleIndex);
    }
    ui.styleItemSegmentMarkBtn.classList.toggle('is-active', segment === 'mark');
    ui.styleItemSegmentColumnBtn.classList.toggle('is-active', segment === 'column');

    const count = getPopoverStepperCount(segment);
    const index = normalizePopoverSegmentIndex(segment, styleItemPopoverNavigator.index);
    styleItemPopoverNavigator.index = index;
    styleItemPopoverSegmentIndexCache[segment] = index;
    const activeColumnIndex = segment === 'column'
        ? (enabledColumns[index] ?? null)
        : null;
    setStylePopoverLinkedColumn(state.chartType === 'bar' ? activeColumnIndex : null);

    if (count <= 1) {
        ui.styleItemStepper.classList.add('hidden');
        return;
    }
    ui.styleItemStepper.classList.remove('hidden');

    if (segment === 'background') {
        const targets = getBackgroundPopoverTargets();
        const target = targets[index] || 'cell-fill';
        ui.styleItemNavLabel.textContent = getBackgroundTargetLabel(target);
    } else if (segment === 'column') {
        const colIndex = enabledColumns[index] ?? 0;
        ui.styleItemNavLabel.textContent = `Column ${colIndex + 1}`;
    } else {
        ui.styleItemNavLabel.textContent = `Mark ${index + 1}`;
    }
    ui.styleItemNavPrevBtn.disabled = index <= 0;
    ui.styleItemNavNextBtn.disabled = index >= count - 1;
}

export function navigateStyleItemPopover(segment: PopoverSegment, index: number) {
    if (!styleItemPopoverOpen) return;
    const nextIndex = normalizePopoverSegmentIndex(segment, index);
    const resolved = resolveNavigationTarget(segment, nextIndex);
    openStyleItemPopoverInternal(
        resolved.target,
        styleItemPopoverAnchorRect || { left: 0, top: 0, right: 0, bottom: 0 },
        null,
        resolved.seriesIndex,
        resolved.colIndex,
        true
    );
}

export function stepStyleItemPopoverNavigator(direction: -1 | 1) {
    if (!styleItemPopoverNavigator) return;
    const next = styleItemPopoverNavigator.index + direction;
    navigateStyleItemPopover(styleItemPopoverNavigator.segment, next);
}

export function switchStyleItemPopoverSegment(segment: PopoverSegment) {
    if (!styleItemPopoverOpen) return;
    if (segment === 'background') return;
    if (segment === 'column' && state.chartType !== 'bar') return;
    const nextIndex = styleItemPopoverSegmentIndexCache[segment] ?? 0;
    navigateStyleItemPopover(segment, nextIndex);
}

export function syncStyleItemPopoverFromConfig(config: StylePopoverConfig) {
    if (styleItemPopoverTarget === 'column' && state.chartType !== 'bar') {
        navigateStyleItemPopover('mark', state.activeMarkStyleIndex);
        return;
    }
    const primary = normalizeHexColorInput(config.primaryValue || config.primaryInput.value) || DEFAULT_STYLE_INJECTION_ITEM.color;
    ui.styleItemPopoverTitle.textContent = getPopoverTitleForTarget(styleItemPopoverTarget || 'input-color');
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

    syncEnableOverrideControl();

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

    const hasOpacity = Boolean(config.opacityInput);
    ui.styleItemOpacityRow.classList.toggle('hidden', !hasOpacity);
    if (hasOpacity && config.opacityInput) {
        ui.styleItemOpacityInput.value = config.opacityInput.value;
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
    syncPopoverNavigatorUi();
}

export function applyMarkIndexFromPreview(seriesIndex: number) {
    const count = Math.max(1, state.markStylesDraft.length);
    const nextIndex = Math.max(0, Math.min(count - 1, Math.floor(seriesIndex)));
    if (state.activeMarkStyleIndex === nextIndex) return;

    state.activeMarkStyleIndex = nextIndex;
    ui.styleMarkIndexInput.value = String(nextIndex);
    const active = getActiveMarkDraft();
    ui.styleMarkFillColorInput.value = active.fillColor;
    ui.styleMarkStrokeColorInput.value = active.strokeColor;
    ui.styleMarkLineBackgroundColorInput.value = active.lineBackgroundColor;
    ui.styleMarkStrokeStyleInput.value = active.strokeStyle;
    ui.styleMarkThicknessInput.value = String(active.thickness);
    syncAllHexPreviewsFromDom();
    syncStyleDraftFromDomAndEmit();
}

export function openStyleItemPopoverInternal(
    target: StyleItemPopoverTarget,
    anchorRect: AnchorRectLike,
    sourceInput?: HTMLInputElement | null,
    seriesIndex?: number,
    colIndex?: number,
    preserveSession = false
) {
    initializeStyleColorPicker();
    let resolvedTarget = target;
    let resolvedColIndex = colIndex;

    // In bar charts, a clicked mark should open its column popover only when that exact column has override enabled.
    if (target === 'mark' && state.chartType === 'bar') {
        const clickedCol = Number.isFinite(colIndex) ? Math.max(0, Math.floor(Number(colIndex))) : null;
        if (clickedCol !== null) {
            const totalCols = getColumnTargetCount();
            ensureColHeaderColorEnabledLength(totalCols);
            if (state.colHeaderColorEnabled[clickedCol]) {
                resolvedTarget = 'column';
                resolvedColIndex = clickedCol;
            }
        }
    }

    if (resolvedTarget === 'mark' && Number.isFinite(seriesIndex)) {
        applyMarkIndexFromPreview(Number(seriesIndex));
    }
    const config = getStylePopoverConfigForTarget(resolvedTarget, sourceInput || null, resolvedColIndex);
    if (!config) return false;

    const keepSession = styleItemPopoverOpen && preserveSession;
    if (!keepSession && styleItemPopoverOpen) {
        closeStyleItemPopover({ commit: false });
    }
    if (!styleItemPopoverSessionSnapshot) {
        styleItemPopoverSessionSnapshot = buildPopoverSessionSnapshot();
    }

    styleItemPopoverTarget = resolvedTarget;
    styleItemPopoverConfig = config;
    styleItemPopoverSourceInput = sourceInput || null;
    styleItemPopoverColumnIndex = null;
    if (resolvedTarget === 'column' && Number.isFinite(resolvedColIndex)) {
        const snapshot = getColumnPopoverSnapshot(Number(resolvedColIndex));
        if (snapshot.mode === 'paint_style' && !snapshot.styleId) {
            snapshot.mode = 'hex';
        }
        styleItemPopoverColumnIndex = snapshot.colIndex;
        styleItemPopoverMode = snapshot.mode;
        styleItemPopoverSelectedStyleId = snapshot.styleId;
    } else if (!keepSession) {
        styleItemPopoverMode = 'hex';
        styleItemPopoverSelectedStyleId = null;
    }
    syncPopoverNavigatorFromTarget(resolvedTarget, seriesIndex, resolvedColIndex);
    styleItemPopoverAnchorRect = anchorRect;
    styleItemPopoverOpen = true;

    ui.styleItemPopover.classList.remove('hidden');
    syncStyleItemPopoverFromConfig(config);
    positionStyleItemPopover(anchorRect);
    return true;
}

export function openStyleColorPopover(input: HTMLInputElement) {
    openStyleItemPopoverInternal('input-color', input.getBoundingClientRect(), input, undefined, undefined, true);
}

export function openStyleItemPopover(target: StylePreviewTarget, anchorPoint: AnchorRectLike) {
    openStyleItemPopoverInternal(target, anchorPoint, null, undefined, undefined, true);
}

export function openStyleItemPopoverWithMeta(
    target: StylePreviewTarget,
    anchorPoint: AnchorRectLike,
    meta: { seriesIndex?: number; colIndex?: number }
) {
    openStyleItemPopoverInternal(target, anchorPoint, null, meta.seriesIndex, meta.colIndex, true);
}

export function closeStyleItemPopover(options: { commit: boolean }) {
    if (!styleItemPopoverOpen) return false;
    const closingTarget = styleItemPopoverTarget;
    const sessionSnapshot = styleItemPopoverSessionSnapshot;
    if (options.commit) {
        if (closingTarget === 'column') {
            syncColumnPopoverStateAndEmit();
        } else {
            syncStyleDraftFromDomAndEmit();
        }
    }
    styleItemPopoverOpen = false;
    styleItemPopoverConfig = null;
    styleItemPopoverTarget = null;
    styleItemPopoverSourceInput = null;
    styleItemPopoverColumnIndex = null;
    styleItemPopoverSelectedStyleId = null;
    styleItemPopoverAnchorRect = null;
    styleItemPopoverNavigator = null;
    styleItemPopoverSessionSnapshot = null;
    ui.styleItemPopover.classList.add('hidden');
    ui.styleItemNavRow.classList.add('hidden');
    setStylePopoverLinkedColumn(null);
    ui.styleItemPrimaryColorInput.classList.remove('style-color-hex-error');
    ui.styleItemSecondaryColorInput.classList.remove('style-color-hex-error');
    if (!options.commit && sessionSnapshot) {
        restorePopoverSessionSnapshot(sessionSnapshot);
    }
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
        refreshStyleItemModeUi();
    }
}

export function bindStylePopoverEvents() {
    ui.styleItemPopover.addEventListener('click', (e) => e.stopPropagation());
    ui.styleItemModeTabHex.addEventListener('click', () => {
        styleItemPopoverMode = 'hex';
        refreshStyleItemModeUi();
        if (styleItemPopoverTarget === 'column') {
            syncColumnPopoverStateAndEmit();
        }
    });
    ui.styleItemModeTabStyle.addEventListener('click', () => {
        styleItemPopoverMode = 'paint_style';
        refreshStyleItemModeUi();
        document.dispatchEvent(new CustomEvent('request-paint-style-list'));
        if (styleItemPopoverTarget === 'column') {
            syncColumnPopoverStateAndEmit();
        }
    });
    ui.styleItemStyleSelect.addEventListener('change', () => {
        styleItemPopoverSelectedStyleId = ui.styleItemStyleSelect.value || null;
        refreshStyleItemModeUi();
        applySelectedPaintStyleColor();
        if (styleItemPopoverTarget === 'column') {
            syncColumnPopoverStateAndEmit();
        }
    });
    ui.styleItemSwatchBlack.addEventListener('click', () => applyQuickSwatchColor('#000000'));
    ui.styleItemSwatchGray.addEventListener('click', () => applyQuickSwatchColor('#808080'));
    ui.styleItemSwatchWhite.addEventListener('click', () => applyQuickSwatchColor('#FFFFFF'));
    ui.styleItemSegmentMarkBtn.addEventListener('click', () => switchStyleItemPopoverSegment('mark'));
    ui.styleItemSegmentColumnBtn.addEventListener('click', () => switchStyleItemPopoverSegment('column'));
    ui.styleItemNavPrevBtn.addEventListener('click', () => stepStyleItemPopoverNavigator(-1));
    ui.styleItemNavNextBtn.addEventListener('click', () => stepStyleItemPopoverNavigator(1));
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
        if (!canApplyStylePopoverColorEdit()) return;
        applyStylePopoverHexInputValue(ui.styleItemPrimaryColorInput);
    });
    ui.styleItemSecondaryColorInput.addEventListener('input', () => {
        if (!canApplyStylePopoverColorEdit()) return;
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
    const syncOpacityFromPopover = () => {
        if (!styleItemPopoverConfig?.opacityInput) return;
        styleItemPopoverConfig.opacityInput.value = String(clampOpacityPercent(ui.styleItemOpacityInput.value, 100));
        syncStyleDraftFromDomAndEmit();
    };
    ui.styleItemOpacityInput.addEventListener('input', syncOpacityFromPopover);
    ui.styleItemOpacityInput.addEventListener('change', syncOpacityFromPopover);
    ui.styleItemVisibleInput.addEventListener('change', () => {
        if (!styleItemPopoverConfig?.visibleInput) return;
        styleItemPopoverConfig.visibleInput.checked = ui.styleItemVisibleInput.checked;
        syncStyleDraftFromDomAndEmit();
    });
    ui.styleItemEnableInput.addEventListener('change', () => {
        if (state.chartType !== 'bar') return;
        if (styleItemPopoverTarget !== 'mark' && styleItemPopoverTarget !== 'column') return;
        const colIndex = getActiveColumnOverrideIndex();
        if (colIndex === null) return;
        const totalCols = getColumnTargetCount();
        ensureColHeaderColorEnabledLength(totalCols);
        state.colHeaderColorEnabled[colIndex] = ui.styleItemEnableInput.checked;
        emitColumnStateUpdated();

        if (ui.styleItemEnableInput.checked) {
            const enabledColumns = getEnabledOverrideColumnIndices();
            const stepperIndex = Math.max(0, enabledColumns.indexOf(colIndex));
            navigateStyleItemPopover('column', stepperIndex);
            return;
        }

        if (styleItemPopoverTarget === 'column') {
            navigateStyleItemPopover('mark', state.activeMarkStyleIndex);
            return;
        }
        syncPopoverNavigatorUi();
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
    ui.styleItemCancelBtn.addEventListener('click', () => {
        closeStyleItemPopover({ commit: false });
    });
    ui.styleItemCloseBtn.addEventListener('click', () => {
        closeStyleItemPopover({ commit: false });
    });
    document.addEventListener('pointerdown', (e) => {
        if (!styleItemPopoverOpen) return;
        const target = e.target as Node | null;
        suppressOutsideCloseFromInsidePointerDown = Boolean(target && ui.styleItemPopover.contains(target));
    }, true);
    document.addEventListener('click', (e) => {
        if (!styleItemPopoverOpen) return;
        const target = e.target as Node | null;
        if (!target) return;
        if (ui.styleItemPopover.contains(target)) return;
        if (suppressOutsideCloseFromInsidePointerDown) {
            suppressOutsideCloseFromInsidePointerDown = false;
            return;
        }
        const colorInputs = getStyleColorInputs();
        if (colorInputs.some((input) => input === target || input.contains(target as Node))) return;
        closeStyleItemPopover({ commit: true });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && styleItemPopoverOpen) {
            closeStyleItemPopover({ commit: true });
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
}

export function getBackgroundPopoverTargets(): BackgroundPopoverTarget[] { return ['cell-fill', 'line-background', 'cell-top', 'tab-right', 'grid', 'assist-line']; }
