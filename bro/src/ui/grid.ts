import { state, getTotalStackedCols, getRowColor, getGridColsForChart } from './state';
import { ui } from './dom';
import { deleteRow, deleteColumn, addBarToGroup, removeBarFromGroupAt, clearAllData, getGroupStartIndex, flatIndexFromGroupBar } from './data-ops';
import { checkCtaValidation, getAutoFillValue, getStackedOverflowState, syncYMaxValidationUi } from './mode';
import { renderPreview, highlightPreview, highlightPreviewCell, resetPreviewHighlight } from './preview';

// ==========================================
// GRID RENDERING
// ==========================================

export function renderGrid() {
    const grid = ui.gridContainer;
    grid.innerHTML = '';

    const isStacked = state.chartType === 'stackedBar';
    const totalCols = isStacked ? getTotalStackedCols() : getGridColsForChart(state.chartType, state.cols);
    const renderCols = isStacked ? state.groupStructure.length : totalCols;
    const topLeftCorner = document.getElementById('header-corner-tl');
    const topRightCorner = document.getElementById('header-corner-tr');

    // Grid template
    grid.style.gridTemplateColumns = `repeat(${renderCols}, 64px)`;
    if (topLeftCorner) {
        topLeftCorner.classList.toggle('h-12', isStacked);
        topLeftCorner.classList.toggle('h-6', !isStacked);
    }
    if (topRightCorner) {
        topRightCorner.classList.toggle('h-12', isStacked);
        topRightCorner.classList.toggle('h-6', !isStacked);
    }

    // Row header rendering
    const headerCont = ui.rowHeaderContainer;
    headerCont.innerHTML = '';

    // ===== COLUMN HEADERS =====
    if (isStacked) {
        // Group headers row
        const groupRow = document.createElement('div');
        groupRow.style.display = 'contents';
        state.groupStructure.forEach((barCount, gIdx) => {
            const gCell = document.createElement('div');
            gCell.className = 'flex items-center justify-center text-xxs font-bold text-text-sub border-r border-b border-border-strong bg-surface relative group';
            gCell.style.gridColumn = 'span 1';
            gCell.style.height = '24px';
            gCell.dataset.headerLabel = `G${gIdx + 1}`;
            const groupControls = state.mode !== 'read'
                ? `<div class="hidden group-hover:flex items-center gap-0.5 ml-1">
                    <button class="w-3.5 h-3.5 flex items-center justify-center rounded-full bg-primary text-white text-[8px] hover:bg-primary-hover cursor-pointer stacked-add-bar" data-g="${gIdx}">+</button>
                </div>`
                : '';
            gCell.innerHTML = `
                <span>G${gIdx + 1}</span>
                ${groupControls}
            `;
            gCell.addEventListener('mouseenter', () => highlightPreview('group', gIdx));
            gCell.addEventListener('mouseleave', () => resetPreviewHighlight());

            if (state.mode !== 'read') {
                const delBtn = document.createElement('button');
                delBtn.className = 'hidden group-hover:flex absolute -top-0 right-0 w-3 h-3 items-center justify-center rounded-full bg-danger text-white text-[6px] cursor-pointer';
                delBtn.innerHTML = '✕';
                delBtn.onclick = (e) => { e.stopPropagation(); deleteColumn(getGroupStartIndex(gIdx)); };
                gCell.appendChild(delBtn);
            }
            groupRow.appendChild(gCell);
        });
        grid.appendChild(groupRow);

        // Sub-column headers
        const subRow = document.createElement('div');
        subRow.style.display = 'contents';
        state.groupStructure.forEach((barCount, gIdx) => {
            const subCell = document.createElement('div');
            subCell.className = 'w-16 h-6 border-r border-b border-border-strong bg-surface relative';
            subCell.style.display = 'grid';
            subCell.style.gridTemplateColumns = `repeat(${barCount}, minmax(0, 1fr))`;

            for (let b = 0; b < barCount; b++) {
                const flatIdx = flatIndexFromGroupBar(gIdx, b);
                const bWrap = document.createElement('div');
                bWrap.className = 'h-6 flex items-center justify-center text-xxs font-medium text-text-sub relative group';
                bWrap.textContent = `B${b + 1}`;
                bWrap.addEventListener('mouseenter', () => highlightPreview('col', flatIdx));
                bWrap.addEventListener('mouseleave', () => resetPreviewHighlight());

                if (state.mode !== 'read' && barCount > 1) {
                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'hidden group-hover:flex absolute -top-0 right-0 w-3 h-3 items-center justify-center rounded-full bg-gray-300 text-white text-[6px] hover:bg-danger cursor-pointer stacked-remove-bar';
                    removeBtn.textContent = '−';
                    removeBtn.dataset.g = String(gIdx);
                    removeBtn.dataset.b = String(b);
                    bWrap.appendChild(removeBtn);
                }
                subCell.appendChild(bWrap);
            }
            subRow.appendChild(subCell);
        });
        grid.appendChild(subRow);
    } else {
        // Normal column headers
        const headerRow = document.createElement('div');
        headerRow.style.display = 'contents';
        for (let c = 0; c < totalCols; c++) {
            const hCell = document.createElement('div');
            hCell.className = 'w-16 h-6 flex items-center justify-center text-xxs font-bold text-text-sub border-r border-b border-border-strong bg-surface relative group col-header';
            hCell.textContent = `C${c + 1}`;
            hCell.dataset.headerLabel = `C${c + 1}`;
            hCell.addEventListener('mouseenter', () => highlightPreview('col', c));
            hCell.addEventListener('mouseleave', () => resetPreviewHighlight());

            if (state.mode !== 'read' && totalCols > 1) {
                const delBtn = document.createElement('button');
                delBtn.className = 'hidden group-hover:flex absolute -top-0 right-0 w-3 h-3 items-center justify-center rounded-full bg-danger text-white text-[6px] cursor-pointer';
                delBtn.innerHTML = '✕';
                delBtn.onclick = (e) => { e.stopPropagation(); deleteColumn(c); };
                hCell.appendChild(delBtn);
            }
            headerRow.appendChild(hCell);
        }
        grid.appendChild(headerRow);
    }

    // ===== ROW HEADERS =====
    for (let r = 0; r < state.rows; r++) {
        const rowH = document.createElement('div');
        rowH.className = 'row-header flex items-center h-6 px-2 border-b border-r border-border text-xxs font-medium text-text-sub relative group';

        const label = getRowHeaderLabel(r, isStacked);
        const leftWrap = document.createElement('div');
        leftWrap.className = 'flex items-center gap-1.5 min-w-0';

        if (!(isStacked && r === 0)) {
            const rowColor = getRowColor(r);
            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'row-color-swatch w-3.5 h-3.5 rounded-[2px] border border-border shrink-0';
            swatch.style.backgroundColor = rowColor;
            swatch.title = rowColor;
            swatch.dataset.row = String(r);
            if (state.mode === 'read') {
                swatch.disabled = true;
                swatch.classList.add('opacity-60', 'cursor-not-allowed');
            } else {
                swatch.classList.add('cursor-pointer');
            }
            swatch.addEventListener('click', (evt) => {
                evt.stopPropagation();
                if (state.mode === 'read') return;
                const anchor = evt.currentTarget as HTMLElement;
                const rect = anchor.getBoundingClientRect();
                document.dispatchEvent(new CustomEvent('row-color-swatch-click', {
                    detail: {
                        row: r,
                        anchorRect: {
                            left: rect.left,
                            top: rect.top,
                            right: rect.right,
                            bottom: rect.bottom,
                            width: rect.width,
                            height: rect.height
                        }
                    }
                }));
            });
            leftWrap.appendChild(swatch);
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'truncate';
        labelSpan.textContent = label;
        leftWrap.appendChild(labelSpan);
        rowH.appendChild(leftWrap);

        rowH.addEventListener('mouseenter', () => highlightPreview('row', r));
        rowH.addEventListener('mouseleave', () => resetPreviewHighlight());

        if (isStacked && r === 0 && state.mode !== 'read') {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'hidden absolute right-1 w-5 h-3 items-center justify-center rounded-full bg-gray-300 text-white text-[7px] cursor-pointer group-hover:flex hover:bg-danger';
            clearBtn.textContent = 'CLR';
            clearBtn.title = 'Clear all data';
            clearBtn.onclick = (e) => {
                e.stopPropagation();
                clearAllData();
            };
            rowH.appendChild(clearBtn);
        }

        if (state.mode !== 'read' && state.rows > 1 && !(isStacked && r === 0)) {
            const delBtn = document.createElement('button');
            delBtn.className = 'del-row-btn hidden absolute right-1 w-3 h-3 items-center justify-center rounded-full bg-danger text-white text-[6px] cursor-pointer group-hover:flex';
            delBtn.innerHTML = '✕';
            delBtn.onclick = () => deleteRow(r);
            rowH.appendChild(delBtn);
        }
        headerCont.appendChild(rowH);
    }

    // ===== DATA CELLS =====
    for (let r = 0; r < state.rows; r++) {
        const rowDiv = document.createElement('div');
        rowDiv.style.display = 'contents';

        if (!isStacked) {
            for (let c = 0; c < totalCols; c++) {
                const cell = buildDataCell(r, c, totalCols, grid, false);
                rowDiv.appendChild(cell);
            }
        } else {
            state.groupStructure.forEach((barCount, gIdx) => {
                const groupCell = document.createElement('div');
                groupCell.className = 'w-16 h-6 border-r border-b border-border bg-white';
                groupCell.style.display = 'grid';
                groupCell.style.gridTemplateColumns = `repeat(${barCount}, minmax(0, 1fr))`;

                for (let b = 0; b < barCount; b++) {
                    const flatC = flatIndexFromGroupBar(gIdx, b);
                    const cell = buildDataCell(r, flatC, totalCols, grid, true);
                    cell.classList.remove('w-16');
                    cell.classList.add('w-full', 'min-w-0', 'h-full');
                    groupCell.appendChild(cell);
                }
                rowDiv.appendChild(groupCell);
            });
        }
        grid.appendChild(rowDiv);
    }

    // Sync scroll
    ui.gridScrollArea.onscroll = () => {
        headerCont.scrollTop = ui.gridScrollArea.scrollTop;
    };

    // Wire stacked add/remove buttons
    if (isStacked && state.mode !== 'read') {
        grid.querySelectorAll('.stacked-add-bar').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const g = parseInt((e.currentTarget as HTMLElement).dataset.g!);
                addBarToGroup(g);
            });
        });
        grid.querySelectorAll('.stacked-remove-bar').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = e.currentTarget as HTMLElement;
                const g = parseInt(target.dataset.g!);
                const b = parseInt(target.dataset.b!);
                removeBarFromGroupAt(g, b);
            });
        });
    }

    if (isStacked) {
        updateStackedDerivedUi();
    }
}

