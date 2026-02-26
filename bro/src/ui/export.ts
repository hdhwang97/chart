import { ui } from './dom';
import { state, getTotalStackedCols, getRowColor, normalizeHexColorInput, getGridColsForChart } from './state';
import type { RowStrokeStyle, StrokeStyleSnapshot } from '../shared/style-types';
import { getEffectiveYDomain } from './y-range';

// ==========================================
// EXPORT TAB — D3 Preview & Code
// ==========================================

declare const d3: any;

let lastStylePayload: any = null;
let dataTabRenderer: (() => void) | null = null;

function buildPreviewStyleFromState() {
    return {
        chartType: state.chartType || 'bar',
        markNum: state.chartType === 'stackedBar' ? state.groupStructure : state.rows,
        yCount: state.cellCount,
        colCount: state.cols,
        markRatio: state.markRatio,
        rowColors: state.rowColors,
        strokeWidth: state.strokeWidth,
        colStrokeStyle: state.colStrokeStyle || null,
        rowStrokeStyles: state.rowStrokeStyles || [],
        cornerRadius: 0,
        colors: state.rowColors
    };
}

function strokeColor(stroke: StrokeStyleSnapshot | null, fallback = '#E5E7EB') {
    return stroke?.color || fallback;
}

function strokeWeight(stroke: StrokeStyleSnapshot | null, fallback = 1) {
    if (!stroke) return fallback;
    if (typeof stroke.weight === 'number') return stroke.weight;
    const sideWeights = [stroke.weightTop, stroke.weightRight, stroke.weightBottom, stroke.weightLeft]
        .filter((v): v is number => typeof v === 'number');
    if (sideWeights.length > 0) {
        return sideWeights.reduce((a, b) => a + b, 0) / sideWeights.length;
    }
    return fallback;
}

function applyStroke(selection: any, stroke: StrokeStyleSnapshot | null, fallbackColor: string, fallbackWidth: number) {
    selection.attr('stroke', strokeColor(stroke, fallbackColor)).attr('stroke-width', strokeWeight(stroke, fallbackWidth));
    if (stroke?.dashPattern && stroke.dashPattern.length > 0) {
        selection.attr('stroke-dasharray', stroke.dashPattern.join(','));
    }
    if (typeof stroke?.opacity === 'number') {
        selection.attr('stroke-opacity', stroke.opacity);
    }
}

function getRowStroke(row: number, styles: RowStrokeStyle[]): StrokeStyleSnapshot | null {
    const found = styles.find(item => item.row === row);
    return found ? found.stroke : null;
}

function resolveRowColors(style: any, chartType: string, numRows: number): string[] {
    const styleRowColors = Array.isArray(style?.rowColors) ? style.rowColors : [];
    const stateRowColors = Array.isArray(state.rowColors) ? state.rowColors : [];
    const baseRowColors = stateRowColors.length > 0 ? stateRowColors : styleRowColors;
    const fallbackColors = Array.isArray(style?.colors) ? style.colors : [];
    const targetCount = Math.max(
        1,
        chartType === 'stackedBar' || chartType === 'stacked'
            ? Math.max(state.rows, numRows + 1)
            : Math.max(state.rows, numRows)
    );
    const resolved: string[] = [];

    for (let i = 0; i < targetCount; i++) {
        const fromRowColors = normalizeHexColorInput(baseRowColors[i]);
        const fromFallback = chartType === 'stackedBar' || chartType === 'stacked'
            ? normalizeHexColorInput(i === 0 ? undefined : fallbackColors[i - 1])
            : normalizeHexColorInput(fallbackColors[i]);
        resolved.push(fromRowColors || fromFallback || getRowColor(i));
    }
    return resolved;
}

function getSeriesColor(rowColors: string[], rowIndex: number, chartType: string) {
    if (chartType === 'stackedBar' || chartType === 'stacked') {
        return rowColors[rowIndex + 1] || getRowColor(rowIndex + 1);
    }
    return rowColors[rowIndex] || getRowColor(rowIndex);
}

function buildXAxisLabels(totalCols: number): string[] {
    return Array.from({ length: totalCols }, (_, i) => `C${i + 1}`);
}

function buildYTickValues(yMin: number, yMax: number, cellCount: number): number[] {
    const n = Math.max(1, cellCount);
    const step = (yMax - yMin) / n;
    return Array.from({ length: n + 1 }, (_, i) => yMin + (step * i));
}

function normalizeMarkRatio(markRatio?: number): number {
    const ratio = typeof markRatio === 'number' ? markRatio : 0.8;
    return Math.max(0.01, Math.min(1, ratio));
}

