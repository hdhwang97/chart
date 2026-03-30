import {
    buildDraftFromPayload,
    buildMarkStylesFromRowHeaders,
    clampOpacityPercent,
    clampThickness,
    cloneDraft,
    ensureMarkDraftSeriesCount,
    ensureMarkStrokeSidesStateCount,
    ensureMarkStrokeLinkStateCount,
    getActiveMarkStrokeSides,
    getActiveMarkDraft,
    isActiveMarkStrokeLinked,
    normalizeMarkStyle,
    setActiveMarkStrokeLinked,
    toStrokeInjectionPayload,
    type ExtractedStylePayload,
    type SavedStylePayload
} from './style-normalization';
import { applyQuickSwatchColor, applySelectedPaintStyleColor, applyStylePopoverHexInputValue, bindStylePopoverEvents, canApplyStylePopoverColorEdit, closeStyleItemPopover, commitStyleColorPopoverIfOpen, forceCloseStyleColorPopover, normalizePopoverSegmentIndex, openStyleColorPopover, openStyleItemPopover, openStyleItemPopoverWithMeta, positionStyleItemPopover, refreshStyleItemModeUi, refreshStyleSettingVariableStatus, setStylePopoverPaintStyles, stepStyleItemPopoverNavigator, styleItemPopoverActiveColorField, styleItemPopoverAnchorRect, styleItemPopoverConfig, styleItemPopoverMode, styleItemPopoverNavigator, styleItemPopoverOpen, styleItemPopoverSegmentIndexCache, styleItemPopoverSelectedStyleId, styleItemPopoverTarget, stylePopoverPaintStyles, suppressOutsideCloseFromInsidePointerDown, switchStyleItemPopoverSegment, syncColumnPopoverStateAndEmit, syncMarkLinkUiState, syncPopoverNavigatorUi, syncStyleItemPopoverFromConfig, updateStyleItemPopoverPreview } from './style-popover';
import { applyTemplateToDraft, bindStyleTemplateEvents, closeTemplateNameEditor, normalizeTemplateNameInput, renderStyleTemplateGallery, requestNewTemplateName, setStyleTemplateList, setStyleTemplateMode } from './style-templates';
import { ui } from './dom';
import { DEFAULT_STYLE_INJECTION_DRAFT, DEFAULT_STYLE_INJECTION_ITEM, chartTypeUsesMarkFill, chartTypeUsesMarkLineBackground, deriveRowColorsFromMarkStyles, ensureColHeaderColorEnabledLength, ensureColHeaderColorModesLength, ensureColHeaderColorsLength, ensureColHeaderPaintStyleIdsLength, ensureRowColorModesLength, ensureRowColorsLength, ensureRowPaintStyleIdsLength, getGridColsForChart, getRowColor, getTotalStackedCols, normalizeHexColorInput, recomputeEffectiveStyleSnapshot, seedMarkStylesFromRowColorsIfNeeded, setLocalStyleOverrideField, state, type AssistLineStyleInjectionDraftItem, type GridStyleInjectionDraftItem, type LineBackgroundStyleInjectionDraftItem, type MarkStyleInjectionDraftItem, type StyleInjectionDraft, type StyleInjectionDraftItem } from './state';
import { resolveMarkVariableStyleIdForInputId } from './mark-variable';
import { formatColorVariableDisplayName } from './variable-display';
import { setStylePreviewHoverTarget, type StylePreviewTarget } from './preview';

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

type StyleInjectionTabKey = 'plot-area' | 'mark';
type StyleSectionKey = 'templates' | 'injection';
const STYLE_CARD_LINKED_HOVER_CLASS = 'is-preview-linked-hover';
let styleSettingCardHoverBound = false;
let styleSettingCardsByTargetCache: Map<StylePreviewTarget, HTMLElement[]> | null = null;
let activeStyleSettingHoverCards: HTMLElement[] = [];
let markVariableStyleListRequested = false;

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

function linePointCardVisible() {
    return state.chartType === 'line';
}

function isStackedChartType() {
    return state.chartType === 'stackedBar' || state.chartType === 'stacked';
}

