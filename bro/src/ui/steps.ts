import { state, CHART_ICONS, initData, getTotalStackedCols, ensureColHeaderColorEnabledLength, ensureColHeaderColorModesLength, ensureColHeaderColorsLength, ensureColHeaderPaintStyleIdsLength, ensureColHeaderTitlesLength, ensureRowColorModesLength, ensureRowColorsLength, ensureRowHeaderLabelsLength, ensureRowPaintStyleIdsLength, getGridColsForChart } from './state';
import { ui } from './dom';
import { renderGrid } from './grid';
import { renderPreview } from './preview';
import { updateModeButtonState, checkCtaValidation, setMode, syncYMaxValidationUi, applyModeLocks } from './mode';
import { updateCsvUi } from './csv';
import { getEffectiveYDomain } from './y-range';
import { syncMarkCountFromRows } from './data-ops';
import { hydrateStyleTab, readStyleTabDraft, setStyleInjectionDraft, toStrokeInjectionPayload, validateStyleTabDraft } from './style-tab';
import { refreshGraphSettingTooltipContent } from './components/graph-setting-tooltip';

// ==========================================
// STEP / TYPE SELECTION / SUBMISSION
// ==========================================

function normalizeMarkRatio(value: unknown): number {
    const ratio = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(ratio)) return 0.8;
    return Math.max(0.01, Math.min(1.0, ratio));
}