function computeClusterLayout(cellWidth: number, markRatio: number, markNum: number) {
    const safeCellWidth = Math.max(1, cellWidth);
    const safeMarkNum = Math.max(1, Math.floor(markNum));
    const clusterW = safeCellWidth * markRatio;
    const gaps = Math.max(0, safeMarkNum - 1);
    const t = Math.max(0, Math.min(1, (markRatio - 0.01) / 0.99));
    const gapRatioRaw = 0.005 + ((0.05 - 0.005) * (t * t));
    let gapPx = safeCellWidth * gapRatioRaw;
    if (gaps > 0) {
        const maxTotalGap = clusterW * 0.35;
        const totalGap = gapPx * gaps;
        if (totalGap > maxTotalGap) {
            gapPx = maxTotalGap / gaps;
        }
    } else {
        gapPx = 0;
    }
    const clusterOffset = (safeCellWidth - clusterW) / 2;
    const subBarW = Math.max(1, (clusterW - (gapPx * gaps)) / safeMarkNum);
    return { clusterW, clusterOffset, subBarW, gapPx };
}

function buildStateNumericData(chartType: string, totalCols: number): number[][] {
    const isStacked = chartType === 'stackedBar' || chartType === 'stacked';
    const cols = isStacked ? getTotalStackedCols() : totalCols;
    const rows = Math.max(0, state.rows);
    const data: number[][] = [];

    for (let r = 0; r < rows; r++) {
        const row: number[] = [];
        for (let c = 0; c < cols; c++) {
            row.push(Number(state.data[r]?.[c]) || 0);
        }
        data.push(row);
    }

    return data;
}

function applyStrokeExtras(selection: any, stroke: StrokeStyleSnapshot | null) {
    if (stroke?.dashPattern && stroke.dashPattern.length > 0) {
        selection.attr('stroke-dasharray', stroke.dashPattern.join(','));
    }
    if (typeof stroke?.opacity === 'number') {
        selection.attr('opacity', stroke.opacity);
    }
}

function getDraftLineStroke(target: 'cellTop' | 'tabRight'): StrokeStyleSnapshot | null {
    const draft = target === 'cellTop' ? state.styleInjectionDraft.cellTop : state.styleInjectionDraft.tabRight;
    return {
        color: draft.color,
        weight: draft.visible ? draft.thickness : 0,
        dashPattern: draft.strokeStyle === 'dash' ? [4, 2] : []
    };
}

function drawGridContainerBorder(g: any, w: number, h: number) {
    const grid = state.styleInjectionDraft.gridContainer;
    const thickness = grid.visible ? grid.thickness : 0;
    if (thickness <= 0) return;
    const dashPattern = grid.strokeStyle === 'dash' ? '4,2' : null;

    if (grid.sides.top) {
        const line = g.append('line')
            .attr('x1', 0)
            .attr('x2', w)
            .attr('y1', 0)
            .attr('y2', 0)
            .attr('stroke', grid.color)
            .attr('stroke-width', thickness);
        if (dashPattern) line.attr('stroke-dasharray', dashPattern);
    }
    if (grid.sides.right) {
        const line = g.append('line')
            .attr('x1', w)
            .attr('x2', w)
            .attr('y1', 0)
            .attr('y2', h)
            .attr('stroke', grid.color)
            .attr('stroke-width', thickness);
        if (dashPattern) line.attr('stroke-dasharray', dashPattern);
    }
    if (grid.sides.bottom) {
        const line = g.append('line')
            .attr('x1', 0)
            .attr('x2', w)
            .attr('y1', h)
            .attr('y2', h)
            .attr('stroke', grid.color)
            .attr('stroke-width', thickness);
        if (dashPattern) line.attr('stroke-dasharray', dashPattern);
    }
    if (grid.sides.left) {
        const line = g.append('line')
            .attr('x1', 0)
            .attr('x2', 0)
            .attr('y1', 0)
            .attr('y2', h)
            .attr('stroke', grid.color)
            .attr('stroke-width', thickness);
        if (dashPattern) line.attr('stroke-dasharray', dashPattern);
    }
}

