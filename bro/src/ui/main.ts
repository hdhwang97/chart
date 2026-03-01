import './style.css';
import {
    state,
    CHART_ICONS,
    initData,
    getTotalStackedCols,
    getGridColsForChart,
    applyIncomingRowColors,
    ensureRowColorsLength,
    ensureRowHeaderLabelsLength,
    ensureColHeaderColorsLength,
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
import type { LocalStyleOverrideMask, LocalStyleOverrides } from '../shared/style-types';
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
        'rowColors', 'colColors', 'colColorEnabled', 'markColorSource',
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
    if (Array.isArray(source.colColors)) next.colColors = source.colColors.map((v) => normalizeHexColorInput(v) || '').filter((v) => Boolean(v));
    if (Array.isArray(source.colColorEnabled)) next.colColorEnabled = source.colColorEnabled.map((v) => Boolean(v));
    if (source.markColorSource === 'col' || source.markColorSource === 'row') next.markColorSource = source.markColorSource;
    if (typeof source.assistLineVisible === 'boolean') next.assistLineVisible = source.assistLineVisible;
    if (source.assistLineEnabled && typeof source.assistLineEnabled === 'object') {
        next.assistLineEnabled = {
            min: Boolean(source.assistLineEnabled.min),
            max: Boolean(source.assistLineEnabled.max),
            avg: Boolean(source.assistLineEnabled.avg)
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
    ui.rowColorPopover.classList.add('hidden');
    ui.rowColorHexInput.classList.remove('row-color-hex-error');
    ui.rowColorResetBtn.classList.add('hidden');
    ui.rowColorResetBtn.disabled = true;
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
        ui.rowColorHexInput.value = hex;
        ui.rowColorHexInput.classList.remove('row-color-hex-error');
        applyColorHex(activeColorTarget, hex);
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
    const color = normalizeHexColorInput(colorHex) || getRowColor(row);
    const rowLabel = state.chartType === 'stackedBar' ? `R${row}` : `R${row + 1}`;

    ui.rowColorPopoverTitle.textContent = `Row ${rowLabel}`;
    ui.rowColorPreview.style.backgroundColor = color;
    ui.rowColorHexInput.value = color;
    ui.rowColorHexInput.classList.remove('row-color-hex-error');
    if (rowColorPicker) {
        isSyncingFromPicker = true;
        rowColorPicker.color.hexString = color;
        isSyncingFromPicker = false;
    }
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
        return;
    }
    const color = normalizeHexColorInput(colorHex)
        || (state.colHeaderColorEnabled[target.index]
            ? (normalizeHexColorInput(state.colHeaderColors[target.index]) || getRowColor(0))
            : getRowColor(0));
    ui.rowColorPopoverTitle.textContent = `Col C${target.index + 1}`;
    ui.rowColorPreview.style.backgroundColor = color;
    ui.rowColorHexInput.value = color;
    ui.rowColorHexInput.classList.remove('row-color-hex-error');
    if (rowColorPicker) {
        isSyncingFromPicker = true;
        rowColorPicker.color.hexString = color;
        isSyncingFromPicker = false;
    }
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
    const totalCols = getGridColsForChart(state.chartType, state.cols);
    ensureColHeaderColorsLength(totalCols);
    initializeRowColorPicker();
    activeColorTarget = target;
    rowColorPopoverOpen = true;
    ui.rowColorPopover.classList.remove('hidden');
    const color = target.type === 'row'
        ? getRowColor(target.index)
        : (state.colHeaderColorEnabled[target.index]
            ? (normalizeHexColorInput(state.colHeaderColors[target.index]) || getRowColor(0))
            : getRowColor(0));
    updateColorPopoverUi(target, color);
    positionRowColorPopover(anchorRect);
}

function commitRowColorPopoverIfOpen() {
    if (!rowColorPopoverOpen || !activeColorTarget) return false;
    const fallback = activeColorTarget.type === 'row'
        ? getRowColor(activeColorTarget.index)
        : (state.colHeaderColorEnabled[activeColorTarget.index]
            ? (normalizeHexColorInput(state.colHeaderColors[activeColorTarget.index]) || getRowColor(0))
            : getRowColor(0));
    const candidate = normalizeHexColorInput(ui.rowColorHexInput.value) || fallback;
    const applied = applyColorHex(activeColorTarget, candidate, true);
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
        return { min: false, max: false, avg: false };
    }
    return {
        min: Boolean(value.min),
        max: Boolean(value.max),
        avg: Boolean(value.avg)
    };
}

function normalizeAssistLineVisibleInput(value: any) {
    return Boolean(value);
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
}

