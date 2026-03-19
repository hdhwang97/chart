import { state, chartTypeUsesMarkFill, getTotalStackedCols, getRowColor, getGridColsForChart, normalizeHexColorInput, resolveBarFillColor } from './state';
import { ui } from './dom';
import type { StrokeStyleSnapshot } from '../shared/style-types';
import type { YLabelFormatMode } from '../shared/y-label-format';
import { formatYLabelValue } from '../shared/y-label-format';
import { getEffectiveYDomain } from './y-range';

// ==========================================
// PREVIEW RENDERING (D3-based)
// ==========================================

declare const d3: any; // loaded from CDN in index.html

export type StylePreviewTarget = 'cell-fill' | 'line-background' | 'cell-top' | 'tab-right' | 'grid' | 'mark' | 'assist-line' | 'column';
export type StylePreviewTargetMeta = {
    seriesIndex?: number;
    colIndex?: number;
};

type PreviewInteractionMode = 'data' | 'style';

export type PreviewRenderOptions = {
    containerId?: string;
    interactionMode?: PreviewInteractionMode;
    onTargetHover?: (target: StylePreviewTarget | null) => void;
    onTargetClick?: (
        target: StylePreviewTarget,
        anchorPoint: { left: number; top: number; right: number; bottom: number },
        meta: StylePreviewTargetMeta
    ) => void;
};

