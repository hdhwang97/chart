import './style.css';
import { state, CHART_ICONS, initData, getTotalStackedCols } from './state';
import { ui } from './dom';
import { renderGrid } from './grid';
import { renderPreview } from './preview';
import { setMode, toggleMode, updateModeButtonState, checkCtaValidation } from './mode';
import { handleCsvUpload, downloadCsv, removeCsv, updateCsvUi } from './csv';
import { addRow, addColumn, handleDimensionInput, updateGridSize } from './data-ops';
import { goToStep, selectType, resetData, updateSettingInputs, submitData } from './steps';
import { switchTab, handleStyleExtracted, setDataTabRenderer } from './export';

// ==========================================
// UI ENTRY POINT
// ==========================================

let uiInitialized = false;
const pendingMessages: any[] = [];

function normalizeMarkRatioInput(value: unknown): number {
    const ratio = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(ratio)) return 0.8;
    return Math.max(0.01, Math.min(1.0, ratio));
}

function handlePluginMessage(msg: any) {
    if (msg.type === 'init') {
        if (!msg.chartType) {
            // No selection
            state.uiMode = 'create';
            state.markRatio = 0.8;
            ui.settingMarkRatioInput.value = '0.8';
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

        // Apply saved settings
        if (msg.lastCellCount) state.cellCount = Number(msg.lastCellCount);
        if (msg.lastMode) state.dataMode = msg.lastMode as 'raw' | 'percent';
        if (msg.lastYMin !== undefined) ui.settingYMin.value = String(msg.lastYMin);
        if (msg.lastYMax !== undefined) ui.settingYMax.value = String(msg.lastYMax);
        if (msg.lastStrokeWidth !== undefined) {
            state.strokeWidth = msg.lastStrokeWidth;
            ui.settingStrokeInput.value = String(msg.lastStrokeWidth);
        }
        state.markRatio = normalizeMarkRatioInput(msg.markRatio);
        ui.settingMarkRatioInput.value = String(state.markRatio);
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
        goToStep(2);
        switchTab('data');
    }

    if (msg.type === 'style_extracted') {
        state.markRatio = normalizeMarkRatioInput(msg.payload?.markRatio);
        ui.settingMarkRatioInput.value = String(state.markRatio);
        state.colStrokeStyle = msg.payload?.colStrokeStyle || null;
        state.cellStrokeStyles = msg.payload?.cellStrokeStyles || [];
        state.rowStrokeStyles = msg.payload?.rowStrokeStyles || [];
        renderPreview();
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
        renderGrid();
        renderPreview();
    });

    // Y axis inputs
    ui.settingYMin.addEventListener('change', () => renderPreview());
    ui.settingYMax.addEventListener('change', () => renderPreview());

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