function renderAxes(g: any, xScale: any, yScale: any, yTickValues: number[], h: number, xTickValues?: number[]) {
    const yAxis = d3.axisLeft(yScale)
        .tickValues(yTickValues)
        .tickFormat((d: number) => Number.isInteger(d) ? String(d) : d.toFixed(1).replace(/\.0$/, ''))
        .tickPadding(6);

    g.append('g')
        .call(yAxis)
        .selectAll('text')
        .attr('font-size', 9);

    const xAxis = d3.axisBottom(xScale)
        .tickSizeOuter(0)
        .tickFormat((d: number) => `C${d + 1}`);
    if (xTickValues && xTickValues.length > 0) {
        xAxis.tickValues(xTickValues);
    }

    g.append('g')
        .attr('transform', `translate(0,${h})`)
        .call(xAxis)
        .selectAll('text')
        .attr('font-size', 9);
}

function drawGuides(g: any, w: number, h: number, colCount: number, yCellCount: number, colStroke: StrokeStyleSnapshot | null, rowStrokes: RowStrokeStyle[], xGuidePositions?: number[]) {
    const tabRightStroke = getDraftLineStroke('tabRight') || colStroke;
    const cellTopStroke = getDraftLineStroke('cellTop');

    if (tabRightStroke && colCount > 0) {
        if (xGuidePositions && xGuidePositions.length > 0) {
            xGuidePositions.forEach((x) => {
                const line = g.append('line')
                    .attr('x1', x)
                    .attr('x2', x)
                    .attr('y1', 0)
                    .attr('y2', h);
                applyStroke(line, tabRightStroke, '#E5E7EB', 1);
                line.attr('opacity', 0.35);
            });
        } else {
            const step = w / colCount;
            for (let c = 0; c <= colCount; c++) {
                const line = g.append('line')
                    .attr('x1', c * step)
                    .attr('x2', c * step)
                    .attr('y1', 0)
                    .attr('y2', h);
                applyStroke(line, tabRightStroke, '#E5E7EB', 1);
                line.attr('opacity', 0.35);
            }
        }
    }

    if (yCellCount > 0) {
        const step = h / yCellCount;
        for (let r = 0; r <= yCellCount; r++) {
            const stroke = cellTopStroke || getRowStroke(r, rowStrokes);
            const line = g.append('line')
                .attr('x1', 0)
                .attr('x2', w)
                .attr('y1', r * step)
                .attr('y2', r * step);
            applyStroke(line, stroke || null, '#E5E7EB', 1);
            line.attr('opacity', stroke ? 0.35 : 0.2);
        }
    }
}

export function setDataTabRenderer(renderer: () => void) {
    dataTabRenderer = renderer;
}

export function switchTab(tab: 'data' | 'style' | 'export') {
    const tabDataBtn = document.getElementById('tab-data')!;
    const tabStyleBtn = document.getElementById('tab-style')!;
    const tabExportBtn = document.getElementById('tab-export')!;
    const step2 = document.getElementById('step-2')!;
    const stepStyle = document.getElementById('step-style')!;
    const stepExport = document.getElementById('step-export')!;
    const activeClass = 'px-3 py-0.5 text-xs font-semibold rounded bg-white shadow-sm text-primary transition-all border-0 cursor-pointer';
    const inactiveClass = 'px-3 py-0.5 text-xs font-semibold rounded text-text-sub hover:text-text bg-transparent transition-all border-0 cursor-pointer';

    if (tab === 'data') {
        tabDataBtn.className = activeClass;
        tabStyleBtn.className = inactiveClass;
        tabExportBtn.className = inactiveClass;
        step2.classList.add('active');
        stepStyle.classList.remove('active');
        stepExport.classList.remove('active');
        if (dataTabRenderer) dataTabRenderer();
    } else if (tab === 'style') {
        tabDataBtn.className = inactiveClass;
        tabStyleBtn.className = activeClass;
        tabExportBtn.className = inactiveClass;
        step2.classList.remove('active');
        stepStyle.classList.add('active');
        stepExport.classList.remove('active');
    } else {
        tabDataBtn.className = inactiveClass;
        tabStyleBtn.className = inactiveClass;
        tabExportBtn.className = activeClass;
        step2.classList.remove('active');
        stepStyle.classList.remove('active');
        stepExport.classList.add('active');

        const previewPayload = lastStylePayload || buildPreviewStyleFromState();
        renderD3Preview(previewPayload);
        updateCodeOutput(previewPayload);

        // Request style extraction from plugin
        parent.postMessage({ pluginMessage: { type: 'extract_style' } }, '*');
    }
}

export function handleStyleExtracted(payload: any) {
    lastStylePayload = payload;
    renderD3Preview(payload);
    updateCodeOutput(payload);
}

