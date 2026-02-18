import { state, getTotalStackedCols, getRowColor, getGridColsForChart } from './state';
import { ui } from './dom';
import type { StrokeStyleSnapshot } from '../shared/style-types';
import { getEffectiveYDomain } from './y-range';

// ==========================================
// PREVIEW RENDERING (D3-based)
// ==========================================

declare const d3: any; // loaded from CDN in index.html

const PREVIEW_OPTS = {
    margin: { top: 12, right: 14, bottom: 30, left: 44 },
    barPadding: 0.2,
    lineStroke: 2,
    colors: ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb923c']
};
const GRID_MARK_HOVER_CLASS = 'grid-cell-mark-hover';
const MARK_DIM_OPACITY = 0.2;
const MARK_HOVER_OPACITY = 1;
type HighlightState = { type: string; index: number; row?: number; col?: number };
let highlightState: HighlightState | null = null;

function getPreviewMarkElements(): SVGElement[] {
    return Array.from(document.querySelectorAll<SVGElement>('#chart-preview-container .preview-mark'));
}

function dimOtherMarks(hovered: SVGElement) {
    const marks = getPreviewMarkElements();
    marks.forEach((mark) => {
        mark.style.opacity = String(MARK_DIM_OPACITY);
    });
    hovered.style.opacity = String(MARK_HOVER_OPACITY);
}

function restoreMarkOpacityFromBase() {
    const marks = getPreviewMarkElements();
    marks.forEach((mark) => {
        const base = mark.getAttribute('data-base-opacity');
        if (base !== null) {
            mark.style.opacity = base;
        } else {
            mark.style.removeProperty('opacity');
        }
    });
}

function clearGridHighlightFromMark() {
    document.querySelectorAll<HTMLInputElement>(`#data-grid input.${GRID_MARK_HOVER_CLASS}`)
        .forEach((cell) => cell.classList.remove(GRID_MARK_HOVER_CLASS));
}

function highlightGridCellFromMark(row: number, col: number) {
    clearGridHighlightFromMark();
    const target = document.querySelector<HTMLInputElement>(`#data-grid input[data-r="${row}"][data-c="${col}"]`);
    if (target) {
        target.classList.add(GRID_MARK_HOVER_CLASS);
    }
}

function highlightGridRowFromMark(row: number) {
    clearGridHighlightFromMark();
    document.querySelectorAll<HTMLInputElement>(`#data-grid input[data-r="${row}"]`)
        .forEach((cell) => cell.classList.add(GRID_MARK_HOVER_CLASS));
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
    const color = strokeColor(stroke, fallbackColor);
    const width = strokeWeight(stroke, fallbackWidth);
    selection.attr('stroke', color).attr('stroke-width', width);

    if (stroke?.dashPattern && stroke.dashPattern.length > 0) {
        selection.attr('stroke-dasharray', stroke.dashPattern.join(','));
    }

    if (typeof stroke?.opacity === 'number') {
        selection.attr('stroke-opacity', stroke.opacity);
    }
}

function applyStrokeExtras(selection: any, stroke: StrokeStyleSnapshot | null) {
    if (stroke?.dashPattern && stroke.dashPattern.length > 0) {
        selection.attr('stroke-dasharray', stroke.dashPattern.join(','));
    }
    if (typeof stroke?.opacity === 'number') {
        selection.attr('stroke-opacity', stroke.opacity);
    }
}

function getLineBaseStrokeWidth() {
    return state.strokeWidth || PREVIEW_OPTS.lineStroke;
}

function getLineHighlightStrokeWidth(baseStroke: number, boost = 1.6) {
    return Math.max(baseStroke + 1, baseStroke * boost);
}

function getRowStroke(row: number): StrokeStyleSnapshot | null {
    const found = state.rowStrokeStyles.find(item => item.row === row);
    return found ? found.stroke : null;
}

