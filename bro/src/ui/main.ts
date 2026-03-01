import './style.css';
import {
    state,
    CHART_ICONS,
    initData,
    getTotalStackedCols,
    getGridColsForChart,
    applyIncomingRowColors,
    ensureRowColorsLength,
    ensureRowColorModesLength,
    ensureRowPaintStyleIdsLength,
    ensureRowHeaderLabelsLength,
    ensureColHeaderColorsLength,
    ensureColHeaderColorModesLength,
    ensureColHeaderPaintStyleIdsLength,
    ensureColHeaderColorEnabledLength,
    ensureColHeaderTitlesLength,
    getDefaultRowColor,
    getRowColor,
    normalizeHexColorInput,
    recomputeEffectiveStyleSnapshot,
    resetLocalStyleOverrideState,
    setLocalStyleOverrideField,
    setLocalStyleOverrideSnapshot
} from './state';
import { ui } from './dom';
import { renderGrid } from './grid';
import { renderPreview } from './preview';
import { setMode, toggleMode, updateModeButtonState, checkCtaValidation, syncYMaxValidationUi, applyModeLocks } from './mode';
import { handleCsvUpload, downloadCsv, removeCsv, updateCsvUi } from './csv';
import { addRow, addColumn, handleDimensionInput, updateGridSize, syncMarkCountFromRows, syncRowsFromMarkCount, applySegmentCountToAllGroups } from './data-ops';
import { goToStep, selectType, resetData, updateSettingInputs, submitData } from './steps';
import { switchTab, handleStyleExtracted, setDataTabRenderer, refreshExportPreview } from './export';
import { bindStyleTabEvents, buildTemplatePayloadFromDraft, buildLocalStyleOverridesFromDraft, commitStyleColorPopoverIfOpen, forceCloseStyleColorPopover, initializeStyleTabDraft, readStyleTabDraft, renderStyleTemplateGallery, requestNewTemplateName, setStyleInjectionDraft, setStyleTemplateList, setStyleTemplateMode, syncAllHexPreviewsFromDom, syncMarkStylesFromHeaderColors, syncStyleTabDraftFromExtracted, validateStyleTabDraft } from './style-tab';
import type { ColorMode, LocalStyleOverrideMask, LocalStyleOverrides, PaintStyleSelection } from '../shared/style-types';
import { initGraphSettingTooltip, refreshGraphSettingTooltipContent } from './components/graph-setting-tooltip';

// ==========================================
// UI ENTRY POINT
// ==========================================

declare const iro: any;

let uiInitialized = false;
const pendingMessages: any[] = [];
let assistLinePopoverOpen = false;
let rowColorPopoverOpen = false;
let activeColorTarget: { type: 'row' | 'col'; index: number } | null = null;
let rowColorPicker: any = null;
let isSyncingFromPicker = false;
let localPaintStyles: PaintStyleSelection[] = [];
let rowColorStyleEditMode = false;
let rowColorDraftHex: string | null = null;
let rowColorDraftMode: ColorMode | null = null;
let rowColorDraftStyleId: string | null = null;
let rowColorDraftColReset = false;

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

function buildRowColorFallback(chartType: string, source: unknown): string[] {
    const colors = Array.isArray(source) ? source : [];
    const normalized = colors
        .map((c) => normalizeHexColorInput(c))
        .filter((c): c is string => Boolean(c));

    if (chartType === 'stackedBar' || chartType === 'stacked') {
        return [getDefaultRowColor(0), ...normalized];
    }
    return normalized;
}

function applyRowColorsFromPayload(
    chartType: string,
    rowCount: number,
    incomingRowColors: unknown,
    fallbackColors: unknown
) {
    const fallback = buildRowColorFallback(chartType, fallbackColors);
    return applyIncomingRowColors(incomingRowColors, rowCount, fallback);
}

function applyRowHeaderLabelsFromPayload(
    incoming: unknown,
    rowCount: number,
    chartType: string
) {
    const source = Array.isArray(incoming) ? incoming : [];
    state.rowHeaderLabels = source.map((label) => (
        typeof label === 'string' ? label.trim() : ''
    ));
    return ensureRowHeaderLabelsLength(rowCount, chartType);
}

function applyColHeaderTitlesFromPayload(
    incoming: unknown,
    colCount: number,
    chartType: string
) {
    const source = Array.isArray(incoming) ? incoming : [];
    state.colHeaderTitles = source.map((label) => (
        typeof label === 'string' ? label.trim() : ''
    ));
    return ensureColHeaderTitlesLength(colCount, chartType);
}

function normalizeIncomingLocalMask(value: unknown): LocalStyleOverrideMask {
    if (!value || typeof value !== 'object') return {};
    const source = value as Record<string, unknown>;
    const keys: Array<keyof LocalStyleOverrideMask> = [
        'rowColors', 'rowColorModes', 'rowPaintStyleIds',
        'colColors', 'colColorModes', 'colPaintStyleIds', 'colColorEnabled', 'markColorSource',
        'assistLineVisible', 'assistLineEnabled',
        'cellFillStyle', 'cellTopStyle', 'tabRightStyle', 'gridContainerStyle',
        'assistLineStyle', 'markStyle', 'markStyles', 'rowStrokeStyles', 'colStrokeStyle'
    ];
    const next: LocalStyleOverrideMask = {};
    keys.forEach((key) => {
        if (key in source) next[key] = Boolean(source[key]);
    });
    return next;
}

function normalizeIncomingLocalOverrides(value: unknown): LocalStyleOverrides {
    if (!value || typeof value !== 'object') return {};
    const source = value as LocalStyleOverrides;
    const next: LocalStyleOverrides = {};
    if (Array.isArray(source.rowColors)) next.rowColors = source.rowColors.map((v) => normalizeHexColorInput(v) || '').filter((v) => Boolean(v));
    if (Array.isArray(source.rowColorModes)) next.rowColorModes = source.rowColorModes.map((v) => v === 'paint_style' ? 'paint_style' : 'hex');
    if (Array.isArray(source.rowPaintStyleIds)) next.rowPaintStyleIds = source.rowPaintStyleIds.map((v) => (typeof v === 'string' && v.trim()) ? v : null);
    if (Array.isArray(source.colColors)) next.colColors = source.colColors.map((v) => normalizeHexColorInput(v) || '').filter((v) => Boolean(v));
    if (Array.isArray(source.colColorModes)) next.colColorModes = source.colColorModes.map((v) => v === 'paint_style' ? 'paint_style' : 'hex');
    if (Array.isArray(source.colPaintStyleIds)) next.colPaintStyleIds = source.colPaintStyleIds.map((v) => (typeof v === 'string' && v.trim()) ? v : null);
    if (Array.isArray(source.colColorEnabled)) next.colColorEnabled = source.colColorEnabled.map((v) => Boolean(v));
    if (source.markColorSource === 'col' || source.markColorSource === 'row') next.markColorSource = source.markColorSource;
    if (typeof source.assistLineVisible === 'boolean') next.assistLineVisible = source.assistLineVisible;
    if (source.assistLineEnabled && typeof source.assistLineEnabled === 'object') {
        next.assistLineEnabled = {
            min: Boolean(source.assistLineEnabled.min),
            max: Boolean(source.assistLineEnabled.max),
            avg: Boolean(source.assistLineEnabled.avg),
            ctr: Boolean(source.assistLineEnabled.ctr)
        };
    }
    if (source.cellFillStyle) next.cellFillStyle = source.cellFillStyle;
    if (source.cellTopStyle) next.cellTopStyle = source.cellTopStyle;
    if (source.tabRightStyle) next.tabRightStyle = source.tabRightStyle;
    if (source.gridContainerStyle) next.gridContainerStyle = source.gridContainerStyle;
    if (source.assistLineStyle) next.assistLineStyle = source.assistLineStyle;
    if (source.markStyle) next.markStyle = source.markStyle;
    if (Array.isArray(source.markStyles)) next.markStyles = source.markStyles;
    if (Array.isArray(source.rowStrokeStyles)) next.rowStrokeStyles = source.rowStrokeStyles;
    if (source.colStrokeStyle) next.colStrokeStyle = source.colStrokeStyle;
    return next;
}

