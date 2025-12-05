import React, { useState, useEffect, useRef } from 'react';
import * as d3 from 'd3';

type ChartType = 'bar' | 'stackedBar' | 'line';
type Mode = 'percent' | 'raw';

interface ChartConfig {
  type: ChartType;
  mode: Mode;
  height?: number;
  horizontalPadding?: number;
  values: number[] | number[][];
}

export default function App() {
  const [jsonInput, setJsonInput] = useState(`{
  "type": "bar",
  "mode": "percent",
  "values": [15, 35, 60, 80]
}`);
  const [log, setLog] = useState('');
  const [isError, setIsError] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // Plugin으로부터 메시지 수신
    window.onmessage = (event) => {
      const msg = event.data.pluginMessage;
      if (!msg) return;
      if (msg.type === 'log') {
        setLog(msg.message);
        setIsError(!msg.ok);
      }
    };
  }, []);

  // JSON이 변경될 때마다 미리보기 업데이트
  useEffect(() => {
    try {
      const config: ChartConfig = JSON.parse(jsonInput);
      renderPreview(config);
      setIsError(false);
    } catch (e) {
      // JSON 파싱 실패 시 미리보기 초기화
      if (svgRef.current) {
        d3.select(svgRef.current).selectAll('*').remove();
      }
    }
  }, [jsonInput]);

  const renderPreview = (config: ChartConfig) => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = 300;
    const height = 150;
    const margin = { top: 10, right: 10, bottom: 20, left: 30 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    switch (config.type) {
      case 'bar':
        renderBarChart(g, config, chartWidth, chartHeight);
        break;
      case 'stackedBar':
        renderStackedBarChart(g, config, chartWidth, chartHeight);
        break;
      case 'line':
        renderLineChart(g, config, chartWidth, chartHeight);
        break;
    }
  };

  const normalizeValues = (
    values: number[],
    mode: Mode,
    maxHeight: number,
  ): number[] => {
    if (mode === 'percent') {
      return values.map(
        (v) => (maxHeight * Math.min(100, Math.max(0, v))) / 100,
      );
    } else {
      const max = Math.max(...values, 0);
      if (max === 0) return values.map(() => 0);
      return values.map((v) => (maxHeight * Math.max(0, v)) / max);
    }
  };

  const renderBarChart = (
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    config: ChartConfig,
    width: number,
    height: number,
  ) => {
    if (!Array.isArray(config.values)) return;
    const values = config.values as number[];

    const normalized = normalizeValues(values, config.mode, height);
    const barWidth = width / values.length;

    g.selectAll('rect')
      .data(normalized)
      .enter()
      .append('rect')
      .attr('x', (_d, i) => i * barWidth + barWidth * 0.1)
      .attr('y', (d) => height - d)
      .attr('width', barWidth * 0.8)
      .attr('height', (d) => d)
      .attr('fill', '#3b82f6')
      .attr('rx', 2);

    // X축
    g.append('line')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('y1', height)
      .attr('y2', height)
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1);
  };

  const renderStackedBarChart = (
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    config: ChartConfig,
    width: number,
    height: number,
  ) => {
    if (!Array.isArray(config.values)) return;
    const values = config.values as number[][];

    const barWidth = width / values.length;
    const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b'];

    values.forEach((segments, barIndex) => {
      if (config.mode === 'percent') {
        let currentY = height;
        segments.forEach((value, segIndex) => {
          const segHeight = (height * Math.min(100, Math.max(0, value))) / 100;
          g.append('rect')
            .attr('x', barIndex * barWidth + barWidth * 0.1)
            .attr('y', currentY - segHeight)
            .attr('width', barWidth * 0.8)
            .attr('height', segHeight)
            .attr('fill', colors[segIndex % colors.length])
            .attr('rx', 2);
          currentY -= segHeight;
        });
      } else {
        const sum = segments.reduce((acc, v) => acc + Math.max(0, v), 0);
        if (sum === 0) return;
        let currentY = height;
        segments.forEach((value, segIndex) => {
          const segHeight = (height * Math.max(0, value)) / sum;
          g.append('rect')
            .attr('x', barIndex * barWidth + barWidth * 0.1)
            .attr('y', currentY - segHeight)
            .attr('width', barWidth * 0.8)
            .attr('height', segHeight)
            .attr('fill', colors[segIndex % colors.length])
            .attr('rx', 2);
          currentY -= segHeight;
        });
      }
    });

    // X축
    g.append('line')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('y1', height)
      .attr('y2', height)
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1);
  };

  const renderLineChart = (
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    config: ChartConfig,
    width: number,
    height: number,
  ) => {
    if (!Array.isArray(config.values)) return;
    const values = config.values as number[];

    const normalized = normalizeValues(values, config.mode, height);
    const xScale = width / (values.length - 1);

    const points = normalized.map((y, i) => ({
      x: i * xScale,
      y: height - y,
    }));

    // 라인 그리기
    const line = d3
      .line<{ x: number; y: number }>()
      .x((d) => d.x)
      .y((d) => d.y)
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', '#3b82f6')
      .attr('stroke-width', 2)
      .attr('d', line);

    // 포인트 그리기
    g.selectAll('circle')
      .data(points)
      .enter()
      .append('circle')
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('r', 4)
      .attr('fill', '#3b82f6')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);

    // X축
    g.append('line')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('y1', height)
      .attr('y2', height)
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1);
  };

  const generateD3Code = (): string => {
    try {
      const config: ChartConfig = JSON.parse(jsonInput);

      const baseCode = `// D3.js Chart Code
// Install: npm install d3
import * as d3 from 'd3';

const data = ${JSON.stringify(config.values, null, 2)};
const config = ${JSON.stringify(
        { type: config.type, mode: config.mode },
        null,
        2,
      )};

// SVG dimensions
const width = 600;
const height = 400;
const margin = { top: 20, right: 20, bottom: 40, left: 40 };
const chartWidth = width - margin.left - margin.right;
const chartHeight = height - margin.top - margin.bottom;

// Create SVG
const svg = d3.select('#chart')
  .append('svg')
  .attr('width', width)
  .attr('height', height);

const g = svg.append('g')
  .attr('transform', \`translate(\${margin.left},\${margin.top})\`);
`;

      let specificCode = '';

      switch (config.type) {
        case 'bar':
          specificCode = generateBarCode(config);
          break;
        case 'stackedBar':
          specificCode = generateStackedBarCode(config);
          break;
        case 'line':
          specificCode = generateLineCode(config);
          break;
      }

      return baseCode + '\n' + specificCode;
    } catch (e) {
      return '// Error: Invalid JSON configuration';
    }
  };

  const generateBarCode = (config: ChartConfig): string => {
    return `// Bar Chart
const values = data;
const barWidth = chartWidth / values.length;

// Normalize data
const maxValue = ${
      config.mode === 'percent' ? '100' : 'Math.max(...values, 0)'
    };
const normalized = values.map(v => 
  (chartHeight * ${
    config.mode === 'percent'
      ? 'Math.min(100, Math.max(0, v))'
      : 'Math.max(0, v)'
  }) / maxValue
);

// Draw bars
g.selectAll('rect')
  .data(normalized)
  .enter()
  .append('rect')
  .attr('x', (d, i) => i * barWidth + barWidth * 0.1)
  .attr('y', d => chartHeight - d)
  .attr('width', barWidth * 0.8)
  .attr('height', d => d)
  .attr('fill', '#3b82f6')
  .attr('rx', 2);

// X-axis
g.append('line')
  .attr('x1', 0)
  .attr('x2', chartWidth)
  .attr('y1', chartHeight)
  .attr('y2', chartHeight)
  .attr('stroke', '#e5e7eb')
  .attr('stroke-width', 2);
`;
  };

  const generateStackedBarCode = (config: ChartConfig): string => {
    return `// Stacked Bar Chart
const values = data;
const barWidth = chartWidth / values.length;
const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b'];

values.forEach((segments, barIndex) => {
  ${
    config.mode === 'percent'
      ? `
  // Percent mode
  let currentY = chartHeight;
  segments.forEach((value, segIndex) => {
    const segHeight = (chartHeight * Math.min(100, Math.max(0, value))) / 100;
    g.append('rect')
      .attr('x', barIndex * barWidth + barWidth * 0.1)
      .attr('y', currentY - segHeight)
      .attr('width', barWidth * 0.8)
      .attr('height', segHeight)
      .attr('fill', colors[segIndex % colors.length])
      .attr('rx', 2);
    currentY -= segHeight;
  });
  `
      : `
  // Raw mode
  const sum = segments.reduce((acc, v) => acc + Math.max(0, v), 0);
  if (sum === 0) return;
  let currentY = chartHeight;
  segments.forEach((value, segIndex) => {
    const segHeight = (chartHeight * Math.max(0, value)) / sum;
    g.append('rect')
      .attr('x', barIndex * barWidth + barWidth * 0.1)
      .attr('y', currentY - segHeight)
      .attr('width', barWidth * 0.8)
      .attr('height', segHeight)
      .attr('fill', colors[segIndex % colors.length])
      .attr('rx', 2);
    currentY -= segHeight;
  });
  `
  }
});

// X-axis
g.append('line')
  .attr('x1', 0)
  .attr('x2', chartWidth)
  .attr('y1', chartHeight)
  .attr('y2', chartHeight)
  .attr('stroke', '#e5e7eb')
  .attr('stroke-width', 2);
`;
  };

  const generateLineCode = (config: ChartConfig): string => {
    return `// Line Chart
const values = data;
const xScale = chartWidth / (values.length - 1);

// Normalize data
const maxValue = ${
      config.mode === 'percent' ? '100' : 'Math.max(...values, 0)'
    };
const normalized = values.map(v => 
  (chartHeight * ${
    config.mode === 'percent'
      ? 'Math.min(100, Math.max(0, v))'
      : 'Math.max(0, v)'
  }) / maxValue
);

const points = normalized.map((y, i) => ({
  x: i * xScale,
  y: chartHeight - y
}));

// Line generator
const line = d3.line()
  .x(d => d.x)
  .y(d => d.y)
  .curve(d3.curveMonotoneX);

// Draw line
g.append('path')
  .datum(points)
  .attr('fill', 'none')
  .attr('stroke', '#3b82f6')
  .attr('stroke-width', 2)
  .attr('d', line);

// Draw points
g.selectAll('circle')
  .data(points)
  .enter()
  .append('circle')
  .attr('cx', d => d.x)
  .attr('cy', d => d.y)
  .attr('r', 4)
  .attr('fill', '#3b82f6')
  .attr('stroke', '#fff')
  .attr('stroke-width', 2);

// X-axis
g.append('line')
  .attr('x1', 0)
  .attr('x2', chartWidth)
  .attr('y1', chartHeight)
  .attr('y2', chartHeight)
  .attr('stroke', '#e5e7eb')
  .attr('stroke-width', 2);
`;
  };

  const handleCopyCode = async () => {
    const code = generateD3Code();
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const handleDownloadCode = () => {
    const code = generateD3Code();
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chart-d3.js';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleApply = () => {
    parent.postMessage(
      {
        pluginMessage: {
          type: 'apply',
          payload: jsonInput,
        },
      },
      '*',
    );
  };

  return (
    <div className="p-3 font-sans text-xs text-gray-900">
      <h1 className="text-sm font-semibold mb-2">Dynamic Chart</h1>

      <div className="text-[11px] text-gray-500 mb-1">
        예시:
        <br />
        {`{ "type": "bar", "mode": "percent", "values": [10, 25, 18] }`}
        <br />
        {`{ "type": "stackedBar", "mode": "raw", "values": [[10,20,15],[5,30,10]] }`}
        <br />
        {`{ "type": "line", "mode": "raw", "values": [99,12,27,48] }`}
      </div>

      <textarea
        value={jsonInput}
        onChange={(e) => setJsonInput(e.target.value)}
        className="w-full h-32 box-border font-mono text-[11px] p-1.5 border border-gray-300 rounded resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="JSON 데이터를 입력하세요"
      />

      {/* D3.js 미리보기 */}
      <div className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded">
        <div className="text-[10px] text-gray-500 mb-1">미리보기:</div>
        <svg
          ref={svgRef}
          width="300"
          height="150"
          className="bg-white rounded"
        />
      </div>

      <button
        type="button"
        onClick={handleApply}
        className="mt-2 w-full px-2.5 py-1.5 text-xs rounded border border-gray-600 bg-gray-900 text-white cursor-pointer hover:bg-gray-800 transition-colors"
      >
        Apply to Selected Graph
      </button>

      {/* Export D3 Code 섹션 */}
      <div className="mt-2 border-t border-gray-200 pt-2">
        <button
          type="button"
          onClick={() => setShowCode(!showCode)}
          className="w-full px-2.5 py-1.5 text-xs rounded border border-blue-500 bg-blue-50 text-blue-700 cursor-pointer hover:bg-blue-100 transition-colors"
        >
          {showCode ? '코드 숨기기' : 'D3.js 코드 보기'}
        </button>

        {showCode && (
          <div className="mt-2">
            <div className="flex gap-1 mb-1">
              <button
                type="button"
                onClick={handleCopyCode}
                className="flex-1 px-2 py-1 text-[11px] rounded border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
              >
                {copiedCode ? '✓ 복사됨!' : '클립보드에 복사'}
              </button>
              <button
                type="button"
                onClick={handleDownloadCode}
                className="flex-1 px-2 py-1 text-[11px] rounded border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
              >
                파일 다운로드
              </button>
            </div>
            <pre className="p-2 bg-gray-900 text-green-400 rounded text-[10px] overflow-auto max-h-[200px] font-mono">
              {generateD3Code()}
            </pre>
          </div>
        )}
      </div>

      {log && (
        <div
          className={`mt-2.5 p-2 rounded text-[11px] font-mono whitespace-pre-wrap max-h-[100px] overflow-auto ${
            isError
              ? 'border border-red-300 bg-red-50 text-red-800'
              : 'border border-gray-200 bg-gray-50 text-gray-700'
          }`}
        >
          {log}
        </div>
      )}
    </div>
  );
}
