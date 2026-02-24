import { state, MAX_SIZE, ensureColHeaderColorsLength, ensureColHeaderTitlesLength, ensureRowColorsLength, ensureRowHeaderLabelsLength, getGridColsForChart } from './state';
import { ui } from './dom';
import { renderGrid } from './grid';
import { renderPreview } from './preview';
import { checkCtaValidation } from './mode';

// ==========================================
// DATA OPERATIONS
// ==========================================

function normalizeSegmentCount(value: unknown, fallback = 1): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(MAX_SIZE, Math.floor(parsed)));
}

function getUniformSegmentCount(): number | null {
    if (!Array.isArray(state.groupStructure) || state.groupStructure.length === 0) return null;
    const normalized = state.groupStructure.map((count) => normalizeSegmentCount(count, 1));
    const first = normalized[0];
    const isUniform = normalized.every((count) => count === first);
    return isUniform ? first : null;
}

function resolveDefaultSegmentForNewGroup() {
    const uniform = getUniformSegmentCount();
    if (uniform !== null) return uniform;
    return normalizeSegmentCount(state.groupStructure[0], 2);
}

function rebuildMarkCountOptions(opts?: { includeMixed?: boolean }) {
    const select = ui.settingMarkSelect;
    select.innerHTML = '';
    if (opts?.includeMixed) {
        const mixed = document.createElement('option');
        mixed.value = 'mixed';
        mixed.textContent = 'Mixed';
        select.appendChild(mixed);
    }
    for (let i = 1; i <= MAX_SIZE; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = String(i);
        select.appendChild(opt);
    }
}

function setSegmentSelectDisabled(disabled: boolean) {
    ui.settingMarkSelect.disabled = disabled;
    ui.settingMarkSelect.classList.toggle('opacity-50', disabled);
    ui.settingMarkSelect.classList.toggle('cursor-not-allowed', disabled);
}

export function syncSegmentControlForStacked() {
    if (state.chartType !== 'stackedBar') {
        setSegmentSelectDisabled(false);
        return;
    }

    const uniform = getUniformSegmentCount();
    if (uniform === null) {
        rebuildMarkCountOptions({ includeMixed: true });
        ui.settingMarkSelect.value = 'mixed';
        setSegmentSelectDisabled(true);
        return;
    }

    rebuildMarkCountOptions();
    ui.settingMarkSelect.value = String(uniform);
    setSegmentSelectDisabled(false);
}

export function applySegmentCountToAllGroups(segmentCount: number) {
    if (state.chartType !== 'stackedBar') return;

    const nextSegmentCount = normalizeSegmentCount(segmentCount, 1);
    const groupCount = Math.max(1, state.groupStructure.length || state.cols || 1);
    const prevStructure = Array.from({ length: groupCount }, (_, idx) => {
        return normalizeSegmentCount(state.groupStructure[idx], nextSegmentCount);
    });
    const nextStructure = Array.from({ length: groupCount }, () => nextSegmentCount);

    const nextData = state.data.map((row) => {
        const sourceRow = Array.isArray(row) ? row : [];
        const rebuiltRow: string[] = [];
        let offset = 0;

        for (let g = 0; g < groupCount; g++) {
            const oldCount = prevStructure[g];
            const keep = Math.min(oldCount, nextSegmentCount);
            for (let i = 0; i < keep; i++) {
                rebuiltRow.push(sourceRow[offset + i] ?? '');
            }
            for (let i = keep; i < nextSegmentCount; i++) {
                rebuiltRow.push('');
            }
            offset += oldCount;
        }

        return rebuiltRow;
    });

    state.groupStructure = nextStructure;
    state.cols = groupCount;
    state.data = nextData;
    ui.settingColInput.value = String(state.cols);
    syncSegmentControlForStacked();
    renderGrid();
    renderPreview();
    checkCtaValidation();
}

export function syncMarkCountFromRows() {
    if (state.chartType === 'stackedBar') {
        syncSegmentControlForStacked();
        return;
    }
    setSegmentSelectDisabled(false);
    rebuildMarkCountOptions();
    const next = Math.max(1, Math.min(MAX_SIZE, state.rows));
    ui.settingMarkSelect.value = String(next);
}