function syncStackedStrokeAcrossSeries(
    styles: MarkStyleInjectionDraftItem[],
    links: boolean[],
    sidesByIndex: Array<{ top: boolean; left: boolean; right: boolean }>,
    sourceIndex: number
) {
    if (!isStackedChartType() || styles.length === 0) return;
    const safeSource = Math.max(0, Math.min(sourceIndex, styles.length - 1));
    const sourceStyle = styles[safeSource] || styles[0];
    const sourceLinked = Boolean(links[safeSource] ?? true);
    const sourceSides = sidesByIndex[safeSource] || { top: true, left: true, right: true };

    for (let i = 0; i < styles.length; i++) {
        styles[i] = {
            ...styles[i],
            strokeColor: sourceStyle.strokeColor,
            thickness: sourceStyle.thickness,
            strokeStyle: sourceStyle.strokeStyle
        };
    }
    for (let i = 0; i < links.length; i++) {
        links[i] = sourceLinked;
    }
    for (let i = 0; i < sidesByIndex.length; i++) {
        sidesByIndex[i] = {
            top: sourceSides.top !== false,
            left: sourceSides.left !== false,
            right: sourceSides.right !== false
        };
    }
}

function deriveContrastingStrokeColor(fillColor: string): string {
    const normalized = normalizeHexColorInput(fillColor) || '#3B82F6';
    const hex = normalized.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    return luminance > 160 ? '#111827' : '#FFFFFF';
}

function syncMarkStrokeCardState() {
    const showToggle = markStrokeToggleEnabled();
    const strokeEnabled = markStrokeCardEnabled();
    ui.styleMarkStrokeToggleRow.classList.toggle('hidden', !showToggle);
    ui.styleMarkStrokeToggle.checked = strokeEnabled;
    ui.styleMarkStrokeCard.classList.toggle('is-disabled', !strokeEnabled);
    ui.styleMarkStrokeCard.setAttribute('aria-disabled', strokeEnabled ? 'false' : 'true');
    [ui.styleMarkStrokeColorInput, ui.styleMarkStrokeStyleInput, ui.styleMarkThicknessInput, ui.styleMarkStrokeSidesTopInput, ui.styleMarkStrokeSidesLeftInput, ui.styleMarkStrokeSidesRightInput].forEach((input) => {
        input.disabled = !strokeEnabled;
    });
}

function syncLinePointCardState() {
    const visible = linePointCardVisible();
    const enabled = visible && state.linePointVisible;

    ui.styleMarkLinePointCard.classList.toggle('hidden', !visible);
    ui.styleMarkLinePointCard.classList.toggle('is-disabled', visible && !enabled);
    ui.styleMarkLinePointCard.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    ui.styleMarkLinePointVisibleInput.checked = state.linePointVisible;
    [ui.styleMarkLinePointStrokeInput, ui.styleMarkLinePointThicknessInput, ui.styleMarkLinePointPaddingInput, ui.styleMarkLinePointFillInput].forEach((input) => {
        input.disabled = !enabled;
    });
}

export function syncMarkStyleCardVisibility() {
    ui.styleMarkFillCard.classList.toggle('hidden', !markFillEnabled());
    ui.styleMarkLineBackgroundCard.classList.toggle('hidden', !markLineBackgroundEnabled());
    syncLinePointCardState();
    syncMarkStrokeCardState();
}

function syncVisibleControlledStyleCards() {
    const visibleInputs = [
        ui.styleCellFillVisibleInput,
        ui.styleLineBackgroundVisibleInput,
        ui.styleCellTopVisibleInput,
        ui.styleTabRightVisibleInput,
        ui.styleGridVisibleInput,
        ui.styleAssistLineVisibleInput,
        ui.styleMarkLineBackgroundVisibleInput
    ];

    visibleInputs.forEach((visibleInput) => {
        const card = visibleInput.closest<HTMLElement>('.style-injection-card');
        if (!card) return;
        const enabled = visibleInput.checked;
        card.classList.toggle('is-disabled', !enabled);
        card.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        card.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input, select, textarea, button')
            .forEach((control) => {
                if (control === visibleInput) return;
                control.disabled = !enabled;
            });
    });
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

function setExpandedStyleSection(sectionKey: StyleSectionKey | null) {
    const shells = Array.from(document.querySelectorAll<HTMLElement>('[data-style-section]'));
    const toggles = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-style-section-toggle]'));
    if (shells.length === 0) return;

    shells.forEach((shell) => {
        const isExpanded = sectionKey !== null && shell.dataset.styleSection === sectionKey;
        shell.classList.toggle('is-expanded', isExpanded);
        shell.classList.toggle('is-collapsed', !isExpanded);
    });

    toggles.forEach((toggle) => {
        const isExpanded = sectionKey !== null && toggle.dataset.styleSectionToggle === sectionKey;
        toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    });
}