function getSeriesColor(rowIndex: number, chartType: string) {
    if (chartType === 'stackedBar' || chartType === 'stacked') {
        return getRowColor(rowIndex + 1);
    }
    return getRowColor(rowIndex);
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
    const clusterOffset = (safeCellWidth - clusterW) / 2;
    const subBarW = Math.max(1, clusterW / safeMarkNum);
    return { clusterW, clusterOffset, subBarW };
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

function drawGuides(g: any, w: number, h: number, totalCols: number, yCellCount: number, xGuidePositions?: number[]) {
    if (state.colStrokeStyle && totalCols > 0) {
        if (xGuidePositions && xGuidePositions.length > 0) {
            xGuidePositions.forEach((x) => {
                const line = g.append('line')
                    .attr('x1', x)
                    .attr('x2', x)
                    .attr('y1', 0)
                    .attr('y2', h);
                applyStroke(line, state.colStrokeStyle, '#E5E7EB', 1);
                line.attr('opacity', 0.35);
            });
        } else {
            const step = w / totalCols;
            for (let c = 0; c <= totalCols; c++) {
                const line = g.append('line')
                    .attr('x1', c * step)
                    .attr('x2', c * step)
                    .attr('y1', 0)
                    .attr('y2', h);
                applyStroke(line, state.colStrokeStyle, '#E5E7EB', 1);
                line.attr('opacity', 0.35);
            }
        }
    }

    if (yCellCount > 0) {
        const step = h / yCellCount;
        for (let r = 0; r <= yCellCount; r++) {
            const stroke = getRowStroke(r);
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

export function renderPreview() {
    const container = document.getElementById('chart-preview-container')!;
    clearGridHighlightFromMark();
    restoreMarkOpacityFromBase();
    container.innerHTML = '';
    container.onmouseleave = () => {
        clearGridHighlightFromMark();
        restoreMarkOpacityFromBase();
    };

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    const svg = d3.select(container).append('svg')
        .attr('width', width)
        .attr('height', height);

    const { margin } = PREVIEW_OPTS;
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const chartType = state.chartType;
    const isStacked = chartType === 'stackedBar';
    const totalCols = isStacked ? getTotalStackedCols() : getGridColsForChart(chartType, state.cols);

    // Get numeric values
    const numData: number[][] = [];
    for (let r = 0; r < state.rows; r++) {
        const row: number[] = [];
        for (let c = 0; c < totalCols; c++) {
            row.push(Number(state.data[r]?.[c]) || 0);
        }
        numData.push(row);
    }

    const yDomain = getEffectiveYDomain({
        mode: state.dataMode,
        yMinInput: ui.settingYMin.value,
        yMaxInput: ui.settingYMax.value,
        data: numData,
        chartType
    });
    const yMin = yDomain.yMin;
    const yMax = yDomain.yMax;

    const yScale = d3.scaleLinear().domain([yMin, yMax]).range([h, 0]);
    const isLine = chartType === 'line';
    const lineTickValues = isLine
        ? Array.from({ length: totalCols }, (_, i) => i)
        : undefined;
    const xAxisScale = isLine
        ? d3.scaleLinear().domain([0, Math.max(1, totalCols - 1)]).range([0, w])
        : d3.scaleBand().domain(d3.range(totalCols)).range([0, w]).padding(0);
    const yTickValues = buildYTickValues(yMin, yMax, state.cellCount);

    renderAxes(g, xAxisScale, yScale, yTickValues, h, lineTickValues);
    const lineGuidePositions = isLine && lineTickValues
        ? lineTickValues.map(idx => xAxisScale(idx))
        : undefined;
    drawGuides(g, w, h, totalCols, state.cellCount, lineGuidePositions);

    if (chartType === 'bar') {
        renderBarPreview(g, numData, w, h, yScale);
    } else if (chartType === 'line') {
        renderLinePreview(g, numData, yScale, xAxisScale);
    } else if (isStacked) {
        renderStackedPreview(g, numData, w, h, yMin, yMax);
    }
}

function renderBarPreview(g: any, data: number[][], w: number, h: number, yScale: any) {
    const cols = state.cols;
    const rows = state.rows;
    const xScale = d3.scaleBand().domain(d3.range(cols)).range([0, w]).padding(0);
    const ratio = normalizeMarkRatio(state.markRatio);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const val = data[r][c];
            const barH = Math.max(0, h - yScale(val));
            const isHighlighted = highlightState
                ? (highlightState.type === 'col' && highlightState.index === c) ||
                (highlightState.type === 'row' && highlightState.index === r)
                    || (highlightState.type === 'cell' && highlightState.row === r && highlightState.col === c)
                : false;

            const colX = xScale(c)!;
            const colW = xScale.bandwidth();
            const clusterLayout = computeClusterLayout(colW, ratio, rows);

            const rect = g.append('rect')
                .attr('class', 'preview-mark')
                .attr('x', colX + clusterLayout.clusterOffset + (r * clusterLayout.subBarW))
                .attr('y', yScale(val))
                .attr('width', clusterLayout.subBarW)
                .attr('height', barH)
                .attr('fill', getSeriesColor(r, 'bar'))
                .attr('opacity', highlightState ? (isHighlighted ? 1 : 0.2) : 0.8)
                .attr('data-base-opacity', highlightState ? (isHighlighted ? 1 : 0.2) : 0.8)
                .attr('rx', 2);
            rect.on('mouseenter', function () {
                highlightGridCellFromMark(r, c);
                dimOtherMarks(this as SVGElement);
            });
            rect.on('mouseleave', () => {
                clearGridHighlightFromMark();
                restoreMarkOpacityFromBase();
            });

            applyStroke(rect, getRowStroke(r) || state.colStrokeStyle, 'none', 0);
        }
    }
}

function renderLinePreview(g: any, data: number[][], yScale: any, xScale: any) {
    const cols = getGridColsForChart('line', state.cols);
    const baseStroke = getLineBaseStrokeWidth();
    const strongStroke = getLineHighlightStrokeWidth(baseStroke, 1.6);
    const softStroke = getLineHighlightStrokeWidth(baseStroke, 1.25);
    const highlightedRows = new Set<number>();
    const rowLayers: Array<{ row: number; path: any; dots: any[] }> = [];

    const isRowRelated = (row: number) => {
        if (!highlightState) return true;
        if (highlightState.type === 'row') return highlightState.index === row;
        if (highlightState.type === 'cell') return highlightState.row === row;
        if (highlightState.type === 'col') return true;
        return false;
    };

    for (let r = 0; r < state.rows; r++) {
        const lineData = data[r].slice(0, cols);
        const isRowHighlighted = highlightState?.type === 'row' && highlightState.index === r;
        const isCellOnRow = highlightState?.type === 'cell' && highlightState.row === r;
        const isColMode = highlightState?.type === 'col';
        const relatedRow = isRowRelated(r);
        const activePathStroke = isRowHighlighted || isCellOnRow
            ? strongStroke
            : (isColMode ? softStroke : baseStroke);
        const pathOpacity = highlightState ? (relatedRow ? 1 : 0.2) : 1;

        const line = d3.line()
            .x((_: any, i: number) => xScale(i)!)
            .y((d: number) => yScale(d));

        const rowStroke = getRowStroke(r) || state.colStrokeStyle;
        const baseColor = getSeriesColor(r, 'line');
        const path = g.append('path')
            .attr('class', 'preview-mark')
            .datum(lineData)
            .attr('fill', 'none')
            .attr('stroke', baseColor)
            .attr('stroke-width', activePathStroke)
            .attr('d', line)
            .attr('opacity', pathOpacity)
            .attr('data-base-opacity', pathOpacity);
        if (isRowHighlighted || isCellOnRow) {
            highlightedRows.add(r);
        }
        path.on('mouseenter', function () {
            highlightGridRowFromMark(r);
            dimOtherMarks(this as SVGElement);
        });
        path.on('mouseleave', () => {
            clearGridHighlightFromMark();
            restoreMarkOpacityFromBase();
        });

        applyStrokeExtras(path, rowStroke);

        // Dots
        const rowDots: any[] = [];
        lineData.forEach((val: number, i: number) => {
            const isColHighlighted = highlightState?.type === 'col' && highlightState.index === i;
            const isCellHighlighted = highlightState?.type === 'cell' && highlightState.row === r && highlightState.col === i;
            const dotOpacity = highlightState
                ? (highlightState.type === 'cell'
                    ? (isCellHighlighted ? 1 : 0.2)
                    : (relatedRow || isColHighlighted ? 1 : 0.2))
                : 1;
            const dot = g.append('circle')
                .attr('class', 'preview-mark')
                .attr('cx', xScale(i)!)
                .attr('cy', yScale(val))
                .attr('r', 3)
                .attr('fill', baseColor)
                .attr('opacity', dotOpacity)
                .attr('data-base-opacity', dotOpacity);
            dot.on('mouseenter', function () {
                highlightGridCellFromMark(r, i);
                dimOtherMarks(this as SVGElement);
            });
            dot.on('mouseleave', () => {
                clearGridHighlightFromMark();
                restoreMarkOpacityFromBase();
            });
            applyStroke(dot, rowStroke, 'none', 0);
            rowDots.push(dot);
        });
        rowLayers.push({ row: r, path, dots: rowDots });
    }

    if (highlightedRows.size > 0) {
        rowLayers.forEach((layer) => {
            if (!highlightedRows.has(layer.row)) return;
            layer.path.raise();
            layer.dots.forEach((dot) => dot.raise());
        });
    }
}

function renderStackedPreview(g: any, data: number[][], w: number, h: number, yMin: number, yMax: number) {
    const groups = state.groupStructure;
    const xScale = d3.scaleBand().domain(d3.range(groups.length)).range([0, w]).padding(PREVIEW_OPTS.barPadding);

    const startRow = 1; // Skip "All" row
    const rowCount = state.rows - startRow;
    if (rowCount <= 0) return;

    const innerYScale = d3.scaleLinear().domain([yMin, yMax]).range([h, 0]);

    let flatIdx = 0;
    groups.forEach((barCount, gIdx) => {
        const groupInnerScale = d3.scaleBand().domain(d3.range(barCount)).range([0, xScale.bandwidth()!]).padding(0.05);

        for (let b = 0; b < barCount; b++) {
            let yOffset = h;
            for (let r = startRow; r < state.rows; r++) {
                const val = data[r][flatIdx] || 0;
                const barH = Math.max(0, h - innerYScale(val));

                const isHighlighted = highlightState
                    ? (highlightState.type === 'group' && highlightState.index === gIdx) ||
                    (highlightState.type === 'col' && highlightState.index === flatIdx) ||
                    (highlightState.type === 'row' && highlightState.index === r) ||
                    (highlightState.type === 'cell' && highlightState.row === r && highlightState.col === flatIdx)
                    : false;

                const rect = g.append('rect')
                    .attr('class', 'preview-mark')
                    .attr('x', xScale(gIdx)! + groupInnerScale(b)!)
                    .attr('y', yOffset - barH)
                    .attr('width', groupInnerScale.bandwidth())
                    .attr('height', barH)
                    .attr('fill', getSeriesColor(r - startRow, 'stackedBar'))
                    .attr('opacity', highlightState ? (isHighlighted ? 1 : 0.2) : 0.8)
                    .attr('data-base-opacity', highlightState ? (isHighlighted ? 1 : 0.2) : 0.8)
                    .attr('rx', 1);
                rect.on('mouseenter', function () {
                    highlightGridCellFromMark(r, flatIdx);
                    dimOtherMarks(this as SVGElement);
                });
                rect.on('mouseleave', () => {
                    clearGridHighlightFromMark();
                    restoreMarkOpacityFromBase();
                });

                applyStroke(rect, getRowStroke(r) || state.colStrokeStyle, 'none', 0);
                yOffset -= barH;
            }
            flatIdx++;
        }
    });
}

export function highlightPreview(type: string, index: number) {
    highlightState = { type, index };
    renderPreview();
}

export function highlightPreviewCell(row: number, col: number) {
    highlightState = { type: 'cell', index: -1, row, col };
    renderPreview();
}

export function resetPreviewHighlight() {
    highlightState = null;
    renderPreview();
}
