import { buildLocalStyleOverridesFromDraft, SavedStylePayload, buildDraftFromPayload } from './style-normalization';
import { ui } from './dom';
import { ensureColHeaderColorEnabledLength, ensureColHeaderColorModesLength, ensureColHeaderColorsLength, ensureColHeaderPaintStyleIdsLength, ensureRowColorModesLength, ensureRowPaintStyleIdsLength, getGridColsForChart, getRowColor, getTotalStackedCols, normalizeHexColorInput, recomputeEffectiveStyleSnapshot, setLocalStyleOverrideField, state } from './state';
import { emitStyleDraftUpdated, hydrateStyleTab, markStyleInjectionDirty, setStyleInjectionDraft } from './style-tab';

import type { StyleTemplateChartType, StyleTemplateItem, StyleTemplatePayload, StyleTemplateStoredPayload } from '../shared/style-types';

const MAX_STYLE_TEMPLATES = 20;
const CHART_TYPE_LABELS: Record<StyleTemplateChartType, string> = {
    bar: 'Bar graph',
    line: 'Line graph',
    stackedBar: 'Stacked bar'
};
const TEMPLATE_MARK_FILL_FALLBACK = ['#3B82F6', '#60A5FA', '#A3E635', '#FBBF24'];
const TEMPLATE_MARK_STROKE_FALLBACK = '#111827';
const TEMPLATE_PLOT_AREA_FALLBACK = ['#FFFFFF', '#111827', '#E5E7EB', '#111827'];
const TEMPLATE_THUMBNAIL_BAR_HEIGHTS = [44, 68, 32, 80];
let templateRenameBlurTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeTemplateChartType(value: unknown): StyleTemplateChartType {
    if (value === 'line') return 'line';
    if (value === 'stackedBar' || value === 'stacked') return 'stackedBar';
    return 'bar';
}

function isStoredPayload(payload: StyleTemplatePayload | StyleTemplateStoredPayload): payload is StyleTemplateStoredPayload {
    return Boolean(payload && typeof payload === 'object' && ('common' in payload || 'byChart' in payload));
}

function mergePayload(base?: StyleTemplatePayload, scoped?: StyleTemplatePayload): StyleTemplatePayload {
    return {
        ...(base || {}),
        ...(scoped || {})
    };
}

export function resolveTemplatePayload(template: StyleTemplateItem): StyleTemplatePayload {
    const payload = template.payload as (StyleTemplatePayload | StyleTemplateStoredPayload);
    if (!isStoredPayload(payload)) return payload || {};
    const currentChart = normalizeTemplateChartType(state.chartType);
    return mergePayload(payload.common, payload.byChart?.[currentChart]);
}

export function formatTemplateTime(ts: number): string {
    try {
        return new Date(ts).toLocaleDateString();
    } catch {
        return '-';
    }
}

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function toSavedStylePayload(payload: StyleTemplatePayload): SavedStylePayload {
    return {
        savedCellFillStyle: payload.cellFillStyle,
        savedLineBackgroundStyle: payload.lineBackgroundStyle,
        savedMarkStyle: payload.markStyle,
        savedMarkStyles: payload.markStyles,
        savedRowColors: payload.rowColors,
        savedCellTopStyle: payload.cellTopStyle,
        savedTabRightStyle: payload.tabRightStyle,
        savedGridContainerStyle: payload.gridContainerStyle,
        savedAssistLineStyle: payload.assistLineStyle
    };
}

export function normalizeTemplateNameInput(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.length > 40) return null;
    return trimmed;
}

export function closeTemplateNameEditor() {
    state.editingTemplateId = null;
    state.editingTemplateName = '';
}

function clearPendingTemplateRenameBlur() {
    if (!templateRenameBlurTimer) return;
    clearTimeout(templateRenameBlurTimer);
    templateRenameBlurTimer = null;
}

function focusTemplateRenameInput(id: string) {
    requestAnimationFrame(() => {
        const input = ui.styleTemplateGallery.querySelector<HTMLInputElement>(`[data-template-rename-input-id="${id}"]`);
        if (!input) return;
        input.focus();
        input.select();
    });
}