function getGroupInfoForFlatCol(flatCol: number): { groupIndex: number; barInGroup: number } {
    let running = 0;
    for (let g = 0; g < state.groupStructure.length; g++) {
        if (flatCol < running + state.groupStructure[g]) {
            return { groupIndex: g, barInGroup: flatCol - running };
        }
        running += state.groupStructure[g];
    }
    return { groupIndex: 0, barInGroup: 0 };
}

function buildDataCell(
    r: number,
    c: number,
    totalCols: number,
    grid: HTMLElement,
    isStacked: boolean
): HTMLInputElement {
    const cell = document.createElement('input');
    cell.type = 'text';
    cell.inputMode = 'decimal';
    cell.className = 'grid-cell w-16 h-6 text-center text-xs border-r border-b border-border focus:outline-none focus:border-primary focus:bg-blue-50 hover:bg-gray-50 transition-colors';
    cell.value = state.data[r]?.[c] || '';

    if (state.mode === 'read') {
        cell.readOnly = true;
        cell.classList.add('cursor-default', 'bg-gray-50');
    }

    if (state.dataMode === 'percent' && cell.value !== '') {
        const n = Number(cell.value);
        if (n < 0 || n > 100) {
            cell.classList.add('border-danger', 'border-2');
        }
    }

    cell.addEventListener('input', (e) => {
        const val = (e.target as HTMLInputElement).value;
        if (!state.data[r]) state.data[r] = [];
        state.data[r][c] = val;
        syncYMaxValidationUi();
        renderPreview();
        checkCtaValidation();

        if (isStacked) {
            updateStackedDerivedUi();
        }
    });

    cell.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter' && isStacked && cell.dataset.remainingPreview === 'true') {
            const commitVal = cell.dataset.remainingValue || '';
            if (!state.data[r]) state.data[r] = [];
            state.data[r][c] = commitVal;
            cell.value = commitVal;
            cell.dataset.remainingPreview = 'false';
            cell.dataset.remainingValue = '';
            cell.placeholder = '';
            cell.classList.remove('grid-cell-remaining-preview');
            cell.removeAttribute('title');
            syncYMaxValidationUi();
            renderPreview();
            checkCtaValidation();
            updateStackedDerivedUi();
        }

        if (ke.key === 'Tab' || ke.key === 'Enter') {
            e.preventDefault();
            const nextC = c + 1;
            const nextR = r + 1;
            if (ke.key === 'Tab' && nextC < totalCols) {
                const next = grid.querySelector(`input[data-r="${r}"][data-c="${nextC}"]`) as HTMLInputElement;
                next?.focus();
            } else if (ke.key === 'Enter' && nextR < state.rows) {
                const next = grid.querySelector(`input[data-r="${nextR}"][data-c="${c}"]`) as HTMLInputElement;
                next?.focus();
            }
        }
    });

    cell.addEventListener('mouseenter', () => {
        cell.classList.add('grid-cell-self-hover');
        highlightPreviewCell(r, c);
    });
    cell.addEventListener('mouseleave', () => {
        cell.classList.remove('grid-cell-self-hover');
        resetPreviewHighlight();
    });

    cell.dataset.r = String(r);
    cell.dataset.c = String(c);
    return cell;
}