function closeRowColorPopover() {
    rowColorPopoverOpen = false;
    activeColorTarget = null;
    rowColorStyleEditMode = false;
    rowColorDraftHex = null;
    rowColorDraftMode = null;
    rowColorDraftStyleId = null;
    rowColorDraftColReset = false;
    ui.rowColorPopover.classList.add('hidden');
    ui.rowColorHexInput.classList.remove('row-color-hex-error');
    ui.rowColorStyleMenu.classList.add('hidden');
    ui.rowColorStyleEditBox.classList.add('hidden');
    ui.rowColorResetBtn.classList.add('hidden');
    ui.rowColorResetBtn.disabled = true;
}

function getDraftMode(target: { type: 'row' | 'col'; index: number }): ColorMode {
    if (rowColorDraftMode) return rowColorDraftMode;
    return getColorModeForTarget(target);
}

function getDraftStyleId(target: { type: 'row' | 'col'; index: number }): string | null {
    if (rowColorDraftStyleId !== null) return rowColorDraftStyleId;
    return getPaintStyleIdForTarget(target);
}

function getDraftColor(target: { type: 'row' | 'col'; index: number }): string {
    return normalizeHexColorInput(rowColorDraftHex) || resolveDefaultColorForTarget(target);
}

function syncRowColorDraftUi(target: { type: 'row' | 'col'; index: number }, rawColor: string) {
    const color = normalizeHexColorInput(rawColor) || resolveDefaultColorForTarget(target);
    rowColorDraftHex = color;
    ui.rowColorPreview.style.backgroundColor = color;
    ui.rowColorHexInput.value = color;
    ui.rowColorStyleEditHexInput.value = color;
    ui.rowColorHexInput.classList.remove('row-color-hex-error');
    ui.rowColorStyleEditHexInput.classList.remove('row-color-hex-error');
    if (rowColorPicker) {
        isSyncingFromPicker = true;
        rowColorPicker.color.hexString = color;
        isSyncingFromPicker = false;
    }
    rowColorDraftColReset = false;
}

function getColorModeForTarget(target: { type: 'row' | 'col'; index: number }): ColorMode {
    if (target.type === 'row') {
        ensureRowColorModesLength(state.rows);
        return state.rowColorModes[target.index] === 'paint_style' ? 'paint_style' : 'hex';
    }
    const totalCols = getGridColsForChart(state.chartType, state.cols);
    ensureColHeaderColorModesLength(totalCols);
    return state.colHeaderColorModes[target.index] === 'paint_style' ? 'paint_style' : 'hex';
}

function getPaintStyleIdForTarget(target: { type: 'row' | 'col'; index: number }): string | null {
    if (target.type === 'row') {
        ensureRowPaintStyleIdsLength(state.rows);
        return state.rowPaintStyleIds[target.index];
    }
    const totalCols = getGridColsForChart(state.chartType, state.cols);
    ensureColHeaderPaintStyleIdsLength(totalCols);
    return state.colHeaderPaintStyleIds[target.index];
}

function setColorModeForTarget(target: { type: 'row' | 'col'; index: number }, mode: ColorMode) {
    if (target.type === 'row') {
        ensureRowColorModesLength(state.rows);
        state.rowColorModes[target.index] = mode;
        if (state.isInstanceTarget) {
            setLocalStyleOverrideField('rowColorModes', ensureRowColorModesLength(state.rows).slice());
            recomputeEffectiveStyleSnapshot();
        }
        return;
    }
    const totalCols = getGridColsForChart(state.chartType, state.cols);
    ensureColHeaderColorModesLength(totalCols);
    state.colHeaderColorModes[target.index] = mode;
    if (state.isInstanceTarget) {
        setLocalStyleOverrideField('colColorModes', ensureColHeaderColorModesLength(totalCols).slice());
        recomputeEffectiveStyleSnapshot();
    }
}

function setPaintStyleIdForTarget(target: { type: 'row' | 'col'; index: number }, styleId: string | null) {
    if (target.type === 'row') {
        ensureRowPaintStyleIdsLength(state.rows);
        state.rowPaintStyleIds[target.index] = styleId;
        if (state.isInstanceTarget) {
            setLocalStyleOverrideField('rowPaintStyleIds', ensureRowPaintStyleIdsLength(state.rows).slice());
            recomputeEffectiveStyleSnapshot();
        }
        return;
    }
    const totalCols = getGridColsForChart(state.chartType, state.cols);
    ensureColHeaderPaintStyleIdsLength(totalCols);
    state.colHeaderPaintStyleIds[target.index] = styleId;
    if (state.isInstanceTarget) {
        setLocalStyleOverrideField('colPaintStyleIds', ensureColHeaderPaintStyleIdsLength(totalCols).slice());
        recomputeEffectiveStyleSnapshot();
    }
}

function requestPaintStyleList() {
    parent.postMessage({ pluginMessage: { type: 'list_paint_styles' } }, '*');
}

function resolveDefaultColorForTarget(target: { type: 'row' | 'col'; index: number }): string {
    return target.type === 'row'
        ? getRowColor(target.index)
        : (state.colHeaderColorEnabled[target.index]
            ? (normalizeHexColorInput(state.colHeaderColors[target.index]) || getRowColor(0))
            : getRowColor(0));
}

function renderPaintStyleMenu() {
    ui.rowColorStyleMenuList.innerHTML = '';
    if (!activeColorTarget) return;
    const activeStyleId = getDraftStyleId(activeColorTarget);
    if (localPaintStyles.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'px-2 py-1.5 text-[10px] text-text-sub';
        empty.textContent = 'No local paint styles';
        ui.rowColorStyleMenuList.appendChild(empty);
        return;
    }
    localPaintStyles.forEach((style) => {
        const item = document.createElement('button');
        item.type = 'button';
        const disabled = style.isSolid === false;
        item.className = `row-color-style-item${disabled ? ' is-disabled' : ''}`;
        item.disabled = disabled;
        const swatch = document.createElement('span');
        swatch.className = 'row-color-style-item-swatch';
        swatch.style.backgroundColor = style.colorHex || '#FFFFFF';
        const label = document.createElement('span');
        label.className = `truncate${rowColorStyleEditMode ? ' row-color-style-item-label-editable' : ''}`;
        label.textContent = style.name;
        label.dataset.role = 'style-label';
        if (rowColorStyleEditMode && !disabled && !style.remote) {
            item.title = '텍스트 클릭: 이름 변경';
        }
        item.appendChild(swatch);
        item.appendChild(label);
        if (style.id === activeStyleId) {
            item.style.backgroundColor = '#EFF6FF';
        }
        item.addEventListener('click', (event) => {
            const targetEl = event.target as HTMLElement | null;
            const clickedLabel = Boolean(targetEl?.closest('[data-role="style-label"]'));
            if (rowColorStyleEditMode && clickedLabel) {
                event.preventDefault();
                event.stopPropagation();
                if (style.remote) {
                    window.alert('Remote style은 이름을 변경할 수 없습니다.');
                    return;
                }
                const nextName = window.prompt('Paint Style name', style.name);
                if (!nextName) return;
                const normalized = nextName.trim();
                if (!normalized) return;
                parent.postMessage({ pluginMessage: { type: 'rename_paint_style', id: style.id, name: normalized } }, '*');
                return;
            }
            if (!activeColorTarget) return;
            rowColorDraftMode = 'paint_style';
            rowColorDraftStyleId = style.id;
            syncRowColorDraftUi(activeColorTarget, style.colorHex);
            updatePopoverModeUi(activeColorTarget);
            ui.rowColorStyleMenu.classList.add('hidden');
        });
        ui.rowColorStyleMenuList.appendChild(item);
    });
}