function startTemplateRename(id: string) {
    const template = state.styleTemplates.find((item) => item.id === id);
    if (!template) return;
    clearPendingTemplateRenameBlur();
    state.editingTemplateId = id;
    state.editingTemplateName = template.name;
    renderStyleTemplateGallery();
    focusTemplateRenameInput(id);
}

function commitTemplateRename(
    id: string,
    rawName?: string,
    options: { cancelOnInvalid?: boolean } = {}
) {
    clearPendingTemplateRenameBlur();
    const template = state.styleTemplates.find((item) => item.id === id);
    if (!template) {
        closeTemplateNameEditor();
        renderStyleTemplateGallery();
        return false;
    }

    const normalized = normalizeTemplateNameInput(rawName ?? state.editingTemplateName ?? template.name);
    if (!normalized) {
        if (options.cancelOnInvalid) {
            closeTemplateNameEditor();
            renderStyleTemplateGallery();
            return false;
        }
        window.alert('템플릿 이름은 1~40자로 입력해야 합니다.');
        focusTemplateRenameInput(id);
        return false;
    }

    const changed = normalized !== template.name;
    closeTemplateNameEditor();
    renderStyleTemplateGallery();
    if (changed) {
        parent.postMessage({ pluginMessage: { type: 'rename_style_template', id, name: normalized, chartType: state.chartType } }, '*');
    }
    return true;
}

function commitCurrentTemplateRename(options: { cancelOnInvalid?: boolean } = {}) {
    if (!state.editingTemplateId) return true;
    const id = state.editingTemplateId;
    const input = ui.styleTemplateGallery.querySelector<HTMLInputElement>(`[data-template-rename-input-id="${id}"]`);
    return commitTemplateRename(id, input?.value ?? state.editingTemplateName, options);
}

function scheduleTemplateRenameCommit(id: string, rawName: string) {
    clearPendingTemplateRenameBlur();
    templateRenameBlurTimer = setTimeout(() => {
        templateRenameBlurTimer = null;
        if (state.editingTemplateId !== id) return;
        commitTemplateRename(id, rawName, { cancelOnInvalid: true });
    }, 0);
}

export function estimateNextTemplateName(): string {
    const names = new Set(state.styleTemplates.map((item) => item.name));
    for (let i = 1; i <= MAX_STYLE_TEMPLATES + 1; i++) {
        const candidate = `Template ${i}`;
        if (!names.has(candidate)) return candidate;
    }
    return `Template ${Date.now()}`;
}

function uniqueColors(colors: string[]): string[] {
    const seen = new Set<string>();
    const next: string[] = [];
    colors.forEach((color) => {
        const normalized = normalizeHexColorInput(color);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        next.push(normalized);
    });
    return next;
}

function resolveTemplateChartLabel(item: StyleTemplateItem): string {
    return CHART_TYPE_LABELS[normalizeTemplateChartType(item.chartType)];
}

function buildMarkSummaryColors(payload: StyleTemplatePayload): string[] {
    const rowColors = uniqueColors(Array.isArray(payload.rowColors) ? payload.rowColors : []);
    const markStyleFillColors = uniqueColors(
        Array.isArray(payload.markStyles)
            ? payload.markStyles.map((style) => style.fillColor || '')
            : []
    );
    const fillColors = rowColors.length > 0
        ? rowColors
        : (markStyleFillColors.length > 0
            ? markStyleFillColors
            : uniqueColors([payload.markStyle?.fillColor || '', ...TEMPLATE_MARK_FILL_FALLBACK]));
    const strokeColor = normalizeHexColorInput(payload.markStyle?.strokeColor) || TEMPLATE_MARK_STROKE_FALLBACK;
    return [...fillColors.slice(0, 4), strokeColor];
}

