import { state, CHART_ICONS, initData, getTotalStackedCols } from './state';
import { ui } from './dom';
import { renderGrid } from './grid';
import { renderPreview } from './preview';
import { updateModeButtonState, checkCtaValidation, setMode, syncYMaxValidationUi, applyModeLocks } from './mode';
import { updateCsvUi } from './csv';
import { getEffectiveYDomain } from './y-range';
import { syncMarkCountFromRows } from './data-ops';

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

export function goToStep(step: number) {
    state.currentStep = step;

    const allSteps = document.querySelectorAll('.step');
    allSteps.forEach(s => s.classList.remove('active'));

    const stepExport = document.getElementById('step-export')!;
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
        ui.containerMarkNormal.classList.add('hidden');
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

    // Line chart stroke width
    if (type === 'line') {
        ui.containerStrokeWidth.classList.remove('hidden');
        ui.spacerStroke.classList.add('hidden');
    } else {
        ui.containerStrokeWidth.classList.add('hidden');
        ui.spacerStroke.classList.remove('hidden');
    }

    const totalCols = type === 'stackedBar' ? getTotalStackedCols() : state.cols;
    state.data = initData(state.rows, totalCols);
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
    const totalCols = state.chartType === 'stackedBar' ? getTotalStackedCols() : state.cols;
    state.data = initData(state.rows, totalCols);
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

    if (state.chartType === 'stackedBar') {
        ui.containerMarkNormal.classList.add('hidden');
    } else {
        ui.containerMarkNormal.classList.remove('hidden');
    }

    if (state.chartType === 'line') {
        ui.containerStrokeWidth.classList.remove('hidden');
        ui.spacerStroke.classList.add('hidden');
    } else {
        ui.containerStrokeWidth.classList.add('hidden');
        ui.spacerStroke.classList.remove('hidden');
    }
    if (state.chartType === 'bar') {
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
        // Row 0 (All) : if empty, use sum 
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

    const payload = {
        type: state.chartType,
        mode: state.dataMode,
        values: drawingValues,
        rawValues: rawValues,
        cols: state.cols,
        rows: state.rows,
        cellCount: state.cellCount,
        yMin: Number(ui.settingYMin.value) || 0,
        yMax: state.dataMode === 'raw' ? effectiveYMax : (parseOptionalNumber(ui.settingYMax.value) ?? 100),
        rawYMaxAuto,
        markNum: markNum,
        strokeWidth: state.strokeWidth,
        markRatio: state.chartType === 'bar' ? normalizeMarkRatio(state.markRatio) : undefined,
        assistLineVisible: state.assistLineVisible,
        assistLineEnabled: {
            min: state.assistLineEnabled.min,
            max: state.assistLineEnabled.max,
            avg: state.assistLineEnabled.avg
        }
    };

    const msgType = state.uiMode === 'edit' ? 'apply' : 'generate';
    parent.postMessage({ pluginMessage: { type: msgType, payload } }, '*');
}

// Expose functions that are called from HTML onclick attributes
(window as any).selectType = selectType;
(window as any).setMode = setMode;