function getRowHeaderLabel(rowIndex: number, isStacked: boolean): string {
    if (!isStacked) return `R${rowIndex + 1}`;
    if (rowIndex === 0) return 'All';
    return `R${rowIndex}`;
}

function formatNumeric(value: number): string {
    if (Number.isInteger(value)) return String(value);
    return String(Math.round(value * 100) / 100);
}

function toFiniteNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function clearStackedDerivedMarks(totalCols: number) {
    for (let r = 1; r < state.rows; r++) {
        for (let c = 0; c < totalCols; c++) {
            const cell = ui.gridContainer.querySelector(`input[data-r="${r}"][data-c="${c}"]`) as HTMLInputElement | null;
            if (!cell) continue;
            cell.classList.remove('grid-cell-remaining-preview', 'grid-cell-stacked-overflow');
            cell.dataset.remainingPreview = 'false';
            cell.dataset.remainingValue = '';
            cell.removeAttribute('title');
            if (cell.value === '') {
                cell.placeholder = '';
            }
        }
    }
}

function updateStackedDerivedUi() {
    if (state.chartType !== 'stackedBar') return;

    const totalCols = getTotalStackedCols();
    clearStackedDerivedMarks(totalCols);

    const overflowState = getStackedOverflowState(state.data);

    overflowState.overflowCells.forEach((key) => {
        const [rStr, cStr] = key.split(':');
        const r = Number(rStr);
        const c = Number(cStr);
        const cell = ui.gridContainer.querySelector(`input[data-r="${r}"][data-c="${c}"]`) as HTMLInputElement | null;
        if (!cell) return;
        cell.classList.add('grid-cell-stacked-overflow');
        cell.title = 'All보다 합계가 큽니다.';
    });

    for (let c = 0; c < totalCols; c++) {
        const allCell = ui.gridContainer.querySelector(`input[data-r="0"][data-c="${c}"]`) as HTMLInputElement | null;
        if (!allCell) continue;

        // Manual input has priority; placeholder is only a fallback when All cell is blank.
        if (allCell.value !== '') {
            allCell.placeholder = '';
        } else {
            const gInfo = getGroupInfoForFlatCol(c);
            const autoVal = getAutoFillValue(0, gInfo.groupIndex, gInfo.barInGroup);
            allCell.placeholder = autoVal || '';
        }

        if (overflowState.overflowCells.size > 0) {
            let hasOverflowInCol = false;
            for (let r = 1; r < state.rows; r++) {
                if (overflowState.overflowCells.has(`${r}:${c}`)) {
                    hasOverflowInCol = true;
                    break;
                }
            }
            if (hasOverflowInCol) continue;
        }

        const allVal = toFiniteNumberOrNull(state.data[0]?.[c]);
        if (allVal === null) continue;

        let blankRow = -1;
        let blankCount = 0;
        let sumFilled = 0;
        let allFilledAreNumeric = true;
        for (let r = 1; r < state.rows; r++) {
            const raw = state.data[r]?.[c];
            if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
                blankCount++;
                blankRow = r;
                continue;
            }
            const n = Number(raw);
            if (!Number.isFinite(n)) {
                allFilledAreNumeric = false;
                break;
            }
            sumFilled += n;
        }

        if (blankCount !== 1 || !allFilledAreNumeric) continue;

        const remaining = allVal - sumFilled;
        if (remaining < 0) continue;
        const targetCell = ui.gridContainer.querySelector(`input[data-r="${blankRow}"][data-c="${c}"]`) as HTMLInputElement | null;
        if (!targetCell || targetCell.value !== '') continue;
        const previewValue = formatNumeric(remaining);
        targetCell.placeholder = previewValue;
        targetCell.dataset.remainingPreview = 'true';
        targetCell.dataset.remainingValue = previewValue;
        targetCell.classList.add('grid-cell-remaining-preview');
        targetCell.title = 'Enter로 남은 값 확정';
    }
}
