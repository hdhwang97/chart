import { state, getTotalStackedCols } from './state';

// ==========================================
// PREVIEW RENDERING (D3-based)
// ==========================================

declare const d3: any; // loaded from CDN in index.html

const PREVIEW_OPTS = {
    margin: { top: 10, right: 10, bottom: 20, left: 25 },
    barPadding: 0.2,
    lineStroke: 2,
    colors: ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb923c']
};

let highlightState: { type: string; index: number } | null = null;

export function renderPreview() {
    const container = document.getElementById('chart-preview-container')!;
    container.innerHTML = '';

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

    const isStacked = state.chartType === 'stackedBar';
    const totalCols = isStacked ? getTotalStackedCols() : state.cols;
    const chartType = state.chartType;

    // Get numeric values
    const numData: number[][] = [];
    for (let r = 0; r < state.rows; r++) {
        const row: number[] = [];
        for (let c = 0; c < totalCols; c++) {
            row.push(Number(state.data[r]?.[c]) || 0);
        }
        numData.push(row);
    }

    // Y domain
    let yMin = Number(document.getElementById('setting-y-min')?.getAttribute('value')) || 0;
    let yMax = 100;

    if (state.dataMode === 'raw') {
        const flat = numData.flat();
        yMax = Math.max(...flat, 1);
        yMin = 0;
    } else {
        yMax = 100;
        yMin = 0;
    }

    const yScale = d3.scaleLinear().domain([yMin, yMax]).range([h, 0]);

    // Y axis
    g.append('g')
        .call(d3.axisLeft(yScale).ticks(state.cellCount).tickSize(-w).tickFormat((d: any) => d))
        .selectAll('line').attr('stroke', '#E5E7EB');

    if (chartType === 'bar') {
        renderBarPreview(g, numData, w, h, yScale);
    } else if (chartType === 'line') {
        renderLinePreview(g, numData, w, h, yScale);
    } else if (isStacked) {
        renderStackedPreview(g, numData, w, h, yMin, yMax);
    }
}

function renderBarPreview(g: any, data: number[][], w: number, h: number, yScale: any) {
    const cols = state.cols;
    const rows = state.rows;
    const xScale = d3.scaleBand().domain(d3.range(cols)).range([0, w]).padding(PREVIEW_OPTS.barPadding);
    const innerScale = d3.scaleBand().domain(d3.range(rows)).range([0, xScale.bandwidth()]).padding(0.05);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const val = data[r][c];
            const barH = Math.max(0, h - yScale(val));
            const isHighlighted = highlightState
                ? (highlightState.type === 'col' && highlightState.index === c) ||
                (highlightState.type === 'row' && highlightState.index === r)
                : false;

            g.append('rect')
                .attr('x', xScale(c)! + innerScale(r)!)
                .attr('y', yScale(val))
                .attr('width', innerScale.bandwidth())
                .attr('height', barH)
                .attr('fill', PREVIEW_OPTS.colors[r % PREVIEW_OPTS.colors.length])
                .attr('opacity', highlightState ? (isHighlighted ? 1 : 0.2) : 0.8)
                .attr('rx', 2);
        }
    }
}

function renderLinePreview(g: any, data: number[][], w: number, h: number, yScale: any) {
    const cols = state.cols;
    const xScale = d3.scalePoint().domain(d3.range(cols)).range([0, w]).padding(0.5);

    for (let r = 0; r < state.rows; r++) {
        const lineData = data[r].slice(0, cols);
        const isRowHighlighted = highlightState?.type === 'row' && highlightState.index === r;

        const line = d3.line()
            .x((_: any, i: number) => xScale(i)!)
            .y((d: number) => yScale(d))
            .curve(d3.curveMonotoneX);

        g.append('path')
            .datum(lineData)
            .attr('fill', 'none')
            .attr('stroke', PREVIEW_OPTS.colors[r % PREVIEW_OPTS.colors.length])
            .attr('stroke-width', state.strokeWidth || PREVIEW_OPTS.lineStroke)
            .attr('d', line)
            .attr('opacity', highlightState ? (isRowHighlighted || !highlightState ? 1 : 0.2) : 0.8);

        // Dots
        lineData.forEach((val: number, i: number) => {
            const isColHighlighted = highlightState?.type === 'col' && highlightState.index === i;
            g.append('circle')
                .attr('cx', xScale(i)!)
                .attr('cy', yScale(val))
                .attr('r', 3)
                .attr('fill', PREVIEW_OPTS.colors[r % PREVIEW_OPTS.colors.length])
                .attr('opacity', highlightState ? (isRowHighlighted || isColHighlighted ? 1 : 0.2) : 0.8);
        });
    }
}

function renderStackedPreview(g: any, data: number[][], w: number, h: number, yMin: number, yMax: number) {
    const groups = state.groupStructure;
    const xScale = d3.scaleBand().domain(d3.range(groups.length)).range([0, w]).padding(PREVIEW_OPTS.barPadding);

    const startRow = 1; // Skip "All" row
    const rowCount = state.rows - startRow;
    if (rowCount <= 0) return;

    // Calculate max sum for scale
    let maxSum = yMax;
    if (state.dataMode === 'raw') {
        let calcMax = 0;
        let flatIdx = 0;
        groups.forEach(barCount => {
            for (let b = 0; b < barCount; b++) {
                let colSum = 0;
                for (let r = startRow; r < state.rows; r++) {
                    colSum += data[r][flatIdx] || 0;
                }
                calcMax = Math.max(calcMax, colSum);
                flatIdx++;
            }
        });
        maxSum = calcMax || 1;
    }

    const innerYScale = d3.scaleLinear().domain([yMin, maxSum]).range([h, 0]);

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
                    (highlightState.type === 'row' && highlightState.index === r)
                    : false;

                g.append('rect')
                    .attr('x', xScale(gIdx)! + groupInnerScale(b)!)
                    .attr('y', yOffset - barH)
                    .attr('width', groupInnerScale.bandwidth())
                    .attr('height', barH)
                    .attr('fill', PREVIEW_OPTS.colors[(r - startRow) % PREVIEW_OPTS.colors.length])
                    .attr('opacity', highlightState ? (isHighlighted ? 1 : 0.2) : 0.8)
                    .attr('rx', 1);

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

export function resetPreviewHighlight() {
    highlightState = null;
    renderPreview();
}
