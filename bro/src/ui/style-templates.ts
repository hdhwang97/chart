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
const TEMPLATE_THUMBNAIL_LINE_POINTS = [
    [14, 62],
    [34, 28],
    [58, 46],
    [82, 20]
] as const;
type TemplateColorChipKind = 'mark-fill' | 'mark-stroke' | 'line-stroke' | 'line-background' | 'background' | 'plot-area' | 'y-axis' | 'x-axis';
type ColorChipDescriptor = {
    color: string;
    label: string;
    kind: TemplateColorChipKind;
    index?: number;
    opacity?: number;
    borderColor?: string;
};
type TemplateColorEditorState = { templateId: string; chip: ColorChipDescriptor } | null;
let templateRenameBlurTimer: ReturnType<typeof setTimeout> | null = null;
let activeTemplateColorEditor: TemplateColorEditorState = null;

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

function cloneTemplatePayload(payload: StyleTemplatePayload): StyleTemplatePayload {
    return JSON.parse(JSON.stringify(payload || {})) as StyleTemplatePayload;
}

function ensureMarkStyleAtIndex(payload: StyleTemplatePayload, index: number) {
    if (!Array.isArray(payload.markStyles)) payload.markStyles = [];
    while (payload.markStyles.length <= index) {
        payload.markStyles.push({});
    }
    payload.markStyles[index] = {
        ...(payload.markStyles[index] || {})
    };
}

function updateTemplatePayloadColor(
    payload: StyleTemplatePayload,
    chartType: StyleTemplateChartType,
    chip: ColorChipDescriptor,
    color: string
): StyleTemplatePayload {
    const next = cloneTemplatePayload(payload);

    if (chip.kind === 'mark-fill') {
        const index = Math.max(0, chip.index || 0);
        const rowColorIndex = chartType === 'stackedBar' ? index + 1 : index;
        if (!Array.isArray(next.rowColors)) next.rowColors = [];
        while (next.rowColors.length <= rowColorIndex) next.rowColors.push('');
        next.rowColors[rowColorIndex] = color;
        ensureMarkStyleAtIndex(next, index);
        next.markStyles![index].fillColor = color;
        if (index === 0) {
            next.markStyle = {
                ...(next.markStyle || {}),
                fillColor: color
            };
        }
        return next;
    }

    if (chip.kind === 'line-stroke') {
        const index = Math.max(0, chip.index || 0);
        ensureMarkStyleAtIndex(next, index);
        next.markStyles![index] = {
            ...(next.markStyles![index] || {}),
            color
        };
        if (index === 0) {
            next.markStyle = {
                ...(next.markStyle || {}),
                strokeColor: color
            };
        }
        return next;
    }

    if (chip.kind === 'line-background') {
        const index = Math.max(0, chip.index || 0);
        ensureMarkStyleAtIndex(next, index);
        next.markStyles![index] = {
            ...(next.markStyles![index] || {}),
            lineBackgroundColor: color
        };
        next.lineBackgroundStyle = {
            ...(next.lineBackgroundStyle || {}),
            color
        };
        if (index === 0) {
            next.markStyle = {
                ...(next.markStyle || {}),
                lineBackgroundColor: color
            };
        }
        return next;
    }

    if (chip.kind === 'mark-stroke') {
        next.markStyle = {
            ...(next.markStyle || {}),
            strokeColor: color
        };
        if (Array.isArray(next.markStyles) && next.markStyles.length > 0) {
            next.markStyles = next.markStyles.map((style) => ({
                ...(style || {}),
                strokeColor: color
            }));
        }
        return next;
    }

    if (chip.kind === 'background') {
        next.cellFillStyle = { ...(next.cellFillStyle || {}), color };
        return next;
    }

    if (chip.kind === 'plot-area') {
        next.gridContainerStyle = { ...(next.gridContainerStyle || {}), color };
        return next;
    }

    if (chip.kind === 'y-axis') {
        next.cellTopStyle = { ...(next.cellTopStyle || {}), color };
        return next;
    }

    next.tabRightStyle = { ...(next.tabRightStyle || {}), color };
    return next;
}

function updateTemplateColorPopoverPreview(rawValue: string) {
    const normalized = normalizeHexColorInput(rawValue);
    const preview = normalized || '#FFFFFF';
    ui.templateColorPopoverPreview.style.backgroundColor = preview;
    ui.templateColorPopoverInputPreview.style.backgroundColor = preview;
    ui.templateColorPopoverInput.classList.toggle('style-color-hex-error', !normalized);
}

