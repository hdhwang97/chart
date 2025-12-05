import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

interface CSVRow {
  [key: string]: string;
}

interface ChartConfig {
  width: number;
  height: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  colorScheme: string;
  primaryColor: string;
  showGrid: boolean;
  animationDuration: number;
  fontSize: number;
  fontFamily: string;
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
  showLegend: boolean;
  barPadding: number;
  lineWidth: number;
  pointRadius: number;
  innerRadius: number; // for donut chart
}

function App() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [data, setData] = useState<number[]>([30, 80, 45, 60, 20, 90, 50]);
  const [chartType, setChartType] = useState('bar');
  const [csvData, setCsvData] = useState<CSVRow[]>([]);
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [columns, setColumns] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  const [config, setConfig] = useState<ChartConfig>({
    width: 500,
    height: 350,
    marginTop: 40,
    marginRight: 20,
    marginBottom: 60,
    marginLeft: 60,
    colorScheme: 'schemeCategory10',
    primaryColor: '#4A90E2',
    showGrid: true,
    animationDuration: 750,
    fontSize: 12,
    fontFamily: 'Arial, sans-serif',
    title: 'Chart Title',
    xAxisLabel: 'X Axis',
    yAxisLabel: 'Y Axis',
    showLegend: false,
    barPadding: 0.1,
    lineWidth: 2,
    pointRadius: 4,
    innerRadius: 0,
  });

  const colorSchemes = [
    { value: 'schemeCategory10', label: 'Category 10' },
    { value: 'schemeAccent', label: 'Accent' },
    { value: 'schemeDark2', label: 'Dark 2' },
    { value: 'schemePaired', label: 'Paired' },
    { value: 'schemeSet1', label: 'Set 1' },
    { value: 'schemeSet2', label: 'Set 2' },
    { value: 'schemeSet3', label: 'Set 3' },
    { value: 'schemeTableau10', label: 'Tableau 10' },
  ];

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = d3.csvParse(text);

      if (parsed.length > 0) {
        setCsvData(parsed);
        const cols = Object.keys(parsed[0]);
        setColumns(cols);

        const firstNumericCol = cols.find((col) => {
          return !isNaN(Number(parsed[0][col]));
        });

        if (firstNumericCol) {
          setSelectedColumn(firstNumericCol);
          updateDataFromColumn(parsed, firstNumericCol);
        }
      }
    };
    reader.readAsText(file);
  };

  const updateDataFromColumn = (csvData: CSVRow[], columnName: string) => {
    const numericData = csvData
      .map((row) => Number(row[columnName]))
      .filter((val) => !isNaN(val));
    setData(numericData);
  };

  const handleColumnChange = (columnName: string) => {
    setSelectedColumn(columnName);
    updateDataFromColumn(csvData, columnName);
  };

  const updateConfig = (key: keyof ChartConfig, value: any) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const getColorScale = () => {
    const scheme = (d3 as any)[config.colorScheme];
    return d3.scaleOrdinal(scheme);
  };

  const createBarChart = () => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height, marginTop, marginRight, marginBottom, marginLeft } =
      config;

    svg.attr('width', width).attr('height', height);

    const x = d3
      .scaleBand()
      .domain(data.map((_, i) => i.toString()))
      .range([marginLeft, width - marginRight])
      .padding(config.barPadding);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data) || 100])
      .nice()
      .range([height - marginBottom, marginTop]);

    // 그리드 추가
    if (config.showGrid) {
      svg
        .append('g')
        .attr('class', 'grid')
        .attr('transform', `translate(${marginLeft},0)`)
        .call(
          d3
            .axisLeft(y)
            .tickSize(-(width - marginLeft - marginRight))
            .tickFormat(() => ''),
        )
        .style('stroke-dasharray', '3,3')
        .style('opacity', 0.3);
    }

    // 막대 그리기
    svg
      .append('g')
      .selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', (_, i) => x(i.toString()) || 0)
      .attr('y', height - marginBottom)
      .attr('height', 0)
      .attr('width', x.bandwidth())
      .attr('fill', config.primaryColor)
      .transition()
      .duration(config.animationDuration)
      .attr('y', (d) => y(d))
      .attr('height', (d) => y(0) - y(d));

    // X축
    svg
      .append('g')
      .attr('transform', `translate(0,${height - marginBottom})`)
      .call(d3.axisBottom(x).tickFormat((d) => `#${Number(d) + 1}`))
      .style('font-size', `${config.fontSize}px`)
      .style('font-family', config.fontFamily)
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    // Y축
    svg
      .append('g')
      .attr('transform', `translate(${marginLeft},0)`)
      .call(d3.axisLeft(y))
      .style('font-size', `${config.fontSize}px`)
      .style('font-family', config.fontFamily);

    // X축 레이블
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', height - 5)
      .attr('text-anchor', 'middle')
      .style('font-size', `${config.fontSize + 2}px`)
      .style('font-family', config.fontFamily)
      .text(config.xAxisLabel);

    // Y축 레이블
    svg
      .append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', 15)
      .attr('x', -(height / 2))
      .attr('text-anchor', 'middle')
      .style('font-size', `${config.fontSize + 2}px`)
      .style('font-family', config.fontFamily)
      .text(config.yAxisLabel);

    // 제목
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .style('font-size', `${config.fontSize + 4}px`)
      .style('font-weight', 'bold')
      .style('font-family', config.fontFamily)
      .text(config.title);
  };

  const createLineChart = () => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height, marginTop, marginRight, marginBottom, marginLeft } =
      config;

    svg.attr('width', width).attr('height', height);

    const x = d3
      .scaleLinear()
      .domain([0, data.length - 1])
      .range([marginLeft, width - marginRight]);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data) || 100])
      .nice()
      .range([height - marginBottom, marginTop]);

    // 그리드
    if (config.showGrid) {
      svg
        .append('g')
        .attr('class', 'grid')
        .attr('transform', `translate(${marginLeft},0)`)
        .call(
          d3
            .axisLeft(y)
            .tickSize(-(width - marginLeft - marginRight))
            .tickFormat(() => ''),
        )
        .style('stroke-dasharray', '3,3')
        .style('opacity', 0.3);
    }

    // 라인 생성
    const line = d3
      .line<number>()
      .x((_, i) => x(i))
      .y((d) => y(d))
      .curve(d3.curveMonotoneX); // 부드러운 곡선

    // 라인 그리기
    const path = svg
      .append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', config.primaryColor)
      .attr('stroke-width', config.lineWidth)
      .attr('d', line);

    // 애니메이션
    const totalLength = path.node()?.getTotalLength() || 0;
    path
      .attr('stroke-dasharray', `${totalLength} ${totalLength}`)
      .attr('stroke-dashoffset', totalLength)
      .transition()
      .duration(config.animationDuration)
      .attr('stroke-dashoffset', 0);

    // 점 그리기
    svg
      .append('g')
      .selectAll('circle')
      .data(data)
      .join('circle')
      .attr('cx', (_, i) => x(i))
      .attr('cy', (d) => y(d))
      .attr('r', 0)
      .attr('fill', config.primaryColor)
      .transition()
      .duration(config.animationDuration)
      .delay((_, i) => i * 50)
      .attr('r', config.pointRadius);

    // X축
    svg
      .append('g')
      .attr('transform', `translate(0,${height - marginBottom})`)
      .call(d3.axisBottom(x))
      .style('font-size', `${config.fontSize}px`)
      .style('font-family', config.fontFamily);

    // Y축
    svg
      .append('g')
      .attr('transform', `translate(${marginLeft},0)`)
      .call(d3.axisLeft(y))
      .style('font-size', `${config.fontSize}px`)
      .style('font-family', config.fontFamily);

    // 레이블들
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', height - 5)
      .attr('text-anchor', 'middle')
      .style('font-size', `${config.fontSize + 2}px`)
      .style('font-family', config.fontFamily)
      .text(config.xAxisLabel);

    svg
      .append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', 15)
      .attr('x', -(height / 2))
      .attr('text-anchor', 'middle')
      .style('font-size', `${config.fontSize + 2}px`)
      .style('font-family', config.fontFamily)
      .text(config.yAxisLabel);

    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .style('font-size', `${config.fontSize + 4}px`)
      .style('font-weight', 'bold')
      .style('font-family', config.fontFamily)
      .text(config.title);
  };

  const createPieChart = () => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = config;
    const radius = Math.min(width, height) / 2 - 60;

    svg.attr('width', width).attr('height', height);

    const g = svg
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2 + 20})`);

    const color = getColorScale();

    const pie = d3.pie<number>().value((d) => d);

    const arc = d3
      .arc<d3.PieArcDatum<number>>()
      .innerRadius(config.innerRadius)
      .outerRadius(radius);

    const outerArc = d3
      .arc<d3.PieArcDatum<number>>()
      .innerRadius(radius * 0.9)
      .outerRadius(radius * 0.9);

    const arcs = g
      .selectAll('arc')
      .data(pie(data))
      .join('g')
      .attr('class', 'arc');

    // 파이 조각 그리기
    arcs
      .append('path')
      .attr('d', arc)
      .attr('fill', (_, i) => color(i.toString()))
      .attr('stroke', 'white')
      .attr('stroke-width', 2)
      .transition()
      .duration(config.animationDuration)
      .attrTween('d', function (d) {
        const interpolate = d3.interpolate({ startAngle: 0, endAngle: 0 }, d);
        return function (t) {
          return arc(interpolate(t)) || '';
        };
      });

    // 레이블
    if (config.showLegend) {
      arcs
        .append('text')
        .attr('transform', (d) => `translate(${arc.centroid(d)})`)
        .attr('text-anchor', 'middle')
        .attr('fill', 'white')
        .attr('font-size', `${config.fontSize}px`)
        .attr('font-family', config.fontFamily)
        .attr('font-weight', 'bold')
        .style('opacity', 0)
        .text((d) => d.data.toFixed(1))
        .transition()
        .duration(config.animationDuration)
        .style('opacity', 1);
    }

    // 제목
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .style('font-size', `${config.fontSize + 4}px`)
      .style('font-weight', 'bold')
      .style('font-family', config.fontFamily)
      .text(config.title);
  };

  useEffect(() => {
    if (chartType === 'bar') {
      createBarChart();
    } else if (chartType === 'line') {
      createLineChart();
    } else if (chartType === 'pie') {
      createPieChart();
    }
  }, [data, chartType, config]);

  const sendToFigma = () => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);

    window.parent.postMessage(
      {
        pluginMessage: {
          type: 'DRAW_CHART',
          svg: svgString,
        },
      },
      '*',
    );
  };

  return (
    <div style={{ padding: 20, maxHeight: '100vh', overflowY: 'auto' }}>
      <h3 style={{ marginTop: 0 }}>📊 D3 Chart Generator</h3>

      {/* CSV 업로드 */}
      <div
        style={{
          marginBottom: 15,
          padding: 10,
          border: '2px dashed #ccc',
          borderRadius: 4,
          backgroundColor: '#f9f9f9',
        }}
      >
        <label
          htmlFor="csv-upload"
          style={{ display: 'block', marginBottom: 5, fontWeight: 'bold' }}
        >
          📁 Upload CSV File
        </label>
        <input
          id="csv-upload"
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          style={{ fontSize: 12 }}
        />
      </div>

      {/* 컬럼 선택 */}
      {columns.length > 0 && (
        <div style={{ marginBottom: 15 }}>
          <label
            style={{ display: 'block', marginBottom: 5, fontWeight: 'bold' }}
          >
            Select Column:
          </label>
          <select
            value={selectedColumn}
            onChange={(e) => handleColumnChange(e.target.value)}
            style={{ padding: 5, fontSize: 14, width: '100%' }}
          >
            {columns.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 차트 타입 */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontWeight: 'bold' }}>Chart Type: </label>
        <select
          value={chartType}
          onChange={(e) => setChartType(e.target.value)}
          style={{ marginLeft: 5, padding: 5 }}
        >
          <option value="bar">Bar Chart</option>
          <option value="line">Line Chart</option>
          <option value="pie">Pie Chart</option>
        </select>
      </div>

      {/* 설정 토글 */}
      <button
        onClick={() => setShowSettings(!showSettings)}
        style={{
          marginBottom: 15,
          padding: '8px 12px',
          backgroundColor: '#666',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          width: '100%',
        }}
      >
        {showSettings ? '▼ Hide Settings' : '▶ Show Settings'}
      </button>

      {/* 설정 패널 */}
      {showSettings && (
        <div
          style={{
            marginBottom: 15,
            padding: 15,
            border: '1px solid #ddd',
            borderRadius: 4,
            backgroundColor: '#f9f9f9',
          }}
        >
          <h4 style={{ marginTop: 0 }}>⚙️ Chart Settings</h4>

          {/* 크기 설정 */}
          <div style={{ marginBottom: 10 }}>
            <label
              style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
            >
              Width: {config.width}px
            </label>
            <input
              type="range"
              min="300"
              max="800"
              value={config.width}
              onChange={(e) => updateConfig('width', Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label
              style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
            >
              Height: {config.height}px
            </label>
            <input
              type="range"
              min="200"
              max="600"
              value={config.height}
              onChange={(e) => updateConfig('height', Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          {/* 여백 설정 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div>
              <label style={{ fontSize: 11 }}>
                Top Margin: {config.marginTop}
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={config.marginTop}
                onChange={(e) =>
                  updateConfig('marginTop', Number(e.target.value))
                }
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11 }}>
                Bottom: {config.marginBottom}
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={config.marginBottom}
                onChange={(e) =>
                  updateConfig('marginBottom', Number(e.target.value))
                }
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11 }}>Left: {config.marginLeft}</label>
              <input
                type="range"
                min="0"
                max="100"
                value={config.marginLeft}
                onChange={(e) =>
                  updateConfig('marginLeft', Number(e.target.value))
                }
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11 }}>
                Right: {config.marginRight}
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={config.marginRight}
                onChange={(e) =>
                  updateConfig('marginRight', Number(e.target.value))
                }
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* 색상 설정 */}
          <div style={{ marginBottom: 10 }}>
            <label
              style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
            >
              Primary Color:
            </label>
            <input
              type="color"
              value={config.primaryColor}
              onChange={(e) => updateConfig('primaryColor', e.target.value)}
              style={{ width: '100%', height: 40 }}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label
              style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
            >
              Color Scheme (Pie):
            </label>
            <select
              value={config.colorScheme}
              onChange={(e) => updateConfig('colorScheme', e.target.value)}
              style={{ width: '100%', padding: 5 }}
            >
              {colorSchemes.map((scheme) => (
                <option key={scheme.value} value={scheme.value}>
                  {scheme.label}
                </option>
              ))}
            </select>
          </div>

          {/* 텍스트 설정 */}
          <div style={{ marginBottom: 10 }}>
            <label
              style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
            >
              Title:
            </label>
            <input
              type="text"
              value={config.title}
              onChange={(e) => updateConfig('title', e.target.value)}
              style={{ width: '100%', padding: 5 }}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label
              style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
            >
              X-Axis Label:
            </label>
            <input
              type="text"
              value={config.xAxisLabel}
              onChange={(e) => updateConfig('xAxisLabel', e.target.value)}
              style={{ width: '100%', padding: 5 }}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label
              style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
            >
              Y-Axis Label:
            </label>
            <input
              type="text"
              value={config.yAxisLabel}
              onChange={(e) => updateConfig('yAxisLabel', e.target.value)}
              style={{ width: '100%', padding: 5 }}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label
              style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
            >
              Font Size: {config.fontSize}px
            </label>
            <input
              type="range"
              min="8"
              max="20"
              value={config.fontSize}
              onChange={(e) => updateConfig('fontSize', Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label
              style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
            >
              Font Family:
            </label>
            <select
              value={config.fontFamily}
              onChange={(e) => updateConfig('fontFamily', e.target.value)}
              style={{ width: '100%', padding: 5 }}
            >
              <option value="Arial, sans-serif">Arial</option>
              <option value="Helvetica, sans-serif">Helvetica</option>
              <option value="'Times New Roman', serif">Times New Roman</option>
              <option value="'Courier New', monospace">Courier New</option>
              <option value="Georgia, serif">Georgia</option>
              <option value="Verdana, sans-serif">Verdana</option>
            </select>
          </div>

          {/* 차트별 설정 */}
          {chartType === 'bar' && (
            <div style={{ marginBottom: 10 }}>
              <label
                style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
              >
                Bar Padding: {config.barPadding.toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.05"
                value={config.barPadding}
                onChange={(e) =>
                  updateConfig('barPadding', Number(e.target.value))
                }
                style={{ width: '100%' }}
              />
            </div>
          )}

          {chartType === 'line' && (
            <>
              <div style={{ marginBottom: 10 }}>
                <label
                  style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
                >
                  Line Width: {config.lineWidth}px
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={config.lineWidth}
                  onChange={(e) =>
                    updateConfig('lineWidth', Number(e.target.value))
                  }
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label
                  style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
                >
                  Point Radius: {config.pointRadius}px
                </label>
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={config.pointRadius}
                  onChange={(e) =>
                    updateConfig('pointRadius', Number(e.target.value))
                  }
                  style={{ width: '100%' }}
                />
              </div>
            </>
          )}

          {chartType === 'pie' && (
            <>
              <div style={{ marginBottom: 10 }}>
                <label
                  style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
                >
                  Inner Radius (Donut): {config.innerRadius}px
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={config.innerRadius}
                  onChange={(e) =>
                    updateConfig('innerRadius', Number(e.target.value))
                  }
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={config.showLegend}
                    onChange={(e) =>
                      updateConfig('showLegend', e.target.checked)
                    }
                  />{' '}
                  Show Labels
                </label>
              </div>
            </>
          )}

          {/* 공통 설정 */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={config.showGrid}
                onChange={(e) => updateConfig('showGrid', e.target.checked)}
              />{' '}
              Show Grid
            </label>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label
              style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}
            >
              Animation: {config.animationDuration}ms
            </label>
            <input
              type="range"
              min="0"
              max="2000"
              step="100"
              value={config.animationDuration}
              onChange={(e) =>
                updateConfig('animationDuration', Number(e.target.value))
              }
              style={{ width: '100%' }}
            />
          </div>
        </div>
      )}

      {/* 액션 버튼 */}
      <div style={{ marginBottom: 15 }}>
        <button
          onClick={sendToFigma}
          style={{
            fontSize: 16,
            padding: '10px 20px',
            backgroundColor: '#0066cc',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            width: '100%',
            fontWeight: 'bold',
          }}
        >
          📊 Draw in Figma
        </button>
      </div>

      {/* 차트 프리뷰 */}
      <div
        style={{
          border: '1px solid #ccc',
          borderRadius: 4,
          overflow: 'hidden',
          backgroundColor: 'white',
        }}
      >
        <svg ref={svgRef}></svg>
      </div>

      {/* 데이터 표시 */}
      <div style={{ marginTop: 10, fontSize: 11, color: '#666' }}>
        <strong>Data ({data.length} points):</strong>{' '}
        {data.length > 10
          ? `[${data.slice(0, 10).join(', ')}, ... +${data.length - 10} more]`
          : `[${data.join(', ')}]`}
      </div>
    </div>
  );
}

export default App;