function bindStyleInjectionTabEvents() {
    const stylePanel = document.querySelector<HTMLElement>('#style-panel');
    if (!stylePanel) return;
    const tabButtons = Array.from(stylePanel.querySelectorAll<HTMLButtonElement>('[data-style-injection-tab]'));
    if (tabButtons.length === 0) return;

    const expandedShell = stylePanel.querySelector<HTMLElement>('[data-style-section].is-expanded');
    const initialSection = (expandedShell?.dataset.styleSection as StyleSectionKey | undefined) || 'injection';
    setExpandedStyleSection(initialSection);

    const activeTab = tabButtons.find((btn) => btn.classList.contains('is-active'))?.dataset.styleInjectionTab as StyleInjectionTabKey | undefined;
    setActiveStyleInjectionTab(activeTab || 'mark');

    stylePanel.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        const sectionToggle = target?.closest<HTMLButtonElement>('[data-style-section-toggle]');
        if (sectionToggle) {
            const sectionKey = sectionToggle.dataset.styleSectionToggle as StyleSectionKey | undefined;
            if (!sectionKey) return;
            const isExpanded = sectionToggle.getAttribute('aria-expanded') === 'true';
            const nextSection = sectionKey === 'templates' ? 'injection' : 'templates';
            setExpandedStyleSection(isExpanded ? nextSection : sectionKey);
            return;
        }

        const tabButton = target?.closest<HTMLButtonElement>('[data-style-injection-tab]');
        if (!tabButton) return;
        const tabKey = tabButton.dataset.styleInjectionTab as StyleInjectionTabKey | undefined;
        if (!tabKey) return;
        setExpandedStyleSection('injection');
        setActiveStyleInjectionTab(tabKey);
    });
}

function buildStyleSettingCardsByTarget(): Array<{ target: StylePreviewTarget; cards: HTMLElement[] }> {
    const resolveCard = (input: HTMLElement): HTMLElement | null => input.closest<HTMLElement>('.style-injection-card');
    const uniqueCards = (cards: Array<HTMLElement | null | undefined>) => {
        const next: HTMLElement[] = [];
        cards.forEach((card) => {
            if (!card || next.includes(card)) return;
            next.push(card);
        });
        return next;
    };

    return [
        { target: 'cell-fill', cards: uniqueCards([resolveCard(ui.styleCellFillColorInput)]) },
        { target: 'tab-right', cards: uniqueCards([resolveCard(ui.styleTabRightColorInput)]) },
        { target: 'cell-top', cards: uniqueCards([resolveCard(ui.styleCellTopColorInput)]) },
        { target: 'grid', cards: uniqueCards([resolveCard(ui.styleGridColorInput)]) },
        { target: 'assist-line', cards: uniqueCards([resolveCard(ui.styleAssistLineColorInput)]) },
        { target: 'mark', cards: uniqueCards([ui.styleMarkStrokeCard, ui.styleMarkFillCard, ui.styleMarkLinePointCard]) },
        { target: 'line-background', cards: uniqueCards([ui.styleMarkLineBackgroundCard]) }
    ];
}

function getStyleSettingCardsByTargetMap(): Map<StylePreviewTarget, HTMLElement[]> {
    if (styleSettingCardsByTargetCache) return styleSettingCardsByTargetCache;
    const map = new Map<StylePreviewTarget, HTMLElement[]>();
    buildStyleSettingCardsByTarget().forEach(({ target, cards }) => {
        map.set(target, cards);
    });
    styleSettingCardsByTargetCache = map;
    return map;
}