function buildPlotAreaSummaryColors(payload: StyleTemplatePayload): string[] {
    const resolved = [
        normalizeHexColorInput(payload.cellFillStyle?.color) || TEMPLATE_PLOT_AREA_FALLBACK[0],
        normalizeHexColorInput(payload.gridContainerStyle?.color) || TEMPLATE_PLOT_AREA_FALLBACK[1],
        normalizeHexColorInput(payload.cellTopStyle?.color) || TEMPLATE_PLOT_AREA_FALLBACK[2],
        normalizeHexColorInput(payload.tabRightStyle?.color) || TEMPLATE_PLOT_AREA_FALLBACK[3]
    ];
    return resolved;
}

function renderColorChips(colors: string[], chipClass = 'style-template-color-chip'): string {
    return colors.map((color) => (
        `<span class="${chipClass}" style="background:${escapeHtml(color)}"></span>`
    )).join('');
}

function renderTemplateThumbnail(item: StyleTemplateItem, markColors: string[], plotAreaColors: string[]): string {
    if (item.thumbnailDataUrl) {
        return `<img class="style-template-thumbnail-image" src="${escapeHtml(item.thumbnailDataUrl)}" alt="${escapeHtml(item.name)} thumbnail" />`;
    }

    return `
<div class="style-template-thumbnail-fallback" style="background:${escapeHtml(plotAreaColors[0])}">
  <div class="style-template-thumbnail-axis style-template-thumbnail-axis--y" style="background:${escapeHtml(plotAreaColors[2])}"></div>
  <div class="style-template-thumbnail-axis style-template-thumbnail-axis--x" style="background:${escapeHtml(plotAreaColors[3])}"></div>
  <div class="style-template-thumbnail-bars">
    ${markColors.slice(0, 4).map((color, index) => (
        `<span class="style-template-thumbnail-bar" style="height:${TEMPLATE_THUMBNAIL_BAR_HEIGHTS[index]}%;background:${escapeHtml(color)};border-color:${escapeHtml(plotAreaColors[1])}"></span>`
    )).join('')}
  </div>
</div>`;
}