const PREVIEW_OPTS = {
    margin: { top: 8, right: 12, bottom: 6, left: 24 },
    lineStroke: 2,
    colors: ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb923c']
};
const PREVIEW_LAYOUT = {
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
const GRID_MARK_HOVER_CLASS = 'grid-cell-mark-hover';
const MARK_DIM_OPACITY = 0.2;
const MARK_HOVER_OPACITY = 1;
const STYLE_DIM_OPACITY = 0.5;
const DATA_CONTEXT_DIM_OPACITY = 0.15;
const LINE_HIGHLIGHT_MULTIPLIER = 1.5;
const LINE_STYLE_HIT_STROKE_WIDTH = 14;
const LINE_STYLE_HIT_RADIUS = 9;
const TAB_BACKGROUND_OPACITY = 1;

type HighlightState = { type: string; index: number; row?: number; col?: number };
let highlightState: HighlightState | null = null;

function getPreviewMarkElements(containerId = 'chart-preview-container'): SVGElement[] {
    return Array.from(document.querySelectorAll<SVGElement>(`#${containerId} .preview-mark`));
}

function dimOtherMarks(containerId: string, hovered: SVGElement) {
    const marks = getPreviewMarkElements(containerId);
    marks.forEach((mark) => {
        mark.style.opacity = String(MARK_DIM_OPACITY);
    });
    hovered.style.opacity = String(MARK_HOVER_OPACITY);
}

function restoreMarkOpacityFromBase(containerId: string) {
    const marks = getPreviewMarkElements(containerId);
    marks.forEach((mark) => {
        const base = mark.getAttribute('data-base-opacity');
        if (base !== null) {
            mark.style.opacity = base;
        } else {
            mark.style.removeProperty('opacity');
        }
    });
}

function markDataContextLine(node: any) {
    const rawOpacity = node.attr('opacity');
    const baseOpacity = (rawOpacity === null || rawOpacity === undefined || rawOpacity === '')
        ? '1'
        : String(rawOpacity);
    node
        .attr('data-data-base-opacity', baseOpacity)
        .classed('preview-data-context-line', true);
}

function dimDataContextLines(containerId: string) {
    const lines = Array.from(document.querySelectorAll<SVGElement>(`#${containerId} .preview-data-context-line`));
    lines.forEach((line) => {
        const base = Number(line.getAttribute('data-data-base-opacity') || '1');
        const safeBase = Number.isFinite(base) ? base : 1;
        line.style.opacity = String(Math.min(safeBase, DATA_CONTEXT_DIM_OPACITY));
    });
}

function restoreDataContextLineOpacity(containerId: string) {
    const lines = Array.from(document.querySelectorAll<SVGElement>(`#${containerId} .preview-data-context-line`));
    lines.forEach((line) => {
        const base = line.getAttribute('data-data-base-opacity');
        if (base !== null) line.style.opacity = base;
        else line.style.removeProperty('opacity');
    });
}

function clearGridHighlightFromMark() {
    document.querySelectorAll<HTMLInputElement>(`#data-grid input.${GRID_MARK_HOVER_CLASS}`)
        .forEach((cell) => cell.classList.remove(GRID_MARK_HOVER_CLASS));
}

function highlightGridCellFromMark(row: number, col: number) {
    clearGridHighlightFromMark();
    const target = document.querySelector<HTMLInputElement>(`#data-grid input[data-r="${row}"][data-c="${col}"]`);
    if (target) target.classList.add(GRID_MARK_HOVER_CLASS);
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

function getDraftLineStroke(target: 'cellTop' | 'tabRight'): StrokeStyleSnapshot | null {
    const draft = target === 'cellTop' ? state.styleInjectionDraft.cellTop : state.styleInjectionDraft.tabRight;
    return {
        color: draft.color,
        weight: draft.visible ? draft.thickness : 0,
        dashPattern: draft.strokeStyle === 'dash' ? [4, 2] : []
    };
}

function markStyleTarget(node: any, target: StylePreviewTarget, mode: PreviewInteractionMode) {
    if (mode !== 'style') return;
    const rawOpacity = node.attr('opacity');
    const baseOpacity = (rawOpacity === null || rawOpacity === undefined || rawOpacity === '')
        ? '1'
        : String(rawOpacity);
    node
        .attr('data-style-target', target)
        .attr('data-style-base-opacity', baseOpacity)
        .attr('data-style-base-stroke-width', () => {
            const raw = node.attr('stroke-width');
            if (raw === null || raw === undefined || raw === '') return '';
            return String(raw);
        })
        .attr('data-style-base-stroke', () => {
            const raw = node.attr('stroke');
            if (raw === null || raw === undefined) return '';
            return String(raw);
        })
        .attr('data-style-base-stroke-dasharray', () => {
            const raw = node.attr('stroke-dasharray');
            if (raw === null || raw === undefined) return '';
            return String(raw);
        })
        .attr('data-style-base-fill', () => {
            const raw = node.attr('fill');
            if (raw === null || raw === undefined) return '';
            return String(raw);
        })
        .attr('data-style-base-fill-opacity', () => {
            const raw = node.attr('fill-opacity');
            if (raw === null || raw === undefined) return '';
            return String(raw);
        })
        .attr('data-style-base-radius', () => {
            const raw = node.attr('r');
            if (raw === null || raw === undefined) return '';
            return String(raw);
        })
        .classed('preview-style-target', true);
}

function markStyleTargetSeries(node: any, seriesIndex: number, mode: PreviewInteractionMode) {
    if (mode !== 'style') return;
    node.attr('data-style-series-index', String(seriesIndex));
}

function markStyleTargetColumn(node: any, colIndex: number, mode: PreviewInteractionMode) {
    if (mode !== 'style') return;
    node.attr('data-style-col-index', String(colIndex));
}

function addStyleHitLine(
    g: any,
    x1: number,
    x2: number,
    y1: number,
    y2: number,
    target: StylePreviewTarget,
    mode: PreviewInteractionMode
) {
    if (mode !== 'style') return;
    const hitWidth = target === 'tab-right' ? 16 : 10;
    const hit = g.append('line')
        .attr('x1', x1)
        .attr('x2', x2)
        .attr('y1', y1)
        .attr('y2', y2)
        .attr('stroke', 'transparent')
        .attr('stroke-width', hitWidth)
        .attr('opacity', 0.01);
    markStyleTarget(hit, target, mode);
}

function drawGridContainerBorder(g: any, w: number, h: number, mode: PreviewInteractionMode) {
    const grid = state.styleInjectionDraft.gridContainer;
    const isStyleMode = mode === 'style';
    const thickness = grid.visible ? grid.thickness : 0;
    if (thickness <= 0 && !isStyleMode) return;

    const color = grid.color;
    const dashPattern = grid.strokeStyle === 'dash' ? '4,2' : null;
    const addEdge = (x1: number, x2: number, y1: number, y2: number) => {
        const line = g.append('line')
            .attr('x1', x1)
            .attr('x2', x2)
            .attr('y1', y1)
            .attr('y2', y2)
            .attr('stroke', color)
            .attr('stroke-width', thickness);
        if (dashPattern) line.attr('stroke-dasharray', dashPattern);
        markDataContextLine(line);
        markStyleTarget(line, 'grid', mode);
        addStyleHitLine(g, x1, x2, y1, y2, 'grid', mode);
    };

    if (grid.sides.top) addEdge(0, w, 0, 0);
    if (grid.sides.right) addEdge(w, w, 0, h);
    if (grid.sides.bottom) addEdge(0, w, h, h);
    if (grid.sides.left) addEdge(0, 0, 0, h);
}

function getAssistLineStyle() {
    const draft = state.styleInjectionDraft.assistLine;
    return {
        color: draft.color || '#E5E7EB',
        thickness: Math.max(1, Number(draft.thickness) || 1),
        dash: draft.strokeStyle === 'dash'
    };
}

function getSeriesColor(rowIndex: number, chartType: string) {
    if (chartType === 'stackedBar' || chartType === 'stacked') {
        return getRowColor(rowIndex + 1);
    }
    return getRowColor(rowIndex);
}

function getBarPreviewColor(rowIndex: number, colIndex: number): string {
    return resolveBarFillColor(rowIndex, colIndex);
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

function resolveSeriesStyleColor(seriesIndex: number, chartType: string, role: 'fill' | 'stroke') {
    const styles = Array.isArray(state.markStylesDraft) ? state.markStylesDraft : [];
    const idx = role === 'stroke'
        ? resolveStackedSharedStrokeSeriesIndex(seriesIndex, chartType)
        : Math.max(0, Math.floor(seriesIndex));
    const draft = styles[idx];
    if (draft) {
        const fromDraft = normalizeHexColorInput(role === 'stroke' ? draft.strokeColor : draft.fillColor);
        if (fromDraft) return fromDraft;
    }
    return getSeriesColor(idx, chartType);
}

function getMarkDraftStyle(seriesIndex: number) {
    const styles = Array.isArray(state.markStylesDraft) ? state.markStylesDraft : [];
    const fallback = state.styleInjectionDraft.mark;
    const idx = Math.max(0, Math.min(seriesIndex, Math.max(0, styles.length - 1)));
    const source = styles[idx] || fallback;
    return {
        fillColor: normalizeHexColorInput(source.fillColor) || normalizeHexColorInput(fallback.fillColor) || '#3B82F6',
        strokeColor: normalizeHexColorInput(source.strokeColor) || normalizeHexColorInput(fallback.strokeColor) || '#3B82F6',
        lineBackgroundColor: normalizeHexColorInput(source.lineBackgroundColor) || normalizeHexColorInput(source.strokeColor) || normalizeHexColorInput(fallback.strokeColor) || '#3B82F6',
        lineBackgroundOpacity: Number.isFinite(Number(source.lineBackgroundOpacity))
            ? Math.max(0, Math.min(100, Number(source.lineBackgroundOpacity)))
            : Math.max(0, Math.min(100, Number((fallback as any).lineBackgroundOpacity ?? 12))),
        lineBackgroundVisible: typeof source.lineBackgroundVisible === 'boolean'
            ? source.lineBackgroundVisible
            : (typeof (fallback as any).lineBackgroundVisible === 'boolean'
                ? Boolean((fallback as any).lineBackgroundVisible)
                : state.styleInjectionDraft.lineBackground.visible),
        thickness: Number.isFinite(Number(source.thickness)) ? Math.max(0, Number(source.thickness)) : Math.max(0, Number(fallback.thickness) || 1),
        strokeStyle: source.strokeStyle === 'dash' ? 'dash' : 'solid'
    };
}

function drawTabBackgroundLayer(g: any, w: number, h: number, mode: PreviewInteractionMode) {
    const rect = g.append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', w)
        .attr('height', h)
        .attr('fill', state.styleInjectionDraft.cellFill.color)
        .attr('fill-opacity', TAB_BACKGROUND_OPACITY);
    markDataContextLine(rect);
    markStyleTarget(rect, 'cell-fill', mode);
}

function getMarkDraftStroke(seriesIndex: number): StrokeStyleSnapshot {
    const strokeSeriesIndex = resolveStackedSharedStrokeSeriesIndex(seriesIndex, state.chartType);
    const mark = getMarkDraftStyle(strokeSeriesIndex);
    const markFillChart = chartTypeUsesMarkFill(state.chartType);
    const links = Array.isArray(state.markStrokeLinkByIndex) ? state.markStrokeLinkByIndex : [];
    const safeIdx = Math.max(0, Math.min(strokeSeriesIndex, Math.max(0, links.length - 1)));
    const linked = markFillChart ? Boolean(links[safeIdx] ?? true) : false;
    const strokeEnabled = !linked;
    const weight = strokeEnabled
        ? (markFillChart ? Math.max(1, mark.thickness) : mark.thickness)
        : 0;
    return {
        color: mark.strokeColor,
        weight,
        dashPattern: mark.strokeStyle === 'dash' ? [4, 2] : []
    };
}

function buildYTickValues(yMin: number, yMax: number, cellCount: number): number[] {
    const n = Math.max(1, cellCount);
    const step = (yMax - yMin) / n;
    return Array.from({ length: n + 1 }, (_, i) => yMin + (step * i));
}

function resolveXAxisLabels(count: number): string[] {
    return Array.from({ length: count }, (_, i) => {
        const raw = state.colHeaderTitles[i];
        return typeof raw === 'string' && raw.trim() ? raw.trim() : `C${i + 1}`;
    });
}

function buildLegendItems(chartType: string): Array<{ label: string; color: string }> {
    const isStacked = chartType === 'stackedBar' || chartType === 'stacked';
    const startRow = isStacked ? 1 : 0;
    const items: Array<{ label: string; color: string }> = [];

    for (let r = startRow; r < state.rows; r++) {
        const seriesIndex = isStacked ? (r - 1) : r;
        const rawLabel = state.rowHeaderLabels[r];
        const fallback = isStacked ? `R${r}` : `R${r + 1}`;
        const label = typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel.trim() : fallback;
        const color = resolveSeriesStyleColor(seriesIndex, chartType, chartType === 'line' ? 'stroke' : 'fill');
        items.push({ label, color });
    }

    return items;
}

function estimateLegendItemWidth(label: string): number {
    return PREVIEW_LAYOUT.legendSwatchSize
        + PREVIEW_LAYOUT.legendItemGap
        + Math.max(16, Math.ceil(label.length * 5));
}

function measureLegendLayout(chartType: string, availableWidth: number) {
    const items = buildLegendItems(chartType);
    if (items.length === 0) return null;

    const maxWidth = Math.max(40, Math.min(PREVIEW_LAYOUT.legendMaxWidth, availableWidth));
    const positions: Array<{ x: number; y: number; item: { label: string; color: string } }> = [];
    let x = 0;
    let y = 0;
    let rowWidth = 0;
    let blockWidth = 0;

    items.forEach((item) => {
        const itemWidth = estimateLegendItemWidth(item.label);
        const nextX = x === 0 ? itemWidth : x + PREVIEW_LAYOUT.legendColumnGap + itemWidth;
        if (x > 0 && nextX > maxWidth) {
            blockWidth = Math.max(blockWidth, rowWidth);
            x = 0;
            y += PREVIEW_LAYOUT.legendRowHeight + PREVIEW_LAYOUT.legendRowGap;
        }

        positions.push({ x, y, item });
        rowWidth = x + itemWidth;
        blockWidth = Math.max(blockWidth, rowWidth);
        x += itemWidth + PREVIEW_LAYOUT.legendColumnGap;
    });

    const blockHeight = y + PREVIEW_LAYOUT.legendRowHeight;
    return { positions, blockWidth, blockHeight };
}

function renderLegend(svg: any, width: number, top: number, chartType: string) {
    const availableWidth = width - PREVIEW_OPTS.margin.left - PREVIEW_OPTS.margin.right;
    const layout = measureLegendLayout(chartType, availableWidth);
    if (!layout) return;

    const originX = Math.max(PREVIEW_OPTS.margin.left, width - PREVIEW_OPTS.margin.right - layout.blockWidth);
    const group = svg.append('g')
        .attr('transform', `translate(${originX},${top})`);

    layout.positions.forEach(({ x, y, item }) => {
        const itemGroup = group.append('g')
            .attr('transform', `translate(${x},${y})`);

        itemGroup.append('rect')
            .attr('x', 0)
            .attr('y', 1)
            .attr('width', PREVIEW_LAYOUT.legendSwatchSize)
            .attr('height', PREVIEW_LAYOUT.legendSwatchSize)
            .attr('fill', item.color);

        itemGroup.append('text')
            .attr('x', PREVIEW_LAYOUT.legendSwatchSize + PREVIEW_LAYOUT.legendItemGap)
            .attr('y', PREVIEW_LAYOUT.legendRowHeight - 1)
            .attr('font-size', PREVIEW_LAYOUT.legendFontSize)
            .attr('font-family', 'Inter, sans-serif')
            .attr('fill', '#000000')
            .text(item.label);
    });
}

function collectAssistLineValues(chartType: string, numData: number[][], totalCols: number): number[] {
    if (!Array.isArray(numData) || numData.length === 0) return [];
    const values: number[] = [];
    if (chartType === 'stackedBar') {
        for (let r = 1; r < numData.length; r++) {
            for (let c = 0; c < totalCols; c++) {
                const v = Number(numData[r]?.[c]);
                if (Number.isFinite(v)) values.push(v);
            }
        }
    } else {
        for (let r = 0; r < numData.length; r++) {
            for (let c = 0; c < totalCols; c++) {
                const v = Number(numData[r]?.[c]);
                if (Number.isFinite(v)) values.push(v);
            }
        }
    }
    return values;
}

function drawAssistLines(
    g: any,
    yScale: any,
    w: number,
    yMin: number,
    yMax: number,
    chartType: string,
    numData: number[][],
    totalCols: number,
    mode: PreviewInteractionMode
) {
    const isStyleMode = mode === 'style';
    if (!state.assistLineVisible && !isStyleMode) return;
    const enabled = state.assistLineEnabled || { min: false, max: false, avg: false, ctr: false };
    if (!enabled.min && !enabled.max && !enabled.avg && !enabled.ctr) return;

    const values = collectAssistLineValues(chartType, numData, totalCols);
    const hasValues = values.length > 0;
    const min = hasValues ? Math.min(...values) : yMin;
    const max = hasValues ? Math.max(...values) : yMax;
    const avg = hasValues ? (values.reduce((acc, v) => acc + v, 0) / values.length) : ((yMin + yMax) / 2);
    const ctr = (yMin + yMax) / 2;

    const style = getAssistLineStyle();
    const lines: number[] = [];
    if (enabled.min) lines.push(min);
    if (enabled.max) lines.push(max);
    if (enabled.avg) lines.push(avg);
    if (enabled.ctr) lines.push(ctr);

    const layer = g.append('g');
    lines.forEach((value) => {
        const y = yScale(value);
        if (!Number.isFinite(y)) return;
        const renderedWidth = state.assistLineVisible ? style.thickness : 0;
        const renderedOpacity = state.assistLineVisible ? 0.9 : 0.001;
        const line = layer.append('line')
            .attr('x1', 0)
            .attr('x2', w)
            .attr('y1', y)
            .attr('y2', y)
            .attr('stroke', style.color)
            .attr('stroke-width', renderedWidth)
            .attr('opacity', renderedOpacity);
        if (style.dash) line.attr('stroke-dasharray', '4,2');
        markDataContextLine(line);
        markStyleTarget(line, 'assist-line', mode);
        addStyleHitLine(layer, 0, w, y, y, 'assist-line', mode);
    });
    if (isStyleMode) layer.raise();
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

function renderAxes(
    g: any,
    xScale: any,
    yScale: any,
    yTickValues: number[],
    h: number,
    yLabelFormat: YLabelFormatMode,
    xLabels: string[],
    showYLabels: boolean,
    showXLabels: boolean,
    xTickValues?: number[]
) {
    if (showYLabels) {
        const yAxisGroup = g.append('g');
        yTickValues.forEach((tickValue) => {
            const y = yScale(tickValue);
            if (!Number.isFinite(y)) return;
            yAxisGroup.append('text')
                .attr('x', -PREVIEW_LAYOUT.yAxisLabelOffset)
                .attr('y', y)
                .attr('dy', '0.32em')
                .attr('text-anchor', 'end')
                .attr('font-size', PREVIEW_LAYOUT.yAxisFontSize)
                .attr('font-family', 'Inter, sans-serif')
                .attr('fill', '#000000')
                .text(formatYLabelValue(Number(tickValue), yLabelFormat));
        });
    }

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
            .attr('y', h + PREVIEW_LAYOUT.xAxisLabelY)
            .attr('text-anchor', 'middle')
            .attr('font-size', PREVIEW_LAYOUT.xAxisFontSize)
            .attr('font-family', 'Inter, sans-serif')
            .attr('fill', '#000000')
            .text(label);
    });
}

function drawGuides(g: any, w: number, h: number, totalCols: number, yCellCount: number, mode: PreviewInteractionMode, xGuidePositions?: number[]) {
    const tabRightStroke = getDraftLineStroke('tabRight') || state.colStrokeStyle;
    const cellTopStroke = getDraftLineStroke('cellTop');
    const tabRightOpacity = 1;

    if (tabRightStroke && totalCols > 0) {
        if (xGuidePositions && xGuidePositions.length > 0) {
            xGuidePositions
                .filter((x) => x > 0 && x <= w)
                .forEach((x) => {
                    const line = g.append('line')
                        .attr('x1', x)
                        .attr('x2', x)
                        .attr('y1', 0)
                        .attr('y2', h);
                    applyStroke(line, tabRightStroke, '#E5E7EB', 1);
                    line.attr('opacity', tabRightOpacity);
                    markDataContextLine(line);
                    markStyleTarget(line, 'tab-right', mode);
                    addStyleHitLine(g, x, x, 0, h, 'tab-right', mode);
                });
        } else {
            const step = w / totalCols;
            for (let c = 1; c <= totalCols; c++) {
                const line = g.append('line')
                    .attr('x1', c * step)
                    .attr('x2', c * step)
                    .attr('y1', 0)
                    .attr('y2', h);
                applyStroke(line, tabRightStroke, '#E5E7EB', 1);
                line.attr('opacity', tabRightOpacity);
                markDataContextLine(line);
                markStyleTarget(line, 'tab-right', mode);
                addStyleHitLine(g, c * step, c * step, 0, h, 'tab-right', mode);
            }
        }
    }

    if (yCellCount > 1) {
        const step = h / yCellCount;
        for (let r = 1; r < yCellCount; r++) {
            const stroke = cellTopStroke || getRowStroke(r);
            const line = g.append('line')
                .attr('x1', 0)
                .attr('x2', w)
                .attr('y1', r * step)
                .attr('y2', r * step);
            applyStroke(line, stroke || null, '#E5E7EB', 1);
            line.attr('opacity', 1);
            markDataContextLine(line);
            markStyleTarget(line, 'cell-top', mode);
            addStyleHitLine(g, 0, w, r * step, r * step, 'cell-top', mode);
        }
    }
}

function applyStyleTargetHover(container: HTMLElement, target: StylePreviewTarget | null) {
    const nodes = Array.from(container.querySelectorAll<SVGElement>('[data-style-target]'));
    if (nodes.length === 0) return;
    const accentTarget = target === 'grid' || target === 'tab-right' || target === 'cell-top' || target === 'assist-line';

    nodes.forEach((node) => {
        const nodeTarget = node.getAttribute('data-style-target') as StylePreviewTarget | null;
        const base = Number(node.getAttribute('data-style-base-opacity') || '1');
        const safeBase = Number.isFinite(base) ? base : 1;
        const isSelected = Boolean(target && nodeTarget === target);
        if (!target || isSelected) {
            node.style.opacity = String(safeBase);
        } else {
            node.style.opacity = String(Math.min(safeBase, STYLE_DIM_OPACITY));
        }

        const baseStrokeRaw = node.getAttribute('data-style-base-stroke-width');
        const baseStroke = Number(baseStrokeRaw);
        const baseStrokeColor = node.getAttribute('data-style-base-stroke');
        const baseDash = node.getAttribute('data-style-base-stroke-dasharray');
        const baseFill = node.getAttribute('data-style-base-fill');
        const baseFillOpacity = node.getAttribute('data-style-base-fill-opacity');
        const baseRadiusRaw = node.getAttribute('data-style-base-radius');
        const baseRadius = Number(baseRadiusRaw);
        if (baseStrokeColor !== null) {
            node.setAttribute('stroke', baseStrokeColor);
        }
        if (baseDash !== null) {
            if (baseDash) node.setAttribute('stroke-dasharray', baseDash);
            else node.removeAttribute('stroke-dasharray');
        }
        if (baseStrokeRaw && Number.isFinite(baseStroke)) {
            node.setAttribute('stroke-width', String(baseStroke));
        }
        if (baseFill !== null) {
            if (baseFill) node.setAttribute('fill', baseFill);
            else node.removeAttribute('fill');
        }
        if (baseFillOpacity !== null) {
            if (baseFillOpacity) node.setAttribute('fill-opacity', baseFillOpacity);
            else node.removeAttribute('fill-opacity');
        }
        if (baseRadiusRaw && Number.isFinite(baseRadius)) {
            node.setAttribute('r', String(baseRadius));
        }

        if (
            accentTarget
            && nodeTarget === target
            && baseStrokeColor
            && baseStrokeColor !== 'transparent'
            && baseStrokeRaw !== ''
            && Number.isFinite(baseStroke)
        ) {
            const boosted = Math.max(baseStroke + 1, 2);
            node.style.opacity = '1';
            node.setAttribute('stroke', '#EF4444');
            node.setAttribute('stroke-dasharray', '4,2');
            node.setAttribute('stroke-width', String(boosted));
        }

        if (target === 'cell-fill' && nodeTarget === 'cell-fill') {
            node.setAttribute('fill', '#EF4444');
            node.setAttribute('fill-opacity', '0.35');
        }
        if (target === 'line-background' && nodeTarget === 'line-background') {
            node.setAttribute('fill', '#EF4444');
            node.setAttribute('fill-opacity', '0.35');
            node.style.opacity = '1';
        }
        if (target === 'column' && nodeTarget === 'column') {
            node.setAttribute('fill', '#EF4444');
            node.setAttribute('fill-opacity', '0.2');
            node.style.opacity = '1';
        }

        if (
            target === 'mark'
            && nodeTarget === 'mark'
            && baseStrokeColor
            && baseStrokeColor !== 'transparent'
            && baseStrokeRaw !== ''
            && Number.isFinite(baseStroke)
        ) {
            node.setAttribute('stroke-width', String(Math.max(1, baseStroke * LINE_HIGHLIGHT_MULTIPLIER)));
        }
        if (target === 'mark' && nodeTarget === 'mark' && baseRadiusRaw && Number.isFinite(baseRadius)) {
            node.setAttribute('r', String(Math.max(1, baseRadius * LINE_HIGHLIGHT_MULTIPLIER)));
        }
    });
}

function bindStyleInteractions(
    container: HTMLElement,
    onTargetHover?: (target: StylePreviewTarget | null) => void,
    onTargetClick?: (
        target: StylePreviewTarget,
        anchorPoint: { left: number; top: number; right: number; bottom: number },
        meta: StylePreviewTargetMeta
    ) => void
) {
    const svg = container.querySelector('svg');
    if (!svg) return;

    let hoverTarget: StylePreviewTarget | null = null;
    const resolveTarget = (eventTarget: EventTarget | null): StylePreviewTarget | null => {
        if (!(eventTarget instanceof Element)) return null;
        const anchor = eventTarget.closest('[data-style-target]') as Element | null;
        const raw = anchor?.getAttribute('data-style-target') as StylePreviewTarget | null;
        if (!raw) return null;
        return raw;
    };

    const setHover = (next: StylePreviewTarget | null) => {
        if (next === hoverTarget) return;
        hoverTarget = next;
        applyStyleTargetHover(container, next);
        if (onTargetHover) onTargetHover(next);
    };

    svg.addEventListener('mousemove', (event) => {
        setHover(resolveTarget(event.target));
    });

    svg.addEventListener('mouseleave', () => {
        setHover(null);
    });

    svg.addEventListener('click', (event) => {
        const target = resolveTarget(event.target);
        if (!target || !onTargetClick) return;
        const elem = (event.target as Element).closest('[data-style-target]') as Element | null;
        if (!elem) return;
        const rect = elem.getBoundingClientRect();
        const rawSeriesIndex = elem.getAttribute('data-style-series-index');
        const parsed = rawSeriesIndex === null ? NaN : Number(rawSeriesIndex);
        const rawColIndex = elem.getAttribute('data-style-col-index');
        const parsedCol = rawColIndex === null ? NaN : Number(rawColIndex);
        const meta: StylePreviewTargetMeta = Number.isFinite(parsed)
            ? { seriesIndex: Math.max(0, Math.floor(parsed)) }
            : {};
        if (Number.isFinite(parsedCol)) {
            meta.colIndex = Math.max(0, Math.floor(parsedCol));
        }
        onTargetClick(target, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, meta);
        event.stopPropagation();
    });
}

export function renderPreview(options: PreviewRenderOptions = {}) {
    const containerId = options.containerId || 'chart-preview-container';
    const mode: PreviewInteractionMode = options.interactionMode || 'data';
    const container = document.getElementById(containerId);
    if (!container) return;

    if (mode === 'data') {
        clearGridHighlightFromMark();
        restoreMarkOpacityFromBase(containerId);
        restoreDataContextLineOpacity(containerId);
    }

    container.innerHTML = '';
    container.onmouseleave = mode === 'data'
        ? () => {
            clearGridHighlightFromMark();
            restoreMarkOpacityFromBase(containerId);
            restoreDataContextLineOpacity(containerId);
        }
        : null;

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    const svg = d3.select(container).append('svg')
        .attr('width', width)
        .attr('height', height)
        .style('font-family', 'Inter, sans-serif');

    const { margin } = PREVIEW_OPTS;
    const xAxisHeight = state.xAxisLabelsVisible ? PREVIEW_LAYOUT.xAxisHeight : 0;
    const legendLayout = measureLegendLayout(state.chartType, width - margin.left - margin.right);
    const legendHeight = legendLayout ? (PREVIEW_LAYOUT.legendGapTop + legendLayout.blockHeight) : 0;
    const w = Math.max(0, width - margin.left - margin.right);
    const h = Math.max(0, height - margin.top - margin.bottom - xAxisHeight - legendHeight);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const chartType = state.chartType;
    const isStacked = chartType === 'stackedBar';
    const totalCols = isStacked ? getTotalStackedCols() : getGridColsForChart(chartType, state.cols);
    const axisCols = isStacked ? state.groupStructure.length : totalCols;

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
        : d3.scaleBand().domain(d3.range(axisCols)).range([0, w]).padding(0);
    const yTickValues = buildYTickValues(yMin, yMax, state.cellCount);
    const xLabels = resolveXAxisLabels(axisCols);

    drawTabBackgroundLayer(g, w, h, mode);

    renderAxes(g, xAxisScale, yScale, yTickValues, h, state.yLabelFormat, xLabels, state.yAxisVisible, state.xAxisLabelsVisible, lineTickValues);
    const lineGuidePositions = isLine && lineTickValues
        ? lineTickValues.map(idx => xAxisScale(idx))
        : undefined;
    drawGuides(g, w, h, axisCols, state.cellCount, mode, lineGuidePositions);

    const activeHighlight = mode === 'style' ? null : highlightState;
    if (chartType === 'bar') {
        renderBarPreview(g, numData, w, h, yScale, activeHighlight, mode, containerId);
    } else if (chartType === 'line') {
        renderLinePreview(g, numData, yScale, xAxisScale, activeHighlight, mode, containerId);
    } else if (isStacked) {
        renderStackedPreview(g, numData, w, h, yMin, yMax, activeHighlight, mode, containerId);
    }

    drawGridContainerBorder(g, w, h, mode);
    drawAssistLines(g, yScale, w, yMin, yMax, chartType, numData, totalCols, mode);
    renderLegend(svg, width, margin.top + h + xAxisHeight + PREVIEW_LAYOUT.legendGapTop, chartType);

    if (mode === 'style') {
        bindStyleInteractions(container, options.onTargetHover, options.onTargetClick);
        applyStyleTargetHover(container, null);
    }
}

function renderBarPreview(
    g: any,
    data: number[][],
    w: number,
    h: number,
    yScale: any,
    activeHighlight: HighlightState | null,
    mode: PreviewInteractionMode,
    containerId: string
) {
    const cols = state.cols;
    const rows = state.rows;
    const xScale = d3.scaleBand().domain(d3.range(cols)).range([0, w]).padding(0);
    const ratio = normalizeMarkRatio(state.markRatio);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const val = data[r][c];
            const barH = Math.max(0, h - yScale(val));
            const isHighlighted = activeHighlight
                ? (activeHighlight.type === 'col' && activeHighlight.index === c)
                || (activeHighlight.type === 'row' && activeHighlight.index === r)
                || (activeHighlight.type === 'cell' && activeHighlight.row === r && activeHighlight.col === c)
                : false;

            const colX = xScale(c)!;
            const colW = xScale.bandwidth();
            const clusterLayout = computeClusterLayout(colW, ratio, rows);

            const rect = g.append('rect')
                .attr('class', 'preview-mark')
                .attr('x', colX + clusterLayout.clusterOffset + (r * (clusterLayout.subBarW + clusterLayout.gapPx)))
                .attr('y', yScale(val))
                .attr('width', clusterLayout.subBarW)
                .attr('height', barH)
                .attr('fill', getBarPreviewColor(r, c))
                .attr('opacity', activeHighlight ? (isHighlighted ? 1 : 0.2) : 1)
                .attr('data-base-opacity', activeHighlight ? (isHighlighted ? 1 : 0.2) : 1)
                .attr('rx', 2);

            if (mode === 'data') {
                rect.on('mouseenter', function (this: SVGElement) {
                    highlightGridCellFromMark(r, c);
                    dimOtherMarks(containerId, this as SVGElement);
                    dimDataContextLines(containerId);
                });
                rect.on('mouseleave', () => {
                    clearGridHighlightFromMark();
                    restoreMarkOpacityFromBase(containerId);
                    restoreDataContextLineOpacity(containerId);
                });
            } else {
                markStyleTarget(rect, 'mark', mode);
                markStyleTargetSeries(rect, r, mode);
                markStyleTargetColumn(rect, c, mode);
            }

            const resolvedStrokeColor = resolveSeriesStyleColor(r, 'bar', 'stroke');
            const draftStroke = getMarkDraftStroke(r);
            applyStroke(rect, { ...draftStroke, color: resolvedStrokeColor }, resolvedStrokeColor, 0);
            if (mode === 'style') {
                // Capture final stroke attrs after applyStroke so style hover reset won't erase them.
                markStyleTarget(rect, 'mark', mode);
                markStyleTargetSeries(rect, r, mode);
                markStyleTargetColumn(rect, c, mode);
            }
        }
    }
}

