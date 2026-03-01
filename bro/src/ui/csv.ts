import { state, getTotalStackedCols, ensureRowColorsLength, getGridColsForChart } from './state';
import { ui } from './dom';
import { renderGrid } from './grid';
import { renderPreview } from './preview';
import { checkCtaValidation } from './mode';
import { syncMarkCountFromRows } from './data-ops';

// ==========================================
// CSV OPERATIONS
// ==========================================

export function handleCsvUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    state.csvFileName = file.name;

    const reader = new FileReader();
    reader.onload = (ev) => {
        const text = ev.target?.result as string;
        parseAndApplyCsv(text);
    };
    reader.readAsText(file);
}

export function parseAndApplyCsv(text: string) {
    const lines = text.trim().split('\n').map(l => l.split(',').map(v => v.trim()));
    if (lines.length === 0) return;

    const isStacked = state.chartType === 'stackedBar';

    if (isStacked) {
        // For stacked: first row = group structure header, rest = data
        // Or just treat column count as flat mapping
        const maxCols = Math.max(...lines.map(l => l.length));
        const totalDataCols = maxCols;

        state.rows = lines.length;
        state.data = lines.map(row => {
            while (row.length < totalDataCols) row.push('');
            return row;
        });

        // Rebuild group structure from cols
        const barsPerGroup = Math.max(1, Math.ceil(totalDataCols / state.groupStructure.length));
        const newGroups = [];
        let remaining = totalDataCols;
        while (remaining > 0) {
            const take = Math.min(barsPerGroup, remaining);
            newGroups.push(take);
            remaining -= take;
        }
        state.groupStructure = newGroups;
        state.cols = newGroups.length;
    } else {
        state.rows = lines.length;
        if (state.chartType === 'line') {
            const pointCols = Math.max(2, lines[0].length);
            state.cols = Math.max(1, pointCols - 1);
            const normalizedCols = getGridColsForChart('line', state.cols);
            state.data = lines.map(row => {
                const next = [...row];
                while (next.length < normalizedCols) next.push('');
                return next.slice(0, normalizedCols);
            });
        } else {
            state.cols = lines[0].length;
            state.data = lines;
        }
    }

    ensureRowColorsLength(state.rows);
    updateCsvUi();
    syncMarkCountFromRows();
    renderGrid();
    renderPreview();
    checkCtaValidation();

    ui.settingColInput.value = String(state.cols);
}

export function downloadCsv() {
    const isStacked = state.chartType === 'stackedBar';
    const totalCols = isStacked ? getTotalStackedCols() : getGridColsForChart(state.chartType, state.cols);

    let csvContent = '';
    for (let r = 0; r < state.rows; r++) {
        const row = [];
        for (let c = 0; c < totalCols; c++) {
            row.push(state.data[r]?.[c] || '');
        }
        csvContent += row.join(',') + '\n';
    }

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.csvFileName || 'chart-data.csv';
    a.click();
    URL.revokeObjectURL(url);
}

export function removeCsv() {
    state.csvFileName = null;
    (ui.csvInput as HTMLInputElement).value = '';
    updateCsvUi();
}

export function updateCsvUi() {
    if (state.csvFileName) {
        ui.csvStatusText.textContent = state.csvFileName;
        ui.csvStatusText.classList.remove('text-text-sub');
        ui.csvStatusText.classList.add('text-primary', 'font-medium');
        ui.csvDeleteBtn.classList.remove('hidden');
    } else {
        ui.csvStatusText.textContent = 'csv를 업로드해주세요.';
        ui.csvStatusText.classList.add('text-text-sub');
        ui.csvStatusText.classList.remove('text-primary', 'font-medium');
        ui.csvDeleteBtn.classList.add('hidden');
    }
}