function updatePaintStyleChipUi(target: { type: 'row' | 'col'; index: number }) {
    const mode = getDraftMode(target);
    const selectedId = getDraftStyleId(target);
    const selected = selectedId ? localPaintStyles.find((item) => item.id === selectedId) || null : null;
    const hasSelected = mode === 'paint_style' && Boolean(selected);
    ui.rowColorStyleChipEmpty.classList.toggle('hidden', hasSelected);
    ui.rowColorStyleChipClose.classList.toggle('hidden', !hasSelected);
    if (!hasSelected) {
        ui.rowColorStyleChipText.textContent = '';
        ui.rowColorStyleMainSwatch.style.backgroundColor = getDraftColor(target);
        ui.rowColorStyleChipEmpty.textContent = 'Select Paint Style';
        return;
    }
    ui.rowColorStyleChipText.textContent = selected?.name || 'Unknown Style';
    ui.rowColorStyleMainSwatch.style.backgroundColor = selected?.colorHex || '#FFFFFF';
}

function updatePopoverModeUi(target: { type: 'row' | 'col'; index: number }) {
    const mode = getDraftMode(target);
    ui.rowColorModeTabHex.classList.toggle('is-active', mode === 'hex');
    ui.rowColorModeTabStyle.classList.toggle('is-active', mode === 'paint_style');
    ui.rowColorHexInputBox.classList.toggle('hidden', mode !== 'hex');
    ui.rowColorStyleInputBox.classList.toggle('hidden', mode !== 'paint_style');
    ui.rowColorAddBtn.classList.toggle('hidden', mode !== 'hex');
    ui.rowColorAddBtn.disabled = mode !== 'hex';
    ui.rowColorEditBtn.classList.toggle('hidden', mode !== 'paint_style');
    ui.rowColorEditBtn.classList.toggle('is-active', mode === 'paint_style' && rowColorStyleEditMode);
    ui.rowColorStyleEditBox.classList.toggle('hidden', !(mode === 'paint_style' && rowColorStyleEditMode));
    ui.rowColorEditBtn.textContent = rowColorStyleEditMode ? 'Done' : 'Edit';
    ui.rowColorStyleEditHexInput.value = getDraftColor(target);
    updatePaintStyleChipUi(target);
    renderPaintStyleMenu();
}

function buildDefaultPaintStyleName(target: { type: 'row' | 'col'; index: number }) {
    const chartTypeToken = state.chartType === 'stackedBar'
        ? 'stacked-bar'
        : (state.chartType || 'chart').toLowerCase();
    const indexToken = String(target.index + 1).padStart(2, '0');
    const prefix = target.type === 'row'
        ? `${chartTypeToken}-row_${indexToken}-`
        : `${chartTypeToken}-col_${indexToken}-`;
    let maxSeq = 0;
    localPaintStyles.forEach((item) => {
        if (!item.name.startsWith(prefix)) return;
        const tail = item.name.slice(prefix.length);
        const parsed = Number(tail);
        if (Number.isFinite(parsed)) {
            maxSeq = Math.max(maxSeq, Math.floor(parsed));
        }
    });
    return `${prefix}${String(maxSeq + 1).padStart(2, '0')}`;
}

function initializeRowColorPicker() {
    if (rowColorPicker || typeof iro === 'undefined') return;
    rowColorPicker = new iro.ColorPicker(ui.rowColorWheel, {
        width: 220,
        color: '#3B82F6',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        layout: [
            { component: iro.ui.Wheel },
            { component: iro.ui.Slider, options: { sliderType: 'value' } }
        ]
    });

    rowColorPicker.on('color:change', (color: any) => {
        if (!activeColorTarget) return;
        const hex = normalizeHexColorInput(color?.hexString || '') || toHex6FromRgb(color);
        if (!hex) return;
        if (isSyncingFromPicker) return;
        syncRowColorDraftUi(activeColorTarget, hex);
        updatePopoverModeUi(activeColorTarget);
    });
}

function updateRowColorSwatchDom(row: number) {
    const color = getRowColor(row);
    document.querySelectorAll<HTMLButtonElement>(`.row-color-swatch[data-row="${row}"]`)
        .forEach((swatch) => {
            swatch.style.backgroundColor = color;
            swatch.title = color;
        });
}

function updateRowColorPopoverUi(row: number, colorHex: string) {
    if (!activeColorTarget) return;
    syncRowColorDraftUi(activeColorTarget, colorHex);
}

function updateColColorSwatchDom(col: number) {
    const color = state.colHeaderColorEnabled[col]
        ? (normalizeHexColorInput(state.colHeaderColors[col]) || getRowColor(0))
        : getRowColor(0);
    document.querySelectorAll<HTMLButtonElement>(`.col-color-swatch[data-col="${col}"]`)
        .forEach((swatch) => {
            swatch.style.backgroundColor = color;
            swatch.title = color;
        });
}

function updateColorPopoverUi(target: { type: 'row' | 'col'; index: number }, colorHex: string) {
    const isColTarget = target.type === 'col';
    ui.rowColorResetBtn.classList.toggle('hidden', !isColTarget);
    ui.rowColorResetBtn.disabled = !isColTarget;
    if (target.type === 'row') {
        updateRowColorPopoverUi(target.index, colorHex);
        updatePopoverModeUi(target);
        return;
    }
    const color = normalizeHexColorInput(colorHex)
        || (state.colHeaderColorEnabled[target.index]
            ? (normalizeHexColorInput(state.colHeaderColors[target.index]) || getRowColor(0))
            : getRowColor(0));
    syncRowColorDraftUi(target, color);
    updatePopoverModeUi(target);
}

function positionRowColorPopover(anchorRect: { left: number; top: number; right: number; bottom: number }) {
    const pop = ui.rowColorPopover;
    const margin = 8;
    const popW = pop.offsetWidth || 256;
    const popH = pop.offsetHeight || 320;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;

    if (left + popW > window.innerWidth - margin) {
        left = window.innerWidth - popW - margin;
    }
    if (top + popH > window.innerHeight - margin) {
        top = anchorRect.top - popH - 6;
    }

    pop.style.left = `${Math.max(margin, left)}px`;
    pop.style.top = `${Math.max(margin, top)}px`;
}

function isRowColorDisabledByColOverrides() {
    if (state.chartType !== 'bar') return false;
    const colCount = getGridColsForChart(state.chartType, state.cols);
    const enabled = ensureColHeaderColorEnabledLength(colCount);
    return colCount > 0 && enabled.every((flag) => Boolean(flag));
}

function applyColorHex(target: { type: 'row' | 'col'; index: number }, rawHex: string, render = true) {
    const normalized = normalizeHexColorInput(rawHex);
    if (!normalized) {
        ui.rowColorHexInput.classList.add('row-color-hex-error');
        return false;
    }

    if (target.type === 'row') {
        ensureRowColorsLength(state.rows);
        if (isRowColorDisabledByColOverrides()) return false;
        state.rowColors[target.index] = normalized;
        if (state.isInstanceTarget) {
            setLocalStyleOverrideField('rowColors', ensureRowColorsLength(state.rows).slice());
            recomputeEffectiveStyleSnapshot();
        }
        if (state.rows === 1 && state.chartType !== 'stackedBar') {
            state.markColorSource = 'row';
            if (state.isInstanceTarget) {
                setLocalStyleOverrideField('markColorSource', 'row');
                recomputeEffectiveStyleSnapshot();
            }
        }
        updateRowColorSwatchDom(target.index);
        syncMarkStylesFromHeaderColors(false);
    } else {
        const totalCols = getGridColsForChart(state.chartType, state.cols);
        ensureColHeaderColorsLength(totalCols);
        ensureColHeaderColorEnabledLength(totalCols);
        state.colHeaderColors[target.index] = normalized;
        state.colHeaderColorEnabled[target.index] = true;
        if (state.isInstanceTarget) {
            setLocalStyleOverrideField('colColors', ensureColHeaderColorsLength(totalCols).slice());
            setLocalStyleOverrideField('colColorEnabled', ensureColHeaderColorEnabledLength(totalCols).slice());
            recomputeEffectiveStyleSnapshot();
        }
        if (state.rows === 1 && state.chartType !== 'stackedBar') {
            state.markColorSource = 'col';
            if (state.isInstanceTarget) {
                setLocalStyleOverrideField('markColorSource', 'col');
                recomputeEffectiveStyleSnapshot();
            }
        }
        updateColColorSwatchDom(target.index);
        syncMarkStylesFromHeaderColors(false);
    }
    ui.rowColorHexInput.classList.remove('row-color-hex-error');
    updateColorPopoverUi(target, normalized);

    if (render) {
        renderGrid();
        renderPreview();
        refreshExportPreview();
    }
    return true;
}

