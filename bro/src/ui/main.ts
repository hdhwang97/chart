import './style.css';
import { state, CHART_ICONS, initData, getTotalStackedCols } from './state';
import { ui } from './dom';
import { renderGrid } from './grid';
import { renderPreview } from './preview';
import { setMode, toggleMode, updateModeButtonState, checkCtaValidation, syncYMaxValidationUi, applyModeLocks } from './mode';
import { handleCsvUpload, downloadCsv, removeCsv, updateCsvUi } from './csv';
import { addRow, addColumn, handleDimensionInput, updateGridSize, syncMarkCountFromRows, syncRowsFromMarkCount } from './data-ops';
import { goToStep, selectType, resetData, updateSettingInputs, submitData } from './steps';
import { switchTab, handleStyleExtracted, setDataTabRenderer } from './export';

// ==========================================
// UI ENTRY POINT
// ==========================================

let uiInitialized = false;
const pendingMessages: any[] = [];
let assistLinePopoverOpen = false;

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
        if (!msg.chartType) {
            // No selection
            state.uiMode = 'create';
            state.mode = 'edit';
            state.markRatio = 0.8;
            state.assistLineVisible = false;
            state.assistLineEnabled = { min: false, max: false, avg: false };
            ui.settingMarkRatioInput.value = '0.8';
            ui.settingYMin.value = '0';
            ui.settingYMax.value = '';
            closeAssistLinePopover();
            updateAssistLineToggleUi();
            state.colStrokeStyle = null;
            state.cellStrokeStyles = [];
            state.rowStrokeStyles = [];
            switchTab('data');
            goToStep(1);
            ui.editModeBtn.classList.add('hidden');
            return;
        }

        state.uiMode = 'edit';
        state.chartType = msg.chartType;

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
                state.cols = vals[0]?.length || 3;
            }

            state.data = vals.map((row: any[]) => row.map((v: any) => String(v)));
        } else {
            const totalCols = msg.chartType === 'stackedBar' ? getTotalStackedCols() : state.cols;
            state.data = initData(state.rows, totalCols);
        }
        syncMarkCountFromRows();

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

        // Line-specific UI
        if (msg.chartType === 'line') {
            ui.containerStrokeWidth.classList.remove('hidden');
            ui.spacerStroke.classList.add('hidden');
        } else {
            ui.containerStrokeWidth.classList.add('hidden');
            ui.spacerStroke.classList.remove('hidden');
        }
        if (msg.chartType === 'bar') {
            ui.containerMarkRatio.classList.remove('hidden');
        } else {
            ui.containerMarkRatio.classList.add('hidden');
        }

        // Stacked-specific UI
        if (msg.chartType === 'stackedBar') {
            ui.labelColInput.textContent = 'Group Count';
            ui.containerMarkNormal.classList.add('hidden');
        } else {
            ui.labelColInput.textContent = 'Graph Col';
            ui.containerMarkNormal.classList.remove('hidden');
            if (msg.savedMarkNum && typeof msg.savedMarkNum === 'number') {
                ui.settingMarkSelect.value = String(msg.savedMarkNum);
            }
        }

        ui.backBtn.classList.add('hidden');
        updateModeButtonState();
        syncYMaxValidationUi();
        applyModeLocks();
        goToStep(2);
        switchTab('data');
        checkCtaValidation();
    }

    if (msg.type === 'style_extracted') {
        state.markRatio = normalizeMarkRatioInput(msg.payload?.markRatio);
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
        renderPreview();
        syncYMaxValidationUi();
        applyModeLocks();
        checkCtaValidation();
        handleStyleExtracted(msg.payload);
    }
}

function bindUiEvents() {
    // Header buttons
    ui.backBtn.addEventListener('click', () => goToStep(1));
    ui.mainCta.addEventListener('click', () => submitData());
    ui.editModeBtn.addEventListener('click', () => toggleMode());

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
        updateAssistLineToggleUi();
        checkCtaValidation();
    });
    ui.assistLineMinCheck.addEventListener('change', () => {
        state.assistLineEnabled.min = ui.assistLineMinCheck.checked;
        checkCtaValidation();
    });
    ui.assistLineMaxCheck.addEventListener('change', () => {
        state.assistLineEnabled.max = ui.assistLineMaxCheck.checked;
        checkCtaValidation();
    });
    ui.assistLineAvgCheck.addEventListener('change', () => {
        state.assistLineEnabled.avg = ui.assistLineAvgCheck.checked;
        checkCtaValidation();
    });
    ui.assistLinePopover.addEventListener('click', (e) => e.stopPropagation());
    ui.assistLineControl.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => {
        if (assistLinePopoverOpen) closeAssistLinePopover();
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
}

function initializeUi() {
    if (uiInitialized) return;
    bindUiEvents();
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