export function applyTemplateToDraft(template: StyleTemplateItem): boolean {
    const resolvedPayload = resolveTemplatePayload(template);
    const nextDraft = buildDraftFromPayload(toSavedStylePayload(resolvedPayload), {});
    setStyleInjectionDraft(nextDraft);
    hydrateStyleTab(nextDraft);
    const totalCols = state.chartType === 'stackedBar'
        ? getTotalStackedCols()
        : getGridColsForChart(state.chartType, state.cols);
    ensureColHeaderColorsLength(totalCols);
    ensureColHeaderColorEnabledLength(totalCols);
    if (Array.isArray(resolvedPayload.colColors)) {
        state.colHeaderColors = resolvedPayload.colColors
            .map((color) => normalizeHexColorInput(color) || getRowColor(0))
            .slice(0, totalCols);
        ensureColHeaderColorsLength(totalCols);
    }
    if (Array.isArray(resolvedPayload.colColorEnabled)) {
        state.colHeaderColorEnabled = resolvedPayload.colColorEnabled
            .map((flag) => Boolean(flag))
            .slice(0, totalCols);
        ensureColHeaderColorEnabledLength(totalCols);
    }
    if (Array.isArray(resolvedPayload.colColorModes)) {
        state.colHeaderColorModes = resolvedPayload.colColorModes
            .map((value) => value === 'paint_style' ? 'paint_style' : 'hex')
            .slice(0, totalCols);
        ensureColHeaderColorModesLength(totalCols);
    }
    if (Array.isArray(resolvedPayload.colPaintStyleIds)) {
        state.colHeaderPaintStyleIds = resolvedPayload.colPaintStyleIds
            .map((value) => (typeof value === 'string' && value.trim()) ? value : null)
            .slice(0, totalCols);
        ensureColHeaderPaintStyleIdsLength(totalCols);
    }
    if (Array.isArray(resolvedPayload.rowColorModes)) {
        state.rowColorModes = resolvedPayload.rowColorModes
            .map((value) => value === 'paint_style' ? 'paint_style' : 'hex')
            .slice(0, state.rows);
        ensureRowColorModesLength(state.rows);
    }
    if (Array.isArray(resolvedPayload.rowPaintStyleIds)) {
        state.rowPaintStyleIds = resolvedPayload.rowPaintStyleIds
            .map((value) => (typeof value === 'string' && value.trim()) ? value : null)
            .slice(0, state.rows);
        ensureRowPaintStyleIdsLength(state.rows);
    }
    if (state.isInstanceTarget) {
        const draftOverrides = buildLocalStyleOverridesFromDraft(nextDraft);
        setLocalStyleOverrideField('rowColors', draftOverrides.overrides.rowColors);
        if (Array.isArray(resolvedPayload.rowColorModes)) setLocalStyleOverrideField('rowColorModes', state.rowColorModes.slice());
        if (Array.isArray(resolvedPayload.rowPaintStyleIds)) setLocalStyleOverrideField('rowPaintStyleIds', state.rowPaintStyleIds.slice());
        setLocalStyleOverrideField('cellFillStyle', draftOverrides.overrides.cellFillStyle);
        setLocalStyleOverrideField('cellTopStyle', draftOverrides.overrides.cellTopStyle);
        setLocalStyleOverrideField('tabRightStyle', draftOverrides.overrides.tabRightStyle);
        setLocalStyleOverrideField('gridContainerStyle', draftOverrides.overrides.gridContainerStyle);
        setLocalStyleOverrideField('assistLineStyle', draftOverrides.overrides.assistLineStyle);
        setLocalStyleOverrideField('markStyle', draftOverrides.overrides.markStyle);
        setLocalStyleOverrideField('markStyles', draftOverrides.overrides.markStyles);
        setLocalStyleOverrideField('markStrokeEnabledByIndex', draftOverrides.overrides.markStrokeEnabledByIndex);
        setLocalStyleOverrideField('markStrokeSidesByIndex', draftOverrides.overrides.markStrokeSidesByIndex);
        setLocalStyleOverrideField('rowStrokeStyles', draftOverrides.overrides.rowStrokeStyles);
        setLocalStyleOverrideField('colStrokeStyle', draftOverrides.overrides.colStrokeStyle);
        setLocalStyleOverrideField('colColors', ensureColHeaderColorsLength(totalCols).slice());
        setLocalStyleOverrideField('colColorModes', ensureColHeaderColorModesLength(totalCols).slice());
        setLocalStyleOverrideField('colPaintStyleIds', ensureColHeaderPaintStyleIdsLength(totalCols).slice());
        setLocalStyleOverrideField('colColorEnabled', ensureColHeaderColorEnabledLength(totalCols).slice());
        recomputeEffectiveStyleSnapshot();
    }
    markStyleInjectionDirty();
    state.selectedStyleTemplateId = template.id;
    emitStyleDraftUpdated();
    renderStyleTemplateGallery();
    return true;
}

export function renderTemplateCard(item: StyleTemplateItem): string {
    const payload = resolveTemplatePayload(item);
    const selectedClass = state.selectedStyleTemplateId === item.id ? ' selected' : '';
    const editing = state.editingTemplateId === item.id;
    const chartLabel = resolveTemplateChartLabel(item);
    const markColors = buildMarkSummaryColors(payload);
    const plotAreaColors = buildPlotAreaSummaryColors(payload);
    const escapedName = escapeHtml(item.name);

    return `
<div class="style-template-card${selectedClass}" data-template-id="${item.id}">
  <div class="style-template-card-header">
    <div class="style-template-card-header-copy">
      ${editing
            ? `<input class="style-template-card-title-input" data-template-rename-input-id="${item.id}" value="${escapeHtml(state.editingTemplateName || item.name)}" maxlength="40" />`
            : `<button class="style-template-card-title-button" data-template-rename-id="${item.id}" type="button">
                 <span class="style-template-card-title">${escapedName}</span>
               </button>`
        }
      <div class="style-template-card-subtitle">${escapeHtml(chartLabel)}</div>
    </div>
    <button class="style-template-card-close" data-template-delete-id="${item.id}" type="button" aria-label="Delete template">×</button>
  </div>
  <div class="style-template-thumbnail">
    ${renderTemplateThumbnail(item, markColors, plotAreaColors)}
  </div>
  <div class="style-template-card-section-title">Color</div>
  <div class="style-template-card-color-panel">
    <div class="style-template-card-color-row">
      <span class="style-template-card-color-label">Mark</span>
      <div class="style-template-card-color-chips">
        ${renderColorChips(markColors)}
      </div>
    </div>
    <div class="style-template-card-color-divider"></div>
    <div class="style-template-card-color-row">
      <span class="style-template-card-color-label">Plot Area</span>
      <div class="style-template-card-color-chips">
        ${renderColorChips(plotAreaColors)}
      </div>
    </div>
  </div>
  <button class="style-template-card-apply" data-template-apply-id="${item.id}" type="button">Apply</button>
</div>`;
}