function openColorPopover(target: { type: 'row' | 'col'; index: number }, anchorRect: { left: number; top: number; right: number; bottom: number }) {
    if (state.mode === 'read') return;
    if (target.type === 'row' && isRowColorDisabledByColOverrides()) return;
    if (assistLinePopoverOpen) closeAssistLinePopover();
    ensureRowColorsLength(state.rows);
    ensureRowColorModesLength(state.rows);
    ensureRowPaintStyleIdsLength(state.rows);
    const totalCols = getGridColsForChart(state.chartType, state.cols);
    ensureColHeaderColorsLength(totalCols);
    ensureColHeaderColorModesLength(totalCols);
    ensureColHeaderPaintStyleIdsLength(totalCols);
    initializeRowColorPicker();
    requestPaintStyleList();
    activeColorTarget = target;
    rowColorStyleEditMode = false;
    rowColorDraftMode = getColorModeForTarget(target);
    rowColorDraftStyleId = getPaintStyleIdForTarget(target);
    rowColorDraftColReset = false;
    rowColorPopoverOpen = true;
    ui.rowColorPopover.classList.remove('hidden');
    const color = target.type === 'row'
        ? getRowColor(target.index)
        : (state.colHeaderColorEnabled[target.index]
            ? (normalizeHexColorInput(state.colHeaderColors[target.index]) || getRowColor(0))
            : getRowColor(0));
    rowColorDraftHex = normalizeHexColorInput(color) || resolveDefaultColorForTarget(target);
    updateColorPopoverUi(target, color);
    positionRowColorPopover(anchorRect);
}

function commitRowColorPopoverIfOpen() {
    if (!rowColorPopoverOpen || !activeColorTarget) return false;
    const mode = getDraftMode(activeColorTarget);
    const draftColor = getDraftColor(activeColorTarget);
    if (mode === 'paint_style') {
        const styleId = getDraftStyleId(activeColorTarget);
        if (!styleId) {
            window.alert('Paint Style을 먼저 선택해주세요.');
            return false;
        }
        setColorModeForTarget(activeColorTarget, 'paint_style');
        setPaintStyleIdForTarget(activeColorTarget, styleId);
        parent.postMessage({ pluginMessage: { type: 'update_paint_style_color', id: styleId, colorHex: draftColor } }, '*');
        const applied = applyColorHex(activeColorTarget, draftColor, true);
        closeRowColorPopover();
        return applied;
    }
    setColorModeForTarget(activeColorTarget, 'hex');
    setPaintStyleIdForTarget(activeColorTarget, null);
    if (activeColorTarget.type === 'col' && rowColorDraftColReset) {
        const totalCols = getGridColsForChart(state.chartType, state.cols);
        ensureColHeaderColorsLength(totalCols);
        ensureColHeaderColorEnabledLength(totalCols);
        ensureColHeaderColorModesLength(totalCols);
        ensureColHeaderPaintStyleIdsLength(totalCols);
        state.colHeaderColorEnabled[activeColorTarget.index] = false;
        state.colHeaderColors[activeColorTarget.index] = getRowColor(0);
        state.colHeaderColorModes[activeColorTarget.index] = 'hex';
        state.colHeaderPaintStyleIds[activeColorTarget.index] = null;
        if (state.isInstanceTarget) {
            setLocalStyleOverrideField('colColors', ensureColHeaderColorsLength(totalCols).slice());
            setLocalStyleOverrideField('colColorModes', ensureColHeaderColorModesLength(totalCols).slice());
            setLocalStyleOverrideField('colPaintStyleIds', ensureColHeaderPaintStyleIdsLength(totalCols).slice());
            setLocalStyleOverrideField('colColorEnabled', ensureColHeaderColorEnabledLength(totalCols).slice());
            recomputeEffectiveStyleSnapshot();
        }
        updateColColorSwatchDom(activeColorTarget.index);
        renderGrid();
        renderPreview();
        refreshExportPreview();
        closeRowColorPopover();
        return true;
    }
    const applied = applyColorHex(activeColorTarget, draftColor, true);
    closeRowColorPopover();
    return applied;
}

function normalizeMarkRatioInput(value: unknown): number {
    const ratio = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(ratio)) return 0.8;
    return Math.max(0.01, Math.min(1.0, ratio));
}

function normalizeAssistLineEnabledInput(value: any) {
    if (!value || typeof value !== 'object') {
        return { min: false, max: false, avg: false, ctr: false };
    }
    return {
        min: Boolean(value.min),
        max: Boolean(value.max),
        avg: Boolean(value.avg),
        ctr: Boolean(value.ctr)
    };
}

function normalizeAssistLineVisibleInput(value: any) {
    return Boolean(value);
}

function updateTemplateModeBanner() {
    ui.templateModeBanner.classList.toggle('hidden', !state.isTemplateMasterTarget);
}

function closeAssistLinePopover() {
    assistLinePopoverOpen = false;
    ui.assistLinePopover.classList.add('hidden');
}

function openAssistLinePopover() {
    assistLinePopoverOpen = true;
    ui.assistLinePopover.classList.remove('hidden');
}

function updateAssistLineToggleUi() {
    ui.assistLineToggleBtn.textContent = state.assistLineVisible ? 'ON' : 'OFF';
    ui.assistLineToggleBtn.className = state.assistLineVisible
        ? 'px-2 py-0.5 text-xxs font-semibold rounded bg-white text-primary shadow-sm transition-all border border-border cursor-pointer'
        : 'px-2 py-0.5 text-xxs font-semibold rounded text-text-sub hover:text-text transition-all border border-border bg-surface cursor-pointer';
    ui.assistLineMinCheck.checked = state.assistLineEnabled.min;
    ui.assistLineMaxCheck.checked = state.assistLineEnabled.max;
    ui.assistLineAvgCheck.checked = state.assistLineEnabled.avg;
    ui.assistLineCtrCheck.checked = state.assistLineEnabled.ctr;
}

