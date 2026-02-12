import { state } from './state';
import { ui } from './dom';
import { renderGrid } from './grid';
import { renderPreview } from './preview';

// ==========================================
// MODE MANAGEMENT
// ==========================================

export function setMode(mode: 'raw' | 'percent') {
    state.dataMode = mode;
    updateModeButtonState();
    clearRangeErrors();

    if (mode === 'percent') {
        checkDataRange();
    }
    renderGrid();
    renderPreview();
    checkCtaValidation();
}

export function toggleMode() {
    if (state.mode === 'read') {
        state.mode = 'edit';
        ui.editModeBtn.textContent = 'Save';
    } else {
        state.mode = 'read';
        ui.editModeBtn.textContent = 'Edit';
    }
    renderGrid();
}

export function updateModeButtonState() {
    if (state.dataMode === 'raw') {
        ui.modeRawBtn.className = 'px-2 py-0.5 text-xxs font-semibold rounded bg-white text-primary shadow-sm transition-all border-0 cursor-pointer';
        ui.modePercentBtn.className = 'px-2 py-0.5 text-xxs font-semibold rounded text-text-sub hover:text-text transition-all border-0 cursor-pointer';
        ui.tooltipNormal.classList.remove('hidden');
        ui.tooltipWarning.classList.add('hidden');
    } else {
        ui.modePercentBtn.className = 'px-2 py-0.5 text-xxs font-semibold rounded bg-white text-primary shadow-sm transition-all border-0 cursor-pointer';
        ui.modeRawBtn.className = 'px-2 py-0.5 text-xxs font-semibold rounded text-text-sub hover:text-text transition-all border-0 cursor-pointer';
        ui.tooltipNormal.classList.add('hidden');
        ui.tooltipWarning.classList.remove('hidden');
    }

    // Stacked hint visibility
    if (state.chartType === 'stackedBar') {
        ui.tooltipStackedHint.classList.remove('hidden');
    } else {
        ui.tooltipStackedHint.classList.add('hidden');
    }
}

export function checkDataRange() {
    if (state.dataMode !== 'percent') return;
    let hasError = false;
    state.data.forEach(row => {
        row.forEach(val => {
            if (val !== '') {
                const n = Number(val);
                if (n < 0 || n > 100) hasError = true;
            }
        });
    });
    if (hasError) {
        showErrorToast();
    }
}

export function clearRangeErrors() {
    const cells = ui.gridContainer.querySelectorAll('.grid-cell');
    cells.forEach(cell => {
        (cell as HTMLElement).classList.remove('border-danger', 'border-2');
    });
}

export function checkCtaValidation() {
    let hasAny = false;
    state.data.forEach(row => {
        row.forEach(val => {
            if (val !== '' && val !== null && val !== undefined) hasAny = true;
        });
    });

    let rangeOk = true;
    if (state.dataMode === 'percent') {
        state.data.forEach(row => {
            row.forEach(val => {
                if (val !== '') {
                    const n = Number(val);
                    if (n < 0 || n > 100) rangeOk = false;
                }
            });
        });
    }

    ui.mainCta.disabled = !hasAny || !rangeOk;
}

// Validate Stacked data
export function validateStackedData(): boolean {
    if (state.chartType !== 'stackedBar') return true;
    // Additional validation if needed
    return true;
}

export function getAutoFillValue(rowIdx: number, groupIndex: number, barInGroup: number): string | null {
    if (state.chartType !== 'stackedBar' || rowIdx !== 0) return null;
    // Row 0 = "All" row for stacked => auto-sum remaining rows
    let totalDataCol = 0;
    for (let g = 0; g < groupIndex; g++) totalDataCol += state.groupStructure[g];
    totalDataCol += barInGroup;

    let sum = 0;
    for (let r = 1; r < state.rows; r++) {
        sum += Number(state.data[r][totalDataCol]) || 0;
    }
    return sum > 0 ? String(sum) : null;
}

function showErrorToast() {
    const toast = ui.errorToast;
    toast.classList.remove('hidden');
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(8px)';
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, 3000);
}
