import { ui } from './dom';
import { state, chartTypeUsesMarkFill, getRowColor, normalizeHexColorInput, getGridColsForChart, resolveBarFillColor } from './state';
import type { RowStrokeStyle, StrokeStyleSnapshot } from '../shared/style-types';
import type { YLabelFormatMode } from '../shared/y-label-format';
import { formatYLabelValue } from '../shared/y-label-format';
import { getEffectiveYDomain } from './y-range';
import { closeStyleItemPopover } from './style-tab';

// ==========================================
// EXPORT TAB — D3 Preview & Code
// ==========================================

declare const d3: any;

let lastStylePayload: any = null;
let dataTabRenderer: (() => void) | null = null;
let styleTabRenderer: (() => void) | null = null;
const EXPORT_LAYOUT = {
    margin: { top: 8, right: 12, bottom: 6, left: 24 },
    xAxisHeight: 20,
    xAxisLabelY: 14,
    xAxisFontSize: 8,
    yAxisFontSize: 8,
    yAxisLabelOffset: 4,
    legendMaxWidth: 183,
    legendSwatchSize: 7,
    legendItemGap: 3,
    legendColumnGap: 12,
    legendRowGap: 6,
    legendFontSize: 8,
    legendGapTop: 6,
    legendRowHeight: 10
} as const;