function renderLinePreview(
    g: any,
    data: number[][],
    yScale: any,
    xScale: any,
    activeHighlight: HighlightState | null,
    mode: PreviewInteractionMode,
    containerId: string
) {
    const cols = getGridColsForChart('line', state.cols);
    const baseStroke = getLineBaseStrokeWidth();
    const highlightStroke = getLineHighlightStrokeWidth(baseStroke, LINE_HIGHLIGHT_MULTIPLIER);
    const highlightedRows = new Set<number>();
    const rowLayers: Array<{ row: number; path: any; dots: any[] }> = [];

    const isRowRelated = (row: number) => {
        if (!activeHighlight) return true;
        if (activeHighlight.type === 'row') return activeHighlight.index === row;
        if (activeHighlight.type === 'cell') return activeHighlight.row === row;
        if (activeHighlight.type === 'col') return true;
        return false;
    };

    for (let r = 0; r < state.rows; r++) {
        const lineData = data[r].slice(0, cols);
        const isRowHighlighted = activeHighlight?.type === 'row' && activeHighlight.index === r;
        const isCellOnRow = activeHighlight?.type === 'cell' && activeHighlight.row === r;
        const relatedRow = isRowRelated(r);
        const activePathStroke = activeHighlight ? highlightStroke : baseStroke;
        const pathOpacity = activeHighlight ? (relatedRow ? 1 : 0.2) : 1;

        const line = d3.line()
            .x((_: any, i: number) => xScale(i)!)
            .y((d: number) => yScale(d));

        const styleMark = getMarkDraftStyle(r);
        const rowStroke = mode === 'style' ? getMarkDraftStroke(r) : (getRowStroke(r) || state.colStrokeStyle);
        const pathStrokeColor = mode === 'style'
            ? styleMark.strokeColor
            : resolveSeriesStyleColor(r, 'line', 'stroke');
        const pathStrokeWidth = mode === 'style'
            ? Math.max(1, styleMark.thickness)
            : activePathStroke;
        const areaColor = normalizeHexColorInput(styleMark.lineBackgroundColor) || normalizeHexColorInput(styleMark.strokeColor) || pathStrokeColor;
        const areaVisible = Boolean(styleMark.lineBackgroundVisible);
        const yDomain = yScale.domain();
        const yBase = Array.isArray(yDomain) && Number.isFinite(Number(yDomain[0])) ? Number(yDomain[0]) : 0;
        const lineBgOpacityFactor = Math.max(0, Math.min(1, Number(styleMark.lineBackgroundOpacity) / 100));
        const areaOpacity = (activeHighlight ? (relatedRow ? 1 : 0.25) : 1) * lineBgOpacityFactor;
        if (areaVisible) {
            const area = d3.area()
                .x((_: any, i: number) => xScale(i)!)
                .y0(() => yScale(yBase))
                .y1((d: number) => yScale(d));
            const areaPath = g.append('path')
                .attr('class', 'preview-mark')
                .datum(lineData)
                .attr('fill', areaColor)
                .attr('stroke', 'none')
                .attr('d', area)
                .attr('opacity', areaOpacity)
                .attr('data-base-opacity', areaOpacity)
                .style('pointer-events', mode === 'style' ? 'auto' : 'none');
            if (mode === 'style') {
                markStyleTarget(areaPath, 'mark', mode);
                markStyleTargetSeries(areaPath, r, mode);
            }
        }
        const path = g.append('path')
            .attr('class', 'preview-mark')
            .datum(lineData)
            .attr('fill', 'none')
            .attr('stroke', pathStrokeColor)
            .attr('stroke-width', pathStrokeWidth)
            .attr('d', line)
            .attr('opacity', pathOpacity)
            .attr('data-base-opacity', pathOpacity);

        if (isRowHighlighted || isCellOnRow) {
            highlightedRows.add(r);
        }

        if (mode === 'data') {
            path.on('mouseenter', function (this: SVGElement) {
                highlightGridRowFromMark(r);
                dimOtherMarks(containerId, this as SVGElement);
                dimDataContextLines(containerId);
            });
            path.on('mouseleave', () => {
                clearGridHighlightFromMark();
                restoreMarkOpacityFromBase(containerId);
                restoreDataContextLineOpacity(containerId);
            });
        } else {
            markStyleTarget(path, 'mark', mode);
            markStyleTargetSeries(path, r, mode);
            const hitPath = g.append('path')
                .datum(lineData)
                .attr('fill', 'none')
                .attr('stroke', 'transparent')
                .attr('stroke-width', LINE_STYLE_HIT_STROKE_WIDTH)
                .attr('d', line)
                .attr('opacity', 0.01);
            markStyleTarget(hitPath, 'mark', mode);
            markStyleTargetSeries(hitPath, r, mode);
        }

        applyStrokeExtras(path, rowStroke);

        const rowDots: any[] = [];
        // TODO: line preview pointer는 추후 업데이트 예정.
        // pointer 재활성화 시 fill 색상은 line stroke 색상(pathStrokeColor)과 동일하게 유지.
        /*
        lineData.forEach((val: number, i: number) => {
            const isColHighlighted = activeHighlight?.type === 'col' && activeHighlight.index === i;
            const isCellHighlighted = activeHighlight?.type === 'cell' && activeHighlight.row === r && activeHighlight.col === i;
            const dotOpacity = activeHighlight
                ? (activeHighlight.type === 'cell'
                    ? (isCellHighlighted ? 1 : 0.2)
                    : (relatedRow || isColHighlighted ? 1 : 0.2))
                : 1;
            const dotRadius = activeHighlight ? (relatedRow || isColHighlighted ? 3 * LINE_HIGHLIGHT_MULTIPLIER : 3) : 3;
            const dot = g.append('circle')
                .attr('class', 'preview-mark')
                .attr('cx', xScale(i)!)
                .attr('cy', yScale(val))
                .attr('r', dotRadius)
                .attr('fill', pathStrokeColor)
                .attr('opacity', dotOpacity)
                .attr('data-base-opacity', dotOpacity);

            if (mode === 'data') {
                dot.on('mouseenter', function () {
                    highlightGridCellFromMark(r, i);
                    dimOtherMarks(containerId, this as SVGElement);
                    dimDataContextLines(containerId);
                });
                dot.on('mouseleave', () => {
                    clearGridHighlightFromMark();
                    restoreMarkOpacityFromBase(containerId);
                    restoreDataContextLineOpacity(containerId);
                });
            } else {
                markStyleTarget(dot, 'mark', mode);
                markStyleTargetSeries(dot, r, mode);
                const hitDot = g.append('circle')
                    .attr('cx', xScale(i)!)
                    .attr('cy', yScale(val))
                    .attr('r', LINE_STYLE_HIT_RADIUS)
                    .attr('fill', 'transparent')
                    .attr('opacity', 0.01);
                markStyleTarget(hitDot, 'mark', mode);
                markStyleTargetSeries(hitDot, r, mode);
            }

            applyStroke(dot, rowStroke, 'none', 0);
            rowDots.push(dot);
        });
        */
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

function renderStackedPreview(
    g: any,
    data: number[][],
    w: number,
    h: number,
    yMin: number,
    yMax: number,
    activeHighlight: HighlightState | null,
    mode: PreviewInteractionMode,
    containerId: string
) {
    const groups = state.groupStructure;
    const ratio = normalizeMarkRatio(state.markRatio);
    const xScale = d3.scaleBand().domain(d3.range(groups.length)).range([0, w]).padding(0);

    const startRow = 1; // Skip "All" row
    const rowCount = state.rows - startRow;
    if (rowCount <= 0) return;

    const innerYScale = d3.scaleLinear().domain([yMin, yMax]).range([h, 0]);

    let flatIdx = 0;
    groups.forEach((barCount, gIdx) => {
        const cellW = xScale.bandwidth();
        const clusterLayout = computeClusterLayout(cellW, ratio, barCount);

        for (let b = 0; b < barCount; b++) {
            let yOffset = h;
            for (let r = startRow; r < state.rows; r++) {
                const val = data[r][flatIdx] || 0;
                const barH = Math.max(0, h - innerYScale(val));

                const isHighlighted = activeHighlight
                    ? (activeHighlight.type === 'group' && activeHighlight.index === gIdx)
                    || (activeHighlight.type === 'col' && activeHighlight.index === flatIdx)
                    || (activeHighlight.type === 'row' && activeHighlight.index === r)
                    || (activeHighlight.type === 'cell' && activeHighlight.row === r && activeHighlight.col === flatIdx)
                    : false;

                const rect = g.append('rect')
                    .attr('class', 'preview-mark')
                    .attr('x', xScale(gIdx)! + clusterLayout.clusterOffset + (b * (clusterLayout.subBarW + clusterLayout.gapPx)))
                    .attr('y', yOffset - barH)
                    .attr('width', clusterLayout.subBarW)
                    .attr('height', barH)
                    .attr('fill', mode === 'style'
                        ? getMarkDraftStyle(Math.max(0, r - startRow)).fillColor
                        : resolveSeriesStyleColor(Math.max(0, r - startRow), 'stackedBar', 'fill'))
                    .attr('opacity', activeHighlight ? (isHighlighted ? 1 : 0.2) : 1)
                    .attr('data-base-opacity', activeHighlight ? (isHighlighted ? 1 : 0.2) : 1)
                    .attr('rx', 1);

                if (mode === 'data') {
                    rect.on('mouseenter', function (this: SVGElement) {
                        highlightGridCellFromMark(r, flatIdx);
                        dimOtherMarks(containerId, this as SVGElement);
                        dimDataContextLines(containerId);
                    });
                    rect.on('mouseleave', () => {
                        clearGridHighlightFromMark();
                        restoreMarkOpacityFromBase(containerId);
                        restoreDataContextLineOpacity(containerId);
                    });
                } else {
                    markStyleTarget(rect, 'mark', mode);
                    markStyleTargetSeries(rect, Math.max(0, r - startRow), mode);
                }

                const seriesIndex = Math.max(0, r - startRow);
                const draftStroke = getMarkDraftStroke(seriesIndex);
                applyStroke(rect, draftStroke, draftStroke.color || 'none', 0);
                if (mode === 'style') {
                    // Capture final stroke attrs after applyStroke so style hover reset won't erase them.
                    markStyleTarget(rect, 'mark', mode);
                    markStyleTargetSeries(rect, seriesIndex, mode);
                }
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