function closeTemplateColorPopover() {
    activeTemplateColorEditor = null;
    ui.templateColorPopover.classList.add('hidden');
    ui.templateColorPopoverInput.classList.remove('style-color-hex-error');
}

function positionTemplateColorPopover(anchorRect: DOMRect | { left: number; top: number; right: number; bottom: number; width?: number; height?: number }) {
    const popover = ui.templateColorPopover;
    const rect = {
        left: anchorRect.left,
        top: anchorRect.top,
        right: anchorRect.right,
        bottom: anchorRect.bottom,
        width: 'width' in anchorRect ? (anchorRect.width || (anchorRect.right - anchorRect.left)) : (anchorRect.right - anchorRect.left),
        height: 'height' in anchorRect ? (anchorRect.height || (anchorRect.bottom - anchorRect.top)) : (anchorRect.bottom - anchorRect.top)
    };
    requestAnimationFrame(() => {
        const popoverWidth = popover.offsetWidth || 224;
        const popoverHeight = popover.offsetHeight || 110;
        let left = rect.left + (rect.width / 2) - (popoverWidth / 2);
        left = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8));
        let top = rect.bottom + 8;
        if (top + popoverHeight > window.innerHeight - 8) {
            top = Math.max(8, rect.top - popoverHeight - 8);
        }
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    });
}

function openTemplateColorPopover(templateId: string, chip: ColorChipDescriptor, anchorRect: DOMRect) {
    activeTemplateColorEditor = { templateId, chip };
    ui.templateColorPopoverTitle.textContent = chip.label;
    ui.templateColorPopoverInput.value = chip.color;
    updateTemplateColorPopoverPreview(chip.color);
    ui.templateColorPopover.classList.remove('hidden');
    positionTemplateColorPopover(anchorRect);
    requestAnimationFrame(() => {
        ui.templateColorPopoverInput.focus();
        ui.templateColorPopoverInput.select();
    });
}

function commitTemplateColorPopover() {
    const editor = activeTemplateColorEditor;
    if (!editor || state.styleTemplateOverwritePendingId) return;
    const normalized = normalizeHexColorInput(ui.templateColorPopoverInput.value);
    if (!normalized) {
        updateTemplateColorPopoverPreview(ui.templateColorPopoverInput.value);
        ui.templateColorPopoverInput.focus();
        ui.templateColorPopoverInput.select();
        return;
    }
    const template = state.styleTemplates.find((item) => item.id === editor.templateId);
    if (!template) {
        closeTemplateColorPopover();
        return;
    }
    const nextPayload = updateTemplatePayloadColor(
        resolveTemplatePayload(template),
        normalizeTemplateChartType(template.chartType),
        editor.chip,
        normalized
    );
    state.styleTemplateOverwritePendingId = editor.templateId;
    closeTemplateColorPopover();
    renderStyleTemplateGallery();
    parent.postMessage({
        pluginMessage: {
            type: 'overwrite_style_template',
            id: editor.templateId,
            payload: nextPayload,
            chartType: state.chartType
        }
    }, '*');
}

export function estimateNextTemplateName(): string {
    const names = new Set(state.styleTemplates.map((item) => item.name));
    for (let i = 1; i <= MAX_STYLE_TEMPLATES + 1; i++) {
        const candidate = `Template ${i}`;
        if (!names.has(candidate)) return candidate;
    }
    return `Template ${Date.now()}`;
}

function clampTemplateChipOpacity(value: unknown, fallback = 1): number {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return fallback;
    if (raw <= 1) return Math.max(0, Math.min(1, raw));
    return Math.max(0, Math.min(1, raw / 100));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const normalized = normalizeHexColorInput(hex);
    if (!normalized) return null;
    return {
        r: Number.parseInt(normalized.slice(1, 3), 16),
        g: Number.parseInt(normalized.slice(3, 5), 16),
        b: Number.parseInt(normalized.slice(5, 7), 16)
    };
}