function handlePluginMessage(msg: any) {
    if (msg.type === 'init') {
        forceCloseStyleColorPopover();
        closeRowColorPopover();
        if (!msg.chartType) {
            // No selection
            state.uiMode = 'create';
            state.isInstanceTarget = false;
            state.isTemplateMasterTarget = false;
            resetLocalStyleOverrideState();
            state.mode = 'edit';
            state.markRatio = 0.8;
            state.rowColors = [getDefaultRowColor(0), getDefaultRowColor(1), getDefaultRowColor(2)];
            state.rowColorModes = ['hex', 'hex', 'hex'];
            state.rowPaintStyleIds = [null, null, null];
            state.rowHeaderLabels = ['R1', 'R2', 'R3'];
            state.colHeaderTitles = ['C1', 'C2', 'C3'];
            state.colHeaderColors = [getDefaultRowColor(0), getDefaultRowColor(1), getDefaultRowColor(2)];
            state.colHeaderColorModes = ['hex', 'hex', 'hex'];
            state.colHeaderPaintStyleIds = [null, null, null];
            state.colHeaderColorEnabled = [false, false, false];
            state.markColorSource = 'row';
            state.assistLineVisible = false;
            state.assistLineEnabled = { min: false, max: false, avg: false, ctr: false };
            ui.settingMarkRatioInput.value = '0.8';
            ui.settingYMin.value = '0';
            ui.settingYMax.value = '';
            closeAssistLinePopover();
            closeRowColorPopover();
            updateAssistLineToggleUi();
            state.colStrokeStyle = null;
            state.cellStrokeStyles = [];
            state.rowStrokeStyles = [];
            ensureRowHeaderLabelsLength(state.rows, state.chartType);
            initializeStyleTabDraft({}, {});
            parent.postMessage({ pluginMessage: { type: 'load_style_templates' } }, '*');
            switchTab('data');
            goToStep(1);
            ui.editModeBtn.classList.add('hidden');
            updateTemplateModeBanner();
            return;
        }

        state.uiMode = 'edit';
        state.chartType = msg.chartType;
        state.isInstanceTarget = Boolean(msg.isInstanceTarget);
        state.isTemplateMasterTarget = Boolean(msg.isTemplateMasterTarget);
        state.extractedStyleSnapshot = normalizeIncomingLocalOverrides(msg.extractedStyleSnapshot);
        setLocalStyleOverrideSnapshot(
            normalizeIncomingLocalOverrides(msg.localStyleOverrides),
            normalizeIncomingLocalMask(msg.localStyleOverrideMask)
        );
        recomputeEffectiveStyleSnapshot();

        // Chart type badge
        ui.chartTypeWrapper.classList.remove('hidden');
        ui.chartTypeIcon.innerHTML = CHART_ICONS[msg.chartType] || '';
        ui.chartTypeDisplay.textContent = msg.chartType === 'stackedBar' ? 'Stacked' : msg.chartType;

        // Edit mode button
        if (msg.uiMode === 'edit') {
            ui.editModeBtn.classList.remove('hidden');
            state.mode = 'edit';
            ui.editModeBtn.textContent = 'Save';
        }

        // Load saved data
        if (msg.savedValues) {
            const vals = msg.savedValues;
            state.rows = vals.length;

            if (msg.chartType === 'stackedBar') {
                if (Array.isArray(msg.savedMarkNum)) {
                    state.groupStructure = msg.savedMarkNum;
                    state.cols = msg.savedMarkNum.length;
                } else {
                    const totalCols = vals[0]?.length || 6;
                    state.groupStructure = [totalCols];
                    state.cols = 1;
                }
            } else {
                const savedCols = vals[0]?.length || 3;
                state.cols = msg.chartType === 'line'
                    ? Math.max(1, savedCols - 1)
                    : savedCols;
            }

            state.data = vals.map((row: any[]) => row.map((v: any) => String(v)));
        } else {
            const totalCols = msg.chartType === 'stackedBar'
                ? getTotalStackedCols()
                : getGridColsForChart(msg.chartType, state.cols);
            state.data = initData(state.rows, totalCols);
        }
        syncMarkCountFromRows();
        applyRowColorsFromPayload(msg.chartType, state.rows, msg.rowColors, msg.markColors);
        state.rowColorModes = [];
        state.rowPaintStyleIds = [];
        ensureRowColorModesLength(state.rows);
        ensureRowPaintStyleIdsLength(state.rows);
        if (Array.isArray(msg.rowColorModes)) {
            state.rowColorModes = msg.rowColorModes
                .map((value: unknown) => value === 'paint_style' ? 'paint_style' : 'hex')
                .slice(0, state.rows);
            ensureRowColorModesLength(state.rows);
        }
        if (Array.isArray(msg.rowPaintStyleIds)) {
            state.rowPaintStyleIds = msg.rowPaintStyleIds
                .map((value: unknown) => (typeof value === 'string' && value.trim()) ? value : null)
                .slice(0, state.rows);
            ensureRowPaintStyleIdsLength(state.rows);
        }
        applyRowHeaderLabelsFromPayload(msg.savedRowHeaderLabels, state.rows, msg.chartType);
        ensureRowColorsLength(state.rows);
        const initTotalCols = msg.chartType === 'stackedBar'
            ? getTotalStackedCols()
            : getGridColsForChart(msg.chartType, state.cols);
        const initHeaderCols = msg.chartType === 'stackedBar'
            ? state.groupStructure.length
            : initTotalCols;
        applyColHeaderTitlesFromPayload(msg.savedXAxisLabels, initHeaderCols, msg.chartType);
        state.colHeaderColorEnabled = [];
        state.colHeaderColorModes = [];
        state.colHeaderPaintStyleIds = [];
        ensureColHeaderColorsLength(initTotalCols);
        ensureColHeaderColorModesLength(initTotalCols);
        ensureColHeaderPaintStyleIdsLength(initTotalCols);
        ensureColHeaderColorEnabledLength(initTotalCols);
        if (Array.isArray(msg.colColors)) {
            state.colHeaderColors = msg.colColors
                .map((c: unknown) => normalizeHexColorInput(c))
                .map((c: string | null, i: number) => c || getDefaultRowColor(i))
                .slice(0, initTotalCols);
            ensureColHeaderColorsLength(initTotalCols);
        }
        if (Array.isArray(msg.colColorModes)) {
            state.colHeaderColorModes = msg.colColorModes
                .map((value: unknown) => value === 'paint_style' ? 'paint_style' : 'hex')
                .slice(0, initTotalCols);
            ensureColHeaderColorModesLength(initTotalCols);
        }
        if (Array.isArray(msg.colPaintStyleIds)) {
            state.colHeaderPaintStyleIds = msg.colPaintStyleIds
                .map((value: unknown) => (typeof value === 'string' && value.trim()) ? value : null)
                .slice(0, initTotalCols);
            ensureColHeaderPaintStyleIdsLength(initTotalCols);
        }
        if (Array.isArray(msg.colColorEnabled)) {
            state.colHeaderColorEnabled = msg.colColorEnabled.map((v: unknown) => Boolean(v)).slice(0, initTotalCols);
        }
        ensureColHeaderColorEnabledLength(initTotalCols);
        state.markColorSource = msg.markColorSource === 'col' ? 'col' : 'row';

        // Apply saved settings
        if (msg.lastCellCount) state.cellCount = Number(msg.lastCellCount);
        if (msg.lastMode) state.dataMode = msg.lastMode as 'raw' | 'percent';
        ui.settingYMin.value = msg.lastYMin !== undefined ? String(msg.lastYMin) : '0';
        ui.settingYMax.value = msg.lastYMax !== undefined ? String(msg.lastYMax) : ((msg.lastMode || 'raw') === 'raw' ? '' : '100');
        if (msg.lastStrokeWidth !== undefined) {
            state.strokeWidth = msg.lastStrokeWidth;
            ui.settingStrokeInput.value = String(msg.lastStrokeWidth);
        }
        state.markRatio = normalizeMarkRatioInput(msg.markRatio);
        state.assistLineVisible = normalizeAssistLineVisibleInput(msg.assistLineVisible);
        state.assistLineEnabled = normalizeAssistLineEnabledInput(msg.assistLineEnabled);
        ui.settingMarkRatioInput.value = String(state.markRatio);
        closeAssistLinePopover();
        updateAssistLineToggleUi();
        state.colStrokeStyle = msg.colStrokeStyle || null;
        state.cellStrokeStyles = msg.cellStrokeStyles || [];
        state.rowStrokeStyles = msg.rowStrokeStyles || [];
        initializeStyleTabDraft(
            {
                savedCellFillStyle: msg.savedCellFillStyle,
                savedMarkStyle: msg.savedMarkStyle,
                savedMarkStyles: msg.savedMarkStyles,
                savedCellTopStyle: msg.savedCellTopStyle,
                savedTabRightStyle: msg.savedTabRightStyle,
                savedGridContainerStyle: msg.savedGridContainerStyle,
                savedAssistLineStyle: msg.savedAssistLineStyle
            },
            {
                cellFillStyle: msg.cellFillStyle,
                markStyle: msg.markStyle,
                markStyles: msg.markStyles,
                rowStrokeStyles: msg.rowStrokeStyles,
                colStrokeStyle: msg.colStrokeStyle,
                chartContainerStrokeStyle: msg.chartContainerStrokeStyle,
                assistLineStrokeStyle: msg.assistLineStrokeStyle
            }
        );
        syncAllHexPreviewsFromDom();
        parent.postMessage({ pluginMessage: { type: 'load_style_templates' } }, '*');

        // Line-specific UI
        if (msg.chartType === 'line') {
            ui.containerStrokeWidth.classList.remove('hidden');
            ui.spacerStroke.classList.add('hidden');
        } else {
            ui.containerStrokeWidth.classList.add('hidden');
            ui.spacerStroke.classList.remove('hidden');
        }
        if (msg.chartType === 'bar' || msg.chartType === 'stackedBar') {
            ui.containerMarkRatio.classList.remove('hidden');
        } else {
            ui.containerMarkRatio.classList.add('hidden');
        }

        // Stacked-specific UI
        if (msg.chartType === 'stackedBar') {
            ui.labelColInput.textContent = 'Group Count';
            ui.labelMarkPosition.textContent = 'Segments';
            ui.containerMarkNormal.classList.remove('hidden');
        } else {
            ui.labelColInput.textContent = 'Graph Col';
            ui.labelMarkPosition.textContent = 'Mark Count';
            ui.containerMarkNormal.classList.remove('hidden');
            if (msg.savedMarkNum && typeof msg.savedMarkNum === 'number') {
                ui.settingMarkSelect.value = String(msg.savedMarkNum);
            }
        }
        refreshGraphSettingTooltipContent();

        ui.backBtn.classList.add('hidden');
        updateModeButtonState();
        syncYMaxValidationUi();
        applyModeLocks();
        goToStep(2);
        switchTab('data');
        checkCtaValidation();
        updateTemplateModeBanner();
    }
    if (msg.type === 'style_templates_loaded') {
        setStyleTemplateList(msg.list || []);
    }
    if (msg.type === 'paint_styles_loaded') {
        const incoming = Array.isArray(msg.list) ? msg.list : [];
        localPaintStyles = incoming
            .map((item: any) => ({
                id: typeof item?.id === 'string' ? item.id : '',
                name: typeof item?.name === 'string' ? item.name : '',
                colorHex: normalizeHexColorInput(item?.colorHex) || '#000000',
                isSolid: item?.isSolid !== false,
                remote: Boolean(item?.remote)
            }))
            .filter((item: PaintStyleSelection) => Boolean(item.id) && Boolean(item.name));
        if (rowColorPopoverOpen && activeColorTarget) {
            updateColorPopoverUi(activeColorTarget, ui.rowColorHexInput.value);
        }
    }
    if (msg.type === 'paint_style_created') {
        if (!activeColorTarget || !msg.style) return;
        const createdId = typeof msg.style.id === 'string' ? msg.style.id : '';
        const createdHex = normalizeHexColorInput(msg.style.colorHex) || resolveDefaultColorForTarget(activeColorTarget);
        if (!createdId) return;
        rowColorDraftMode = 'paint_style';
        rowColorDraftStyleId = createdId;
        syncRowColorDraftUi(activeColorTarget, createdHex);
        updateColorPopoverUi(activeColorTarget, createdHex);
    }
    if (msg.type === 'paint_style_renamed') {
        if (rowColorPopoverOpen && activeColorTarget) {
            updateColorPopoverUi(activeColorTarget, ui.rowColorHexInput.value);
        }
    }
    if (msg.type === 'paint_style_updated') {
        if (rowColorPopoverOpen && activeColorTarget) {
            const styleId = getPaintStyleIdForTarget(activeColorTarget);
            if (styleId && styleId === msg.id) {
                const nextHex = normalizeHexColorInput(msg.colorHex) || ui.rowColorHexInput.value;
                applyColorHex(activeColorTarget, nextHex, true);
                updateColorPopoverUi(activeColorTarget, nextHex);
            }
        }
    }
    if (msg.type === 'paint_style_error') {
        window.alert(msg.reason || 'Paint Style 처리 중 오류가 발생했습니다.');
    }
    if (msg.type === 'style_template_saved') {
        setStyleTemplateList(msg.list || []);
    }
    if (msg.type === 'style_template_deleted') {
        setStyleTemplateList(msg.list || []);
    }
    if (msg.type === 'style_template_renamed') {
        setStyleTemplateList(msg.list || []);
    }
    if (msg.type === 'style_template_error') {
        window.alert(msg.reason || '템플릿 처리 중 오류가 발생했습니다.');
    }

    if (msg.type === 'style_extracted') {
        if (msg.payload) {
            if (msg.payload.isInstanceTarget !== undefined) {
                state.isInstanceTarget = Boolean(msg.payload.isInstanceTarget);
            }
            if (msg.payload.isTemplateMasterTarget !== undefined) {
                state.isTemplateMasterTarget = Boolean(msg.payload.isTemplateMasterTarget);
            }
            state.extractedStyleSnapshot = normalizeIncomingLocalOverrides(msg.payload.extractedStyleSnapshot);
            setLocalStyleOverrideSnapshot(
                normalizeIncomingLocalOverrides(msg.payload.localStyleOverrides),
                normalizeIncomingLocalMask(msg.payload.localStyleOverrideMask)
            );
            recomputeEffectiveStyleSnapshot();
        }
        const extractedDraftPayload = {
            cellFillStyle: msg.payload?.cellFillStyle,
            markStyle: msg.payload?.markStyle,
            markStyles: msg.payload?.markStyles,
            rowStrokeStyles: msg.payload?.rowStrokeStyles,
            colStrokeStyle: msg.payload?.colStrokeStyle,
            chartContainerStrokeStyle: msg.payload?.chartContainerStrokeStyle,
            assistLineStrokeStyle: msg.payload?.assistLineStrokeStyle
        };

        if (msg.source === 'extract_style') {
            const wasDirty = state.styleInjectionDirty;
            const syncApplied = state.isInstanceTarget
                ? false
                : syncStyleTabDraftFromExtracted(extractedDraftPayload);
            if (syncApplied) {
                syncAllHexPreviewsFromDom();
                renderGrid();
                renderPreview();
                refreshExportPreview();
            }
            console.log('[ui][style-extracted]', {
                source: msg.source,
                dirty: wasDirty,
                syncApplied
            });
            handleStyleExtracted(msg.payload);
            return;
        }

        state.markRatio = normalizeMarkRatioInput(msg.payload?.markRatio);
        if (msg.payload?.strokeWidth !== undefined && Number.isFinite(Number(msg.payload.strokeWidth))) {
            state.strokeWidth = Number(msg.payload.strokeWidth);
            ui.settingStrokeInput.value = String(state.strokeWidth);
        }
        applyRowColorsFromPayload(state.chartType, state.rows, msg.payload?.rowColors, msg.payload?.colors);
        state.rowColorModes = [];
        state.rowPaintStyleIds = [];
        ensureRowColorModesLength(state.rows);
        ensureRowPaintStyleIdsLength(state.rows);
        if (Array.isArray(msg.payload?.rowColorModes)) {
            state.rowColorModes = msg.payload.rowColorModes
                .map((value: unknown) => value === 'paint_style' ? 'paint_style' : 'hex')
                .slice(0, state.rows);
            ensureRowColorModesLength(state.rows);
        }
        if (Array.isArray(msg.payload?.rowPaintStyleIds)) {
            state.rowPaintStyleIds = msg.payload.rowPaintStyleIds
                .map((value: unknown) => (typeof value === 'string' && value.trim()) ? value : null)
                .slice(0, state.rows);
            ensureRowPaintStyleIdsLength(state.rows);
        }
        ensureRowColorsLength(state.rows);
        const payloadTotalCols = state.chartType === 'stackedBar'
            ? getTotalStackedCols()
            : getGridColsForChart(state.chartType, state.cols);
        state.colHeaderColorEnabled = [];
        state.colHeaderColorModes = [];
        state.colHeaderPaintStyleIds = [];
        ensureColHeaderColorsLength(payloadTotalCols);
        ensureColHeaderColorModesLength(payloadTotalCols);
        ensureColHeaderPaintStyleIdsLength(payloadTotalCols);
        ensureColHeaderColorEnabledLength(payloadTotalCols);
        if (Array.isArray(msg.payload?.colColors)) {
            state.colHeaderColors = msg.payload.colColors
                .map((c: unknown) => normalizeHexColorInput(c))
                .map((c: string | null, i: number) => c || getDefaultRowColor(i))
                .slice(0, payloadTotalCols);
            ensureColHeaderColorsLength(payloadTotalCols);
        }
        if (Array.isArray(msg.payload?.colColorModes)) {
            state.colHeaderColorModes = msg.payload.colColorModes
                .map((value: unknown) => value === 'paint_style' ? 'paint_style' : 'hex')
                .slice(0, payloadTotalCols);
            ensureColHeaderColorModesLength(payloadTotalCols);
        }
        if (Array.isArray(msg.payload?.colPaintStyleIds)) {
            state.colHeaderPaintStyleIds = msg.payload.colPaintStyleIds
                .map((value: unknown) => (typeof value === 'string' && value.trim()) ? value : null)
                .slice(0, payloadTotalCols);
            ensureColHeaderPaintStyleIdsLength(payloadTotalCols);
        }
        if (Array.isArray(msg.payload?.colColorEnabled)) {
            state.colHeaderColorEnabled = msg.payload.colColorEnabled
                .map((v: unknown) => Boolean(v))
                .slice(0, payloadTotalCols);
        }
        ensureColHeaderColorEnabledLength(payloadTotalCols);
        state.markColorSource = msg.payload?.markColorSource === 'col' ? 'col' : state.markColorSource;
        if (msg.payload?.assistLineVisible !== undefined) {
            state.assistLineVisible = normalizeAssistLineVisibleInput(msg.payload.assistLineVisible);
        }
        if (msg.payload?.assistLineEnabled) {
            state.assistLineEnabled = normalizeAssistLineEnabledInput(msg.payload.assistLineEnabled);
        }
        updateAssistLineToggleUi();
        ui.settingMarkRatioInput.value = String(state.markRatio);
        state.colStrokeStyle = msg.payload?.colStrokeStyle || null;
        state.cellStrokeStyles = msg.payload?.cellStrokeStyles || [];
        state.rowStrokeStyles = msg.payload?.rowStrokeStyles || [];
        syncStyleTabDraftFromExtracted(extractedDraftPayload);
        syncAllHexPreviewsFromDom();
        renderGrid();
        renderPreview();
        refreshExportPreview();
        syncYMaxValidationUi();
        applyModeLocks();
        checkCtaValidation();
        handleStyleExtracted(msg.payload);
        updateTemplateModeBanner();
    }
}