function clearStyleSettingHoverCards() {
    if (activeStyleSettingHoverCards.length === 0) return;
    activeStyleSettingHoverCards.forEach((card) => card.classList.remove(STYLE_CARD_LINKED_HOVER_CLASS));
    activeStyleSettingHoverCards = [];
}

function setStyleSettingHoverCards(cards: HTMLElement[]) {
    if (
        cards.length === activeStyleSettingHoverCards.length
        && cards.every((card, idx) => activeStyleSettingHoverCards[idx] === card)
    ) {
        return;
    }
    clearStyleSettingHoverCards();
    cards.forEach((card) => card.classList.add(STYLE_CARD_LINKED_HOVER_CLASS));
    activeStyleSettingHoverCards = cards;
}

export function setStyleSettingCardHoverState(target: StylePreviewTarget | null) {
    if (!target) {
        clearStyleSettingHoverCards();
        return;
    }
    setStyleSettingHoverCards(getStyleSettingCardsByTargetMap().get(target) || []);
}

function setStyleSettingCardHoverStateForCard(card: HTMLElement | null) {
    if (!card) {
        clearStyleSettingHoverCards();
        return;
    }
    setStyleSettingHoverCards([card]);
}

export function bindStyleSettingCardHoverInteractions() {
    if (styleSettingCardHoverBound) return;
    styleSettingCardHoverBound = true;

    getStyleSettingCardsByTargetMap().forEach((cards, target) => {
        cards.forEach((card) => {
            card.dataset.stylePreviewTarget = target;
            card.addEventListener('mouseenter', () => {
                setStyleSettingCardHoverStateForCard(card);
                setStylePreviewHoverTarget(target);
            });
            card.addEventListener('mouseleave', () => {
                setStyleSettingCardHoverStateForCard(null);
                setStylePreviewHoverTarget(null);
            });
        });
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
        ui.styleMarkLinePointStrokeInput,
        ui.styleMarkLinePointFillInput,
        ui.styleAssistLineColorInput
    ];
}

function syncMarkIndexSelector() {
    const select = ui.styleMarkIndexInput;
    const count = Math.max(1, state.markStylesDraft.length);
    ensureMarkStrokeLinkStateCount(count);
    ensureMarkStrokeSidesStateCount(count);
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
    if (input === ui.styleMarkLinePointStrokeInput) return 'Line Point Stroke';
    if (input === ui.styleMarkLinePointFillInput) return 'Line Point Fill';
    if (input === ui.styleCellTopColorInput) return 'Y-axis line';
    if (input === ui.styleTabRightColorInput) return 'X-axis line';
    if (input === ui.styleGridColorInput) return 'Plot area';
    if (input === ui.styleAssistLineColorInput) return 'guide line';
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
    if (input === ui.styleMarkLinePointStrokeInput) return state.styleInjectionDraft.mark.linePointStrokeColor;
    if (input === ui.styleMarkLinePointFillInput) return state.styleInjectionDraft.mark.linePointFillColor;
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
    if (input === ui.styleMarkLinePointStrokeInput) return ui.styleMarkLinePointStrokePreview;
    if (input === ui.styleMarkLinePointFillInput) return ui.styleMarkLinePointFillPreview;
    if (input === ui.styleAssistLineColorInput) return ui.styleAssistLineColorPreview;
    return null;
}

export function updateHexPreview(input: HTMLInputElement, swatch: HTMLElement, fallback: string) {
    const color = normalizeHexColorInput(input.value) || normalizeHexColorInput(fallback) || DEFAULT_STYLE_INJECTION_ITEM.color;
    swatch.style.backgroundColor = color;
    swatch.title = color;
}

export function syncMarkVariableNameDisplay() {
    const labelNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-style-variable-name-for]'));
    if (labelNodes.length === 0) return;

    labelNodes.forEach((label) => {
        const inputId = label.dataset.styleVariableNameFor;
        if (!inputId || !inputId.startsWith('style-mark-')) return;
        const input = document.getElementById(inputId) as HTMLInputElement | null;
        if (!input) return;

        const variableState = resolveMarkVariableStyleIdForInputId(inputId);
        const styleId = variableState.styleId;
        const linkedStyle = styleId
            ? stylePopoverPaintStyles.find((item) => item.id === styleId) || null
            : null;
        if (styleId && !linkedStyle && !markVariableStyleListRequested) {
            markVariableStyleListRequested = true;
            document.dispatchEvent(new CustomEvent('request-color-variable-list'));
        } else if (linkedStyle) {
            markVariableStyleListRequested = false;
        }

        const showVariableName = Boolean(styleId);
        const styleName = styleId
            ? (linkedStyle ? formatColorVariableDisplayName(linkedStyle.name) : styleId)
            : '';
        const wrapper = input.closest<HTMLElement>('.hex-input-with-preview');
        label.classList.toggle('hidden', !showVariableName);
        label.textContent = showVariableName ? styleName : '';
        if (wrapper) {
            wrapper.classList.toggle('is-variable-mode', showVariableName);
        }
        if (showVariableName) {
            input.style.setProperty('color', 'transparent', 'important');
            input.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
            input.style.setProperty('caret-color', 'transparent', 'important');
            input.style.setProperty('text-shadow', 'none', 'important');
        } else {
            input.style.removeProperty('color');
            input.style.removeProperty('-webkit-text-fill-color');
            input.style.removeProperty('caret-color');
            input.style.removeProperty('text-shadow');
        }
        input.readOnly = showVariableName;
        input.title = showVariableName ? styleName : '';
    });
}

