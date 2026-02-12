import { ui } from './dom';

// ==========================================
// EXPORT TAB — D3 Preview & Code
// ==========================================

declare const d3: any;

let lastStylePayload: any = null;

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

    const margin = { top: 10, right: 10, bottom: 20, left: 30 };
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

    // Y axis
    g.append('g')
        .call(d3.axisLeft(yScale).ticks(yCount).tickSize(-w))
        .selectAll('line').attr('stroke', '#E5E7EB');

    if (chartType === 'bar') {
        const xScale = d3.scaleBand().domain(d3.range(colCount)).range([0, w]).padding(1 - (style.markRatio || 0.8));
        const innerScale = d3.scaleBand().domain(d3.range(numRows)).range([0, xScale.bandwidth()]).padding(0.05);

        for (let r = 0; r < numRows; r++) {
            for (let c = 0; c < colCount; c++) {
                const val = sampleData[r][c];
                g.append('rect')
                    .attr('x', xScale(c)! + innerScale(r)!)
                    .attr('y', yScale(val))
                    .attr('width', innerScale.bandwidth())
                    .attr('height', h - yScale(val))
                    .attr('fill', colors[r % colors.length])
                    .attr('rx', cornerRadius);
            }
        }
    } else if (chartType === 'line') {
        const xScale = d3.scalePoint().domain(d3.range(colCount)).range([0, w]).padding(0.5);

        for (let r = 0; r < numRows; r++) {
            const lineData = sampleData[r].slice(0, colCount);
            const line = d3.line()
                .x((_: any, i: number) => xScale(i)!)
                .y((d: number) => yScale(d))
                .curve(d3.curveMonotoneX);

            g.append('path')
                .datum(lineData)
                .attr('fill', 'none')
                .attr('stroke', colors[r % colors.length])
                .attr('stroke-width', strokeWidth)
                .attr('d', line);

            lineData.forEach((val: number, i: number) => {
                g.append('circle')
                    .attr('cx', xScale(i)!)
                    .attr('cy', yScale(val))
                    .attr('r', 3)
                    .attr('fill', colors[r % colors.length]);
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

                    g.append('rect')
                        .attr('x', xScale(gIdx)! + innerScale(b)!)
                        .attr('y', yOffset - barH)
                        .attr('width', innerScale.bandwidth())
                        .attr('height', barH)
                        .attr('fill', colors[r % colors.length])
                        .attr('rx', cornerRadius);
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

    return `// D3.js Config Export
// Generated from Figma Plugin
const config = {
  colors: ${colorsJson},
  padding: ${paddingVal},
  strokeWidth: ${strokeVal},
  cornerRadius: ${radiusVal},
  chartType: "${style.chartType || 'bar'}",
  colCount: ${style.colCount || 5},
  yCount: ${style.yCount || 4}
};

// Example: Apply to D3 bars
// d3.selectAll('rect')
//   .attr('fill', (d, i) => config.colors[i % config.colors.length])
//   .attr('rx', config.cornerRadius);
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