function toChipCssColor(color: string, opacity?: number): string {
    const normalized = normalizeHexColorInput(color) || '#FFFFFF';
    const alpha = clampTemplateChipOpacity(opacity, 1);
    if (alpha >= 0.999) return normalized;
    const rgb = hexToRgb(normalized);
    if (!rgb) return normalized;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function getTemplatePrimaryMarkStyle(payload: StyleTemplatePayload) {
    if (Array.isArray(payload.markStyles) && payload.markStyles.length > 0) {
        return payload.markStyles[0] || payload.markStyle || {};
    }
    return payload.markStyle || {};
}

function isMarkStrokeEnabledAtIndex(payload: StyleTemplatePayload, index: number): boolean {
    if (Array.isArray(payload.markStyles) && typeof payload.markStyles[index]?.enabled === 'boolean') {
        return Boolean(payload.markStyles[index]?.enabled);
    }
    if (typeof payload.markStyle?.enabled === 'boolean') {
        return payload.markStyle.enabled;
    }
    return true;
}

function resolveTemplateStrokeColor(payload: StyleTemplatePayload): string {
    const explicit = Array.isArray(payload.markStyles)
        ? payload.markStyles.map((style) => normalizeHexColorInput(style?.strokeColor)).find(Boolean)
        : null;
    return explicit
        || normalizeHexColorInput(payload.markStyle?.strokeColor)
        || TEMPLATE_MARK_STROKE_FALLBACK;
}

function resolveBarLikeFillDescriptors(payload: StyleTemplatePayload, chartType: StyleTemplateChartType): ColorChipDescriptor[] {
    const styleColors = Array.isArray(payload.markStyles)
        ? payload.markStyles
            .map((style, index) => ({
                color: normalizeHexColorInput(style?.fillColor) || TEMPLATE_MARK_FILL_FALLBACK[index % TEMPLATE_MARK_FILL_FALLBACK.length],
                label: `Mark Fill ${index + 1}`,
                kind: 'mark-fill' as const,
                index
            }))
        : [];
    if (styleColors.length > 0) return styleColors.slice(0, 4);

    const rowColorSource = Array.isArray(payload.rowColors)
        ? (chartType === 'stackedBar' ? payload.rowColors.slice(1) : payload.rowColors.slice())
        : [];
    if (rowColorSource.length > 0) {
        return rowColorSource.slice(0, 4).map((color, index) => ({
            color: normalizeHexColorInput(color) || TEMPLATE_MARK_FILL_FALLBACK[index % TEMPLATE_MARK_FILL_FALLBACK.length],
            label: `Mark Fill ${index + 1}`,
            kind: 'mark-fill' as const,
            index
        }));
    }

    const fallbackColor = normalizeHexColorInput(payload.markStyle?.fillColor);
    return TEMPLATE_MARK_FILL_FALLBACK.slice(0, 4).map((color, index) => ({
        color: index === 0 && fallbackColor ? fallbackColor : color,
        label: `Mark Fill ${index + 1}`,
        kind: 'mark-fill' as const,
        index
    }));
}

function resolveLineSeriesDescriptors(payload: StyleTemplatePayload): ColorChipDescriptor[] {
    const styles = Array.isArray(payload.markStyles) && payload.markStyles.length > 0
        ? payload.markStyles
        : [getTemplatePrimaryMarkStyle(payload)];
    return styles.slice(0, 4).flatMap((style, index) => {
        const strokeColor = normalizeHexColorInput(style?.strokeColor)
            || normalizeHexColorInput(payload.markStyle?.strokeColor)
            || TEMPLATE_MARK_FILL_FALLBACK[index % TEMPLATE_MARK_FILL_FALLBACK.length];
        const areaColor = normalizeHexColorInput(style?.lineBackgroundColor)
            || normalizeHexColorInput(payload.markStyle?.lineBackgroundColor)
            || normalizeHexColorInput(payload.lineBackgroundStyle?.color)
            || strokeColor;
        const lineBackgroundVisible = typeof style?.lineBackgroundVisible === 'boolean'
            ? style.lineBackgroundVisible
            : (typeof payload.markStyle?.lineBackgroundVisible === 'boolean'
                ? payload.markStyle.lineBackgroundVisible
                : (typeof payload.lineBackgroundStyle?.visible === 'boolean'
                    ? payload.lineBackgroundStyle.visible
                    : true));
        const descriptors: ColorChipDescriptor[] = [
            {
                color: strokeColor,
                label: `Line ${index + 1}`,
                kind: 'line-stroke' as const,
                index
            }
        ];
        if (lineBackgroundVisible) {
            descriptors.push({
                color: areaColor,
                label: `Line BG ${index + 1}`,
                kind: 'line-background' as const,
                index,
                opacity: clampTemplateChipOpacity(style?.lineBackgroundOpacity ?? payload.markStyle?.lineBackgroundOpacity, 1),
                borderColor: isMarkStrokeEnabledAtIndex(payload, index) ? strokeColor : '#D1D5DB'
            });
        }
        return descriptors;
    });
}

function resolveTemplateChartLabel(item: StyleTemplateItem): string {
    return CHART_TYPE_LABELS[normalizeTemplateChartType(item.chartType)];
}

function isTemplateStrokeEnabled(payload: StyleTemplatePayload): boolean {
    if (Array.isArray(payload.markStyles)) {
        const explicit = payload.markStyles
            .map((style) => style?.enabled)
            .filter((value): value is boolean => typeof value === 'boolean');
        if (explicit.length > 0) return explicit.some(Boolean);
    }
    if (typeof payload.markStyle?.enabled === 'boolean') {
        return payload.markStyle.enabled;
    }
    return true;
}

function buildMarkSummaryDescriptors(payload: StyleTemplatePayload, chartType: StyleTemplateChartType): ColorChipDescriptor[] {
    if (chartType === 'line') {
        return resolveLineSeriesDescriptors(payload);
    }

    const descriptors: ColorChipDescriptor[] = resolveBarLikeFillDescriptors(payload, chartType);
    if (isTemplateStrokeEnabled(payload)) {
        descriptors.push({
            color: resolveTemplateStrokeColor(payload),
            label: 'Mark Stroke',
            kind: 'mark-stroke'
        });
    }
    return descriptors;
}

function buildPlotAreaSummaryDescriptors(payload: StyleTemplatePayload): ColorChipDescriptor[] {
    return [
        {
            color: normalizeHexColorInput(payload.cellFillStyle?.color) || TEMPLATE_PLOT_AREA_FALLBACK[0],
            label: 'Background',
            kind: 'background'
        },
        {
            color: normalizeHexColorInput(payload.gridContainerStyle?.color) || TEMPLATE_PLOT_AREA_FALLBACK[1],
            label: 'Plot Area',
            kind: 'plot-area'
        },
        {
            color: normalizeHexColorInput(payload.cellTopStyle?.color) || TEMPLATE_PLOT_AREA_FALLBACK[2],
            label: 'Y-axis line',
            kind: 'y-axis'
        },
        {
            color: normalizeHexColorInput(payload.tabRightStyle?.color) || TEMPLATE_PLOT_AREA_FALLBACK[3],
            label: 'X-axis line',
            kind: 'x-axis'
        }
    ];
}

function renderColorChips(templateId: string, chips: ColorChipDescriptor[], chipClass = 'style-template-color-chip'): string {
    return chips.map(({ color, label, kind, index, opacity, borderColor }) => {
        const safeOpacity = clampTemplateChipOpacity(opacity, 1);
        const tooltip = safeOpacity < 0.999
            ? `${label}: ${color} (${Math.round(safeOpacity * 100)}%)`
            : `${label}: ${color}`;
        const chipStyle = [
            `background:${escapeHtml(toChipCssColor(color, safeOpacity))}`,
            `border-color:${escapeHtml(normalizeHexColorInput(borderColor) || '#D1D5DB')}`
        ].join(';');
        return `<button class="style-template-color-chip-wrap" type="button" aria-label="${escapeHtml(tooltip)}" data-template-color-chip="true" data-template-id="${templateId}" data-template-color-kind="${kind}" data-template-color-label="${escapeHtml(label)}" data-template-color-value="${escapeHtml(color)}"${typeof index === 'number' ? ` data-template-color-index="${index}"` : ''}>
            <span class="${chipClass}" style="${chipStyle}"></span>
            <span class="style-template-color-chip-tooltip">${escapeHtml(tooltip)}</span>
        </button>`;
    }).join('');
}

function renderLineTemplateThumbnail(markChips: ColorChipDescriptor[], plotAreaChips: ColorChipDescriptor[]): string {
    const lineStrokes = markChips.filter((chip) => chip.kind === 'line-stroke').slice(0, 3);
    const lineBackgrounds = markChips.filter((chip) => chip.kind === 'line-background').slice(0, 3);
    const layerCount = Math.max(lineStrokes.length, lineBackgrounds.length, 1);
    const layers = Array.from({ length: layerCount }, (_, index) => ({
        stroke: lineStrokes[index]?.color || TEMPLATE_MARK_FILL_FALLBACK[index % TEMPLATE_MARK_FILL_FALLBACK.length],
        area: lineBackgrounds[index]?.color || lineStrokes[index]?.color || TEMPLATE_MARK_FILL_FALLBACK[index % TEMPLATE_MARK_FILL_FALLBACK.length],
        opacity: lineBackgrounds[index]?.opacity ?? 0.35
    }));
    return `
<div class="style-template-thumbnail-fallback style-template-thumbnail-fallback--line" style="background:${escapeHtml(plotAreaChips[0]?.color || TEMPLATE_PLOT_AREA_FALLBACK[0])}">
  <div class="style-template-thumbnail-axis style-template-thumbnail-axis--y" style="background:${escapeHtml(plotAreaChips[2]?.color || TEMPLATE_PLOT_AREA_FALLBACK[2])}"></div>
  <div class="style-template-thumbnail-axis style-template-thumbnail-axis--x" style="background:${escapeHtml(plotAreaChips[3]?.color || TEMPLATE_PLOT_AREA_FALLBACK[3])}"></div>
  <div class="style-template-thumbnail-line-grid" style="background:${escapeHtml(plotAreaChips[1]?.color || TEMPLATE_PLOT_AREA_FALLBACK[1])}"></div>
  <div class="style-template-thumbnail-lines">
    ${layers.map((chip, index) => {
        const offset = index * 4;
        const points = TEMPLATE_THUMBNAIL_LINE_POINTS
            .map(([x, y]) => `${x},${Math.max(10, Math.min(82, y + offset))}`)
            .join(' ');
        const areaPoints = `14,72 ${points} 82,72`;
        return `<svg class="style-template-thumbnail-line-layer" viewBox="0 0 96 76" preserveAspectRatio="none" aria-hidden="true">
            <polygon points="${areaPoints}" fill="${escapeHtml(toChipCssColor(chip.area, chip.opacity))}" stroke="none"></polygon>
            <polyline points="${points}" fill="none" stroke="${escapeHtml(normalizeHexColorInput(chip.stroke) || TEMPLATE_MARK_STROKE_FALLBACK)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
        </svg>`;
    }).join('')}
  </div>
</div>`;
}

function renderTemplateThumbnail(item: StyleTemplateItem, chartType: StyleTemplateChartType, markChips: ColorChipDescriptor[], plotAreaChips: ColorChipDescriptor[]): string {
    if (item.thumbnailDataUrl) {
        return `<img class="style-template-thumbnail-image" src="${escapeHtml(item.thumbnailDataUrl)}" alt="${escapeHtml(item.name)} thumbnail" />`;
    }

    if (chartType === 'line') {
        return renderLineTemplateThumbnail(markChips, plotAreaChips);
    }

    const markColors = markChips.map((chip) => toChipCssColor(chip.color, chip.opacity));
    const plotAreaColors = plotAreaChips.map((chip) => chip.color);

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
    const chartType = normalizeTemplateChartType(item.chartType);
    const selectedClass = state.selectedStyleTemplateId === item.id ? ' selected' : '';
    const isSelected = state.selectedStyleTemplateId === item.id;
    const isOverwritePending = state.styleTemplateOverwritePendingId === item.id;
    const editing = state.editingTemplateId === item.id;
    const chartLabel = resolveTemplateChartLabel(item);
    const markChips = buildMarkSummaryDescriptors(payload, chartType);
    const plotAreaChips = buildPlotAreaSummaryDescriptors(payload);
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
    ${renderTemplateThumbnail(item, chartType, markChips, plotAreaChips)}
  </div>
  <div class="style-template-card-section-title">Color</div>
  <div class="style-template-card-color-panel">
    <div class="style-template-card-color-row">
      <span class="style-template-card-color-label">Mark</span>
      <div class="style-template-card-color-chips">
        ${renderColorChips(item.id, markChips)}
      </div>
    </div>
    <div class="style-template-card-color-divider"></div>
    <div class="style-template-card-color-row">
      <span class="style-template-card-color-label">Plot Area</span>
      <div class="style-template-card-color-chips">
        ${renderColorChips(item.id, plotAreaChips)}
      </div>
    </div>
  </div>
  <div class="style-template-card-cta-row${isSelected ? ' is-selected' : ''}">
    ${isSelected
        ? `<button class="style-template-card-overwrite${isOverwritePending ? ' is-pending' : ''}" data-template-overwrite-id="${item.id}" type="button"${isOverwritePending ? ' disabled' : ''}>${isOverwritePending ? 'Saving...' : 'Overwrite'}</button>`
        : ''
    }
    <button class="style-template-card-apply${isSelected ? '' : ' is-full'}" data-template-apply-id="${item.id}" type="button">Apply</button>
  </div>
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
    if (state.styleTemplateOverwritePendingId && !state.styleTemplates.some((item) => item.id === state.styleTemplateOverwritePendingId)) {
        state.styleTemplateOverwritePendingId = null;
    }
    if (state.selectedStyleTemplateId && !state.styleTemplates.some((item) => item.id === state.selectedStyleTemplateId)) {
        state.selectedStyleTemplateId = null;
    }
    if (state.editingTemplateId && !state.styleTemplates.some((item) => item.id === state.editingTemplateId)) {
        closeTemplateNameEditor();
    }
    if (activeTemplateColorEditor && !state.styleTemplates.some((item) => item.id === activeTemplateColorEditor?.templateId)) {
        closeTemplateColorPopover();
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
    ui.templateColorPopover.addEventListener('click', (e) => e.stopPropagation());
    ui.templateColorPopoverCloseBtn.addEventListener('click', () => closeTemplateColorPopover());
    ui.templateColorPopoverCancelBtn.addEventListener('click', () => closeTemplateColorPopover());
    ui.templateColorPopoverSaveBtn.addEventListener('click', () => commitTemplateColorPopover());
    ui.templateColorPopoverInput.addEventListener('input', () => {
        updateTemplateColorPopoverPreview(ui.templateColorPopoverInput.value);
    });
    ui.templateColorPopoverInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitTemplateColorPopover();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closeTemplateColorPopover();
        }
    });

    ui.styleTemplateGallery.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;

        const colorChipBtn = target.closest<HTMLButtonElement>('[data-template-color-chip="true"]');
        if (colorChipBtn) {
            e.preventDefault();
            e.stopPropagation();
            const templateId = colorChipBtn.dataset.templateId;
            const kind = colorChipBtn.dataset.templateColorKind as TemplateColorChipKind | undefined;
            const label = colorChipBtn.dataset.templateColorLabel;
            const color = normalizeHexColorInput(colorChipBtn.dataset.templateColorValue) || '#FFFFFF';
            if (!templateId || !kind || !label) return;
            if (state.editingTemplateId) {
                const committed = commitCurrentTemplateRename({ cancelOnInvalid: false });
                if (!committed) return;
            }
            if (state.selectedStyleTemplateId !== templateId) {
                state.selectedStyleTemplateId = templateId;
                renderStyleTemplateGallery();
            }
            openTemplateColorPopover(templateId, {
                color,
                label,
                kind,
                index: Number.isFinite(Number(colorChipBtn.dataset.templateColorIndex))
                    ? Number(colorChipBtn.dataset.templateColorIndex)
                    : undefined
            }, colorChipBtn.getBoundingClientRect());
            return;
        }

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
            closeTemplateColorPopover();
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

        const overwriteBtn = target.closest<HTMLButtonElement>('[data-template-overwrite-id]');
        if (overwriteBtn) {
            e.preventDefault();
            e.stopPropagation();
            closeTemplateColorPopover();
            const id = overwriteBtn.dataset.templateOverwriteId;
            if (!id || state.styleTemplateOverwritePendingId) return;
            if (state.editingTemplateId) {
                const committed = commitCurrentTemplateRename({ cancelOnInvalid: false });
                if (!committed) return;
            }
            const template = state.styleTemplates.find((item) => item.id === id);
            if (!template) return;
            if (!window.confirm(`현재 스타일로 "${template.name}" 템플릿을 덮어쓸까요?`)) return;
            state.styleTemplateOverwritePendingId = id;
            renderStyleTemplateGallery();
            document.dispatchEvent(new CustomEvent('request-style-template-overwrite', {
                detail: { id }
            }));
            return;
        }

        const deleteBtn = target.closest<HTMLButtonElement>('[data-template-delete-id]');
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            closeTemplateColorPopover();
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
        if (state.styleTemplateOverwritePendingId) return;
        const path = e.composedPath();
        const isInsideTemplateCard = path.some((node) => (
            node instanceof HTMLElement && Boolean(node.closest('#style-template-gallery [data-template-id]'))
        ));
        const isInsideTemplateColorPopover = path.some((node) => (
            node instanceof HTMLElement && Boolean(node.closest('#template-color-popover'))
        ));
        if (isInsideTemplateCard || isInsideTemplateColorPopover) return;
        closeTemplateColorPopover();
        state.selectedStyleTemplateId = null;
        renderStyleTemplateGallery();
    });
}
