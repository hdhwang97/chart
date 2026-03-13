import {
    buildDraftFromPayload,
    buildMarkStylesFromRowHeaders,
    clampOpacityPercent,
    clampThickness,
    cloneDraft,
    ensureMarkDraftSeriesCount,
    ensureMarkStrokeLinkStateCount,
    getActiveMarkDraft,
    isActiveMarkStrokeLinked,
    normalizeMarkStyle,
    setActiveMarkStrokeLinked,
    toStrokeInjectionPayload,
    type ExtractedStylePayload,
    type SavedStylePayload
} from './style-normalization';
import { applyQuickSwatchColor, applySelectedPaintStyleColor, applyStylePopoverHexInputValue, bindStylePopoverEvents, canApplyStylePopoverColorEdit, closeStyleItemPopover, commitStyleColorPopoverIfOpen, forceCloseStyleColorPopover, normalizePopoverSegmentIndex, openStyleColorPopover, openStyleItemPopover, openStyleItemPopoverWithMeta, positionStyleItemPopover, refreshStyleItemModeUi, setStylePopoverPaintStyles, stepStyleItemPopoverNavigator, styleItemPopoverActiveColorField, styleItemPopoverAnchorRect, styleItemPopoverConfig, styleItemPopoverMode, styleItemPopoverNavigator, styleItemPopoverOpen, styleItemPopoverSegmentIndexCache, styleItemPopoverSelectedStyleId, styleItemPopoverTarget, suppressOutsideCloseFromInsidePointerDown, switchStyleItemPopoverSegment, syncColumnPopoverStateAndEmit, syncMarkLinkUiState, syncPopoverNavigatorUi, syncStyleItemPopoverFromConfig, updateStyleItemPopoverPreview } from './style-popover';
import { applyTemplateToDraft, bindStyleTemplateEvents, closeTemplateNameEditor, normalizeTemplateNameInput, renderStyleTemplateGallery, requestNewTemplateName, setStyleTemplateList, setStyleTemplateMode } from './style-templates';
import { ui } from './dom';
import { DEFAULT_STYLE_INJECTION_DRAFT, DEFAULT_STYLE_INJECTION_ITEM, chartTypeUsesMarkFill, chartTypeUsesMarkLineBackground, deriveRowColorsFromMarkStyles, ensureColHeaderColorEnabledLength, ensureColHeaderColorModesLength, ensureColHeaderColorsLength, ensureColHeaderPaintStyleIdsLength, ensureRowColorModesLength, ensureRowColorsLength, ensureRowPaintStyleIdsLength, getGridColsForChart, getRowColor, getTotalStackedCols, normalizeHexColorInput, recomputeEffectiveStyleSnapshot, seedMarkStylesFromRowColorsIfNeeded, setLocalStyleOverrideField, state, type AssistLineStyleInjectionDraftItem, type GridStyleInjectionDraftItem, type LineBackgroundStyleInjectionDraftItem, type MarkStyleInjectionDraftItem, type StyleInjectionDraft, type StyleInjectionDraftItem } from './state';

const THICKNESS_MIN = 0;
const THICKNESS_MAX = 20;

function debounce<F extends (...args: any[]) => void>(func: F, wait: number): F {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    return function (this: any, ...args: Parameters<F>) {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            timeout = null;
            func.apply(this, args);
        }, wait);
    } as F;
}

type StyleInjectionTabKey = 'plot-area' | 'mark' | 'assist-line';

function markFillEnabled() {
    return chartTypeUsesMarkFill(state.chartType);
}

function markLineBackgroundEnabled() {
    return chartTypeUsesMarkLineBackground(state.chartType);
}

function markStrokeToggleEnabled() {
    return markFillEnabled();
}

function markStrokeCardEnabled() {
    return !markStrokeToggleEnabled() || !isActiveMarkStrokeLinked();
}