function buildPreviewStyleFromState() {
    return {
        chartType: state.chartType || 'bar',
        markNum: state.chartType === 'stackedBar' ? state.groupStructure : state.rows,
        yCount: state.cellCount,
        colCount: state.cols,
        xAxisLabelsVisible: state.xAxisLabelsVisible,
        markRatio: state.markRatio,
        rowColors: state.rowColors,
        colColors: state.colHeaderColors,
        colColorEnabled: state.colHeaderColorEnabled,
        markColorSource: state.markColorSource,
        strokeWidth: state.strokeWidth,
        colStrokeStyle: state.colStrokeStyle || null,
        rowStrokeStyles: state.rowStrokeStyles || [],
        previewPlotWidth: state.previewPlotWidth,
        previewPlotHeight: state.previewPlotHeight,
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

function isStackedChartType(chartType: string) {
    return chartType === 'stackedBar' || chartType === 'stacked';
}

function resolveStackedSharedStrokeSeriesIndex(seriesIndex: number, chartType: string): number {
    const safeSeries = Math.max(0, Math.floor(seriesIndex));
    if (!isStackedChartType(chartType)) return safeSeries;
    const styles = Array.isArray(state.markStylesDraft) ? state.markStylesDraft : [];
    if (styles.length === 0) return safeSeries;
    return Math.max(0, Math.min(state.activeMarkStyleIndex, styles.length - 1));
}

function getMarkDraftStyleFromState(seriesIndex: number) {
    const styles = Array.isArray(state.markStylesDraft) ? state.markStylesDraft : [];
    const idx = Math.max(0, Math.floor(seriesIndex));
    const fallback = state.styleInjectionDraft.mark;
    const source = styles[idx] || fallback;
    const fill = normalizeHexColorInput(source.fillColor) || normalizeHexColorInput(fallback.fillColor) || '#3B82F6';
    const stroke = normalizeHexColorInput(source.strokeColor) || normalizeHexColorInput(fallback.strokeColor) || fill;
    const lineBackground = normalizeHexColorInput(source.lineBackgroundColor) || stroke;
    const lineBackgroundOpacity = Number.isFinite(Number(source.lineBackgroundOpacity))
        ? Math.max(0, Math.min(100, Number(source.lineBackgroundOpacity)))
        : 100;
    const lineBackgroundVisible = typeof source.lineBackgroundVisible === 'boolean'
        ? source.lineBackgroundVisible
        : (typeof (fallback as any).lineBackgroundVisible === 'boolean'
            ? Boolean((fallback as any).lineBackgroundVisible)
            : state.styleInjectionDraft.lineBackground.visible);
    const thickness = Number.isFinite(Number(source.thickness))
        ? Math.max(0, Number(source.thickness))
        : Math.max(0, Number(fallback.thickness) || 1);
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : 'solid';
    return { fillColor: fill, strokeColor: stroke, lineBackgroundColor: lineBackground, lineBackgroundOpacity, lineBackgroundVisible, thickness, strokeStyle };
}

function isMarkStrokeEnabled(seriesIndex: number): boolean {
    if (!chartTypeUsesMarkFill(state.chartType)) return true;
    const links = Array.isArray(state.markStrokeLinkByIndex) ? state.markStrokeLinkByIndex : [];
    const strokeSeriesIndex = resolveStackedSharedStrokeSeriesIndex(seriesIndex, state.chartType);
    const safeIdx = Math.max(0, Math.min(strokeSeriesIndex, Math.max(0, links.length - 1)));
    const linked = Boolean(links[safeIdx] ?? true);
    return !linked;
}

function getDraftMarkStrokeFromState(seriesIndex: number, chartType: string, rowColors: string[]): StrokeStyleSnapshot {
    const strokeSeriesIndex = resolveStackedSharedStrokeSeriesIndex(seriesIndex, chartType);
    const draftStyle = getMarkDraftStyleFromState(strokeSeriesIndex);
    const strokeEnabled = isMarkStrokeEnabled(seriesIndex);
    const weight = strokeEnabled
        ? Math.max(1, draftStyle.thickness)
        : 0;
    return {
        color: resolveSeriesStyleColor(rowColors, strokeSeriesIndex, chartType, 'stroke'),
        weight,
        dashPattern: draftStyle.strokeStyle === 'dash' ? [4, 2] : []
    };
}

function resolveSeriesStyleColor(rowColors: string[], rowIndex: number, chartType: string, role: 'fill' | 'stroke') {
    const draft = getMarkDraftStyleFromState(rowIndex);
    const fromDraft = role === 'stroke' ? draft.strokeColor : draft.fillColor;
    if (fromDraft) return fromDraft;
    return getSeriesColor(rowColors, rowIndex, chartType);
}

function getBarSeriesColor(rowIndex: number, colIndex: number) {
    return resolveBarFillColor(rowIndex, colIndex);
}

function buildXAxisLabels(totalCols: number): string[] {
    return Array.from({ length: totalCols }, (_, i) => {
        const raw = state.colHeaderTitles[i];
        return typeof raw === 'string' && raw.trim() ? raw.trim() : `C${i + 1}`;
    });
}

function buildYTickValues(yMin: number, yMax: number, cellCount: number): number[] {
    const n = Math.max(1, cellCount);
    const step = (yMax - yMin) / n;
    return Array.from({ length: n + 1 }, (_, i) => yMin + (step * i));
}

function buildLegendItems(chartType: string, rowColors: string[]): Array<{ label: string; color: string }> {
    const isStacked = chartType === 'stackedBar' || chartType === 'stacked';
    const startRow = isStacked ? 1 : 0;
    const items: Array<{ label: string; color: string }> = [];

    for (let r = startRow; r < state.rows; r++) {
        const seriesIndex = isStacked ? (r - 1) : r;
        const rawLabel = state.rowHeaderLabels[r];
        const fallback = isStacked ? `R${r}` : `R${r + 1}`;
        const label = typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel.trim() : fallback;
        const color = resolveSeriesStyleColor(rowColors, seriesIndex, chartType, chartType === 'line' ? 'stroke' : 'fill');
        items.push({ label, color });
    }

    return items;
}

function estimateLegendItemWidth(label: string): number {
    return EXPORT_LAYOUT.legendSwatchSize
        + EXPORT_LAYOUT.legendItemGap
        + Math.max(16, Math.ceil(label.length * 5));
}

function measureLegendLayout(chartType: string, rowColors: string[], availableWidth: number) {
    const items = buildLegendItems(chartType, rowColors);
    if (items.length === 0) return null;

    const maxWidth = Math.max(40, Math.min(EXPORT_LAYOUT.legendMaxWidth, availableWidth));
    const positions: Array<{ x: number; y: number; item: { label: string; color: string } }> = [];
    let x = 0;
    let y = 0;
    let rowWidth = 0;
    let blockWidth = 0;

    items.forEach((item) => {
        const itemWidth = estimateLegendItemWidth(item.label);
        const nextX = x === 0 ? itemWidth : x + EXPORT_LAYOUT.legendColumnGap + itemWidth;
        if (x > 0 && nextX > maxWidth) {
            blockWidth = Math.max(blockWidth, rowWidth);
            x = 0;
            y += EXPORT_LAYOUT.legendRowHeight + EXPORT_LAYOUT.legendRowGap;
        }

        positions.push({ x, y, item });
        rowWidth = x + itemWidth;
        blockWidth = Math.max(blockWidth, rowWidth);
        x += itemWidth + EXPORT_LAYOUT.legendColumnGap;
    });

    const blockHeight = y + EXPORT_LAYOUT.legendRowHeight;
    return { positions, blockWidth, blockHeight };
}

function renderLegend(svg: any, svgNaturalWidth: number, top: number, chartType: string, rowColors: string[]) {
    const availableWidth = svgNaturalWidth - EXPORT_LAYOUT.margin.left - EXPORT_LAYOUT.margin.right;
    const layout = measureLegendLayout(chartType, rowColors, availableWidth);
    if (!layout) return;

    const originX = Math.max(EXPORT_LAYOUT.margin.left, svgNaturalWidth - EXPORT_LAYOUT.margin.right - layout.blockWidth);
    const group = svg.append('g')
        .attr('transform', `translate(${originX},${top})`);

    layout.positions.forEach(({ x, y, item }) => {
        const itemGroup = group.append('g')
            .attr('transform', `translate(${x},${y})`);

        itemGroup.append('rect')
            .attr('x', 0)
            .attr('y', 1)
            .attr('width', EXPORT_LAYOUT.legendSwatchSize)
            .attr('height', EXPORT_LAYOUT.legendSwatchSize)
            .attr('fill', item.color);

        itemGroup.append('text')
            .attr('x', EXPORT_LAYOUT.legendSwatchSize + EXPORT_LAYOUT.legendItemGap)
            .attr('y', EXPORT_LAYOUT.legendRowHeight - 1)
            .attr('font-size', EXPORT_LAYOUT.legendFontSize)
            .attr('font-family', 'Inter, sans-serif')
            .attr('fill', '#000000')
            .text(item.label);
    });
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
    const cols = isStacked ? state.groupStructure.reduce((a, b) => a + b, 0) : totalCols;
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

function drawTabBackgroundLayer(g: any, w: number, h: number) {
    g.append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', w)
        .attr('height', h)
        .attr('fill', state.styleInjectionDraft.cellFill.color)
        .attr('fill-opacity', 1);
}

function renderAxes(
    g: any,
    xScale: any,
    yScale: any,
    yTickValues: number[],
    h: number,
    yLabelFormat: YLabelFormatMode,
    xLabels: string[],
    showXLabels: boolean,
    xTickValues?: number[]
) {
    const yAxisGroup = g.append('g');
    yTickValues.forEach((tickValue) => {
        const y = yScale(tickValue);
        if (!Number.isFinite(y)) return;
        yAxisGroup.append('text')
            .attr('x', -EXPORT_LAYOUT.yAxisLabelOffset)
            .attr('y', y)
            .attr('dy', '0.32em')
            .attr('text-anchor', 'end')
            .attr('font-size', EXPORT_LAYOUT.yAxisFontSize)
            .attr('font-family', 'Inter, sans-serif')
            .attr('fill', '#000000')
            .text(formatYLabelValue(Number(tickValue), yLabelFormat));
    });

    if (!showXLabels) return;

    const xAxisGroup = g.append('g');
    const positions = xTickValues && xTickValues.length > 0
        ? xTickValues.map((tickValue, i) => ({
            x: xScale(tickValue),
            label: xLabels[i] || `C${i + 1}`
        }))
        : xLabels.map((label, i) => ({
            x: typeof xScale.bandwidth === 'function'
                ? xScale(i)! + (xScale.bandwidth() / 2)
                : xScale(i),
            label
        }));

    positions.forEach(({ x, label }) => {
        if (!Number.isFinite(Number(x))) return;
        xAxisGroup.append('text')
            .attr('x', x)
            .attr('y', h + EXPORT_LAYOUT.xAxisLabelY)
            .attr('text-anchor', 'middle')
            .attr('font-size', EXPORT_LAYOUT.xAxisFontSize)
            .attr('font-family', 'Inter, sans-serif')
            .attr('fill', '#000000')
            .text(label);
    });
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
                line.attr('opacity', 1);
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
                line.attr('opacity', 1);
            }
        }
    }

    if (yCellCount > 1) {
        const step = h / yCellCount;
        for (let r = 1; r < yCellCount; r++) {
            const stroke = cellTopStroke || getRowStroke(r, rowStrokes);
            const line = g.append('line')
                .attr('x1', 0)
                .attr('x2', w)
                .attr('y1', r * step)
                .attr('y2', r * step);
            applyStroke(line, stroke || null, '#E5E7EB', 1);
            line.attr('opacity', 1);
        }
    }
}