export function syncRowsFromMarkCount() {
    if (state.chartType === 'stackedBar') return;
    const parsed = Number(ui.settingMarkSelect.value);
    const nextRows = Math.max(1, Math.min(MAX_SIZE, Number.isFinite(parsed) ? parsed : 1));
    ui.settingMarkSelect.value = String(nextRows);
    if (state.rows !== nextRows) {
        updateGridSize(state.cols, nextRows);
    }
}

export function addRow() {
    if (state.rows >= MAX_SIZE) return;
    state.rows++;
    const newCols = state.chartType === 'stackedBar'
        ? state.groupStructure.reduce((a, b) => a + b, 0)
        : getGridColsForChart(state.chartType, state.cols);
    state.data.push(new Array(newCols).fill(""));
    ensureRowColorsLength(state.rows);
    ensureRowHeaderLabelsLength(state.rows, state.chartType);
    syncMarkCountFromRows();
    renderGrid();
    renderPreview();
    checkCtaValidation();
}

export function clearAllData() {
    const totalCols = state.chartType === 'stackedBar'
        ? state.groupStructure.reduce((a, b) => a + b, 0)
        : getGridColsForChart(state.chartType, state.cols);

    state.data = Array.from({ length: state.rows }, () => new Array(totalCols).fill(''));
    renderGrid();
    renderPreview();
    checkCtaValidation();
}

export function addColumn() {
    if (state.chartType === 'stackedBar') {
        const defaultSegment = resolveDefaultSegmentForNewGroup();
        state.groupStructure.push(defaultSegment);
        const totalCols = state.groupStructure.reduce((a, b) => a + b, 0);
        for (let r = 0; r < state.data.length; r++) {
            while (state.data[r].length < totalCols) state.data[r].push("");
        }
        state.cols = state.groupStructure.length;
        syncSegmentControlForStacked();
    } else {
        if (state.cols >= MAX_SIZE) return;
        state.cols++;
        state.data.forEach(row => row.push(""));
    }
    ui.settingColInput.value = String(state.cols);
    ensureColHeaderColorsLength(getGridColsForChart(state.chartType, state.cols));
    ensureColHeaderTitlesLength(
        state.chartType === 'stackedBar' ? state.groupStructure.length : getGridColsForChart(state.chartType, state.cols),
        state.chartType
    );
    renderGrid();
    renderPreview();
    checkCtaValidation();
}

export function deleteRow(rowIdx: number) {
    if (state.rows <= 1) return;
    state.rows--;
    state.data.splice(rowIdx, 1);
    ensureRowColorsLength(state.rows);
    ensureRowHeaderLabelsLength(state.rows, state.chartType);
    syncMarkCountFromRows();
    renderGrid();
    renderPreview();
    checkCtaValidation();
}

export function deleteColumn(colIdx: number) {
    if (state.chartType === 'stackedBar') {
        const groupIndex = getGroupIndexForCol(colIdx);
        if (groupIndex === -1 || state.groupStructure.length <= 1) return;
        const removeStart = state.groupStructure.slice(0, groupIndex).reduce((a, b) => a + b, 0);
        const removeCount = state.groupStructure[groupIndex];
        state.groupStructure.splice(groupIndex, 1);
        state.data.forEach(row => row.splice(removeStart, removeCount));
        state.cols = state.groupStructure.length;
        syncSegmentControlForStacked();
    } else {
        if (state.cols <= 1) return;
        state.cols--;
        state.data.forEach(row => row.splice(colIdx, 1));
    }
    ui.settingColInput.value = String(state.cols);
    ensureColHeaderColorsLength(getGridColsForChart(state.chartType, state.cols));
    ensureColHeaderTitlesLength(
        state.chartType === 'stackedBar' ? state.groupStructure.length : getGridColsForChart(state.chartType, state.cols),
        state.chartType
    );
    renderGrid();
    renderPreview();
    checkCtaValidation();
}

export function addBarToGroup(groupIndex: number) {
    if (!state.groupStructure[groupIndex] || state.groupStructure[groupIndex] >= MAX_SIZE) return;
    const insertPos = state.groupStructure.slice(0, groupIndex + 1).reduce((a, b) => a + b, 0);
    state.groupStructure[groupIndex]++;
    state.data.forEach(row => row.splice(insertPos, 0, ""));
    syncSegmentControlForStacked();
    renderGrid();
    renderPreview();
    checkCtaValidation();
}