function syncMarkStrokeCardState() {
    const showToggle = markStrokeToggleEnabled();
    const strokeEnabled = markStrokeCardEnabled();
    ui.styleMarkStrokeToggleRow.classList.toggle('hidden', !showToggle);
    ui.styleMarkStrokeToggle.checked = strokeEnabled;
    ui.styleMarkStrokeCard.classList.toggle('is-disabled', !strokeEnabled);
    ui.styleMarkStrokeCard.setAttribute('aria-disabled', strokeEnabled ? 'false' : 'true');
    [ui.styleMarkStrokeColorInput, ui.styleMarkStrokeStyleInput, ui.styleMarkThicknessInput].forEach((input) => {
        input.disabled = !strokeEnabled;
    });
}

function syncMarkStyleCardVisibility() {
    ui.styleMarkFillCard.classList.toggle('hidden', !markFillEnabled());
    ui.styleMarkLineBackgroundCard.classList.toggle('hidden', !markLineBackgroundEnabled());
    syncMarkStrokeCardState();
}

function setActiveStyleInjectionTab(tabKey: StyleInjectionTabKey) {
    const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-style-injection-tab]'));
    const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-style-injection-panel]'));
    if (tabButtons.length === 0 || panels.length === 0) return;

    tabButtons.forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.styleInjectionTab === tabKey);
    });
    panels.forEach((panel) => {
        panel.classList.toggle('is-active', panel.dataset.styleInjectionPanel === tabKey);
    });
}

function bindStyleInjectionTabEvents() {
    const stylePanel = document.querySelector<HTMLElement>('#style-panel');
    if (!stylePanel) return;
    const tabButtons = Array.from(stylePanel.querySelectorAll<HTMLButtonElement>('[data-style-injection-tab]'));
    if (tabButtons.length === 0) return;

    const activeTab = tabButtons.find((btn) => btn.classList.contains('is-active'))?.dataset.styleInjectionTab as StyleInjectionTabKey | undefined;
    setActiveStyleInjectionTab(activeTab || 'mark');

    stylePanel.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        const tabButton = target?.closest<HTMLButtonElement>('[data-style-injection-tab]');
        if (!tabButton) return;
        const tabKey = tabButton.dataset.styleInjectionTab as StyleInjectionTabKey | undefined;
        if (!tabKey) return;
        setActiveStyleInjectionTab(tabKey);
    });
}