export function setDataTabRenderer(renderer: () => void) {
    dataTabRenderer = renderer;
}

export function setStyleTabRenderer(renderer: () => void) {
    styleTabRenderer = renderer;
}

export function switchTab(tab: 'data' | 'style' | 'export') {
    closeStyleItemPopover({ commit: false });
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
        if (styleTabRenderer) styleTabRenderer();
    } else {
        tabDataBtn.className = inactiveClass;
        tabStyleBtn.className = inactiveClass;
        tabExportBtn.className = activeClass;
        step2.classList.remove('active');
        stepStyle.classList.remove('active');
        stepExport.classList.add('active');

        const previewPayload = {
            ...(lastStylePayload || buildPreviewStyleFromState()),
            previewPlotWidth: state.previewPlotWidth,
            previewPlotHeight: state.previewPlotHeight
        };
        renderD3Preview(previewPayload);
        updateCodeOutput(previewPayload);

        // Request style extraction from plugin
        parent.postMessage({ pluginMessage: { type: 'extract_style' } }, '*');
    }
}

export function handleStyleExtracted(payload: any) {
    lastStylePayload = {
        ...payload,
        previewPlotWidth: Number.isFinite(Number(payload?.previewPlotWidth)) ? Number(payload.previewPlotWidth) : state.previewPlotWidth,
        previewPlotHeight: Number.isFinite(Number(payload?.previewPlotHeight)) ? Number(payload.previewPlotHeight) : state.previewPlotHeight
    };
    renderD3Preview(lastStylePayload);
    updateCodeOutput(lastStylePayload);
}

export function refreshExportPreview() {
    const previewPayload = {
        ...(lastStylePayload || buildPreviewStyleFromState()),
        previewPlotWidth: state.previewPlotWidth,
        previewPlotHeight: state.previewPlotHeight
    };
    renderD3Preview(previewPayload);
    updateCodeOutput(previewPayload);
}