export function refreshExportPreview() {
    const previewPayload = lastStylePayload || buildPreviewStyleFromState();
    renderD3Preview(previewPayload);
    updateCodeOutput(previewPayload);
}

function renderD3Preview(style: any) {
    const container = document.getElementById('d3-preview-container')!;
    container.innerHTML = '';

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    const svg = d3.select(container).append('svg')
        .attr('width', width)
        .attr('height', height);

    const margin = { top: 12, right: 14, bottom: 30, left: 44 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const colCount = style.colCount || 5;
    const markNum = style.markNum || 1;
    const yCount = style.yCount || 4;
    const chartType = style.chartType || 'bar';
    const cornerRadius = style.cornerRadius || 0;
    const strokeWidth = style.strokeWidth || state.strokeWidth || 2;
    const colStrokeStyle: StrokeStyleSnapshot | null = style.colStrokeStyle || null;
    const rowStrokeStyles: RowStrokeStyle[] = style.rowStrokeStyles || [];
    const groups = chartType === 'stackedBar'
        ? (Array.isArray(markNum) ? markNum : [colCount])
        : [];

    const flatCols = Array.isArray(markNum)
        ? markNum.reduce((a: number, b: number) => a + b, 0)
        : (chartType === 'line' ? getGridColsForChart('line', colCount) : colCount);
    const axisCols = chartType === 'stackedBar' ? groups.length : flatCols;
    const stateData = buildStateNumericData(chartType, flatCols);
    const hasStateData = stateData.length > 0 && stateData.some(row => row.some(v => Number.isFinite(v)));

    // fallback data when UI state is empty
    let sampleData: number[][] = stateData;
    if (!hasStateData) {
        const fallbackRows = Array.isArray(markNum) ? Math.max(2, markNum.length + 1) : (typeof markNum === 'number' ? markNum : 1);
        sampleData = [];
        for (let r = 0; r < fallbackRows; r++) {
            const row = [];
            for (let c = 0; c < flatCols; c++) {
                row.push(20 + Math.random() * 60);
            }
            sampleData.push(row);
        }
    }
    const numRows = sampleData.length;
    const rowColors = resolveRowColors(style, chartType, numRows);

    const yDomain = getEffectiveYDomain({
        mode: state.dataMode,
        yMinInput: ui.settingYMin.value,
        yMaxInput: ui.settingYMax.value,
        data: sampleData,
        chartType
    });
    const yScale = d3.scaleLinear().domain([yDomain.yMin, yDomain.yMax]).range([h, 0]);
    const isLine = chartType === 'line';
    const lineTickValues = isLine
        ? Array.from({ length: flatCols }, (_, i) => i)
        : undefined;
    const xAxisScale = isLine
        ? d3.scaleLinear().domain([0, Math.max(1, flatCols - 1)]).range([0, w])
        : d3.scaleBand().domain(d3.range(axisCols)).range([0, w]).padding(0);
    const yTickValues = buildYTickValues(yDomain.yMin, yDomain.yMax, yCount);

    renderAxes(g, xAxisScale, yScale, yTickValues, h, lineTickValues);
    const lineGuidePositions = isLine && lineTickValues
        ? lineTickValues.map(idx => xAxisScale(idx))
        : undefined;
    drawGuides(g, w, h, axisCols, yCount, colStrokeStyle, rowStrokeStyles, lineGuidePositions);

    if (chartType === 'bar') {
        const xScale = d3.scaleBand().domain(d3.range(colCount)).range([0, w]).padding(0);
        const ratio = normalizeMarkRatio(style.markRatio);

        for (let r = 0; r < numRows; r++) {
            for (let c = 0; c < colCount; c++) {
                const val = sampleData[r]?.[c] || 0;

                const colX = xScale(c)!;
                const colW = xScale.bandwidth();
                const clusterLayout = computeClusterLayout(colW, ratio, numRows);

                const rect = g.append('rect')
                    .attr('x', colX + clusterLayout.clusterOffset + (r * (clusterLayout.subBarW + clusterLayout.gapPx)))
                    .attr('y', yScale(val))
                    .attr('width', clusterLayout.subBarW)
                    .attr('height', h - yScale(val))
                    .attr('fill', getSeriesColor(rowColors, r, 'bar'))
                    .attr('rx', cornerRadius);
                applyStroke(rect, getRowStroke(r, rowStrokeStyles) || colStrokeStyle, 'none', 0);
            }
        }
    } else if (chartType === 'line') {
        const pointCols = getGridColsForChart('line', colCount);
        const xScale = d3.scaleLinear().domain([0, Math.max(1, pointCols - 1)]).range([0, w]);

        for (let r = 0; r < numRows; r++) {
            const lineData = (sampleData[r] || []).slice(0, pointCols);
            const line = d3.line()
                .x((_: any, i: number) => xScale(i)!)
                .y((d: number) => yScale(d));

            const rowStroke = getRowStroke(r, rowStrokeStyles) || colStrokeStyle;
            const baseColor = getSeriesColor(rowColors, r, 'line');
            const path = g.append('path')
                .datum(lineData)
                .attr('fill', 'none')
                .attr('stroke', baseColor)
                .attr('stroke-width', strokeWidth)
                .attr('d', line);
            applyStrokeExtras(path, rowStroke);

            lineData.forEach((val: number, i: number) => {
                const dot = g.append('circle')
                    .attr('cx', xScale(i)!)
                    .attr('cy', yScale(val))
                    .attr('r', 3)
                    .attr('fill', baseColor);
                if (typeof rowStroke?.opacity === 'number') {
                    dot.attr('opacity', rowStroke.opacity);
                }
            });
        }
    } else if (chartType === 'stackedBar') {
        const ratio = normalizeMarkRatio(style.markRatio);
        const xScale = d3.scaleBand().domain(d3.range(groups.length)).range([0, w]).padding(0);
        const startRow = sampleData.length > 1 ? 1 : 0;

        let flatIdx = 0;
        groups.forEach((barCount: number, gIdx: number) => {
            const cellW = xScale.bandwidth();
            const clusterLayout = computeClusterLayout(cellW, ratio, barCount);

            for (let b = 0; b < barCount; b++) {
                let yOffset = h;
                for (let r = startRow; r < numRows; r++) {
                    const val = sampleData[r]?.[flatIdx] || 0;
                    const barH = Math.max(0, h - yScale(val));

                    const rect = g.append('rect')
                        .attr('x', xScale(gIdx)! + clusterLayout.clusterOffset + (b * (clusterLayout.subBarW + clusterLayout.gapPx)))
                        .attr('y', yOffset - barH)
                        .attr('width', clusterLayout.subBarW)
                        .attr('height', barH)
                        .attr('fill', getSeriesColor(rowColors, r - startRow, 'stackedBar'))
                        .attr('rx', cornerRadius);
                    applyStroke(rect, getRowStroke(r, rowStrokeStyles) || colStrokeStyle, 'none', 0);
                    yOffset -= barH;
                }
                flatIdx++;
            }
        });
    }

    drawGridContainerBorder(g, w, h);
}

function updateCodeOutput(style: any) {
    const codeOutput = document.getElementById('d3-code-output') as HTMLTextAreaElement;
    codeOutput.value = generateD3CodeString(style);
}

export function generateD3CodeString(style: any): string {
    const colorsJson = JSON.stringify(style.colors && style.colors.length > 0 ? style.colors : ['#18A0FB']);
    const paddingVal = (1 - (style.markRatio || 0.8)).toFixed(2);
    const strokeVal = style.strokeWidth || 2;
    const radiusVal = style.cornerRadius || 0;
    const colStroke = JSON.stringify(style.colStrokeStyle || null);
    const rowStrokes = JSON.stringify(style.rowStrokeStyles || []);

    return `// D3.js Config Export
// Generated from Figma Plugin
const config = {
  colors: ${colorsJson},
  padding: ${paddingVal},
  strokeWidth: ${strokeVal},
  cornerRadius: ${radiusVal},
  derivedGapRatio: 0,
  chartType: "${style.chartType || 'bar'}",
  colCount: ${style.colCount || 5},
  yCount: ${style.yCount || 4},
  colStroke: ${colStroke},
  rowStrokes: ${rowStrokes}
};

// Example: Apply to D3 bars
// d3.selectAll('rect')
//   .attr('fill', (d, i) => config.colors[i % config.colors.length])
//   .attr('rx', config.cornerRadius)
//   .attr('stroke', config.colStroke?.color || 'none');
//
// d3.scaleBand().padding(config.padding);`;
}

export function copyToClipboard() {
    const codeOutput = document.getElementById('d3-code-output') as HTMLTextAreaElement;
    codeOutput.select();
    document.execCommand('copy');

    const btn = codeOutput.previousElementSibling?.querySelector('button');
    // Simple visual feedback
    const origText = 'Copy';
    if (btn) {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = origText; }, 1500);
    }
}

// Expose functions used in HTML onclick attributes
(window as any).switchTab = switchTab;
(window as any).copyToClipboard = copyToClipboard;
