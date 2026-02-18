import { state, getTotalStackedCols, getRowColor } from './state';
import { ui } from './dom';
import { deleteRow, deleteColumn, addBarToGroup, removeBarFromGroup } from './data-ops';
import { checkCtaValidation, getAutoFillValue, syncYMaxValidationUi } from './mode';
import { renderPreview, highlightPreview, highlightPreviewCell, resetPreviewHighlight } from './preview';

// ==========================================
// GRID RENDERING
// ==========================================

export function renderGrid() {
    const grid = ui.gridContainer;
    grid.innerHTML = '';

    const isStacked = state.chartType === 'stackedBar';
    const totalCols = isStacked ? getTotalStackedCols() : state.cols;

    // Grid template
    grid.style.gridTemplateColumns = `repeat(${totalCols}, 64px)`;

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
            gCell.style.gridColumn = `span ${barCount}`;
            gCell.style.height = '24px';
            const groupControls = state.mode !== 'read'
                ? `<div class="hidden group-hover:flex items-center gap-0.5 ml-1">
                    <button class="w-3.5 h-3.5 flex items-center justify-center rounded-full bg-primary text-white text-[8px] hover:bg-primary-hover cursor-pointer stacked-add-bar" data-g="${gIdx}">+</button>
                    ${barCount > 1 ? `<button class="w-3.5 h-3.5 flex items-center justify-center rounded-full bg-gray-300 text-white text-[8px] hover:bg-danger cursor-pointer stacked-remove-bar" data-g="${gIdx}">−</button>` : ''}
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
                delBtn.onclick = (e) => { e.stopPropagation(); deleteColumn(state.groupStructure.slice(0, gIdx).reduce((a, b) => a + b, 0)); };
                gCell.appendChild(delBtn);
            }
            groupRow.appendChild(gCell);
        });
        grid.appendChild(groupRow);

        // Sub-column headers
        const subRow = document.createElement('div');
        subRow.style.display = 'contents';
        let flatIdx = 0;
        state.groupStructure.forEach((barCount, gIdx) => {
            for (let b = 0; b < barCount; b++) {
                const subCell = document.createElement('div');
                subCell.className = 'w-16 h-6 flex items-center justify-center text-xxs font-medium text-text-sub border-r border-b border-border-strong bg-surface';
                subCell.textContent = `B${b + 1}`;
                subCell.addEventListener('mouseenter', () => highlightPreview('col', flatIdx));
                subCell.addEventListener('mouseleave', () => resetPreviewHighlight());
                subRow.appendChild(subCell);
                flatIdx++;
            }
        });
        grid.appendChild(subRow);
    } else {
        // Normal column headers
        const headerRow = document.createElement('div');
        headerRow.style.display = 'contents';
        for (let c = 0; c < state.cols; c++) {
            const hCell = document.createElement('div');
            hCell.className = 'w-16 h-6 flex items-center justify-center text-xxs font-bold text-text-sub border-r border-b border-border-strong bg-surface relative group col-header';
            hCell.textContent = `C${c + 1}`;
            hCell.addEventListener('mouseenter', () => highlightPreview('col', c));
            hCell.addEventListener('mouseleave', () => resetPreviewHighlight());

            if (state.mode !== 'read' && state.cols > 1) {
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

        const label = isStacked && r === 0 ? 'All' : `R${isStacked ? r : r + 1}`;
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

        if (state.mode !== 'read' && state.rows > 1) {
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

        for (let c = 0; c < totalCols; c++) {
            const cell = document.createElement('input');
            cell.type = 'text';
            cell.inputMode = 'decimal';
            cell.className = 'grid-cell w-16 h-6 text-center text-xs border-r border-b border-border focus:outline-none focus:border-primary focus:bg-blue-50 hover:bg-gray-50 transition-colors';
            cell.value = state.data[r]?.[c] || '';

            // Auto-fill preview for stacked row 0
            if (isStacked && r === 0 && cell.value === '') {
                const gInfo = getGroupInfoForFlatCol(c);
                const autoVal = getAutoFillValue(r, gInfo.groupIndex, gInfo.barInGroup);
                if (autoVal) {
                    cell.placeholder = autoVal;
                    cell.classList.add('text-gray-300');
                }
            }

            if (state.mode === 'read') {
                cell.readOnly = true;
                cell.classList.add('cursor-default', 'bg-gray-50');
            }

            // Percent mode range error highlight
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

                // Re-check auto-fill for stacked
                if (isStacked && r > 0) {
                    renderGrid(); // re-render to update row-0 placeholders
                }
            });

            cell.addEventListener('keydown', (e) => {
                const ke = e as KeyboardEvent;
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
            rowDiv.appendChild(cell);
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
                const g = parseInt((e.currentTarget as HTMLElement).dataset.g!);
                removeBarFromGroup(g);
            });
        });
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