export function removeBarFromGroup(groupIndex: number) {
    if (!state.groupStructure[groupIndex] || state.groupStructure[groupIndex] <= 1) return;
    const removePos = state.groupStructure.slice(0, groupIndex + 1).reduce((a, b) => a + b, 0) - 1;
    state.groupStructure[groupIndex]--;
    state.data.forEach(row => row.splice(removePos, 1));
    syncSegmentControlForStacked();
    renderGrid();
    renderPreview();
    checkCtaValidation();
}

export function removeBarFromGroupAt(groupIndex: number, barIndex: number) {
    const groupBarCount = state.groupStructure[groupIndex];
    if (!groupBarCount || groupBarCount <= 1) return;
    if (barIndex < 0 || barIndex >= groupBarCount) return;

    const groupStart = state.groupStructure.slice(0, groupIndex).reduce((a, b) => a + b, 0);
    const removePos = groupStart + barIndex;
    state.groupStructure[groupIndex]--;
    state.data.forEach(row => row.splice(removePos, 1));
    syncSegmentControlForStacked();
    renderGrid();
    renderPreview();
    checkCtaValidation();
}

export function getGroupStartIndex(groupIndex: number): number {
    if (groupIndex <= 0) return 0;
    return state.groupStructure.slice(0, groupIndex).reduce((a, b) => a + b, 0);
}

export function flatIndexFromGroupBar(groupIndex: number, barIndex: number): number {
    return getGroupStartIndex(groupIndex) + barIndex;
}

export function groupBarFromFlatIndex(flatColIdx: number): { groupIndex: number; barIndex: number } {
    let running = 0;
    for (let g = 0; g < state.groupStructure.length; g++) {
        const count = state.groupStructure[g];
        if (flatColIdx < running + count) {
            return { groupIndex: g, barIndex: flatColIdx - running };
        }
        running += count;
    }
    return { groupIndex: 0, barIndex: 0 };
}

export function handleDimensionInput(e: Event) {
    const input = e.target as HTMLInputElement;
    let val = parseInt(input.value) || 1;
    val = Math.max(1, Math.min(MAX_SIZE, val));
    input.value = String(val);

    if (input === ui.settingColInput) {
        updateGridSize(val, state.rows);
    } else if (input === ui.settingCellInput) {
        state.cellCount = val;
    } else if (input === ui.settingStrokeInput) {
        state.strokeWidth = val;
    }
    renderPreview();
    checkCtaValidation();
}

export function updateGridSize(newCols: number, newRows: number) {
    if (state.chartType === 'stackedBar') {
        const defaultSegment = resolveDefaultSegmentForNewGroup();
        while (state.groupStructure.length < newCols) state.groupStructure.push(defaultSegment);
        state.groupStructure = state.groupStructure.slice(0, newCols);
        const totalCols = state.groupStructure.reduce((a, b) => a + b, 0);
        for (let r = 0; r < state.data.length; r++) {
            while (state.data[r].length < totalCols) state.data[r].push("");
            state.data[r] = state.data[r].slice(0, totalCols);
        }
        while (state.data.length < newRows) state.data.push(new Array(totalCols).fill(""));
        state.data = state.data.slice(0, newRows);
    } else {
        const dataCols = getGridColsForChart(state.chartType, newCols);
        for (let r = 0; r < state.data.length; r++) {
            while (state.data[r].length < dataCols) state.data[r].push("");
            state.data[r] = state.data[r].slice(0, dataCols);
        }
        while (state.data.length < newRows) state.data.push(new Array(dataCols).fill(""));
        state.data = state.data.slice(0, newRows);
    }
    state.cols = newCols;
    state.rows = newRows;
    ensureRowColorsLength(state.rows);
    ensureRowHeaderLabelsLength(state.rows, state.chartType);
    ensureColHeaderColorsLength(getGridColsForChart(state.chartType, state.cols));
    ensureColHeaderTitlesLength(
        state.chartType === 'stackedBar' ? state.groupStructure.length : getGridColsForChart(state.chartType, state.cols),
        state.chartType
    );
    syncMarkCountFromRows();
    renderGrid();
    checkCtaValidation();
}

// helper
function getGroupIndexForCol(flatColIdx: number) {
    let running = 0;
    for (let g = 0; g < state.groupStructure.length; g++) {
        running += state.groupStructure[g];
        if (flatColIdx < running) return g;
    }
    return -1;
}