function bindUiEvents() {
    // Header buttons
    ui.backBtn.addEventListener('click', () => goToStep(1));
    ui.mainCta.addEventListener('click', () => {
        commitRowColorPopoverIfOpen();
        commitStyleColorPopoverIfOpen();
        submitData();
    });
    ui.editModeBtn.addEventListener('click', () => {
        closeRowColorPopover();
        toggleMode();
    });

    // Settings inputs
    ui.settingColInput.addEventListener('change', handleDimensionInput);
    ui.settingCellInput.addEventListener('change', handleDimensionInput);
    ui.settingStrokeInput.addEventListener('change', handleDimensionInput);
    ui.settingMarkRatioInput.addEventListener('change', () => {
        state.markRatio = normalizeMarkRatioInput(ui.settingMarkRatioInput.value);
        ui.settingMarkRatioInput.value = String(state.markRatio);
        renderPreview();
    });
    ui.settingMarkSelect.addEventListener('change', () => {
        if (state.chartType === 'stackedBar') {
            const nextSegment = Number(ui.settingMarkSelect.value);
            if (Number.isFinite(nextSegment) && nextSegment > 0) {
                applySegmentCountToAllGroups(nextSegment);
            }
            return;
        }
        syncRowsFromMarkCount();
        renderGrid();
        renderPreview();
    });
    ui.assistLineLabelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (assistLinePopoverOpen) closeAssistLinePopover();
        else openAssistLinePopover();
    });
    ui.assistLineToggleBtn.addEventListener('click', () => {
        state.assistLineVisible = !state.assistLineVisible;
        if (state.isInstanceTarget) {
            setLocalStyleOverrideField('assistLineVisible', state.assistLineVisible);
            recomputeEffectiveStyleSnapshot();
        }
        updateAssistLineToggleUi();
        checkCtaValidation();
    });
    ui.assistLineMinCheck.addEventListener('change', () => {
        state.assistLineEnabled.min = ui.assistLineMinCheck.checked;
        if (state.isInstanceTarget) {
            setLocalStyleOverrideField('assistLineEnabled', { ...state.assistLineEnabled });
            recomputeEffectiveStyleSnapshot();
        }
        checkCtaValidation();
    });
    ui.assistLineMaxCheck.addEventListener('change', () => {
        state.assistLineEnabled.max = ui.assistLineMaxCheck.checked;
        if (state.isInstanceTarget) {
            setLocalStyleOverrideField('assistLineEnabled', { ...state.assistLineEnabled });
            recomputeEffectiveStyleSnapshot();
        }
        checkCtaValidation();
    });
    ui.assistLineAvgCheck.addEventListener('change', () => {
        state.assistLineEnabled.avg = ui.assistLineAvgCheck.checked;
        if (state.isInstanceTarget) {
            setLocalStyleOverrideField('assistLineEnabled', { ...state.assistLineEnabled });
            recomputeEffectiveStyleSnapshot();
        }
        checkCtaValidation();
    });
    ui.assistLineCtrCheck.addEventListener('change', () => {
        state.assistLineEnabled.ctr = ui.assistLineCtrCheck.checked;
        if (state.isInstanceTarget) {
            setLocalStyleOverrideField('assistLineEnabled', { ...state.assistLineEnabled });
            recomputeEffectiveStyleSnapshot();
        }
        checkCtaValidation();
    });
    ui.assistLinePopover.addEventListener('click', (e) => e.stopPropagation());
    ui.assistLineControl.addEventListener('click', (e) => e.stopPropagation());
    ui.rowColorPopover.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('row-color-swatch-click', ((event: Event) => {
        const custom = event as CustomEvent<{ row: number; anchorRect: { left: number; top: number; right: number; bottom: number } }>;
        if (!custom.detail || typeof custom.detail.row !== 'number') return;
        openColorPopover({ type: 'row', index: custom.detail.row }, custom.detail.anchorRect);
    }) as EventListener);
    document.addEventListener('col-color-swatch-click', ((event: Event) => {
        const custom = event as CustomEvent<{ col: number; anchorRect: { left: number; top: number; right: number; bottom: number } }>;
        if (!custom.detail || typeof custom.detail.col !== 'number') return;
        openColorPopover({ type: 'col', index: custom.detail.col }, custom.detail.anchorRect);
    }) as EventListener);
    const switchColorMode = (mode: ColorMode) => {
        if (!activeColorTarget) return;
        rowColorDraftMode = mode;
        if (mode === 'hex') {
            rowColorDraftStyleId = null;
            ui.rowColorStyleMenu.classList.add('hidden');
        } else {
            requestPaintStyleList();
        }
        updateColorPopoverUi(activeColorTarget, getDraftColor(activeColorTarget));
    };
    ui.rowColorModeTabHex.addEventListener('click', () => switchColorMode('hex'));
    ui.rowColorModeTabStyle.addEventListener('click', () => switchColorMode('paint_style'));
    ui.rowColorEditBtn.addEventListener('click', () => {
        if (!activeColorTarget) return;
        if (getDraftMode(activeColorTarget) !== 'paint_style') return;
        rowColorStyleEditMode = !rowColorStyleEditMode;
        updateColorPopoverUi(activeColorTarget, getDraftColor(activeColorTarget));
    });
    ui.rowColorStyleCaretBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!activeColorTarget) return;
        if (getDraftMode(activeColorTarget) !== 'paint_style') return;
        renderPaintStyleMenu();
        const nextHidden = !ui.rowColorStyleMenu.classList.contains('hidden');
        ui.rowColorStyleMenu.classList.toggle('hidden', nextHidden);
    });
    ui.rowColorStyleChipClose.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!activeColorTarget) return;
        rowColorDraftStyleId = null;
        rowColorDraftMode = 'hex';
        ui.rowColorStyleMenu.classList.add('hidden');
        updateColorPopoverUi(activeColorTarget, getDraftColor(activeColorTarget));
    });
    ui.rowColorStyleChip.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!activeColorTarget) return;
        if (getDraftMode(activeColorTarget) !== 'paint_style') return;
        if (!rowColorStyleEditMode) return;
        const styleId = getDraftStyleId(activeColorTarget);
        if (!styleId) return;
        const current = localPaintStyles.find((item) => item.id === styleId);
        if (!current) return;
        if (current.remote) {
            window.alert('Remote style은 이름을 변경할 수 없습니다.');
            return;
        }
        const nextName = window.prompt('Paint Style name', current.name);
        if (!nextName) return;
        const normalized = nextName.trim();
        if (!normalized) return;
        parent.postMessage({ pluginMessage: { type: 'rename_paint_style', id: styleId, name: normalized } }, '*');
    });
    ui.rowColorAddBtn.addEventListener('click', () => {
        if (!activeColorTarget) return;
        if (getDraftMode(activeColorTarget) !== 'hex') return;
        const hex = getDraftColor(activeColorTarget);
        const name = buildDefaultPaintStyleName(activeColorTarget);
        parent.postMessage({ pluginMessage: { type: 'create_paint_style', name, colorHex: hex } }, '*');
    });
    ui.rowColorHexInput.addEventListener('input', () => {
        if (!activeColorTarget) return;
        const normalized = normalizeHexColorInput(ui.rowColorHexInput.value);
        if (!normalized) {
            ui.rowColorHexInput.classList.add('row-color-hex-error');
            return;
        }
        syncRowColorDraftUi(activeColorTarget, normalized);
        updatePopoverModeUi(activeColorTarget);
    });
    ui.rowColorStyleEditHexInput.addEventListener('input', () => {
        if (!activeColorTarget) return;
        if (getDraftMode(activeColorTarget) !== 'paint_style') return;
        if (!rowColorStyleEditMode) return;
        const normalized = normalizeHexColorInput(ui.rowColorStyleEditHexInput.value);
        if (!normalized) {
            ui.rowColorStyleEditHexInput.classList.add('row-color-hex-error');
            return;
        }
        ui.rowColorStyleEditHexInput.classList.remove('row-color-hex-error');
        syncRowColorDraftUi(activeColorTarget, normalized);
        updatePopoverModeUi(activeColorTarget);
    });
    ui.rowColorHexInput.addEventListener('blur', () => {
        if (!activeColorTarget) return;
        if (!normalizeHexColorInput(ui.rowColorHexInput.value)) {
            updateColorPopoverUi(activeColorTarget, getDraftColor(activeColorTarget));
        }
    });
    ui.rowColorSaveBtn.addEventListener('click', () => {
        commitRowColorPopoverIfOpen();
    });
    ui.rowColorResetBtn.addEventListener('click', () => {
        if (!activeColorTarget || activeColorTarget.type !== 'col') {
            return;
        }
        rowColorDraftMode = 'hex';
        rowColorDraftStyleId = null;
        rowColorDraftHex = getRowColor(0);
        rowColorDraftColReset = true;
        updateColorPopoverUi(activeColorTarget, getRowColor(0));
    });
    document.addEventListener('click', () => {
        if (assistLinePopoverOpen) closeAssistLinePopover();
        if (rowColorPopoverOpen) closeRowColorPopover();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && rowColorPopoverOpen) {
            closeRowColorPopover();
        }
    });
    document.addEventListener('style-draft-updated', () => {
        renderGrid();
        renderPreview();
        refreshExportPreview();
    });

    // Y axis inputs
    ui.settingYMin.addEventListener('change', () => {
        syncYMaxValidationUi();
        renderPreview();
        applyModeLocks();
        checkCtaValidation();
    });
    ui.settingYMax.addEventListener('change', () => {
        syncYMaxValidationUi();
        renderPreview();
        applyModeLocks();
        checkCtaValidation();
    });

    // CSV
    ui.csvInput.addEventListener('change', handleCsvUpload);
    ui.csvExportBtn.addEventListener('click', downloadCsv);
    ui.csvDeleteBtn.addEventListener('click', removeCsv);

    // Reset
    ui.resetBtn.addEventListener('click', resetData);

    // Column & Row add buttons
    ui.addColFixedBtn.addEventListener('click', () => addColumn());
    ui.addRowFixedBtn.addEventListener('click', () => addRow());

    // Restore toast
    ui.toastCloseBtn.addEventListener('click', () => {
        ui.toast.classList.add('hidden');
    });

    bindStyleTabEvents();
    setStyleTemplateMode('read');
    ui.styleTemplateAddBtn.addEventListener('click', () => {
        const name = requestNewTemplateName();
        const draft = readStyleTabDraft();
        const validated = validateStyleTabDraft(draft);
        setStyleInjectionDraft(validated.draft);
        if (!validated.isValid) {
            window.alert('현재 Style 입력값이 유효하지 않습니다. 오류를 먼저 수정해주세요.');
            return;
        }
        const payload = buildTemplatePayloadFromDraft(validated.draft);
        parent.postMessage({ pluginMessage: { type: 'save_style_template', name, payload } }, '*');
    });
    document.addEventListener('style-draft-updated', () => {
        if (state.isInstanceTarget) {
            const draft = readStyleTabDraft();
            const fromDraft = buildLocalStyleOverridesFromDraft(draft);
            if (fromDraft.mask.cellFillStyle) setLocalStyleOverrideField('cellFillStyle', fromDraft.overrides.cellFillStyle);
            if (fromDraft.mask.cellTopStyle) setLocalStyleOverrideField('cellTopStyle', fromDraft.overrides.cellTopStyle);
            if (fromDraft.mask.tabRightStyle) setLocalStyleOverrideField('tabRightStyle', fromDraft.overrides.tabRightStyle);
            if (fromDraft.mask.gridContainerStyle) setLocalStyleOverrideField('gridContainerStyle', fromDraft.overrides.gridContainerStyle);
            if (fromDraft.mask.assistLineStyle) setLocalStyleOverrideField('assistLineStyle', fromDraft.overrides.assistLineStyle);
            if (fromDraft.mask.markStyle) setLocalStyleOverrideField('markStyle', fromDraft.overrides.markStyle);
            if (fromDraft.mask.markStyles) setLocalStyleOverrideField('markStyles', fromDraft.overrides.markStyles);
            if (fromDraft.mask.rowStrokeStyles) setLocalStyleOverrideField('rowStrokeStyles', fromDraft.overrides.rowStrokeStyles);
            if (fromDraft.mask.colStrokeStyle) setLocalStyleOverrideField('colStrokeStyle', fromDraft.overrides.colStrokeStyle);
            recomputeEffectiveStyleSnapshot();
        }
        state.selectedStyleTemplateId = null;
        renderStyleTemplateGallery();
    });
}

function initializeUi() {
    if (uiInitialized) return;
    ensureRowColorsLength(state.rows);
    ensureColHeaderColorEnabledLength(getGridColsForChart(state.chartType, state.cols));
    initializeStyleTabDraft({}, {});
    initializeRowColorPicker();
    if (!rowColorPicker) {
        console.warn('[ui][row-color] iro.js is not available. Falling back to HEX input only.');
    }
    bindUiEvents();
    initGraphSettingTooltip();
    updateAssistLineToggleUi();
    requestPaintStyleList();
    setDataTabRenderer(() => {
        renderGrid();
        renderPreview();
    });
    uiInitialized = true;

    while (pendingMessages.length > 0) {
        const msg = pendingMessages.shift();
        if (msg) handlePluginMessage(msg);
    }
}

// --- Message handler from Figma plugin ---
window.onmessage = (event) => {
    const msg = event.data?.pluginMessage;
    if (!msg) return;

    if (!uiInitialized) {
        pendingMessages.push(msg);
        return;
    }

    handlePluginMessage(msg);
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeUi, { once: true });
} else {
    initializeUi();
}