export function getStyleColorInputs(): HTMLInputElement[] {
    return [
        ui.styleCellFillColorInput,
        ui.styleLineBackgroundColorInput,
        ui.styleCellTopColorInput,
        ui.styleTabRightColorInput,
        ui.styleGridColorInput,
        ui.styleMarkFillColorInput,
        ui.styleMarkStrokeColorInput,
        ui.styleMarkLineBackgroundColorInput,
        ui.styleAssistLineColorInput
    ];
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

export function setInputError(input: HTMLInputElement, invalid: boolean) {
    if (invalid) input.classList.add('style-input-error');
    else input.classList.remove('style-input-error');
}

export function resolveStyleColorLabel(input: HTMLInputElement): string {
    if (input === ui.styleCellFillColorInput) return 'Background';
    if (input === ui.styleLineBackgroundColorInput) return 'Line Background';
    if (input === ui.styleMarkFillColorInput) return 'Mark Fill';
    if (input === ui.styleMarkStrokeColorInput) return 'Mark Stroke';
    if (input === ui.styleMarkLineBackgroundColorInput) return 'Mark Line Background';
    if (input === ui.styleCellTopColorInput) return 'Y-axis line';
    if (input === ui.styleTabRightColorInput) return 'X-axis line';
    if (input === ui.styleGridColorInput) return 'Plot area';
    if (input === ui.styleAssistLineColorInput) return 'Assist Line';
    return 'Style Color';
}

export function getHexPreviewFallback(input: HTMLInputElement): string {
    if (input === ui.styleCellFillColorInput) return state.styleInjectionDraft.cellFill.color;
    if (input === ui.styleLineBackgroundColorInput) return state.styleInjectionDraft.lineBackground.color;
    if (input === ui.styleCellTopColorInput) return state.styleInjectionDraft.cellTop.color;
    if (input === ui.styleTabRightColorInput) return state.styleInjectionDraft.tabRight.color;
    if (input === ui.styleGridColorInput) return state.styleInjectionDraft.gridContainer.color;
    if (input === ui.styleMarkFillColorInput) return state.styleInjectionDraft.mark.fillColor;
    if (input === ui.styleMarkStrokeColorInput) return state.styleInjectionDraft.mark.strokeColor;
    if (input === ui.styleMarkLineBackgroundColorInput) return state.styleInjectionDraft.mark.lineBackgroundColor;
    if (input === ui.styleAssistLineColorInput) return state.styleInjectionDraft.assistLine.color;
    return DEFAULT_STYLE_INJECTION_ITEM.color;
}

export function getHexPreviewElement(input: HTMLInputElement): HTMLElement | null {
    if (input === ui.styleCellFillColorInput) return ui.styleCellFillColorPreview;
    if (input === ui.styleLineBackgroundColorInput) return ui.styleLineBackgroundColorPreview;
    if (input === ui.styleCellTopColorInput) return ui.styleCellTopColorPreview;
    if (input === ui.styleTabRightColorInput) return ui.styleTabRightColorPreview;
    if (input === ui.styleGridColorInput) return ui.styleGridColorPreview;
    if (input === ui.styleMarkFillColorInput) return ui.styleMarkFillColorPreview;
    if (input === ui.styleMarkStrokeColorInput) return ui.styleMarkStrokeColorPreview;
    if (input === ui.styleMarkLineBackgroundColorInput) return ui.styleMarkLineBackgroundColorPreview;
    if (input === ui.styleAssistLineColorInput) return ui.styleAssistLineColorPreview;
    return null;
}

export function updateHexPreview(input: HTMLInputElement, swatch: HTMLElement, fallback: string) {
    const color = normalizeHexColorInput(input.value) || normalizeHexColorInput(fallback) || DEFAULT_STYLE_INJECTION_ITEM.color;
    swatch.style.backgroundColor = color;
    swatch.title = color;
}

export function syncAllHexPreviewsFromDom() {
    getStyleColorInputs().forEach((input) => {
        const swatch = getHexPreviewElement(input);
        if (!swatch) return;
        updateHexPreview(input, swatch, getHexPreviewFallback(input));
    });
}

export function getStyleFormInputsForSnapshot(): Array<HTMLInputElement | HTMLSelectElement> {
    return [
        ui.styleCellFillColorInput,
        ui.styleLineBackgroundColorInput,
        ui.styleLineBackgroundVisibleInput,
        ui.styleMarkLineBackgroundVisibleInput,
        ui.styleMarkFillColorInput,
        ui.styleMarkStrokeColorInput,
        ui.styleMarkLineBackgroundColorInput,
        ui.styleMarkLineBackgroundOpacityInput,
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

export function syncStyleDraftFromDomAndEmit() {
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

export function normalizeFromDom(
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

export function normalizeColorThicknessFromDom(
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

export function emitStyleDraftUpdated() {
    document.dispatchEvent(new CustomEvent('style-draft-updated'));
}

export function hydrateStyleTab(draft: StyleInjectionDraft) {
    syncMarkStyleCardVisibility();
    ui.styleCellFillColorInput.value = draft.cellFill.color;
    ui.styleLineBackgroundColorInput.value = draft.lineBackground.color;
    ui.styleLineBackgroundVisibleInput.checked = draft.lineBackground.visible;
    ui.styleMarkLineBackgroundVisibleInput.checked = draft.lineBackground.visible;
    ui.styleLineBackgroundSection.classList.add('hidden');
    syncMarkIndexSelector();
    const activeMark = getActiveMarkDraft();
    ui.styleMarkFillColorInput.value = activeMark.fillColor;
    ui.styleMarkStrokeColorInput.value = activeMark.strokeColor;
    ui.styleMarkLineBackgroundColorInput.value = activeMark.lineBackgroundColor;
    ui.styleMarkLineBackgroundOpacityInput.value = String(clampOpacityPercent(activeMark.lineBackgroundOpacity, 100));
    ui.styleMarkLineBackgroundVisibleInput.checked = activeMark.lineBackgroundVisible;
    ui.styleLineBackgroundVisibleInput.checked = activeMark.lineBackgroundVisible;
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
    const allowMarkFill = markFillEnabled();
    const allowLineBackground = markLineBackgroundEnabled();
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
        lineBackgroundColor: normalizeHexColorInput(ui.styleMarkLineBackgroundColorInput.value) || state.styleInjectionDraft.mark.lineBackgroundColor,
        lineBackgroundOpacity: clampOpacityPercent(ui.styleMarkLineBackgroundOpacityInput.value, state.styleInjectionDraft.mark.lineBackgroundOpacity),
        thickness: Number(ui.styleMarkThicknessInput.value),
        strokeStyle: ui.styleMarkStrokeStyleInput.value === 'dash' ? 'dash' : 'solid'
    });
    const mark: MarkStyleInjectionDraftItem = markNormalized
        ? {
            fillColor: allowMarkFill
                ? (markNormalized.fillColor || state.styleInjectionDraft.mark.fillColor)
                : state.styleInjectionDraft.mark.fillColor,
            strokeColor: markNormalized.strokeColor || state.styleInjectionDraft.mark.strokeColor,
            lineBackgroundColor: allowLineBackground
                ? (markNormalized.lineBackgroundColor
                    || markNormalized.strokeColor
                    || state.styleInjectionDraft.mark.lineBackgroundColor)
                : state.styleInjectionDraft.mark.lineBackgroundColor,
            lineBackgroundOpacity: allowLineBackground
                ? clampOpacityPercent(
                    typeof markNormalized.lineBackgroundOpacity === 'number' ? markNormalized.lineBackgroundOpacity * 100 : undefined,
                    state.styleInjectionDraft.mark.lineBackgroundOpacity
                )
                : state.styleInjectionDraft.mark.lineBackgroundOpacity,
            lineBackgroundVisible: allowLineBackground
                ? ui.styleMarkLineBackgroundVisibleInput.checked
                : state.styleInjectionDraft.mark.lineBackgroundVisible,
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
        lineBackground: allowLineBackground
            ? {
                color: normalizeHexColorInput(mark.lineBackgroundColor) || normalizeHexColorInput(mark.strokeColor) || state.styleInjectionDraft.lineBackground.color,
                opacity: Math.max(0, Math.min(1, mark.lineBackgroundOpacity / 100)),
                visible: mark.lineBackgroundVisible
            }
            : { ...state.styleInjectionDraft.lineBackground },
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
    bindStyleInjectionTabEvents();

    ui.styleMarkLineBackgroundVisibleInput.addEventListener('change', () => {
        ui.styleLineBackgroundVisibleInput.checked = ui.styleMarkLineBackgroundVisibleInput.checked;
    });

    const handleChange = debounce(() => {
        syncStyleDraftFromDomAndEmit();
    }, 150);

    const styleInputsFormContainer = document.querySelector('#style-panel')
        || document.querySelector('.style-panel-scroll-area')
        || document.body;
    styleInputsFormContainer.addEventListener('input', (e) => {
        const target = e.target as HTMLElement;
        const trackedInputs = getStyleFormInputsForSnapshot();
        if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
            if (trackedInputs.includes(target)) {
                handleChange();
            }
        }
    });

    styleInputsFormContainer.addEventListener('change', (e) => {
        const target = e.target as HTMLElement;
        const trackedInputs = getStyleFormInputsForSnapshot();
        const isStyleInput = target instanceof HTMLInputElement || target instanceof HTMLSelectElement;

        if (isStyleInput && trackedInputs.includes(target as any)) {
            handleChange();
        }
    });

    ui.styleMarkIndexInput.addEventListener('change', () => {
        const idx = Number(ui.styleMarkIndexInput.value);
        state.activeMarkStyleIndex = Number.isFinite(idx) ? Math.max(0, idx) : 0;
        styleItemPopoverSegmentIndexCache.mark = normalizePopoverSegmentIndex('mark', state.activeMarkStyleIndex);
        if (styleItemPopoverNavigator?.segment === 'mark') {
            styleItemPopoverNavigator.index = styleItemPopoverSegmentIndexCache.mark;
        }
        const active = getActiveMarkDraft();
        ui.styleMarkFillColorInput.value = active.fillColor;
        ui.styleMarkStrokeColorInput.value = active.strokeColor;
        ui.styleMarkLineBackgroundColorInput.value = active.lineBackgroundColor;
        ui.styleMarkLineBackgroundOpacityInput.value = String(clampOpacityPercent(active.lineBackgroundOpacity, 100));
        ui.styleMarkLineBackgroundVisibleInput.checked = active.lineBackgroundVisible;
        ui.styleLineBackgroundVisibleInput.checked = active.lineBackgroundVisible;
        ui.styleMarkStrokeStyleInput.value = active.strokeStyle;
        ui.styleMarkThicknessInput.value = String(active.thickness);
        syncMarkStyleCardVisibility();
        syncAllHexPreviewsFromDom();
        if (styleItemPopoverOpen && styleItemPopoverTarget === 'mark' && styleItemPopoverConfig) {
            syncStyleItemPopoverFromConfig(styleItemPopoverConfig);
        } else if (styleItemPopoverOpen) {
            syncPopoverNavigatorUi();
        }
        syncStyleDraftFromDomAndEmit();
    });

    ui.styleMarkStrokeToggle.addEventListener('change', () => {
        const strokeEnabled = ui.styleMarkStrokeToggle.checked;
        setActiveMarkStrokeLinked(!strokeEnabled);
        if (!strokeEnabled) {
            const linkedStroke = normalizeHexColorInput(ui.styleMarkFillColorInput.value)
                || state.styleInjectionDraft.mark.fillColor
                || DEFAULT_STYLE_INJECTION_DRAFT.mark.fillColor;
            ui.styleMarkStrokeColorInput.value = linkedStroke;
            if (
                styleItemPopoverOpen
                && (
                    styleItemPopoverSourceInput === ui.styleMarkStrokeColorInput
                    || styleItemPopoverSourceInput === ui.styleMarkThicknessInput
                    || styleItemPopoverSourceInput === ui.styleMarkStrokeStyleInput
                )
            ) {
                forceCloseStyleColorPopover();
            }
            const focused = document.activeElement;
            if (focused instanceof HTMLElement && ui.styleMarkStrokeCard.contains(focused)) {
                focused.blur();
            }
        }
        syncMarkStrokeCardState();
        if (styleItemPopoverOpen && styleItemPopoverTarget === 'mark' && styleItemPopoverConfig) {
            syncStyleItemPopoverFromConfig(styleItemPopoverConfig);
        }
        syncStyleDraftFromDomAndEmit();
    });

    styleInputsFormContainer.addEventListener('click', (e) => {
        const target = e.target as HTMLInputElement;
        const colorInputs = getStyleColorInputs();
        if (target instanceof HTMLElement && ui.styleMarkStrokeCard.contains(target) && !markStrokeCardEnabled()) {
            e.preventDefault();
            return;
        }
        if (target instanceof HTMLInputElement && colorInputs.includes(target)) {
            openStyleColorPopover(target);
        }
    });
    styleInputsFormContainer.addEventListener('focusin', (e) => {
        const target = e.target as HTMLInputElement;
        const colorInputs = getStyleColorInputs();
        if (target instanceof HTMLElement && ui.styleMarkStrokeCard.contains(target) && !markStrokeCardEnabled()) {
            target.blur();
            return;
        }
        if (target instanceof HTMLInputElement && colorInputs.includes(target)) {
            openStyleColorPopover(target);
        }
    });

    bindStylePopoverEvents();

    bindStyleTemplateEvents();
}

export * from './style-popover';
export * from './style-templates';
export * from './style-normalization';