function parseOptionalNumber(value: string): number | null {
    if (value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function collectGridHeaderLabels(): string[] {
    const headerCount = state.chartType === 'stackedBar'
        ? state.groupStructure.length
        : getGridColsForChart(state.chartType, state.cols);
    return ensureColHeaderTitlesLength(headerCount, state.chartType)
        .map((label) => label.trim())
        .filter((label) => label.length > 0);
}

export function goToStep(step: number) {
    state.currentStep = step;

    const allSteps = document.querySelectorAll('.step');
    allSteps.forEach(s => s.classList.remove('active'));

    const stepStyle = document.getElementById('step-style')!;
    const stepExport = document.getElementById('step-export')!;
    stepStyle.classList.remove('active');
    stepExport.classList.remove('active');

    if (step === 1) {
        ui.step1.classList.add('active');
        ui.backBtn.classList.add('hidden');
        ui.chartTypeWrapper.classList.add('hidden');
        ui.mainCta.textContent = 'Apply to Figma';
    } else if (step === 2) {
        ui.step2.classList.add('active');
        if (state.uiMode === 'create') {
            ui.backBtn.classList.remove('hidden');
        }

        // Update settings UI
        updateSettingInputs();
        renderGrid();
        setTimeout(() => renderPreview(), 50);
        applyModeLocks();
        checkCtaValidation();
    }
}

export function selectType(type: string) {
    state.chartType = type;

    ui.chartTypeWrapper.classList.remove('hidden');
    ui.chartTypeIcon.innerHTML = CHART_ICONS[type] || '';
    ui.chartTypeDisplay.textContent = type === 'stackedBar' ? 'Stacked' : type;

    // Stacked-specific UI
    if (type === 'stackedBar') {
        ui.labelColInput.textContent = 'Group Count';
        ui.labelMarkPosition.textContent = 'Segments';
        ui.containerMarkNormal.classList.remove('hidden');
        ui.tooltipStackedHint.classList.remove('hidden');

        state.groupStructure = [2, 2, 2];
        state.cols = 3;
        state.rows = 3;
    } else {
        ui.labelColInput.textContent = 'Graph Col';
        ui.labelMarkPosition.textContent = 'Mark Count';
        ui.containerMarkNormal.classList.remove('hidden');
        ui.tooltipStackedHint.classList.add('hidden');

        state.cols = 3;
        state.rows = 3;
    }
    refreshGraphSettingTooltipContent();

    // Line chart stroke width
    if (type === 'line') {
        ui.containerStrokeWidth.classList.remove('hidden');
        ui.spacerStroke.classList.add('hidden');
    } else {
        ui.containerStrokeWidth.classList.add('hidden');
        ui.spacerStroke.classList.remove('hidden');
    }

    const totalCols = type === 'stackedBar' ? getTotalStackedCols() : getGridColsForChart(type, state.cols);
    state.data = initData(state.rows, totalCols);
    state.colHeaderColorEnabled = [];
    ensureRowColorsLength(state.rows);
    ensureRowHeaderLabelsLength(state.rows, state.chartType);
    ensureColHeaderColorsLength(totalCols);
    ensureColHeaderColorEnabledLength(totalCols);
    ensureColHeaderTitlesLength(type === 'stackedBar' ? state.groupStructure.length : totalCols, state.chartType);
    state.markColorSource = 'row';
    syncMarkCountFromRows();
    if (state.dataMode === 'raw') {
        ui.settingYMin.value = '0';
        ui.settingYMax.value = '';
    } else {
        ui.settingYMin.value = '0';
        ui.settingYMax.value = '100';
    }

    updateModeButtonState();
    goToStep(2);
}

export function resetData() {
    const totalCols = state.chartType === 'stackedBar'
        ? getTotalStackedCols()
        : getGridColsForChart(state.chartType, state.cols);
    state.data = initData(state.rows, totalCols);
    ensureRowColorsLength(state.rows);
    ensureRowHeaderLabelsLength(state.rows, state.chartType);
    ensureColHeaderColorsLength(totalCols);
    ensureColHeaderColorEnabledLength(totalCols);
    ensureColHeaderTitlesLength(state.chartType === 'stackedBar' ? state.groupStructure.length : totalCols, state.chartType);
    state.csvFileName = null;

    updateCsvUi();
    renderGrid();
    renderPreview();
    checkCtaValidation();
}

export function updateSettingInputs() {
    ui.settingColInput.value = String(state.cols);
    ui.settingCellInput.value = String(state.cellCount);
    ui.settingStrokeInput.value = String(state.strokeWidth);
    state.markRatio = normalizeMarkRatio(state.markRatio);
    ui.settingMarkRatioInput.value = String(state.markRatio);
    ui.containerMarkNormal.classList.remove('hidden');

    if (state.chartType === 'line') {
        ui.containerStrokeWidth.classList.remove('hidden');
        ui.spacerStroke.classList.add('hidden');
    } else {
        ui.containerStrokeWidth.classList.add('hidden');
        ui.spacerStroke.classList.remove('hidden');
    }
    if (state.chartType === 'bar' || state.chartType === 'stackedBar') {
        ui.containerMarkRatio.classList.remove('hidden');
    } else {
        ui.containerMarkRatio.classList.add('hidden');
    }
}

export function submitData() {
    const isAllowed = checkCtaValidation();
    if (!isAllowed) return;

    const isStacked = state.chartType === 'stackedBar';

    let drawingValues: number[][];
    let rawValues: string[][];

    if (isStacked) {
        rawValues = state.data.map(row => [...row]);
        // Row 0 (All, manual input allowed): if empty, use sum fallback 
        const totalCols = getTotalStackedCols();
        for (let c = 0; c < totalCols; c++) {
            if (rawValues[0][c] === '' || rawValues[0][c] === undefined) {
                let sum = 0;
                for (let r = 1; r < state.rows; r++) {
                    sum += Number(rawValues[r][c]) || 0;
                }
                rawValues[0][c] = String(sum);
            }
        }
        // Drawing values exclude row 0
        drawingValues = rawValues.slice(1).map(row => row.map(v => Number(v) || 0));
    } else {
        rawValues = state.data.map(row => [...row]);
        drawingValues = state.data.map(row => row.map(v => Number(v) || 0));
    }

    const markNum = isStacked
        ? state.groupStructure
        : Number(ui.settingMarkSelect.value) || 1;

    const yDomain = getEffectiveYDomain({
        mode: state.dataMode,
        yMinInput: ui.settingYMin.value,
        yMaxInput: ui.settingYMax.value,
        data: state.data,
        chartType: state.chartType
    });
    const effectiveYMax = yDomain.yMax;
    const rawYMaxAuto = state.dataMode === 'raw' ? yDomain.isAuto : false;
    if (state.dataMode === 'raw') {
        ui.settingYMax.value = String(effectiveYMax);
    }

    const styleDraft = readStyleTabDraft();
    const validatedStyleDraft = validateStyleTabDraft(styleDraft);
    setStyleInjectionDraft(validatedStyleDraft.draft);
    if (!validatedStyleDraft.isValid) {
        hydrateStyleTab(validatedStyleDraft.draft);
    }
    const explicitStylePayload = validatedStyleDraft.isValid
        ? toStrokeInjectionPayload(validatedStyleDraft.draft)
        : null;

    const msgType = state.uiMode === 'edit' ? 'apply' : 'generate';
    const styleApplyMode = msgType === 'generate' ? 'include_style' : 'include_style';

    const payload = {
        type: state.chartType,
        mode: state.dataMode,
        values: drawingValues,
        rawValues: rawValues,
        xAxisLabels: collectGridHeaderLabels(),
        cols: state.cols,
        rows: state.rows,
        cellCount: state.cellCount,
        yMin: Number(ui.settingYMin.value) || 0,
        yMax: state.dataMode === 'raw' ? effectiveYMax : (parseOptionalNumber(ui.settingYMax.value) ?? 100),
        rawYMaxAuto,
        markNum: markNum,
        strokeWidth: state.strokeWidth,
        markRatio: (state.chartType === 'bar' || state.chartType === 'stackedBar')
            ? normalizeMarkRatio(state.markRatio)
            : undefined,
        rowColors: ensureRowColorsLength(state.rows),
        rowColorModes: ensureRowColorModesLength(state.rows),
        rowPaintStyleIds: ensureRowPaintStyleIdsLength(state.rows),
        rowHeaderLabels: ensureRowHeaderLabelsLength(state.rows, state.chartType),
        colColors: state.colHeaderColors,
        colColorModes: ensureColHeaderColorModesLength(getGridColsForChart(state.chartType, state.cols)),
        colPaintStyleIds: ensureColHeaderPaintStyleIdsLength(getGridColsForChart(state.chartType, state.cols)),
        colColorEnabled: ensureColHeaderColorEnabledLength(getGridColsForChart(state.chartType, state.cols)),
        markColorSource: state.markColorSource,
        assistLineVisible: state.assistLineVisible,
        assistLineEnabled: {
            min: state.assistLineEnabled.min,
            max: state.assistLineEnabled.max,
            avg: state.assistLineEnabled.avg,
            ctr: state.assistLineEnabled.ctr
        },
        rowStrokeStyles: state.rowStrokeStyles,
        colStrokeStyle: state.colStrokeStyle,
        localStyleOverrides: state.isInstanceTarget ? state.localStyleOverrides : undefined,
        localStyleOverrideMask: state.isInstanceTarget ? state.localStyleOverrideMask : undefined,
        styleApplyMode,
        ...(explicitStylePayload || {})
    };

    parent.postMessage({ pluginMessage: { type: msgType, payload } }, '*');
}

// Expose functions that are called from HTML onclick attributes
(window as any).selectType = selectType;
(window as any).setMode = setMode;