function renderD3Preview(style: any) {
    const container = document.getElementById('d3-preview-container')!;
    container.innerHTML = '';

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    const margin = EXPORT_LAYOUT.margin;
    const xAxisLabelsVisible = style?.xAxisLabelsVisible !== undefined
        ? Boolean(style.xAxisLabelsVisible)
        : state.xAxisLabelsVisible;
    const xAxisHeight = xAxisLabelsVisible ? EXPORT_LAYOUT.xAxisHeight : 0;
    const requestedPlotWidth = Number(style?.previewPlotWidth);
    const requestedPlotHeight = Number(style?.previewPlotHeight);
    const w = Number.isFinite(requestedPlotWidth) && requestedPlotWidth > 0
        ? requestedPlotWidth
        : Math.max(0, width - margin.left - margin.right);
    const h = Number.isFinite(requestedPlotHeight) && requestedPlotHeight > 0
        ? requestedPlotHeight
        : Math.max(0, height - margin.top - margin.bottom);
    const chartTypeRaw = style.chartType || 'bar';
    const chartType = chartTypeRaw === 'stacked' ? 'stackedBar' : chartTypeRaw;
    const rowColors = resolveRowColors(style, chartType, Math.max(1, state.rows));
    const legendLayout = measureLegendLayout(chartType, rowColors, margin.left + w + margin.right);
    const legendHeight = legendLayout ? (EXPORT_LAYOUT.legendGapTop + legendLayout.blockHeight) : 0;
    const svgNaturalWidth = Math.max(1, margin.left + w + margin.right);
    const svgNaturalHeight = Math.max(1, margin.top + h + xAxisHeight + legendHeight + margin.bottom);

    const svg = d3.select(container).append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', `0 0 ${svgNaturalWidth} ${svgNaturalHeight}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .style('font-family', 'Inter, sans-serif');

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const colCount = style.colCount || 5;
    const markNum = style.markNum || 1;
    const yCount = style.yCount || 4;
    const cornerRadius = style.cornerRadius || 0;
    const strokeWidth = style.strokeWidth || state.strokeWidth || 2;
    const colStrokeStyle: StrokeStyleSnapshot | null = style.colStrokeStyle || null;
    const rowStrokeStyles: RowStrokeStyle[] = style.rowStrokeStyles || [];
    const normalizeGroupValue = (value: unknown) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 0;
        return Math.max(0, Math.floor(parsed));
    };
    const fallbackGroups = Array.isArray(state.groupStructure)
        ? state.groupStructure.map((value) => normalizeGroupValue(value))
        : [];
    let groups = chartType === 'stackedBar'
        ? (Array.isArray(markNum) ? markNum.map((value: unknown) => normalizeGroupValue(value)) : [Math.max(1, Math.floor(colCount))])
        : [];
    if (chartType === 'stackedBar' && colCount > 0 && groups.length !== colCount) {
        if (groups.length > colCount) {
            groups = groups.slice(0, colCount);
        } else if (fallbackGroups.length === colCount) {
            groups = fallbackGroups.slice(0, colCount);
        }
    }

    const flatCols = chartType === 'stackedBar'
        ? groups.reduce((a: number, b: number) => a + b, 0)
        : (Array.isArray(markNum)
            ? markNum.reduce((a: number, b: number) => a + b, 0)
            : (chartType === 'line' ? getGridColsForChart('line', colCount) : colCount));
    const axisCols = chartType === 'stackedBar' ? groups.length : flatCols;
    const stateData = buildStateNumericData(chartType, flatCols);
    const hasStateData = stateData.length > 0 && stateData.some(row => row.some(v => Number.isFinite(v)));

    // fallback data when UI state is empty
    let sampleData: number[][] = stateData;
    if (!hasStateData) {
        const fallbackRows = chartType === 'stackedBar'
            ? Math.max(2, groups.length + 1)
            : (Array.isArray(markNum) ? Math.max(2, markNum.length + 1) : (typeof markNum === 'number' ? markNum : 1));
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
    const xLabels = buildXAxisLabels(axisCols);

    drawTabBackgroundLayer(g, w, h);
    renderAxes(g, xAxisScale, yScale, yTickValues, h, state.yLabelFormat, xLabels, xAxisLabelsVisible, lineTickValues);
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
                    .attr('fill', getBarSeriesColor(r, c))
                    .attr('rx', cornerRadius);
                const draftStroke = getDraftMarkStrokeFromState(r, 'bar', rowColors);
                applyStroke(rect, draftStroke, draftStroke.color || '#3B82F6', 0);
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
            const area = d3.area()
                .x((_: any, i: number) => xScale(i)!)
                .y0(() => yScale(yDomain.yMin))
                .y1((d: number) => yScale(d));

            const draftStyle = getMarkDraftStyleFromState(r);
            const baseColor = resolveSeriesStyleColor(rowColors, r, 'line', 'fill');
            const draftStroke: StrokeStyleSnapshot = {
                color: resolveSeriesStyleColor(rowColors, r, 'line', 'stroke'),
                weight: Math.max(1, draftStyle.thickness || strokeWidth),
                dashPattern: draftStyle.strokeStyle === 'dash' ? [4, 2] : []
            };
            const areaColor = normalizeHexColorInput(draftStyle.lineBackgroundColor) || normalizeHexColorInput(draftStyle.strokeColor) || baseColor;
            const areaVisible = draftStyle.lineBackgroundVisible !== false;
            if (areaVisible) {
                const areaOpacity = Math.max(0, Math.min(1, Number(draftStyle.lineBackgroundOpacity) / 100));
                g.append('path')
                    .datum(lineData)
                    .attr('fill', areaColor)
                    .attr('stroke', 'none')
                    .attr('opacity', areaOpacity)
                    .attr('d', area);
            }
            const path = g.append('path')
                .datum(lineData)
                .attr('fill', 'none')
                .attr('stroke', draftStroke.color || baseColor)
                .attr('stroke-width', draftStroke.weight || strokeWidth)
                .attr('d', line);
            applyStrokeExtras(path, draftStroke);

            // Preview pointer (line dots) disabled for export tab.
            // lineData.forEach((val: number, i: number) => {
            //     const dot = g.append('circle')
            //         .attr('cx', xScale(i)!)
            //         .attr('cy', yScale(val))
            //         .attr('r', 3)
            //         .attr('fill', baseColor);
            //     if (typeof draftStroke?.opacity === 'number') {
            //         dot.attr('opacity', draftStroke.opacity);
            //     }
            // });
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
                        .attr('fill', resolveSeriesStyleColor(rowColors, r - startRow, 'stackedBar', 'fill'))
                        .attr('rx', cornerRadius);
                    const draftStroke = getDraftMarkStrokeFromState(Math.max(0, r - startRow), 'stackedBar', rowColors);
                    applyStroke(rect, draftStroke, 'none', 0);
                    yOffset -= barH;
                }
                flatIdx++;
            }
        });
    }

    drawGridContainerBorder(g, w, h);
    renderLegend(svg, svgNaturalWidth, margin.top + h + xAxisHeight + EXPORT_LAYOUT.legendGapTop, chartType, rowColors);
}

