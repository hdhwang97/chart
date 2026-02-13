import { ui } from './dom';
import type { RowStrokeStyle, StrokeStyleSnapshot } from '../shared/style-types';

// ==========================================
// EXPORT TAB — D3 Preview & Code
// ==========================================

declare const d3: any;

let lastStylePayload: any = null;
let dataTabRenderer: (() => void) | null = null;

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

function applyStrokeExtras(selection: any, stroke: StrokeStyleSnapshot | null) {
    if (stroke?.dashPattern && stroke.dashPattern.length > 0) {
        selection.attr('stroke-dasharray', stroke.dashPattern.join(','));
    }
    if (typeof stroke?.opacity === 'number') {
        selection.attr('opacity', stroke.opacity);
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
    if (colStroke && colCount > 0) {
        if (xGuidePositions && xGuidePositions.length > 0) {
            xGuidePositions.forEach((x) => {
                const line = g.append('line')
                    .attr('x1', x)
                    .attr('x2', x)
                    .attr('y1', 0)
                    .attr('y2', h);
                applyStroke(line, colStroke, '#E5E7EB', 1);
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
                applyStroke(line, colStroke, '#E5E7EB', 1);
                line.attr('opacity', 0.35);
            }
        }
    }

    if (yCellCount > 0) {
        const step = h / yCellCount;
        for (let r = 0; r <= yCellCount; r++) {
            const stroke = getRowStroke(r, rowStrokes);
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

export function switchTab(tab: 'data' | 'export') {
    const tabDataBtn = document.getElementById('tab-data')!;
    const tabExportBtn = document.getElementById('tab-export')!;
    const step2 = document.getElementById('step-2')!;
    const stepExport = document.getElementById('step-export')!;

    if (tab === 'data') {
        tabDataBtn.className = 'px-3 py-0.5 text-xs font-semibold rounded bg-white shadow-sm text-primary transition-all border-0 cursor-pointer';
        tabExportBtn.className = 'px-3 py-0.5 text-xs font-semibold rounded text-text-sub hover:text-text bg-transparent transition-all border-0 cursor-pointer';
        step2.classList.add('active');
        stepExport.classList.remove('active');
        if (dataTabRenderer) dataTabRenderer();
    } else {
        tabExportBtn.className = 'px-3 py-0.5 text-xs font-semibold rounded bg-white shadow-sm text-primary transition-all border-0 cursor-pointer';
        tabDataBtn.className = 'px-3 py-0.5 text-xs font-semibold rounded text-text-sub hover:text-text bg-transparent transition-all border-0 cursor-pointer';
        step2.classList.remove('active');
        stepExport.classList.add('active');

        // Request style extraction from plugin
        parent.postMessage({ pluginMessage: { type: 'extract_style' } }, '*');

        if (lastStylePayload) {
            renderD3Preview(lastStylePayload);
            updateCodeOutput(lastStylePayload);
        }
    }
}

export function handleStyleExtracted(payload: any) {
    lastStylePayload = payload;
    renderD3Preview(payload);
    updateCodeOutput(payload);
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

    const colors = style.colors && style.colors.length > 0 ? style.colors : ['#3b82f6'];
    const colCount = style.colCount || 5;
    const markNum = style.markNum || 1;
    const yCount = style.yCount || 4;
    const chartType = style.chartType || 'bar';
    const cornerRadius = style.cornerRadius || 0;
    const strokeWidth = style.strokeWidth || 2;
    const colStrokeStyle: StrokeStyleSnapshot | null = style.colStrokeStyle || null;
    const rowStrokeStyles: RowStrokeStyle[] = style.rowStrokeStyles || [];

    // Generate sample data
    const sampleData: number[][] = [];
    const numRows = Array.isArray(markNum) ? Math.max(2, ...markNum.map(() => 2)) : (typeof markNum === 'number' ? markNum : 1);
    const numCols = Array.isArray(markNum) ? markNum.reduce((a: number, b: number) => a + b, 0) : colCount;

    for (let r = 0; r < numRows; r++) {
        const row = [];
        for (let c = 0; c < numCols; c++) {
            row.push(20 + Math.random() * 60);
        }
        sampleData.push(row);
    }

    const yScale = d3.scaleLinear().domain([0, 100]).range([h, 0]);
    const isLine = chartType === 'line';
    const lineTickValues = isLine
        ? Array.from({ length: numCols }, (_, i) => i)
        : undefined;
    const xAxisScale = isLine
        ? d3.scaleLinear().domain([0, Math.max(1, numCols - 1)]).range([0, w])
        : d3.scaleBand().domain(d3.range(numCols)).range([0, w]).padding(0);
    const yTickValues = buildYTickValues(0, 100, yCount);

    renderAxes(g, xAxisScale, yScale, yTickValues, h, lineTickValues);
    const lineGuidePositions = isLine && lineTickValues
        ? lineTickValues.map(idx => xAxisScale(idx))
        : undefined;
    drawGuides(g, w, h, numCols, yCount, colStrokeStyle, rowStrokeStyles, lineGuidePositions);

    if (chartType === 'bar') {
        const xScale = d3.scaleBand().domain(d3.range(colCount)).range([0, w]).padding(0);
        const ratio = normalizeMarkRatio(style.markRatio);

        for (let r = 0; r < numRows; r++) {
            for (let c = 0; c < colCount; c++) {
                const val = sampleData[r][c];

                const colX = xScale(c)!;
                const colW = xScale.bandwidth();
                const clusterW = colW * ratio;
                const clusterOffset = (colW - clusterW) / 2;
                const innerScale = d3.scaleBand().domain(d3.range(numRows)).range([0, clusterW]).padding(0.12);

                const rect = g.append('rect')
                    .attr('x', colX + clusterOffset + innerScale(r)!)
                    .attr('y', yScale(val))
                    .attr('width', innerScale.bandwidth())
                    .attr('height', h - yScale(val))
                    .attr('fill', colors[r % colors.length])
                    .attr('rx', cornerRadius);
                applyStroke(rect, getRowStroke(r, rowStrokeStyles) || colStrokeStyle, 'none', 0);
            }
        }
    } else if (chartType === 'line') {
        const xScale = d3.scaleLinear().domain([0, Math.max(1, colCount - 1)]).range([0, w]);

        for (let r = 0; r < numRows; r++) {
            const lineData = sampleData[r].slice(0, colCount);
            const line = d3.line()
                .x((_: any, i: number) => xScale(i)!)
                .y((d: number) => yScale(d))
                .curve(d3.curveMonotoneX);

            const rowStroke = getRowStroke(r, rowStrokeStyles) || colStrokeStyle;
            const baseColor = colors[r % colors.length];
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
        const groups = Array.isArray(markNum) ? markNum : [colCount];
        const xScale = d3.scaleBand().domain(d3.range(groups.length)).range([0, w]).padding(1 - (style.markRatio || 0.8));

        let flatIdx = 0;
        groups.forEach((barCount: number, gIdx: number) => {
            const innerScale = d3.scaleBand().domain(d3.range(barCount)).range([0, xScale.bandwidth()!]).padding(0.05);

            for (let b = 0; b < barCount; b++) {
                let yOffset = h;
                for (let r = 0; r < numRows; r++) {
                    const val = sampleData[r][flatIdx] || (20 + Math.random() * 30);
                    const barH = (val / 100) * h;

                    const rect = g.append('rect')
                        .attr('x', xScale(gIdx)! + innerScale(b)!)
                        .attr('y', yOffset - barH)
                        .attr('width', innerScale.bandwidth())
                        .attr('height', barH)
                        .attr('fill', colors[r % colors.length])
                        .attr('rx', cornerRadius);
                    applyStroke(rect, getRowStroke(r, rowStrokeStyles) || colStrokeStyle, 'none', 0);
                    yOffset -= barH;
                }
                flatIdx++;
            }
        });
    }
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