export function syncAllHexPreviewsFromDom() {
    getStyleColorInputs().forEach((input) => {
        const swatch = getHexPreviewElement(input);
        if (!swatch) return;
        updateHexPreview(input, swatch, getHexPreviewFallback(input));
    });
    syncMarkVariableNameDisplay();
    refreshStyleSettingVariableStatus();
}

export function getStyleFormInputsForSnapshot(): Array<HTMLInputElement | HTMLSelectElement> {
    return [
        ui.styleCellFillColorInput,
        ui.styleCellFillVisibleInput,
        ui.styleLineBackgroundColorInput,
        ui.styleLineBackgroundVisibleInput,
        ui.styleMarkLineBackgroundVisibleInput,
        ui.styleMarkFillColorInput,
        ui.styleMarkStrokeColorInput,
        ui.styleMarkLineBackgroundColorInput,
        ui.styleMarkLinePointStrokeInput,
        ui.styleMarkLinePointThicknessInput,
        ui.styleMarkLinePointPaddingInput,
        ui.styleMarkLinePointFillInput,
        ui.styleMarkLineBackgroundOpacityInput,
        ui.styleMarkStrokeStyleInput,
        ui.styleMarkThicknessInput,
        ui.styleMarkStrokeSidesTopInput,
        ui.styleMarkStrokeSidesLeftInput,
        ui.styleMarkStrokeSidesRightInput,
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

export function syncStyleDraftFromDomAndEmit(sourceInputId?: string | null) {
    markStyleInjectionDirty();
    const normalized = validateStyleTabDraft(readStyleTabDraft());
    setStyleInjectionDraft(normalized.draft);
    syncRowColorsFromMarkStyles({ emitLocalOverride: true });
    syncAllHexPreviewsFromDom();
    emitStyleDraftUpdated({ sourceInputId: sourceInputId || null });
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

export function emitStyleDraftUpdated(detail?: { sourceInputId?: string | null }) {
    document.dispatchEvent(new CustomEvent('style-draft-updated', { detail }));
}

export function hydrateStyleTab(draft: StyleInjectionDraft) {
    syncMarkStyleCardVisibility();
    ui.styleCellFillColorInput.value = draft.cellFill.color;
    ui.styleCellFillVisibleInput.checked = draft.cellFill.visible;
    ui.styleLineBackgroundColorInput.value = draft.lineBackground.color;
    ui.styleLineBackgroundVisibleInput.checked = draft.lineBackground.visible;
    ui.styleMarkLineBackgroundVisibleInput.checked = draft.lineBackground.visible;
    ui.styleLineBackgroundSection.classList.add('hidden');
    syncMarkIndexSelector();
    const activeMark = getActiveMarkDraft();
    ui.styleMarkFillColorInput.value = activeMark.fillColor;
    ui.styleMarkStrokeColorInput.value = activeMark.strokeColor;
    ui.styleMarkLineBackgroundColorInput.value = activeMark.lineBackgroundColor;
    ui.styleMarkLinePointStrokeInput.value = activeMark.linePointStrokeColor;
    ui.styleMarkLinePointThicknessInput.value = String(activeMark.linePointThickness);
    ui.styleMarkLinePointPaddingInput.value = String(activeMark.linePointPadding);
    ui.styleMarkLinePointFillInput.value = activeMark.linePointFillColor;
    ui.styleMarkLineBackgroundOpacityInput.value = String(clampOpacityPercent(activeMark.lineBackgroundOpacity, 100));
    ui.styleMarkLineBackgroundVisibleInput.checked = activeMark.lineBackgroundVisible;
    ui.styleLineBackgroundVisibleInput.checked = activeMark.lineBackgroundVisible;
    ui.styleMarkStrokeStyleInput.value = activeMark.strokeStyle;
    ui.styleMarkThicknessInput.value = String(activeMark.thickness);
    const activeSides = getActiveMarkStrokeSides();
    ui.styleMarkStrokeSidesTopInput.checked = activeSides.top;
    ui.styleMarkStrokeSidesLeftInput.checked = activeSides.left;
    ui.styleMarkStrokeSidesRightInput.checked = activeSides.right;
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

    ui.styleAssistLineVisibleInput.checked = state.assistLineVisible;
    ui.styleAssistLineColorInput.value = draft.assistLine.color;
    ui.styleAssistLineStrokeStyleInput.value = draft.assistLine.strokeStyle;
    ui.styleAssistLineThicknessInput.value = String(draft.assistLine.thickness);
    syncVisibleControlledStyleCards();

    if (styleItemPopoverOpen && styleItemPopoverConfig) {
        syncStyleItemPopoverFromConfig(styleItemPopoverConfig);
    }
    syncAllHexPreviewsFromDom();
}

export function syncLineMarkThicknessFromStrokeWidth(strokeWidth: number) {
    if (state.chartType !== 'line') return;
    const normalized = clampThickness(strokeWidth, state.styleInjectionDraft.mark.thickness);
    const styles = ensureMarkDraftSeriesCount(state.markStylesDraft).map((item) => ({
        ...item,
        thickness: normalized
    }));
    state.markStylesDraft = styles;
    const nextDraft: StyleInjectionDraft = {
        ...state.styleInjectionDraft,
        mark: {
            ...state.styleInjectionDraft.mark,
            thickness: normalized
        }
    };
    setStyleInjectionDraft(nextDraft);
    ui.styleMarkThicknessInput.value = String(normalized);
    if (styleItemPopoverOpen && styleItemPopoverConfig) {
        syncStyleItemPopoverFromConfig(styleItemPopoverConfig);
    }
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
        linePointStrokeColor: normalizeHexColorInput(ui.styleMarkLinePointStrokeInput.value) || state.styleInjectionDraft.mark.linePointStrokeColor,
        linePointFillColor: normalizeHexColorInput(ui.styleMarkLinePointFillInput.value) || state.styleInjectionDraft.mark.linePointFillColor,
        linePointThickness: Number(ui.styleMarkLinePointThicknessInput.value),
        linePointPadding: Number(ui.styleMarkLinePointPaddingInput.value),
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
            linePointStrokeColor: markNormalized.linePointStrokeColor || markNormalized.strokeColor || state.styleInjectionDraft.mark.linePointStrokeColor,
            linePointFillColor: markNormalized.linePointFillColor || markNormalized.fillColor || state.styleInjectionDraft.mark.linePointFillColor,
            linePointThickness: typeof markNormalized.linePointThickness === 'number' ? markNormalized.linePointThickness : state.styleInjectionDraft.mark.linePointThickness,
            linePointPadding: typeof markNormalized.linePointPadding === 'number' ? markNormalized.linePointPadding : state.styleInjectionDraft.mark.linePointPadding,
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
    const sidesByIndex = ensureMarkStrokeSidesStateCount(styles.length);
    const strokeLinks = ensureMarkStrokeLinkStateCount(styles.length);
    const idx = Math.max(0, Math.min(state.activeMarkStyleIndex, styles.length - 1));
    styles[idx] = { ...mark };
    sidesByIndex[idx] = {
        top: ui.styleMarkStrokeSidesTopInput.checked,
        left: ui.styleMarkStrokeSidesLeftInput.checked,
        right: ui.styleMarkStrokeSidesRightInput.checked
    };
    syncStackedStrokeAcrossSeries(styles, strokeLinks, sidesByIndex, idx);
    state.markStylesDraft = styles;
    state.activeMarkStyleIndex = idx;

    return {
        cellFill: {
            color: cellFillColor,
            visible: ui.styleCellFillVisibleInput.checked
        },
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
    const linePointStrokeValid = !linePointCardVisible() || Boolean(normalizeHexColorInput(ui.styleMarkLinePointStrokeInput.value));
    const linePointThicknessRaw = Number(ui.styleMarkLinePointThicknessInput.value);
    const linePointThicknessValid = !linePointCardVisible() || (
        Number.isFinite(linePointThicknessRaw)
        && linePointThicknessRaw >= THICKNESS_MIN
        && linePointThicknessRaw <= THICKNESS_MAX
    );
    const linePointPaddingRaw = Number(ui.styleMarkLinePointPaddingInput.value);
    const linePointPaddingValid = !linePointCardVisible() || (
        Number.isFinite(linePointPaddingRaw)
        && linePointPaddingRaw >= THICKNESS_MIN
        && linePointPaddingRaw <= THICKNESS_MAX
    );
    const linePointFillValid = !linePointCardVisible() || Boolean(normalizeHexColorInput(ui.styleMarkLinePointFillInput.value));
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
    setInputError(ui.styleMarkLinePointStrokeInput, !linePointStrokeValid && linePointCardVisible());
    setInputError(ui.styleMarkLinePointThicknessInput, !linePointThicknessValid && linePointCardVisible());
    setInputError(ui.styleMarkLinePointPaddingInput, !linePointPaddingValid && linePointCardVisible());
    setInputError(ui.styleMarkLinePointFillInput, !linePointFillValid && linePointCardVisible());
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
        && linePointStrokeValid
        && linePointThicknessValid
        && linePointPaddingValid
        && linePointFillValid
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
            cellFill: {
                color: normalizeHexColorInput(ui.styleCellFillColorInput.value) || draft.cellFill.color,
                visible: ui.styleCellFillVisibleInput.checked
            },
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
                linePointStrokeColor: normalizeHexColorInput(ui.styleMarkLinePointStrokeInput.value) || draft.mark.linePointStrokeColor,
                linePointThickness: linePointThicknessValid
                    ? linePointThicknessRaw
                    : clampThickness(linePointThicknessRaw, draft.mark.linePointThickness),
                linePointPadding: linePointPaddingValid
                    ? linePointPaddingRaw
                    : clampThickness(linePointPaddingRaw, draft.mark.linePointPadding),
                linePointFillColor: normalizeHexColorInput(ui.styleMarkLinePointFillInput.value) || draft.mark.linePointFillColor,
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
    ensureMarkStrokeSidesStateCount(state.markStylesDraft.length);
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
    bindStyleSettingCardHoverInteractions();

    const syncLineBackgroundVisibility = (checked: boolean) => {
        ui.styleMarkLineBackgroundVisibleInput.checked = checked;
        ui.styleLineBackgroundVisibleInput.checked = checked;
        syncVisibleControlledStyleCards();
    };
    ui.styleMarkLineBackgroundVisibleInput.addEventListener('change', () => {
        syncLineBackgroundVisibility(ui.styleMarkLineBackgroundVisibleInput.checked);
    });
    ui.styleLineBackgroundVisibleInput.addEventListener('change', () => {
        syncLineBackgroundVisibility(ui.styleLineBackgroundVisibleInput.checked);
    });
    [ui.styleCellFillVisibleInput, ui.styleCellTopVisibleInput, ui.styleTabRightVisibleInput, ui.styleGridVisibleInput, ui.styleAssistLineVisibleInput].forEach((input) => {
        input.addEventListener('change', () => {
            syncVisibleControlledStyleCards();
        });
    });

    const handleChange = debounce((sourceInputId?: string | null) => {
        syncStyleDraftFromDomAndEmit(sourceInputId);
    }, 150);

    const styleInputsFormContainer = document.querySelector('#style-panel')
        || document.querySelector('.style-panel-scroll-area')
        || document.body;
    styleInputsFormContainer.addEventListener('input', (e) => {
        const target = e.target as HTMLElement;
        const trackedInputs = getStyleFormInputsForSnapshot();
        if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
            if (trackedInputs.includes(target)) {
                handleChange(target.id || null);
            }
        }
    });

    styleInputsFormContainer.addEventListener('change', (e) => {
        const target = e.target as HTMLElement;
        const trackedInputs = getStyleFormInputsForSnapshot();
        const isStyleInput = target instanceof HTMLInputElement || target instanceof HTMLSelectElement;

        if (isStyleInput && trackedInputs.includes(target as any)) {
            handleChange((target as HTMLInputElement | HTMLSelectElement).id || null);
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
        ui.styleMarkLinePointStrokeInput.value = active.linePointStrokeColor;
        ui.styleMarkLinePointThicknessInput.value = String(active.linePointThickness);
        ui.styleMarkLinePointPaddingInput.value = String(active.linePointPadding);
        ui.styleMarkLinePointFillInput.value = active.linePointFillColor;
        ui.styleMarkLineBackgroundOpacityInput.value = String(clampOpacityPercent(active.lineBackgroundOpacity, 100));
        ui.styleMarkLineBackgroundVisibleInput.checked = active.lineBackgroundVisible;
        ui.styleLineBackgroundVisibleInput.checked = active.lineBackgroundVisible;
        ui.styleMarkStrokeStyleInput.value = active.strokeStyle;
        ui.styleMarkThicknessInput.value = String(active.thickness);
        const activeSides = getActiveMarkStrokeSides();
        ui.styleMarkStrokeSidesTopInput.checked = activeSides.top;
        ui.styleMarkStrokeSidesLeftInput.checked = activeSides.left;
        ui.styleMarkStrokeSidesRightInput.checked = activeSides.right;
        syncMarkStyleCardVisibility();
        syncVisibleControlledStyleCards();
        syncAllHexPreviewsFromDom();
        if (styleItemPopoverOpen && styleItemPopoverTarget === 'mark' && styleItemPopoverConfig) {
            syncStyleItemPopoverFromConfig(styleItemPopoverConfig);
        } else if (styleItemPopoverOpen) {
            syncPopoverNavigatorUi();
        }
        syncStyleDraftFromDomAndEmit(ui.styleMarkIndexInput.id);
    });

    ui.styleMarkStrokeToggle.addEventListener('change', () => {
        const strokeEnabled = ui.styleMarkStrokeToggle.checked;
        setActiveMarkStrokeLinked(!strokeEnabled);
        if (strokeEnabled) {
            const fillColor = normalizeHexColorInput(ui.styleMarkFillColorInput.value)
                || state.styleInjectionDraft.mark.fillColor
                || DEFAULT_STYLE_INJECTION_DRAFT.mark.fillColor;
            const strokeColor = normalizeHexColorInput(ui.styleMarkStrokeColorInput.value)
                || fillColor;
            if (strokeColor === fillColor) {
                ui.styleMarkStrokeColorInput.value = deriveContrastingStrokeColor(fillColor);
            }
            const thicknessRaw = Number(ui.styleMarkThicknessInput.value);
            if (!Number.isFinite(thicknessRaw) || thicknessRaw <= 0) {
                ui.styleMarkThicknessInput.value = '1';
            }
        } else {
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
        syncStyleDraftFromDomAndEmit(ui.styleMarkStrokeToggle.id);
    });

    [ui.styleMarkStrokeSidesTopInput, ui.styleMarkStrokeSidesLeftInput, ui.styleMarkStrokeSidesRightInput].forEach((input) => {
        input.addEventListener('change', () => {
            syncStyleDraftFromDomAndEmit(input.id);
        });
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