function updateCodeOutput(style: any) {
    const codeOutput = document.getElementById('d3-code-output') as HTMLTextAreaElement;
    codeOutput.value = generateD3CodeString(style);
}

export function generateD3CodeString(style: any): string {
    const container = document.getElementById('d3-preview-container');
    const containerWidth = container?.clientWidth || 0;
    const containerHeight = container?.clientHeight || 0;
    const chartTypeRaw = style.chartType || 'bar';
    const chartType = chartTypeRaw === 'stacked' ? 'stackedBar' : chartTypeRaw;
    const xAxisLabelsVisible = style?.xAxisLabelsVisible !== undefined
        ? Boolean(style.xAxisLabelsVisible)
        : state.xAxisLabelsVisible;
    const colCount = Number(style.colCount) || 5;
    const yCount = Number(style.yCount) || 4;
    const strokeVal = Number(style.strokeWidth) || state.strokeWidth || 2;
    const radiusVal = Number(style.cornerRadius) || 0;
    const requestedPlotWidth = Number(style?.previewPlotWidth);
    const requestedPlotHeight = Number(style?.previewPlotHeight);
    const plotWidth = Number.isFinite(requestedPlotWidth) && requestedPlotWidth > 0
        ? requestedPlotWidth
        : Math.max(0, containerWidth - EXPORT_LAYOUT.margin.left - EXPORT_LAYOUT.margin.right);
    const plotHeight = Number.isFinite(requestedPlotHeight) && requestedPlotHeight > 0
        ? requestedPlotHeight
        : Math.max(0, containerHeight - EXPORT_LAYOUT.margin.top - EXPORT_LAYOUT.margin.bottom);
    const rowColors = resolveRowColors(style, chartType, Math.max(1, state.rows));
    const markNum = style.markNum || 1;
    const normalizeGroupValue = (value: unknown) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 0;
        return Math.max(0, Math.floor(parsed));
    };
    const fallbackGroups = Array.isArray(state.groupStructure)
        ? state.groupStructure.map((value) => normalizeGroupValue(value))
        : [];
    let groups = chartType === 'stackedBar'
        ? (Array.isArray(markNum) ? markNum.map((value: unknown) => normalizeGroupValue(value)) : [Math.max(1, Math.floor(colCount))])
        : [];
    if (chartType === 'stackedBar' && colCount > 0 && groups.length !== colCount) {
        if (groups.length > colCount) {
            groups = groups.slice(0, colCount);
        } else if (fallbackGroups.length === colCount) {
            groups = fallbackGroups.slice(0, colCount);
        }
    }

    const flatCols = chartType === 'stackedBar'
        ? groups.reduce((a: number, b: number) => a + b, 0)
        : (Array.isArray(markNum)
            ? markNum.reduce((a: number, b: number) => a + b, 0)
            : (chartType === 'line' ? getGridColsForChart('line', colCount) : colCount));
    const axisCols = chartType === 'stackedBar' ? groups.length : flatCols;
    let sampleData = buildStateNumericData(chartType, flatCols);
    const hasStateData = sampleData.length > 0 && sampleData.some(row => row.some(v => Number.isFinite(v)));
    if (!hasStateData) {
        const fallbackRows = chartType === 'stackedBar'
            ? Math.max(2, state.rows || 2)
            : Math.max(1, state.rows || 1);
        sampleData = Array.from({ length: fallbackRows }, (_, rowIndex) => (
            Array.from({ length: Math.max(1, flatCols) }, (_, colIndex) => (
                Math.max(0, 100 - (colIndex * 10) - (rowIndex * 5))
            ))
        ));
    }
    const yDomain = getEffectiveYDomain({
        mode: state.dataMode,
        yMinInput: ui.settingYMin.value,
        yMaxInput: ui.settingYMax.value,
        data: sampleData,
        chartType
    });
    const yTickValues = buildYTickValues(yDomain.yMin, yDomain.yMax, yCount);
    const xLabels = buildXAxisLabels(axisCols);
    const legendItems = buildLegendItems(chartType, rowColors);
    const svgNaturalWidth = Math.max(1, EXPORT_LAYOUT.margin.left + plotWidth + EXPORT_LAYOUT.margin.right);
    const legendLayout = measureLegendLayout(chartType, rowColors, svgNaturalWidth);
    const legendHeight = legendLayout ? (EXPORT_LAYOUT.legendGapTop + legendLayout.blockHeight) : 0;
    const xAxisHeight = xAxisLabelsVisible ? EXPORT_LAYOUT.xAxisHeight : 0;
    const svgNaturalHeight = Math.max(1, EXPORT_LAYOUT.margin.top + plotHeight + xAxisHeight + legendHeight + EXPORT_LAYOUT.margin.bottom);
    const paddingVal = Number((1 - normalizeMarkRatio(style.markRatio)).toFixed(4));
    const yTicks = yTickValues.map((value) => ({
        value,
        label: formatYLabelValue(Number(value), state.yLabelFormat)
    }));
    const legendPositions = legendLayout
        ? legendLayout.positions.map(({ x, y, item }) => ({
            x,
            y,
            label: item.label,
            color: item.color
        }))
        : [];
    const verticalStroke = getDraftLineStroke('tabRight') || style.colStrokeStyle || null;
    const horizontalStroke = getDraftLineStroke('cellTop');
    const gridContainer = {
        color: state.styleInjectionDraft.gridContainer.color,
        weight: state.styleInjectionDraft.gridContainer.visible ? state.styleInjectionDraft.gridContainer.thickness : 0,
        dashPattern: state.styleInjectionDraft.gridContainer.strokeStyle === 'dash' ? [4, 2] : [],
        sides: { ...state.styleInjectionDraft.gridContainer.sides }
    };
    const barSeries = chartType === 'bar'
        ? sampleData.map((_, seriesIndex) => ({
            stroke: getDraftMarkStrokeFromState(seriesIndex, 'bar', rowColors),
            fills: Array.from({ length: Math.max(1, colCount) }, (_, colIndex) => getBarSeriesColor(seriesIndex, colIndex))
        }))
        : [];
    const lineSeries = chartType === 'line'
        ? sampleData.map((_, seriesIndex) => {
            const draftStyle = getMarkDraftStyleFromState(seriesIndex);
            const baseColor = resolveSeriesStyleColor(rowColors, seriesIndex, 'line', 'fill');
            return {
                stroke: {
                    color: resolveSeriesStyleColor(rowColors, seriesIndex, 'line', 'stroke'),
                    weight: Math.max(1, draftStyle.thickness || strokeVal),
                    dashPattern: draftStyle.strokeStyle === 'dash' ? [4, 2] : []
                },
                areaColor: normalizeHexColorInput(draftStyle.lineBackgroundColor) || normalizeHexColorInput(draftStyle.strokeColor) || baseColor,
                areaOpacity: Math.max(0, Math.min(1, Number(draftStyle.lineBackgroundOpacity) / 100)),
                areaVisible: draftStyle.lineBackgroundVisible !== false
            };
        })
        : [];
    const stackedStartRow = sampleData.length > 1 ? 1 : 0;
    const stackedSeries = chartType === 'stackedBar'
        ? Array.from({ length: Math.max(0, sampleData.length - stackedStartRow) }, (_, seriesIndex) => ({
            stroke: getDraftMarkStrokeFromState(seriesIndex, 'stackedBar', rowColors),
            fill: resolveSeriesStyleColor(rowColors, seriesIndex, 'stackedBar', 'fill'),
            rowIndex: seriesIndex + stackedStartRow
        }))
        : [];

    const config = {
        chartType,
        data: sampleData,
        plot: {
            width: plotWidth,
            height: plotHeight
        },
        svg: {
            width: svgNaturalWidth,
            height: svgNaturalHeight,
            preserveAspectRatio: 'xMidYMid meet'
        },
        layout: EXPORT_LAYOUT,
        axis: {
            colCount,
            flatCols,
            yCount,
            xLabels,
            xAxisLabelsVisible,
            yDomain,
            yTicks,
            yLabelFormat: state.yLabelFormat
        },
        legend: {
            items: legendItems,
            positions: legendPositions,
            blockWidth: legendLayout?.blockWidth || 0,
            blockHeight: legendLayout?.blockHeight || 0
        },
        marks: {
            markRatio: normalizeMarkRatio(style.markRatio),
            padding: paddingVal,
            strokeWidth: strokeVal,
            cornerRadius: radiusVal,
            colors: rowColors
        },
        series: {
            bar: barSeries,
            line: lineSeries,
            stacked: stackedSeries
        },
        groups,
        grid: {
            backgroundColor: state.styleInjectionDraft.cellFill.color,
            verticalStroke,
            horizontalStroke,
            container: gridContainer
        },
        strokes: {
            colStroke: style.colStrokeStyle || null,
            rowStrokes: style.rowStrokeStyles || []
        }
    };

    return `// Requires:
// 1. D3 to be loaded globally
// 2. A container element: <div id="chart"></div>
//
// This snippet mirrors the current export-tab preview and is ready to render.
const config = ${JSON.stringify(config, null, 2)};

const root = d3.select('#chart');
if (root.empty()) {
  throw new Error('Missing container: #chart');
}

root.selectAll('*').remove();

const svgEl = root
  .append('svg')
  .attr('viewBox', \`0 0 \${config.svg.width} \${config.svg.height}\`)
  .attr('preserveAspectRatio', config.svg.preserveAspectRatio);

const plot = svgEl.append('g')
  .attr('transform', \`translate(\${config.layout.margin.left},\${config.layout.margin.top})\`);

function resolveStrokeWeight(stroke, fallbackWidth) {
  if (!stroke) return fallbackWidth;
  if (typeof stroke.weight === 'number') return stroke.weight;
  const sideWeights = [
    stroke.weightTop,
    stroke.weightRight,
    stroke.weightBottom,
    stroke.weightLeft
  ].filter((value) => typeof value === 'number');
  if (sideWeights.length > 0) {
    return sideWeights.reduce((sum, value) => sum + value, 0) / sideWeights.length;
  }
  return fallbackWidth;
}

function applyStroke(selection, stroke, fallbackColor, fallbackWidth) {
  selection
    .attr('stroke', stroke && stroke.color ? stroke.color : fallbackColor)
    .attr('stroke-width', resolveStrokeWeight(stroke, fallbackWidth));

  if (stroke && Array.isArray(stroke.dashPattern) && stroke.dashPattern.length > 0) {
    selection.attr('stroke-dasharray', stroke.dashPattern.join(','));
  }
  if (stroke && typeof stroke.opacity === 'number') {
    selection.attr('stroke-opacity', stroke.opacity);
  }
}

function computeClusterLayout(cellWidth, markRatio, markNum) {
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

  return {
    clusterW,
    clusterOffset: (safeCellWidth - clusterW) / 2,
    subBarW: Math.max(1, (clusterW - (gapPx * gaps)) / safeMarkNum),
    gapPx
  };
}

const yScale = d3.scaleLinear()
  .domain([config.axis.yDomain.yMin, config.axis.yDomain.yMax])
  .range([config.plot.height, 0]);

plot.append('rect')
  .attr('x', 0)
  .attr('y', 0)
  .attr('width', config.plot.width)
  .attr('height', config.plot.height)
  .attr('fill', config.grid.backgroundColor);

config.axis.yTicks.forEach((tick) => {
  const y = yScale(tick.value);

  plot.append('text')
    .attr('x', -config.layout.yAxisLabelOffset)
    .attr('y', y)
    .attr('dy', '0.32em')
    .attr('text-anchor', 'end')
    .attr('font-size', config.layout.yAxisFontSize)
    .text(tick.label);
});

if (config.chartType === 'line') {
  const lineGuidePositions = Array.from({ length: config.axis.flatCols }, (_, index) => {
    if (config.axis.flatCols <= 1) return 0;
    return (config.plot.width / (config.axis.flatCols - 1)) * index;
  });
  lineGuidePositions.forEach((x) => {
    const guide = plot.append('line')
      .attr('x1', x)
      .attr('x2', x)
      .attr('y1', 0)
      .attr('y2', config.plot.height);
    applyStroke(guide, config.grid.verticalStroke || config.strokes.colStroke, '#E5E7EB', 1);
  });
} else {
  const step = config.axis.colCount > 0 ? config.plot.width / config.axis.colCount : config.plot.width;
  for (let index = 0; index <= config.axis.colCount; index += 1) {
    const x = step * index;
    const guide = plot.append('line')
      .attr('x1', x)
      .attr('x2', x)
      .attr('y1', 0)
      .attr('y2', config.plot.height);
    applyStroke(guide, config.grid.verticalStroke || config.strokes.colStroke, '#E5E7EB', 1);
  }
}

if (config.axis.yCount > 1) {
  const step = config.plot.height / config.axis.yCount;
  for (let row = 1; row < config.axis.yCount; row += 1) {
    const stroke = config.grid.horizontalStroke
      || (config.strokes.rowStrokes || []).find((item) => item.row === row)?.stroke
      || null;
    const guide = plot.append('line')
      .attr('x1', 0)
      .attr('x2', config.plot.width)
      .attr('y1', row * step)
      .attr('y2', row * step);
    applyStroke(guide, stroke, '#E5E7EB', 1);
  }
}

if (config.axis.xAxisLabelsVisible) {
config.axis.xLabels.forEach((label, index) => {
  let x = 0;
  if (config.chartType === 'line') {
    x = config.axis.xLabels.length <= 1
      ? 0
      : (config.plot.width / (config.axis.xLabels.length - 1)) * index;
  } else {
    const xBand = d3.scaleBand()
      .domain(d3.range(config.axis.colCount))
      .range([0, config.plot.width])
      .padding(0);
    x = xBand(index) + (xBand.bandwidth() / 2);
  }

  plot.append('text')
    .attr('x', x)
    .attr('y', config.plot.height + config.layout.xAxisLabelY)
    .attr('text-anchor', 'middle')
    .attr('font-size', config.layout.xAxisFontSize)
    .text(label);
});
}

if (config.chartType === 'bar') {
  const xScale = d3.scaleBand()
    .domain(d3.range(config.axis.colCount))
    .range([0, config.plot.width])
    .padding(0);

  config.data.forEach((row, seriesIndex) => {
    row.slice(0, config.axis.colCount).forEach((value, colIndex) => {
      const colX = xScale(colIndex);
      const colW = xScale.bandwidth();
      const cluster = computeClusterLayout(colW, config.marks.markRatio, config.data.length);
      const stroke = config.series.bar[seriesIndex]?.stroke || null;
      const fill = config.series.bar[seriesIndex]?.fills?.[colIndex] || config.marks.colors[seriesIndex] || '#3B82F6';
      const rect = plot.append('rect')
        .attr('x', colX + cluster.clusterOffset + (seriesIndex * (cluster.subBarW + cluster.gapPx)))
        .attr('y', yScale(value))
        .attr('width', cluster.subBarW)
        .attr('height', config.plot.height - yScale(value))
        .attr('fill', fill)
        .attr('rx', config.marks.cornerRadius);
      applyStroke(rect, stroke, fill, 0);
    });
  });
} else if (config.chartType === 'line') {
  const xScale = d3.scaleLinear()
    .domain([0, Math.max(1, config.axis.flatCols - 1)])
    .range([0, config.plot.width]);

  config.data.forEach((row, seriesIndex) => {
    const style = config.series.line[seriesIndex];
    const points = row.slice(0, config.axis.flatCols);
    const line = d3.line()
      .x((d, index) => xScale(index))
      .y((d) => yScale(d));
    const area = d3.area()
      .x((d, index) => xScale(index))
      .y0(() => yScale(config.axis.yDomain.yMin))
      .y1((d) => yScale(d));

    if (style && style.areaVisible) {
      plot.append('path')
        .datum(points)
        .attr('fill', style.areaColor)
        .attr('stroke', 'none')
        .attr('opacity', style.areaOpacity)
        .attr('d', area);
    }

    const path = plot.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', style?.stroke?.color || config.marks.colors[seriesIndex] || '#3B82F6')
      .attr('stroke-width', style?.stroke?.weight || config.marks.strokeWidth)
      .attr('d', line);
    applyStroke(path, style?.stroke || null, style?.stroke?.color || '#3B82F6', config.marks.strokeWidth);
  });
} else if (config.chartType === 'stackedBar') {
  const xScale = d3.scaleBand()
    .domain(d3.range(config.groups.length))
    .range([0, config.plot.width])
    .padding(0);

  let flatIndex = 0;
  config.groups.forEach((barCount, groupIndex) => {
    const cellW = xScale.bandwidth();
    const cluster = computeClusterLayout(cellW, config.marks.markRatio, barCount);

    for (let barIndex = 0; barIndex < barCount; barIndex += 1) {
      let yOffset = config.plot.height;

      config.series.stacked.forEach((series) => {
        const value = config.data[series.rowIndex]?.[flatIndex] || 0;
        const barH = Math.max(0, config.plot.height - yScale(value));
        const rect = plot.append('rect')
          .attr('x', xScale(groupIndex) + cluster.clusterOffset + (barIndex * (cluster.subBarW + cluster.gapPx)))
          .attr('y', yOffset - barH)
          .attr('width', cluster.subBarW)
          .attr('height', barH)
          .attr('fill', series.fill)
          .attr('rx', config.marks.cornerRadius);
        applyStroke(rect, series.stroke, 'none', 0);
        yOffset -= barH;
      });

      flatIndex += 1;
    }
  });
}

if (config.grid.container && config.grid.container.weight > 0) {
  const border = config.grid.container;
  if (border.sides.top) {
    const topLine = plot.append('line')
      .attr('x1', 0)
      .attr('x2', config.plot.width)
      .attr('y1', 0)
      .attr('y2', 0);
    applyStroke(topLine, border, border.color, border.weight);
  }
  if (border.sides.right) {
    const rightLine = plot.append('line')
      .attr('x1', config.plot.width)
      .attr('x2', config.plot.width)
      .attr('y1', 0)
      .attr('y2', config.plot.height);
    applyStroke(rightLine, border, border.color, border.weight);
  }
  if (border.sides.bottom) {
    const bottomLine = plot.append('line')
      .attr('x1', 0)
      .attr('x2', config.plot.width)
      .attr('y1', config.plot.height)
      .attr('y2', config.plot.height);
    applyStroke(bottomLine, border, border.color, border.weight);
  }
  if (border.sides.left) {
    const leftLine = plot.append('line')
      .attr('x1', 0)
      .attr('x2', 0)
      .attr('y1', 0)
      .attr('y2', config.plot.height);
    applyStroke(leftLine, border, border.color, border.weight);
  }
}

if (Array.isArray(config.legend.positions) && config.legend.positions.length > 0) {
  const legend = svgEl.append('g')
    .attr(
      'transform',
      'translate('
        + Math.max(config.layout.margin.left, config.svg.width - config.layout.margin.right - config.legend.blockWidth)
        + ','
        + (config.layout.margin.top + config.plot.height + (config.axis.xAxisLabelsVisible ? config.layout.xAxisHeight : 0) + config.layout.legendGapTop)
        + ')'
    );

  config.legend.positions.forEach((item) => {
    const group = legend.append('g')
      .attr('transform', 'translate(' + item.x + ',' + item.y + ')');

    group.append('rect')
      .attr('x', 0)
      .attr('y', 1)
      .attr('width', config.layout.legendSwatchSize)
      .attr('height', config.layout.legendSwatchSize)
      .attr('fill', item.color);

    group.append('text')
      .attr('x', config.layout.legendSwatchSize + config.layout.legendItemGap)
      .attr('y', config.layout.legendRowHeight - 1)
      .attr('font-size', config.layout.legendFontSize)
      .text(item.label);
  });
}`;
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
