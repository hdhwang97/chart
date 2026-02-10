
        import '../shared/constants';
import './styles/base.css';
import './styles/grid.css';
import { MAX_SIZE, state, CHART_ICONS, initData } from './state';
import { ui, bindGridScrollSync } from './dom';
import { registerGridFunctions, addColumn as addColumnFromGrid, addRow as addRowFromGrid, deleteColumn as deleteColumnFromGrid, deleteRow as deleteRowFromGrid, renderGrid as renderGridFromGrid, updateGridSize as updateGridSizeFromGrid } from './grid';
import { registerCsvFunctions, downloadCsv as downloadCsvFromCsv, handleCsvUpload as handleCsvUploadFromCsv, parseAndApplyCsv as parseAndApplyCsvFromCsv, removeCsv as removeCsvFromCsv } from './csv';
import { bindMessageHandler, postPluginMessage, registerMessageFunctions } from './message';
import { checkCtaValidation as checkCtaValidationFromMode, checkDataRange as checkDataRangeFromMode, registerModeFunctions, setMode as setModeFromMode, toggleMode as toggleModeFromMode } from './mode';

bindGridScrollSync();

        function getTotalStackedCols() {
            return state.groupStructure.reduce((a, b) => a + b, 0);
        }

        function checkDataRange() {
            if(state.dataMode === 'raw') return true; 
            const totalVisualRows = state.data.length;
            const totalCols = state.data.length > 0 ? state.data[0].length : 0;
            for (let i = 0; i < totalVisualRows; i++) {
                for (let j = 0; j < totalCols; j++) {
                    const val = state.data[i][j];
                    if (val && val.trim() !== "") {
                        const num = Number(val);
                        if (!isNaN(num) && (num < 0 || num > 100)) return false; 
                    }
                }
            }
            return true;
        }

        function clearRangeErrors() {
            ui.gridContainer.querySelectorAll('input').forEach(input => {
                const wrapper = input.parentElement;
                wrapper.classList.remove('bg-red-50', 'bg-red-200'); 
                const row = parseInt(input.dataset.row);
                if (state.chartType === 'stackedBar' && row === 0) {
                    wrapper.classList.add('bg-blue-50');
                } else {
                    wrapper.classList.add((row % 2 === 1) ? 'bg-surface' : 'bg-white');
                }
                input.classList.remove('text-danger', 'font-medium', 'font-bold');
            });
        }

        function updateModeButtonState() {
            if(state.dataMode === 'percent') {
                 ui.modePercentBtn.className = 'px-2 py-0.5 text-xxs font-semibold rounded bg-white text-primary shadow-sm transition-all';
                 ui.modeRawBtn.className = 'px-2 py-0.5 text-xxs font-semibold rounded text-text-sub hover:text-text transition-all';
            } else {
                 ui.modePercentBtn.className = 'px-2 py-0.5 text-xxs font-semibold rounded text-text-sub hover:text-text transition-all';
                 ui.modeRawBtn.className = 'px-2 py-0.5 text-xxs font-semibold rounded bg-white text-primary shadow-sm transition-all';
            }
        }

        window.setMode = function(targetMode) {
            if (state.dataMode === targetMode) return;
            if (state.dataMode === 'raw' && targetMode === 'percent') {
                state.cachedRawData = JSON.parse(JSON.stringify(state.data));
                let maxVal = 0;
                state.data.forEach(row => { row.forEach(val => { const num = Number(val); if (!isNaN(num) && num > maxVal) maxVal = num; }); });
                if (maxVal === 0) maxVal = 100; state.conversionMax = maxVal;
                state.data = state.data.map(row => row.map(val => { if(val==="")return""; const num=Number(val); if(isNaN(num))return val; return String(Math.round((num/maxVal)*100*10)/10); }));
                state.dataMode = 'percent';
            } else if (state.dataMode === 'percent' && targetMode === 'raw') {
                if (state.cachedRawData) { state.data = state.cachedRawData; state.cachedRawData = null; }
                else { state.data = state.data.map(row => row.map(val => { if(val==="")return""; const num=Number(val); if(isNaN(num))return val; return String(Math.round((num/100)*state.conversionMax)); })); }
                state.dataMode = 'raw';
            }
            const isValid = checkDataRange();
            if(!isValid && state.dataMode === 'percent') { ui.tooltipNormal.classList.add('hidden'); ui.tooltipWarning.classList.remove('hidden'); }
            else { ui.tooltipNormal.classList.remove('hidden'); ui.tooltipWarning.classList.add('hidden'); clearRangeErrors(); }
            updateModeButtonState(); renderGrid();
        };

        function downloadCsv() { 
            let csvContent = "data:text/csv;charset=utf-8,";
            state.data.forEach(rowArray => {
                let row = rowArray.join(",");
                csvContent += row + "\r\n";
            });
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", "chart_data.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        function showToast() { ui.toast.classList.remove('hidden'); setTimeout(() => { ui.toast.classList.remove('opacity-0', 'translate-y-2'); }, 50); }
        function hideToast() { ui.toast.classList.add('opacity-0', 'translate-y-2'); setTimeout(() => { ui.toast.classList.add('hidden'); }, 300); }
        ui.toastCloseBtn.addEventListener('click', hideToast);
        ui.toastYesBtn.addEventListener('click', () => { hideToast(); });
        function updateCsvUi() { 
            const isUploaded = !!state.csvFileName;
            ui.csvStatusText.textContent = isUploaded ? state.csvFileName : "csv를 업로드해주세요.";
            ui.csvStatusText.className = isUploaded ? 'text-xs text-primary font-semibold truncate' : 'text-xs text-text-sub truncate';
            isUploaded ? ui.csvDeleteBtn.classList.remove('hidden') : ui.csvDeleteBtn.classList.add('hidden');
        }
        function removeCsv() { state.csvFileName = null; ui.csvInput.value = ''; updateCsvUi(); }

        function updateHeaderIcon() {
            let displayType = 'Bar';
            if(state.chartType === 'line') displayType = 'Line';
            else if(state.chartType === 'stackedBar') displayType = 'Stacked';
            ui.chartTypeDisplay.textContent = displayType;
            ui.chartTypeIcon.innerHTML = CHART_ICONS[state.chartType] || CHART_ICONS['bar'];
            
            if(state.chartType === 'stackedBar') ui.tooltipStackedHint.classList.remove('hidden');
            else ui.tooltipStackedHint.classList.add('hidden');
        }

        function goToStep(stepNum) {
            state.currentStep = stepNum;
            document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
            if (stepNum === 1) {
                ui.step1.classList.add('active');
                ui.backBtn.classList.add('hidden');
                ui.chartTypeWrapper.classList.add('hidden'); 
                ui.mainCta.style.display = 'none';
                ui.editModeBtn.classList.add('hidden'); 
                removeCsv();
                state.uiMode = 'create';
            } else {
                ui.step2.classList.add('active');
                ui.backBtn.classList.remove('hidden');
                ui.chartTypeWrapper.classList.remove('hidden'); 
                
                const targetHeight = state.chartType === 'stackedBar' ? 780 : 720; 

                updateHeaderIcon();
                ui.mainCta.style.display = 'block';
                ui.mainCta.textContent = state.uiMode === 'create' ? "Generate to Figma" : "Apply to Figma";
                ui.editModeBtn.classList.remove('hidden');
                
                try {
                    updateSettingInputs(); 
                    renderGrid();
                    checkCtaValidation();
                    updateModeButtonState(); 
                } catch (e) { console.error("Render Error:", e); }
            }
        }

        window.selectType = function(type) {
            state.chartType = type;
            resetData(); 
            goToStep(2);
        };

        ui.backBtn.addEventListener('click', () => { goToStep(1); hideToast(); });

        function initData(rows, cols) {
            const newData = [];
            for (let i = 0; i < rows; i++) {
                const row = new Array(cols).fill("");
                newData.push(row);
            }
            return newData;
        }

        function handlePluginMessage(event) {
            const msg = event.data.pluginMessage;
            if (!msg) return;

            if (msg.type === 'init') {
                state.uiMode = msg.uiMode || 'create';
                
                if (msg.chartType) {
                    state.chartType = msg.chartType;
                    
                    let targetData = null;
                    let targetMarkNum = null;

                    if (msg.savedValues) {
                        targetData = msg.savedValues;
                        targetMarkNum = msg.savedMarkNum;
                    } else if (msg.inferredValues) {
                        targetData = msg.inferredValues;
                        targetMarkNum = msg.inferredMarkNum;
                    }

                    if (targetData) {
                        state.data = targetData.map(row => row.map(v => String(v)));
                        
                        if (msg.chartType === 'stackedBar') {
                            if (targetMarkNum && Array.isArray(targetMarkNum)) {
                                state.groupStructure = targetMarkNum;
                                state.cols = state.groupStructure.length;
                            } else {
                                state.cols = 1; 
                                state.groupStructure = [state.data[0].length];
                            }
                            
                            let shouldAddAllRow = false;
                            
                            if (targetData === msg.inferredValues) {
                                shouldAddAllRow = true;
                            } else if (targetData === msg.savedValues) {
                                const visualRowCount = msg.inferredValues ? msg.inferredValues.length : 0;
                                if (state.data.length <= visualRowCount) {
                                    shouldAddAllRow = true;
                                }
                            }

                            if (shouldAddAllRow) {
                                const colsCount = state.data.length > 0 ? state.data[0].length : state.cols;
                                state.data.unshift(new Array(colsCount).fill(""));
                            }
                            state.rows = state.data.length; 

                        } else {
                            state.rows = state.data.length;
                            state.cols = state.data[0].length;
                            if (msg.chartType === 'line') state.cols = Math.max(1, state.cols - 1);
                        }
                    } else {
                        // Reverted Default Initialization for Stacked Bar
                        if (msg.chartType === 'stackedBar') {
                            state.groupStructure = [2, 2, 2]; // 3 Groups, 2 Bars each
                            state.data = initData(4, 6); // All + 3 Stacks = 4 rows, 6 cols total
                            state.rows = 4;
                            state.cols = 3;
                        } else {
                            state.rows = 3; 
                            state.cols = 3;
                            state.data = initData(3, 3);
                        }
                    }
                    
                    updateSettingInputs();
                    updateModeButtonState(); 
                    goToStep(2); 
                } else {
                    state.uiMode = 'create';
                    goToStep(1); 
                }
            }
        }

        function validateStackedData() {
            if (state.chartType !== 'stackedBar') return;
            if (state.data.length < 2) return; 

            const totalCols = state.data[0].length;

            for (let c = 0; c < totalCols; c++) {
                const allValStr = state.data[0][c];
                const allVal = Number(allValStr);
                
                if (allValStr === "" || isNaN(allVal)) {
                     for (let r = 0; r < state.rows; r++) {
                         const cellInput = document.querySelector(`input[data-row="${r}"][data-col="${c}"]`);
                         if(cellInput) {
                             const wrapper = cellInput.parentElement;
                             if (wrapper.classList.contains('bg-red-200')) {
                                 wrapper.classList.remove('bg-red-200');
                                 cellInput.classList.remove('text-danger', 'font-bold');
                                 if (r === 0) wrapper.classList.add('bg-blue-50');
                                 else wrapper.classList.add((r % 2 === 1) ? 'bg-surface' : 'bg-white');
                             }
                         }
                     }
                    continue;
                }

                let stackSum = 0;
                for (let r = 1; r < state.rows; r++) {
                    const stackValStr = state.data[r][c];
                    const stackVal = Number(stackValStr);
                    const cellInput = document.querySelector(`input[data-row="${r}"][data-col="${c}"]`);
                    
                    if (cellInput) {
                        const wrapper = cellInput.parentElement;
                        let isError = false;

                        if (stackValStr !== "" && !isNaN(stackVal)) {
                            stackSum += stackVal;
                            if (stackVal > allVal) {
                                isError = true;
                                wrapper.classList.remove('bg-white', 'bg-surface');
                                wrapper.classList.add('bg-red-200');
                                cellInput.classList.add('text-danger', 'font-bold');
                            }
                        }

                        if (!isError && wrapper.classList.contains('bg-red-200')) {
                             wrapper.classList.remove('bg-red-200');
                             cellInput.classList.remove('text-danger', 'font-bold');
                             wrapper.classList.add((r % 2 === 1) ? 'bg-surface' : 'bg-white');
                        }
                    }
                }

                const allInput = document.querySelector(`input[data-row="0"][data-col="${c}"]`);
                if (allInput) {
                    const wrapper = allInput.parentElement;
                    if (stackSum > allVal) {
                        wrapper.classList.remove('bg-blue-50');
                        wrapper.classList.add('bg-red-200');
                        allInput.classList.add('text-danger', 'font-bold');
                    } else {
                        if (wrapper.classList.contains('bg-red-200')) {
                            wrapper.classList.remove('bg-red-200');
                            wrapper.classList.add('bg-blue-50');
                            allInput.classList.remove('text-danger', 'font-bold');
                        }
                    }
                }
            }
        }

        // ==========================================
        // MAIN GRID RENDERER
        // ==========================================
        function renderGrid() {
            ui.gridContainer.innerHTML = ''; 
            ui.rowHeaderContainer.innerHTML = ''; 
            
            if (!state.data || state.data.length === 0) return;
            let gridCols = state.data[0].length;
            
            ui.gridContainer.style.gridTemplateColumns = `repeat(${gridCols}, minmax(60px, 1fr))`;

            // [HEADER AREA]
            if (state.chartType === 'stackedBar') {
                // [Level 1] Super Header (Groups)
                for (let g = 0; g < state.groupStructure.length; g++) { 
                    const groupHeader = document.createElement('div');
                    groupHeader.id = `header-group-${g}`;
                    
                    const spanCount = state.groupStructure[g];
                    groupHeader.style.gridColumn = `span ${spanCount}`;
                    
                    // [UPDATED] Added border-r-2 for thicker border
                    groupHeader.className = 'sticky top-0 z-30 bg-gray-100 border-r-2 border-b border-border-strong flex items-center justify-center h-6 text-xxs font-bold text-text group relative cursor-pointer hover:bg-blue-50';
                    groupHeader.innerHTML = `<span>Group ${g + 1}</span>`;
                    
                    // Interaction: Hover Group
                    groupHeader.addEventListener('mouseenter', () => highlightPreview('group', g));
                    groupHeader.addEventListener('mouseleave', () => resetPreviewHighlight());

                    if (state.mode === 'edit') {
                        const addBarBtn = document.createElement('button');
                        addBarBtn.id = `btn-add-bar-group-${g}`;
                        addBarBtn.className = 'absolute left-1 top-1/2 -translate-y-1/2 w-4 h-4 hidden group-hover:flex items-center justify-center bg-transparent border-0 cursor-pointer text-primary hover:text-primary-hover';
                        addBarBtn.innerHTML = `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
                        addBarBtn.title = "Add Bar to Group";
                        addBarBtn.onclick = (e) => { e.stopPropagation(); addBarToGroup(g); };
                        groupHeader.appendChild(addBarBtn);

                        const delBtn = document.createElement('button');
                        delBtn.id = `btn-del-group-${g}`;
                        delBtn.className = 'absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 hidden group-hover:flex items-center justify-center bg-transparent border-0 cursor-pointer text-text-sub hover:text-danger';
                        delBtn.innerHTML = `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
                        delBtn.onclick = (e) => { e.stopPropagation(); deleteColumn(g); };
                        groupHeader.appendChild(delBtn);
                    }
                    ui.gridContainer.appendChild(groupHeader);
                }

                // [Level 2] Sub Header (Bars)
                let colCursor = 0;
                state.groupStructure.forEach((count, gIdx) => {
                    for (let b = 0; b < count; b++) {
                        const subHeader = document.createElement('div');
                        const actualColIndex = colCursor; 
                        
                        subHeader.id = `header-sub-group-${gIdx}-bar-${b}`;
                        subHeader.className = 'sticky top-6 z-20 bg-surface border-r border-b border-border-strong flex items-center justify-center h-6 text-[9px] font-medium text-text-sub group relative cursor-pointer hover:text-primary';
                        subHeader.textContent = `Bar ${b + 1}`;
                        
                        // Interaction: Hover Sub-bar
                        subHeader.addEventListener('mouseenter', () => { 
                            subHeader.classList.add('header-hover');
                            highlightPreview('col', actualColIndex); 
                        });
                        subHeader.addEventListener('mouseleave', () => { 
                            subHeader.classList.remove('header-hover');
                            resetPreviewHighlight(); 
                        });

                        if (state.mode === 'edit') {
                            const delSubBtn = document.createElement('button');
                            delSubBtn.id = `btn-del-sub-group-${gIdx}-bar-${b}`;
                            delSubBtn.className = 'absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 hidden group-hover:flex items-center justify-center bg-transparent border-0 cursor-pointer text-text-sub hover:text-danger';
                            delSubBtn.innerHTML = `<svg class="w-2 h-2 fill-current" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
                            const currentG = gIdx; 
                            const currentB = b;
                            delSubBtn.onclick = (e) => { e.stopPropagation(); removeBarFromGroup(currentG, currentB); };
                            subHeader.appendChild(delSubBtn);
                        }
                        ui.gridContainer.appendChild(subHeader);
                        colCursor++;
                    }
                });

            } else {
                // CASE B: Normal Charts
                for (let j = 0; j < gridCols; j++) {
                    const headerCell = document.createElement('div');
                    headerCell.id = `header-col-${j}`;
                    headerCell.className = 'sticky top-0 z-20 bg-surface border-r border-b border-border-strong flex items-center justify-center h-6 text-xxs font-semibold text-text-sub group relative cursor-pointer transition-colors';
                    
                    let colLabel = `${j + 1}`;
                    if (state.chartType === 'line') colLabel = `P ${j + 1}`;
                    
                    headerCell.innerHTML = `<span>${colLabel}</span>`;
                    
                    headerCell.addEventListener('mouseenter', () => {
                        headerCell.classList.add('header-hover');
                        highlightPreview('col', j);
                    });
                    headerCell.addEventListener('mouseleave', () => {
                        headerCell.classList.remove('header-hover');
                        resetPreviewHighlight();
                    });

                    if (state.mode === 'edit') {
                        const delBtn = document.createElement('button');
                        delBtn.id = `btn-del-col-${j}`;
                        delBtn.className = 'absolute right-0.5 top-1/2 -translate-y-1/2 w-4 h-4 hidden group-hover:flex items-center justify-center bg-transparent border-0 cursor-pointer text-text-sub hover:text-danger';
                        delBtn.innerHTML = `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
                        delBtn.onclick = () => deleteColumn(j);
                        headerCell.appendChild(delBtn);
                    }
                    ui.gridContainer.appendChild(headerCell);
                }
            }

            // [BODY AREA] Rows
            state.data.forEach((row, rowIndex) => {
                const isStackedAll = (state.chartType === 'stackedBar' && rowIndex === 0);
                const isZebra = (rowIndex % 2 === 1);
                let bgClass = isZebra ? 'bg-surface' : 'bg-white';
                if (isStackedAll) bgClass = 'bg-blue-50'; 

                const rowHeader = document.createElement('div');
                rowHeader.id = `header-row-${rowIndex}`;
                rowHeader.className = `row-header group relative w-full h-6 px-2 border-b border-r border-border-strong text-xxs font-semibold text-text-sub flex items-center justify-between truncate ${bgClass} cursor-pointer transition-colors`;
                
                let rowLabelText = "";
                if (state.chartType === 'line') rowLabelText = `Line ${rowIndex + 1}`;
                else if (state.chartType === 'stackedBar') {
                    if (rowIndex === 0) rowLabelText = `All (Total)`;
                    else rowLabelText = `Stack ${rowIndex}`;
                } else {
                    rowLabelText = `Bar ${rowIndex + 1}`;
                }
                
                const textSpan = document.createElement('span');
                textSpan.textContent = rowLabelText;
                textSpan.className = "truncate"; 
                if (isStackedAll) textSpan.classList.add('text-primary-hover', 'font-bold');
                rowHeader.appendChild(textSpan);
                
                // Interaction: Hover Row
                rowHeader.addEventListener('mouseenter', () => {
                    rowHeader.classList.add('header-hover');
                    highlightPreview('row', rowIndex);
                });
                rowHeader.addEventListener('mouseleave', () => {
                    rowHeader.classList.remove('header-hover');
                    resetPreviewHighlight();
                });

                if (state.mode === 'edit' && !isStackedAll) {
                     const delRowBtn = document.createElement('button');
                     delRowBtn.id = `btn-del-row-${rowIndex}`;
                     delRowBtn.innerHTML = `<svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 17.59 17.59 13.41 12 19 6.41z"/></svg>`;
                     delRowBtn.className = 'del-row-btn w-4 h-4 hidden items-center justify-center bg-transparent border-0 cursor-pointer text-text-sub hover:text-danger shrink-0';
                     delRowBtn.onclick = (e) => { e.stopPropagation(); deleteRow(rowIndex); };
                     rowHeader.appendChild(delRowBtn);
                }
                ui.rowHeaderContainer.appendChild(rowHeader);

                // Cells
                row.forEach((cellValue, colIndex) => {
                    const cellWrapper = document.createElement('div');
                    // [UPDATED] Added hover:bg-blue-50
                    cellWrapper.className = `flex items-center w-full h-6 border-r border-b border-border-strong ${bgClass} hover:bg-blue-50 transition-colors`;
                    const input = document.createElement('input');
                    input.id = `input-cell-${rowIndex}-${colIndex}`;
                    
                    input.type = 'text'; input.value = cellValue; input.dataset.row = rowIndex; input.dataset.col = colIndex;
                    
                    let isError = false; 
                    if (state.dataMode === 'percent' && cellValue !== "") { 
                        const num = Number(cellValue); 
                        if (!isNaN(num) && (num < 0 || num > 100)) isError = true; 
                    }
                    let classes = `flex-1 w-full h-full px-2 text-xs text-right focus:outline-none bg-transparent min-w-0`;
                    if (isError) { cellWrapper.classList.remove('bg-white', 'bg-surface', 'bg-blue-50'); cellWrapper.classList.add('bg-red-50'); classes += ' text-danger font-medium'; }
                    if (state.mode === 'read') classes += ' text-gray-400 cursor-not-allowed';
                    
                    if (isStackedAll) classes += ' font-bold text-primary';

                    input.className = classes;
                    
                    // Input Interaction: Focus & Hover to Highlight
                    // [UPDATED] Added mouseenter/mouseleave events
                    input.addEventListener('focus', () => highlightPreview('cell', rowIndex, colIndex));
                    input.addEventListener('mouseenter', () => highlightPreview('cell', rowIndex, colIndex));
                    input.addEventListener('mouseleave', () => resetPreviewHighlight());
                    input.addEventListener('blur', () => resetPreviewHighlight());
                    
                    input.addEventListener('input', (e) => {
                        state.data[rowIndex][colIndex] = e.target.value;
                        updateModeButtonState(); 
                        
                        if (state.chartType === 'stackedBar') {
                            validateStackedData();
                        }

                        const val = e.target.value; const num = Number(val);
                        const isErr = (state.dataMode === 'percent' && val!=="" && (!isNaN(num) && (num<0 || num>100)));
                        if(isErr && !cellWrapper.classList.contains('bg-red-200')) { 
                            cellWrapper.classList.remove(bgClass); cellWrapper.classList.add('bg-red-50'); e.target.classList.add('text-danger', 'font-medium'); 
                        } else if (!cellWrapper.classList.contains('bg-red-200')) { 
                            cellWrapper.classList.remove('bg-red-50'); cellWrapper.classList.add(bgClass); e.target.classList.remove('text-danger', 'font-medium'); 
                        }
                        
                        checkCtaValidation();
                        renderPreview(); 
                    });
                    cellWrapper.appendChild(input);
                    if (state.dataMode === 'percent') {
                        const unitSpan = document.createElement('span'); unitSpan.className = 'shrink-0 pr-2 pl-0.5 text-[10px] text-text-sub pointer-events-none'; unitSpan.innerText = '%'; cellWrapper.appendChild(unitSpan);
                    }
                    ui.gridContainer.appendChild(cellWrapper);
                });
            });

            if (state.chartType === 'stackedBar') {
                ui.rowHeaderContainer.style.marginTop = '24px'; 
                validateStackedData();
            } else {
                ui.rowHeaderContainer.style.marginTop = '0px'; 
            }
            checkCtaValidation();
            renderPreview(); 
        }

        // ==========================================
        // PREVIEW SECTION (Refactored)
        // ==========================================

        const PREVIEW_OPTS = {
            padding: { top: 20, right: 80, bottom: 20, left: 80 },
            colors: {
                default: '#9CA3AF', // Gray-400
                secondary: '#6B7280', // Gray-500
                highlight: '#0EA5E9' // Sky-500
            },
            barWidthRatio: 0.6 
        };

        function renderPreview() {
            const container = document.getElementById('chart-preview-container');
            if (!container) return;

            const rows = state.rows;
            const chartType = state.chartType;
            
            const width = container.clientWidth || 300;
            const height = container.clientHeight || 208;
            
            const { padding, colors, barWidthRatio } = PREVIEW_OPTS;
            
            const drawW = width - padding.left - padding.right;
            const drawH = height - padding.top - padding.bottom;
            const svgNS = "http://www.w3.org/2000/svg";
            
            const svg = document.createElementNS(svgNS, "svg");
            svg.setAttribute("width", "100%");
            svg.setAttribute("height", "100%");
            svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

            // Axis Lines
            const yAxis = document.createElementNS(svgNS, "line");
            yAxis.setAttribute("x1", padding.left); yAxis.setAttribute("y1", padding.top);
            yAxis.setAttribute("x2", padding.left); yAxis.setAttribute("y2", height - padding.bottom);
            yAxis.setAttribute("stroke", "#E0E0E0"); yAxis.setAttribute("stroke-width", "1");
            svg.appendChild(yAxis);

            const xAxis = document.createElementNS(svgNS, "line");
            xAxis.setAttribute("x1", padding.left); xAxis.setAttribute("y1", height - padding.bottom);
            xAxis.setAttribute("x2", width - padding.right); xAxis.setAttribute("y2", height - padding.bottom);
            xAxis.setAttribute("stroke", "#E0E0E0"); xAxis.setAttribute("stroke-width", "1");
            svg.appendChild(xAxis);

            let totalGridCols = 0;
            if(state.data.length > 0) totalGridCols = state.data[0].length;
            if(totalGridCols === 0) return;

            // [FIXED] Dynamic Scale Calculation
            // 1. 사용자 설정값 가져오기
            const settingYMin = Number(ui.settingYMin.value) || 0;
            const settingYMax = Number(ui.settingYMax.value) || 100;
            
            // 2. 실제 데이터의 최댓값(Max) 계산
            let dataMax = 0;
            if (chartType === 'stackedBar') {
                // Stacked Bar는 '쌓인 높이(Sum)'가 기준이 되어야 함
                for(let c = 0; c < totalGridCols; c++) {
                    let colSum = 0;
                    // Row 0(Total)은 제외하고 실제 쌓이는 Row 1부터 합산
                    for(let r = 1; r < rows; r++) {
                        const val = Number(state.data[r][c]);
                        if (!isNaN(val)) colSum += val;
                    }
                    if (colSum > dataMax) dataMax = colSum;
                }
            } else {
                // Bar, Line 차트는 개별 값 중 최댓값 찾기
                state.data.forEach(row => {
                    row.forEach(val => {
                        const num = Number(val);
                        if (!isNaN(num) && num > dataMax) dataMax = num;
                    });
                });
            }

            // 3. 최종 Y Max 결정 (설정값보다 데이터가 크면 데이터 기준, 아니면 설정값 기준)
            // Raw 모드일 때만 자동 확장을 적용합니다.
            let finalYMax = settingYMax;
            if (state.dataMode === 'raw') {
                finalYMax = Math.max(settingYMax, dataMax);
            }

            const yMin = settingYMin;
            const yRange = (finalYMax - yMin) === 0 ? 1 : (finalYMax - yMin);


            // ==========================================
            // LINE CHART RENDERING
            // ==========================================
            if (chartType === 'line') {
                const segmentWidth = drawW / state.cols; 

                for (let r = 0; r < rows; r++) {
                    let points = "";
                    let circleElements = [];
                    
                    for (let c = 0; c < totalGridCols; c++) {
                        let rawVal = "";
                        if (state.data[r] && state.data[r][c]) rawVal = state.data[r][c];
                        
                        const numVal = Number(rawVal);
                        let val = (rawVal === "" || isNaN(numVal)) ? yMin : numVal;

                        const normalizedVal = Math.max(0, val - yMin);
                        // 비율 계산 시 finalYMax 기준인 yRange 사용
                        const ratio = Math.min(Math.max(normalizedVal / yRange, 0), 1);
                        const barH = drawH * ratio;

                        const cx = padding.left + (c * segmentWidth);
                        const cy = (height - padding.bottom) - barH;

                        points += `${cx},${cy} `;

                        const circle = document.createElementNS(svgNS, "circle");
                        circle.setAttribute("cx", cx);
                        circle.setAttribute("cy", cy);
                        circle.setAttribute("r", "3");
                        circle.setAttribute("fill", colors.default);
                        circle.setAttribute("stroke", "#fff");
                        circle.setAttribute("stroke-width", "1");
                        
                        circle.setAttribute("data-row", r);
                        circle.setAttribute("data-col", c);
                        circle.setAttribute("data-original-fill", colors.default);
                        circle.classList.add('preview-mark');
                        
                        circleElements.push(circle);
                    }

                    const polyline = document.createElementNS(svgNS, "polyline");
                    polyline.setAttribute("points", points);
                    polyline.setAttribute("fill", "none");
                    polyline.setAttribute("stroke", colors.secondary);
                    polyline.setAttribute("stroke-width", "2");
                    polyline.setAttribute("stroke-linejoin", "round");
                    polyline.setAttribute("stroke-linecap", "round");
                    
                    // 호버 효과용 속성
                    polyline.setAttribute("data-row", r);
                    polyline.classList.add('preview-line');

                    svg.appendChild(polyline);
                    circleElements.forEach(circle => svg.appendChild(circle));
                }

            } else {
                // ==========================================
                // BAR / STACKED BAR RENDERING
                // ==========================================
                let colToGroupMap = [];
                if (chartType === 'stackedBar') {
                    state.groupStructure.forEach((count, gIdx) => {
                        for(let i=0; i<count; i++) {
                            colToGroupMap.push({ groupIdx: gIdx, colInGroup: i, totalInGroup: count });
                        }
                    });
                }

                for (let c = 0; c < totalGridCols; c++) {
                    let stackY = 0;

                    for (let r = 0; r < rows; r++) {
                        if (chartType === 'stackedBar' && r === 0) continue;

                        let rawVal = "";
                        if (state.data[r] && state.data[r][c]) rawVal = state.data[r][c];
                        const numVal = Number(rawVal);
                        let val = (rawVal === "" || isNaN(numVal)) ? 
                                  ((chartType === 'stackedBar') ? (finalYMax - yMin)/(rows-1) : (finalYMax - yMin)*0.7) : numVal;
                        
                        const normalizedVal = Math.max(0, val - yMin);
                        const ratio = Math.min(Math.max(normalizedVal / yRange, 0), 1);
                        const barH = drawH * ratio;

                        const rect = document.createElementNS(svgNS, "rect");
                        let x = 0, y = 0, rectWidth = 0;

                        if (chartType === 'stackedBar') {
                            const mapInfo = colToGroupMap[c];
                            if (mapInfo) {
                                const groupSlotWidth = drawW / state.groupStructure.length;
                                const effectiveBarWidth = (groupSlotWidth * barWidthRatio) / mapInfo.totalInGroup;
                                x = padding.left + (mapInfo.groupIdx * groupSlotWidth) + (groupSlotWidth * (1 - barWidthRatio) / 2) + (mapInfo.colInGroup * effectiveBarWidth);
                                y = (height - padding.bottom) - stackY - barH;
                                stackY += barH;
                                rectWidth = Math.max(0, effectiveBarWidth - 1);
                            }
                        } else {
                            let effectiveColWidth = drawW / state.cols;
                            let effectiveBarWidth = (effectiveColWidth * barWidthRatio) / rows;
                            x = padding.left + (c * effectiveColWidth) + (effectiveColWidth * (1 - barWidthRatio) / 2) + (r * effectiveBarWidth);
                            y = (height - padding.bottom) - barH;
                            rectWidth = Math.max(0, effectiveBarWidth - 1);
                        }

                        rect.setAttribute("x", x);
                        rect.setAttribute("y", y);
                        rect.setAttribute("width", rectWidth);
                        rect.setAttribute("height", Math.max(0, barH));
                        rect.setAttribute("fill", (chartType === 'stackedBar' && r % 2 === 0) ? colors.secondary : colors.default);
                        rect.setAttribute("data-original-fill", rect.getAttribute("fill"));
                        rect.setAttribute("data-row", r);
                        rect.setAttribute("data-col", c);
                        
                        rect.classList.add('preview-mark');
                        svg.appendChild(rect);
                    }
                }
            }
            container.innerHTML = '';
            container.appendChild(svg);
        }

        function highlightPreview(type, indexOrRow, colIndex) {
            const marks = document.querySelectorAll('.preview-mark');
            const lines = document.querySelectorAll('.preview-line');
            const { highlight } = PREVIEW_OPTS.colors;

            // 1. 라인(Line) 먼저 처리 (점보다 아래에 위치해야 하므로 먼저 처리)
            lines.forEach(line => {
                let shouldThicken = false;
                const r = line.getAttribute('data-row');

                if (type === 'row') {
                    if (r == indexOrRow) shouldThicken = true;
                } else if (type === 'cell') {
                    // Cell 호버 시 해당 Row 라인도 강조
                    if (r == indexOrRow) shouldThicken = true;
                }

                if (shouldThicken) {
                    line.setAttribute('stroke-width', "4");
                    line.setAttribute('stroke', highlight);
                    
                    // [핵심] 하이라이트된 라인을 DOM 맨 끝으로 이동 (최상위 노출)
                    line.parentNode.appendChild(line);
                } else {
                    line.setAttribute('stroke-width', "2");
                    line.setAttribute('stroke', PREVIEW_OPTS.colors.secondary);
                }
            });

            // 2. 마크(Point/Bar) 처리 (라인 위에 그려져야 하므로 나중에 처리)
            marks.forEach(mark => {
                let shouldHighlight = false;
                
                if (type === 'col') { 
                    if (state.chartType === 'stackedBar') {
                         if (mark.getAttribute('data-col') == indexOrRow) shouldHighlight = true;
                    } else {
                        if (mark.getAttribute('data-col') == indexOrRow) shouldHighlight = true;
                    }
                } else if (type === 'row') { 
                    if (mark.getAttribute('data-row') == indexOrRow) shouldHighlight = true;
                } else if (type === 'group') { 
                    let startCol = 0;
                    for(let i=0; i<indexOrRow; i++) startCol += state.groupStructure[i];
                    let endCol = startCol + state.groupStructure[indexOrRow];
                    
                    const c = parseInt(mark.getAttribute('data-col'));
                    if (c >= startCol && c < endCol) shouldHighlight = true;
                } else if (type === 'cell') { 
                    const r = indexOrRow;
                    const c = colIndex;
                    if (state.chartType === 'stackedBar' && r === 0) {
                        if (mark.getAttribute('data-col') == c) shouldHighlight = true;
                    } else {
                        if (mark.getAttribute('data-row') == r && mark.getAttribute('data-col') == c) shouldHighlight = true;
                    }
                }

                if (shouldHighlight) {
                    mark.setAttribute('fill', highlight);
                    
                    if (mark.tagName === 'circle') {
                        mark.setAttribute('r', "6"); // 크기 확대
                    }

                    // [핵심] 하이라이트된 마크를 DOM 맨 끝으로 이동 (최상위 노출)
                    mark.parentNode.appendChild(mark); 

                } else {
                    mark.setAttribute('fill', mark.getAttribute('data-original-fill'));
                    if (mark.tagName === 'circle') {
                        mark.setAttribute('r', "3"); // 크기 복구
                    }
                }
            });
        }

        function resetPreviewHighlight() {
            // 마크(점/바) 초기화
            const marks = document.querySelectorAll('.preview-mark');
            marks.forEach(mark => {
                mark.setAttribute('fill', mark.getAttribute('data-original-fill'));
                if (mark.tagName === 'circle') {
                    mark.setAttribute('r', "3"); // 반지름 초기화
                }
            });

            // 라인 초기화
            const lines = document.querySelectorAll('.preview-line');
            lines.forEach(line => {
                line.setAttribute('stroke-width', "2"); // 두께 초기화
                line.setAttribute('stroke', PREVIEW_OPTS.colors.secondary); // 색상 초기화
            });
        }

        // ==========================================
        // DATA MANIPULATION HELPERS
        // ==========================================

        function addBarToGroup(groupIndex) {
            if (state.groupStructure[groupIndex] >= 10) return;
            let insertAt = 0;
            for (let i = 0; i < groupIndex; i++) {
                insertAt += state.groupStructure[i];
            }
            insertAt += state.groupStructure[groupIndex]; 

            state.data.forEach(row => { row.splice(insertAt, 0, ""); });
            state.groupStructure[groupIndex]++;
            renderGrid();
        }

        function removeBarFromGroup(groupIndex, barIndex) {
            if (state.groupStructure[groupIndex] <= 1) {
                alert("Minimum 1 bar per group."); return; 
            }
            let deleteAt = 0;
            for (let i = 0; i < groupIndex; i++) {
                deleteAt += state.groupStructure[i];
            }
            deleteAt += barIndex;
            state.data.forEach(row => { row.splice(deleteAt, 1); });
            state.groupStructure[groupIndex]--;
            renderGrid();
        }

        function handleDimensionInput() {
            let inputCell = parseInt(ui.settingCellInput.value);
            if (isNaN(inputCell) || inputCell < 1) inputCell = 1;
            if (inputCell > 10) inputCell = 10; 
            state.cellCount = inputCell;

            let inputCols = parseInt(ui.settingColInput.value);
            if (inputCols < 1) inputCols = 1; if (inputCols > MAX_SIZE) inputCols = MAX_SIZE;
            
            // Reverted Dimension Logic
            if (state.chartType === 'stackedBar') {
                const currentGroupCount = state.cols;
                if (inputCols > currentGroupCount) {
                    const addedCount = inputCols - currentGroupCount;
                    for(let k=0; k<addedCount; k++) {
                        state.groupStructure.push(2); // Default 2 bars per new group
                        state.data.forEach(row => { row.push("", ""); });
                    }
                } else if (inputCols < currentGroupCount) {
                    const removedCount = currentGroupCount - inputCols;
                    for(let k=0; k<removedCount; k++) {
                        const barsToRemove = state.groupStructure.pop();
                        state.data.forEach(row => { row.splice(-barsToRemove, barsToRemove); });
                    }
                }
                state.cols = inputCols;
                renderGrid(); 
            } else {
                let inputRows = parseInt(ui.settingMarkSelect.value);
                state.cols = inputCols;
                let targetDataCols = inputCols;
                if (state.chartType === 'line') {
                    targetDataCols = inputCols + 1;
                }
                updateGridSize(inputRows, targetDataCols);
            }
            updateSettingInputs();
        }

        function updateGridSize(newRows, newCols) {
            const currentRows = state.data.length;
            const currentCols = currentRows > 0 ? state.data[0].length : 0;
            const newData = [];
            for (let i = 0; i < newRows; i++) {
                const newRow = [];
                for (let j = 0; j < newCols; j++) {
                    if (i < currentRows && j < currentCols) {
                        newRow.push(state.data[i][j]);
                    } else {
                        newRow.push("");
                    }
                }
                newData.push(newRow);
            }
            state.data = newData;
            state.rows = newRows;
            renderGrid();
        }

        function addColumn() {
            if (state.cols >= MAX_SIZE) return;

            if(state.chartType === 'stackedBar') {
                state.cols++;
                state.groupStructure.push(2); 
                state.data.forEach(row => { row.push("", ""); });
                updateSettingInputs(); 
                renderGrid();
            } else {
                state.cols++;
                updateGridSize(state.rows, state.cols);
                updateSettingInputs();
            }
            setTimeout(() => { ui.gridScrollArea.scrollTo({ left: ui.gridScrollArea.scrollWidth, behavior: 'smooth' }); }, 50);
        }
        
        function addRow() {
            if (state.rows >= MAX_SIZE) return;
            state.rows++;
            
            const currentCols = state.data.length > 0 ? state.data[0].length : 
                                (state.chartType === 'stackedBar' ? getTotalStackedCols() : state.cols);
            state.data.push(new Array(currentCols).fill(""));

            if(state.chartType !== 'stackedBar') ui.settingMarkSelect.value = state.rows;

            updateSettingInputs(); 
            renderGrid();
            
            setTimeout(() => { ui.gridScrollArea.scrollTo({ top: ui.gridScrollArea.scrollHeight, behavior: 'smooth' }); }, 50);
        }

        function deleteColumn(colIndex) {
            if (state.cols <= 1) return;
            
            if (state.chartType === 'stackedBar') {
                const barsToRemove = state.groupStructure[colIndex];
                let startAt = 0;
                for(let i=0; i<colIndex; i++) startAt += state.groupStructure[i];
                state.data.forEach(row => row.splice(startAt, barsToRemove));
                state.groupStructure.splice(colIndex, 1);
                state.cols--;
            } else {
                state.data.forEach(row => row.splice(colIndex, 1));
                state.cols--;
            }
            updateSettingInputs(); renderGrid();
        }

        function deleteRow(rowIndex) {
            if (state.chartType === 'stackedBar' && rowIndex === 0) return;
            
            if (state.rows <= 1) return;
            state.data.splice(rowIndex, 1);
            state.rows--;
            updateSettingInputs(); renderGrid();
        }

        // ==========================================
        // OTHER LOGIC (Load/Save/Reset)
        // ==========================================

        function resetData() {
            if (state.chartType === 'stackedBar') {
                state.cols = 3;
                state.groupStructure = [2, 2, 2]; // Reverted default structure (2 bars per group)
                state.rows = 4; // All + 3 Stacks
                state.data = initData(4, 6); // All + 3 Stacks = 4 rows, 6 cols total
            } else if (state.chartType === 'line') {
                state.rows = 3; state.cols = 3; state.data = initData(3, 4);
            } else {
                state.rows = 3; state.cols = 3; state.data = initData(3, 3);
            }
            state.dataMode = 'raw'; 
            updateSettingInputs();
            renderGrid();
        }

        function updateSettingInputs() {
            ui.settingCellInput.value = state.cellCount;
            
            if (state.chartType === 'stackedBar') {
                 ui.labelColInput.textContent = "Group Count"; 
                 ui.settingColInput.value = state.cols; 
                 ui.containerMarkWrapper.classList.add('hidden');
            } else {
                 ui.labelColInput.textContent = "Graph Col";
                 ui.settingColInput.value = state.cols;
                 ui.containerMarkWrapper.classList.remove('hidden');
                 
                 if (state.rows > 5) {
                    if (!ui.settingMarkSelect.querySelector(`option[value="${state.rows}"]`)) {
                        const opt = document.createElement('option');
                        opt.value = state.rows; opt.text = state.rows; ui.settingMarkSelect.appendChild(opt);
                    }
                 }
                 ui.settingMarkSelect.value = state.rows;
            }
        }

        function handleCsvUpload(event) {
            const file = event.target.files[0];
            if (!file) return;
            state.csvFileName = file.name;
            updateCsvUi();
            const reader = new FileReader();
            reader.onload = function(e) { parseAndApplyCsv(e.target.result); };
            reader.readAsText(file);
        }

        function parseAndApplyCsv(csvText) {
            const lines = csvText.split(/\r?\n/).filter(r => r.trim() !== '');
            if (lines.length === 0) return;

            let maxCols = 0;
            const tempRows = lines.map(line => {
                const cells = line.split(',');
                if (cells.length > maxCols) maxCols = cells.length;
                return cells;
            });

            const normalizedData = tempRows.map(row => {
                while (row.length < maxCols) { row.push(""); }
                return row.map(cell => cell.trim());
            });

            state.data = normalizedData;
            state.rows = normalizedData.length;

            if (state.chartType === 'stackedBar') {
                const currentTotal = getTotalStackedCols();
                if (maxCols !== currentTotal) {
                    state.cols = 1; 
                    state.groupStructure = [maxCols];
                }
            } else {
                state.cols = maxCols;
            }

            state.dataMode = 'raw'; 
            updateSettingInputs(); renderGrid(); updateCsvUi(); ui.csvInput.value = '';
        }

        function toggleMode() {
             const textBtnClass = 'bg-transparent border-0 text-primary hover:text-primary-hover font-semibold text-xs cursor-pointer transition-colors min-w-[40px]';
             if (state.mode === 'edit') {
                state.mode = 'read';
                ui.editModeBtn.textContent = "Edit";
                ui.editModeBtn.className = textBtnClass;
                ui.settingColInput.disabled = true; 
                ui.settingCellInput.disabled = true;
                ui.settingMarkSelect.disabled = true;
                ui.settingYMin.disabled = true;
                ui.settingYMax.disabled = true;
             } else {
                state.mode = 'edit';
                ui.editModeBtn.textContent = "Save";
                ui.editModeBtn.className = textBtnClass;
                ui.settingColInput.disabled = false; 
                ui.settingCellInput.disabled = false;
                ui.settingMarkSelect.disabled = false;
                ui.settingYMin.disabled = false;
                ui.settingYMax.disabled = false;
             }
             renderGrid(); checkCtaValidation(); 
        }

        function checkCtaValidation() {
            if (state.mode !== 'read') { ui.mainCta.disabled = true; return; }
            let isAllFilled = true;
            let isRangeError = false;
            
            const totalVisualRows = state.data.length;
            const totalCols = state.data.length > 0 ? state.data[0].length : 0;

            for (let i = 0; i < totalVisualRows; i++) {
                for (let j = 0; j < totalCols; j++) {
                    const val = state.data[i][j];
                    if (!val || val.trim() === "") isAllFilled = false;
                    if (state.dataMode === 'percent' && val && val.trim() !== "") {
                        const num = Number(val);
                        if (!isNaN(num) && (num < 0 || num > 100)) isRangeError = true;
                    }
                }
            }
            const toast = ui.errorToast;
            if (isRangeError) {
                if (toast.classList.contains('hidden')) { toast.classList.remove('hidden'); setTimeout(() => toast.classList.remove('opacity-0', 'translate-y-2'), 10); }
            } else {
                if (!toast.classList.contains('hidden') && !toast.classList.contains('opacity-0')) { toast.classList.add('opacity-0', 'translate-y-2'); setTimeout(() => toast.classList.add('hidden'), 300); }
            }
            ui.mainCta.disabled = !(isAllFilled && !isRangeError);
        }

        function submitData() {
            let finalValues = state.data.map(row => 
                row.map(cell => {
                    const num = Number(cell);
                    return isNaN(num) ? 0 : num;
                })
            );
            
            let rawValues = finalValues;
            let drawingValues = finalValues;
            let markNumPayload = state.groupStructure; 
            
            if (state.chartType === 'stackedBar' || state.chartType === 'stacked') {
                if (finalValues.length > 1) {
                    drawingValues = finalValues.slice(1);
                }
                markNumPayload = state.groupStructure;
            } else {
                markNumPayload = state.rows; 
            }

            const msgType = state.uiMode === 'create' ? 'generate' : 'apply';
            
            postPluginMessage({
                type: msgType,
                payload: {
                    type: state.chartType,
                    mode: state.dataMode,
                    values: drawingValues,
                    rawValues: rawValues,
                    rows: (state.chartType === 'stackedBar' || state.chartType === 'stacked') ? (state.rows - 1) : state.rows,
                    cols: state.cols,
                    cellCount: state.cellCount,
                    yMin: Number(ui.settingYMin.value),
                    yMax: Number(ui.settingYMax.value),
                    markNum: markNumPayload
                }
            });
        }


        registerGridFunctions({ renderGrid, updateGridSize, addRow, addColumn, deleteRow, deleteColumn });
        registerCsvFunctions({ handleCsvUpload, parseAndApplyCsv, downloadCsv, removeCsv });
        registerModeFunctions({ setMode: window.setMode as any, toggleMode, checkDataRange, checkCtaValidation });
        registerMessageFunctions({ onMessage: handlePluginMessage as any });
        bindMessageHandler();

        (window as any).setMode = setModeFromMode;
        (window as any).selectType = window.selectType;
        ui.editModeBtn.addEventListener('click', toggleMode);
        ui.csvInput.addEventListener('change', handleCsvUploadFromCsv as any);
        ui.csvDeleteBtn.addEventListener('click', removeCsvFromCsv);
        ui.mainCta.addEventListener('click', submitData);
        
        ui.settingColInput.addEventListener('input', handleDimensionInput);
        ui.settingCellInput.addEventListener('input', handleDimensionInput); 
        ui.settingMarkSelect.addEventListener('change', handleDimensionInput);
        
        ui.addColFixedBtn.addEventListener('click', addColumnFromGrid);
        ui.addRowFixedBtn.addEventListener('click', addRowFromGrid);
        ui.csvExportBtn.addEventListener('click', downloadCsvFromCsv);
        ui.resetBtn.addEventListener('click', resetData);
    

export {};