export function renderStyleTemplateGallery() {
    const gallery = ui.styleTemplateGallery;
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

export function bindStyleTemplateEvents() {
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
            if (state.editingTemplateId && state.editingTemplateId !== id) {
                commitCurrentTemplateRename({ cancelOnInvalid: true });
            }
            if (state.editingTemplateId === id) return;
            startTemplateRename(id);
            return;
        }

        const applyBtn = target.closest<HTMLButtonElement>('[data-template-apply-id]');
        if (applyBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = applyBtn.dataset.templateApplyId;
            if (!id) return;
            if (state.editingTemplateId) {
                commitCurrentTemplateRename({ cancelOnInvalid: true });
            }
            const template = state.styleTemplates.find((item) => item.id === id);
            if (!template) return;
            applyTemplateToDraft(template);
            return;
        }

        const deleteBtn = target.closest<HTMLButtonElement>('[data-template-delete-id]');
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            clearPendingTemplateRenameBlur();
            const id = deleteBtn.dataset.templateDeleteId;
            if (!id) return;
            if (state.editingTemplateId === id) {
                closeTemplateNameEditor();
                renderStyleTemplateGallery();
            }
            if (!window.confirm('이 템플릿을 삭제하시겠습니까?')) return;
            parent.postMessage({ pluginMessage: { type: 'delete_style_template', id, chartType: state.chartType } }, '*');
            return;
        }

        const renameInput = target.closest<HTMLInputElement>('[data-template-rename-input-id]');
        if (renameInput) return;

        const card = target.closest<HTMLElement>('[data-template-id]');
        if (!card) return;
        e.stopPropagation();
        const id = card.dataset.templateId;
        if (!id) return;
        if (state.editingTemplateId && state.editingTemplateId !== id) {
            commitCurrentTemplateRename({ cancelOnInvalid: true });
        }
        if (state.selectedStyleTemplateId !== id) {
            state.selectedStyleTemplateId = id;
            renderStyleTemplateGallery();
        }
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
            commitTemplateRename(id, input.value);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            clearPendingTemplateRenameBlur();
            closeTemplateNameEditor();
            renderStyleTemplateGallery();
        }
    });

    ui.styleTemplateGallery.addEventListener('input', (e) => {
        const target = e.target as HTMLElement | null;
        const input = target?.closest<HTMLInputElement>('[data-template-rename-input-id]');
        if (!input) return;
        state.editingTemplateName = input.value;
    });

    ui.styleTemplateGallery.addEventListener('focusout', (e) => {
        const target = e.target as HTMLElement | null;
        const input = target?.closest<HTMLInputElement>('[data-template-rename-input-id]');
        if (!input) return;
        const id = input.dataset.templateRenameInputId;
        if (!id) return;
        scheduleTemplateRenameCommit(id, input.value);
    });

    document.addEventListener('click', (e) => {
        if (!state.selectedStyleTemplateId) return;
        const isInsideTemplateCard = e.composedPath().some((node) => (
            node instanceof HTMLElement && Boolean(node.closest('#style-template-gallery [data-template-id]'))
        ));
        if (isInsideTemplateCard) return;
        state.selectedStyleTemplateId = null;
        renderStyleTemplateGallery();
    });
}