function handlePluginMessage(msg: any) {
    if (msg.type === 'init') {
        forceCloseStyleColorPopover();
        closeRowColorPopover();
        if (!msg.chartType) {
            // No selection
            state.uiMode = 'create';
            state.isInstanceTarget = false;
            resetLocalStyleOverrideState();
            state.mode = 'edit';
            state.markRatio = 0.8;
            state.rowColors = [getDefaultRowColor(0), getDefaultRowColor(1), getDefaultRowColor(2)];
            state.rowHeaderLabels = ['R1', 'R2', 'R3'];
            state.colHeaderTitles = ['C1', 'C2', 'C3'];
            state.colHeaderColors = [getDefaultRowColor(0), getDefaultRowColor(1), getDefaultRowColor(2)];
            state.colHeaderColorEnabled = [false, false, false];
            state.markColorSource = 'row';
            state.assistLineVisible = false;
            state.assistLineEnabled = { min: false, max: false, avg: false };
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
            return;
        }

        state.uiMode = 'edit';
        state.chartType = msg.chartType;
        state.isInstanceTarget = Boolean(msg.isInstanceTarget);
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
        ensureColHeaderColorsLength(initTotalCols);
        ensureColHeaderColorEnabledLength(initTotalCols);
        if (Array.isArray(msg.colColors)) {
            state.colHeaderColors = msg.colColors
                .map((c: unknown) => normalizeHexColorInput(c))
                .map((c: string | null, i: number) => c || getDefaultRowColor(i))
                .slice(0, initTotalCols);
            ensureColHeaderColorsLength(initTotalCols);
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
    }
    if (msg.type === 'style_templates_loaded') {
        setStyleTemplateList(msg.list || []);
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
        ensureRowColorsLength(state.rows);
        const payloadTotalCols = state.chartType === 'stackedBar'
            ? getTotalStackedCols()
            : getGridColsForChart(state.chartType, state.cols);
        state.colHeaderColorEnabled = [];
        ensureColHeaderColorsLength(payloadTotalCols);
        ensureColHeaderColorEnabledLength(payloadTotalCols);
        if (Array.isArray(msg.payload?.colColors)) {
            state.colHeaderColors = msg.payload.colColors
                .map((c: unknown) => normalizeHexColorInput(c))
                .map((c: string | null, i: number) => c || getDefaultRowColor(i))
                .slice(0, payloadTotalCols);
            ensureColHeaderColorsLength(payloadTotalCols);
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
    ui.rowColorHexInput.addEventListener('input', () => {
        if (!activeColorTarget) return;
        const normalized = normalizeHexColorInput(ui.rowColorHexInput.value);
        if (!normalized) {
            ui.rowColorHexInput.classList.add('row-color-hex-error');
            return;
        }
        applyColorHex(activeColorTarget, normalized);
    });
    ui.rowColorHexInput.addEventListener('blur', () => {
        if (!activeColorTarget) return;
        if (!normalizeHexColorInput(ui.rowColorHexInput.value)) {
            const fallback = activeColorTarget.type === 'row'
                ? getRowColor(activeColorTarget.index)
                : (state.colHeaderColorEnabled[activeColorTarget.index]
                    ? (normalizeHexColorInput(state.colHeaderColors[activeColorTarget.index]) || getRowColor(0))
                    : getRowColor(0));
            updateColorPopoverUi(activeColorTarget, fallback);
        }
    });
    ui.rowColorSaveBtn.addEventListener('click', () => {
        if (!activeColorTarget) {
            closeRowColorPopover();
            return;
        }
        const candidate = normalizeHexColorInput(ui.rowColorHexInput.value)
            || (activeColorTarget.type === 'row'
                ? getRowColor(activeColorTarget.index)
                : (state.colHeaderColorEnabled[activeColorTarget.index]
                    ? (normalizeHexColorInput(state.colHeaderColors[activeColorTarget.index]) || getRowColor(0))
                    : getRowColor(0)));
        const applied = applyColorHex(activeColorTarget, candidate);
        if (!applied) return;
        closeRowColorPopover();
    });
    ui.rowColorResetBtn.addEventListener('click', () => {
        if (!activeColorTarget || activeColorTarget.type !== 'col') {
            return;
        }
        const totalCols = getGridColsForChart(state.chartType, state.cols);
        ensureColHeaderColorsLength(totalCols);
        ensureColHeaderColorEnabledLength(totalCols);
        state.colHeaderColorEnabled[activeColorTarget.index] = false;
        state.colHeaderColors[activeColorTarget.index] = getRowColor(0);
        if (state.isInstanceTarget) {
            const totalCols = getGridColsForChart(state.chartType, state.cols);
            setLocalStyleOverrideField('colColors', ensureColHeaderColorsLength(totalCols).slice());
            setLocalStyleOverrideField('colColorEnabled', ensureColHeaderColorEnabledLength(totalCols).slice());
            recomputeEffectiveStyleSnapshot();
        }
        updateColColorSwatchDom(activeColorTarget.index);
        const fallback = normalizeHexColorInput(state.colHeaderColors[activeColorTarget.index]) || getRowColor(0);
        updateColorPopoverUi(activeColorTarget, fallback);
        renderGrid();
        renderPreview();
        refreshExportPreview();
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
