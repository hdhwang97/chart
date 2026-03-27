import { VARIANT_MAPPING, PLUGIN_DATA_KEYS, MARK_NAME_PATTERNS } from './constants';
import { loadChartData, loadLocalStyleOverrides, saveChartData, saveLocalStyleOverrides } from './data-layer';
import { extractStyleFromNode } from './style';
import { collectColumns, setVariantProperty, setLayerVisibility, applyCells, applyYAxis, applyYAxisEmptyVisibility, applyYAxisVisibility, applyColumnXEmptyVisibility, getChartLegendHeight, getGraphHeight, getPlotAreaWidth, getXEmptyHeight, hasVisibleXEmpty, applyColumnXEmptyAlign, applyColumnXEmptyLabels, applyLegendLabelsFromRowHeaders } from './drawing/shared';
import { applyBar } from './drawing/bar';
import { applyLine, syncFlatLineFillBottomPadding } from './drawing/line';
import { applyStackedBar } from './drawing/stacked';
import { applyAssistLines } from './drawing/assist-line';
import { applyStrokeInjection } from './drawing/stroke-injection';
import { resolveEffectiveYRange } from './drawing/y-range';
import { getOrImportComponent, initPluginUI, inferChartType, inferStructureFromGraph, syncChartOnResize, type SelectionTargetMeta } from './init';
import { normalizeHexColor, rgbToHex, traverse } from './utils';
import { withLoadingOpacity } from './loading';
import { deleteStyleTemplate, loadStyleTemplates, overwriteStyleTemplate, renameStyleTemplate, saveStyleTemplate } from './template-store';
import { PerfTracker, logApplyPerf } from './perf';
import { debugLog } from './log';
import type {
    ColorMode,
    LocalStyleOverrideMask,
    LocalStyleOverrides,
    PaintStyleSelection,
    StyleApplyMode
} from '../shared/style-types';

// ==========================================
// PLUGIN ENTRY POINT
// ==========================================

figma.showUI(__html__, { width: 600, height: 800 });

let selectedChartTargets: SceneNode[] = [];
let activeTargetId: string | null = null;
const trackedTargetSizes = new Map<string, { width: number; height: number }>();
const autoResizeSyncQueue = new Map<string, {
    inFlight: boolean;
    pending: boolean;
    pendingPostPreviewUpdate: boolean;
}>();
type ApplyPolicy = 'template-master' | 'instance-data' | 'default';
const APPLY_CHUNK_SIZE_BAR = 20;
const APPLY_CHUNK_SIZE_STACKED = 20;
const APPLY_CHUNK_SIZE_LINE = 10;
const APPLY_CHUNK_SIZE_STROKE = 10;
let latestApplyRunId = 0;
const targetRevisionMap = new Map<string, number>();
const styleExtractCache = new Map<string, { revision: number; payload: any }>();

function nextTick(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

function bumpTargetRevision(targetId: string) {
    const next = (targetRevisionMap.get(targetId) || 0) + 1;
    targetRevisionMap.set(targetId, next);
    // drop outdated cache entries for the same target
    Array.from(styleExtractCache.keys()).forEach((key) => {
        if (key.startsWith(`${targetId}:`)) styleExtractCache.delete(key);
    });
}

function getTargetRevision(targetId: string): number {
    return targetRevisionMap.get(targetId) || 0;
}

function normalizeMarkRatio(value: unknown): number | null {
    const ratio = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(ratio)) return null;
    return Math.max(0.01, Math.min(1.0, ratio));
}

const DEFAULT_ROW_COLORS = [
    '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#DBEAFE',
    '#34D399', '#FBBF24', '#F87171', '#A78BFA', '#FB923C'
];

function getDefaultRowColor(index: number) {
    return DEFAULT_ROW_COLORS[index % DEFAULT_ROW_COLORS.length];
}

function normalizeRowColors(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeHexColor(item))
        .filter((item): item is string => Boolean(item));
}

function normalizeColorMode(value: unknown): ColorMode {
    return value === 'paint_style' ? 'paint_style' : 'hex';
}

function normalizeColorModes(value: unknown): ColorMode[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => normalizeColorMode(item));
}

function normalizeStyleId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function normalizeStyleIds(value: unknown): Array<string | null> {
    if (!Array.isArray(value)) return [];
    return value.map((item) => normalizeStyleId(item));
}

function resolveRowColorsFromNode(
    node: SceneNode,
    chartType: string,
    rowCount: number,
    fallbackColors?: string[]
) {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_ROW_COLORS);
    let saved: any[] = [];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const fallback = Array.isArray(fallbackColors) ? fallbackColors : [];
    const fallbackRowColors = (chartType === 'stackedBar' || chartType === 'stacked')
        ? [getDefaultRowColor(0), ...fallback]
        : fallback;
    const next: string[] = [];
    for (let i = 0; i < Math.max(1, rowCount); i++) {
        const color =
            normalizeHexColor(saved[i]) ||
            normalizeHexColor(fallbackRowColors[i]) ||
            getDefaultRowColor(i);
        next.push(color);
    }
    return next;
}

function resolveRowColorModesFromNode(node: SceneNode, rowCount: number): ColorMode[] {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_ROW_COLOR_MODES);
    let saved: any[] = [];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const next: ColorMode[] = [];
    for (let i = 0; i < Math.max(1, rowCount); i++) {
        next.push(normalizeColorMode(saved[i]));
    }
    return next;
}

function resolveRowPaintStyleIdsFromNode(node: SceneNode, rowCount: number): Array<string | null> {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_ROW_PAINT_STYLE_IDS);
    let saved: any[] = [];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const next: Array<string | null> = [];
    for (let i = 0; i < Math.max(1, rowCount); i++) {
        next.push(normalizeStyleId(saved[i]));
    }
    return next;
}

function resolveMarkRatioFromNode(node: SceneNode, extractedRatio?: number): number {
    const savedRatioStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_BAR_PADDING);
    const savedRatio = normalizeMarkRatio(savedRatioStr);
    if (savedRatio !== null) return savedRatio;

    const extracted = normalizeMarkRatio(extractedRatio);
    if (extracted !== null) return extracted;

    return 0.8;
}

function normalizeStrokeWidth(value: unknown): number | null {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

function normalizeStyleApplyMode(value: unknown): StyleApplyMode {
    return value === 'data_only' ? 'data_only' : 'include_style';
}

function normalizeLocalStyleOverrideMask(value: unknown): LocalStyleOverrideMask {
    if (!value || typeof value !== 'object') return {};
    const source = value as Record<string, unknown>;
    const next: LocalStyleOverrideMask = {};
    const keys: Array<keyof LocalStyleOverrideMask> = [
        'rowColors', 'rowColorModes', 'rowPaintStyleIds',
        'colColors', 'colColorModes', 'colPaintStyleIds', 'colColorEnabled', 'markColorSource',
        'assistLineVisible', 'assistLineEnabled',
        'cellFillStyle', 'lineBackgroundStyle', 'cellTopStyle', 'tabRightStyle', 'gridContainerStyle',
        'assistLineStyle', 'markStyle', 'markStyles', 'markStrokeEnabledByIndex', 'markStrokeSidesByIndex', 'rowStrokeStyles', 'colStrokeStyle'
    ];
    keys.forEach((key) => {
        if (key in source) next[key] = Boolean(source[key]);
    });
    return next;
}

function hasTruthyMask(mask: LocalStyleOverrideMask): boolean {
    return Object.values(mask).some((value) => Boolean(value));
}

function normalizeLocalStyleOverrides(value: unknown): LocalStyleOverrides {
    if (!value || typeof value !== 'object') return {};
    const source = value as LocalStyleOverrides;
    const next: LocalStyleOverrides = {};
    if (Array.isArray(source.rowColors)) next.rowColors = normalizeRowColors(source.rowColors);
    if (Array.isArray(source.rowColorModes)) next.rowColorModes = normalizeColorModes(source.rowColorModes);
    if (Array.isArray(source.rowPaintStyleIds)) next.rowPaintStyleIds = normalizeStyleIds(source.rowPaintStyleIds);
    if (Array.isArray(source.colColors)) next.colColors = normalizeRowColors(source.colColors);
    if (Array.isArray(source.colColorModes)) next.colColorModes = normalizeColorModes(source.colColorModes);
    if (Array.isArray(source.colPaintStyleIds)) next.colPaintStyleIds = normalizeStyleIds(source.colPaintStyleIds);
    if (Array.isArray(source.colColorEnabled)) next.colColorEnabled = source.colColorEnabled.map((v) => Boolean(v));
    if (source.markColorSource === 'col' || source.markColorSource === 'row') next.markColorSource = source.markColorSource;
    if (typeof source.assistLineVisible === 'boolean') next.assistLineVisible = source.assistLineVisible;
    if (source.assistLineEnabled && typeof source.assistLineEnabled === 'object') {
        next.assistLineEnabled = {
            min: Boolean(source.assistLineEnabled.min),
            max: Boolean(source.assistLineEnabled.max),
            avg: Boolean(source.assistLineEnabled.avg),
            ctr: Boolean(source.assistLineEnabled.ctr)
        };
    }
    if (source.cellFillStyle && typeof source.cellFillStyle === 'object') next.cellFillStyle = source.cellFillStyle;
    if (source.lineBackgroundStyle && typeof source.lineBackgroundStyle === 'object') next.lineBackgroundStyle = source.lineBackgroundStyle;
    if (source.cellTopStyle && typeof source.cellTopStyle === 'object') next.cellTopStyle = source.cellTopStyle;
    if (source.tabRightStyle && typeof source.tabRightStyle === 'object') next.tabRightStyle = source.tabRightStyle;
    if (source.gridContainerStyle && typeof source.gridContainerStyle === 'object') next.gridContainerStyle = source.gridContainerStyle;
    if (source.assistLineStyle && typeof source.assistLineStyle === 'object') next.assistLineStyle = source.assistLineStyle;
    if (source.markStyle && typeof source.markStyle === 'object') next.markStyle = source.markStyle;
    if (Array.isArray(source.markStyles)) next.markStyles = source.markStyles;
    if (Array.isArray(source.markStrokeEnabledByIndex)) {
        next.markStrokeEnabledByIndex = source.markStrokeEnabledByIndex.map((v) => Boolean(v));
    }
    if (Array.isArray(source.markStrokeSidesByIndex)) {
        next.markStrokeSidesByIndex = source.markStrokeSidesByIndex
            .map((item) => item && typeof item === 'object'
                ? {
                    top: (item as any).top !== false,
                    left: (item as any).left !== false,
                    right: (item as any).right !== false
                }
                : null)
            .filter((item): item is { top: boolean; left: boolean; right: boolean } => Boolean(item));
    }
    if (Array.isArray(source.rowStrokeStyles)) next.rowStrokeStyles = source.rowStrokeStyles;
    if (source.colStrokeStyle && typeof source.colStrokeStyle === 'object') next.colStrokeStyle = source.colStrokeStyle;
    return next;
}

function isStackedType(chartType: string): boolean {
    return chartType === 'stackedBar' || chartType === 'stacked';
}

function resolveStrokeWidthForUi(node: SceneNode, requestedStrokeWidth?: unknown, extractedStrokeWidth?: unknown): number {
    const requested = normalizeStrokeWidth(requestedStrokeWidth);
    if (requested !== null) return requested;

    const saved = normalizeStrokeWidth(node.getPluginData(PLUGIN_DATA_KEYS.LAST_STROKE_WIDTH));
    if (saved !== null) return saved;

    const extracted = normalizeStrokeWidth(extractedStrokeWidth);
    if (extracted !== null) return extracted;

    return 2;
}

function resolveBarLabelVisibleFromNode(node: SceneNode): boolean {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_BAR_LABEL_VISIBLE);
    if (!raw) return true;
    return raw !== 'false';
}

function resolveBarLabelSourceFromNode(node: SceneNode): 'row' | 'y' {
    return node.getPluginData(PLUGIN_DATA_KEYS.LAST_BAR_LABEL_SOURCE) === 'y' ? 'y' : 'row';
}

function isRecognizedChartSelection(node: SceneNode) {
    const savedChartType = node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE);
    const columnCount = collectColumns(node).length;
    return Boolean(savedChartType) || columnCount > 0;
}

function hasSavedChartData(node: SceneNode) {
    return Boolean(node.getPluginData(PLUGIN_DATA_KEYS.LAST_VALUES));
}

function isPersistedChartOwner(node: SceneNode) {
    return hasSavedChartData(node) || Boolean(node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE));
}

function isDescendantOfNode(node: SceneNode, ancestor: SceneNode): boolean {
    let current: BaseNode | null = node.parent;
    while (current && current.type !== 'PAGE') {
        if (current.id === ancestor.id) return true;
        current = current.parent;
    }
    return false;
}

function detectCTypeSelection(selectedNode: SceneNode, resolvedNode: SceneNode): boolean {
    if (selectedNode.type !== 'COMPONENT') return false;
    if (selectedNode.id === resolvedNode.id) return false;
    if (resolvedNode.type !== 'INSTANCE') return false;
    return isDescendantOfNode(resolvedNode, selectedNode);
}

function findNamedNodeInTree(root: SceneNode, name: string): SceneNode | null {
    if (root.name === name) return root;
    if (!('findOne' in root)) return null;
    return (root as SceneNode & ChildrenMixin).findOne((node) => node.name === name) as SceneNode | null;
}

function setNodeLayoutSizing(
    node: SceneNode | null,
    horizontal?: 'FILL' | 'FIXED',
    vertical?: 'FILL' | 'FIXED'
): boolean {
    if (!node) return false;
    const target = node as SceneNode & {
        layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
        layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
    };
    try {
        let changed = false;
        if (horizontal && 'layoutSizingHorizontal' in target && target.layoutSizingHorizontal !== horizontal) {
            target.layoutSizingHorizontal = horizontal;
            changed = true;
        }
        if (vertical && 'layoutSizingVertical' in target && target.layoutSizingVertical !== vertical) {
            target.layoutSizingVertical = vertical;
            changed = true;
        }
        return changed;
    } catch {
        return false;
    }
}

function applyCTypeResizeRules(root: SceneNode): number {
    const firstChild =
        'children' in root && (root as SceneNode & ChildrenMixin).children.length > 0
            ? (root as SceneNode & ChildrenMixin).children[0] as SceneNode
            : null;
    const chartNode = findNamedNodeInTree(root, 'chart');
    const chartMainNode = findNamedNodeInTree(root, 'chart_main');
    const chartLegendNode =
        findNamedNodeInTree(root, 'chart_legend') || findNamedNodeInTree(root, 'chart_legned');

    let updated = 0;
    if (setNodeLayoutSizing(root, 'FIXED', 'FIXED')) updated += 1;
    if (setNodeLayoutSizing(firstChild, 'FILL', 'FILL')) updated += 1;
    if (setNodeLayoutSizing(chartNode, 'FILL', 'FILL')) updated += 1;
    if (setNodeLayoutSizing(chartMainNode, 'FILL', 'FILL')) updated += 1;
    if (setNodeLayoutSizing(chartLegendNode, 'FILL')) updated += 1;
    return updated;
}

function findSingleDescendantChartTarget(root: SceneNode): SceneNode | null {
    const candidates: Array<{ node: SceneNode; depth: number; score: number }> = [];
    const visit = (node: SceneNode, depth: number) => {
        if (depth > 0 && isRecognizedChartSelection(node)) {
            let score = 0;
            if (hasSavedChartData(node)) score += 1000;
            if (node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE)) score += 300;
            if (node.type === 'INSTANCE') score += 100;
            if (node.type === 'COMPONENT') score += 50;
            // Prefer closer descendants when priority signals are equal.
            score -= depth;
            candidates.push({ node, depth, score });
        }
        if (!('children' in node)) return;
        (node as SceneNode & ChildrenMixin).children.forEach((child) => visit(child, depth + 1));
    };

    visit(root, 0);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.depth - b.depth;
    });
    return candidates[0].node;
}

function resolveChartTargetWithinSelectionRoot(node: SceneNode): SceneNode {
    // If the selected node already owns persisted chart data, prefer it.
    if (isPersistedChartOwner(node)) return node;

    const descendantTarget = findSingleDescendantChartTarget(node);
    if (descendantTarget) return descendantTarget;

    return node;
}

function resolveChartTargetFromInnerNode(node: SceneNode): SceneNode {
    if (isPersistedChartOwner(node)) return node;

    const descendantTarget = findSingleDescendantChartTarget(node);
    if (descendantTarget) return descendantTarget;

    let current: BaseNode | null = node;
    while (current && current.type !== 'PAGE') {
        if ('getPluginData' in current) {
            const candidate = current as SceneNode;
            if (isPersistedChartOwner(candidate)) {
                return candidate;
            }
        }
        current = current.parent;
    }
    return node;
}

function collectChartTargetsWithinSelectionRoot(node: SceneNode): SceneNode[] {
    if (isPersistedChartOwner(node)) return [node];

    const targets: SceneNode[] = [];
    const visit = (current: SceneNode) => {
        if (current.id !== node.id && isPersistedChartOwner(current)) {
            targets.push(current);
            return;
        }
        if (!('children' in current)) return;
        (current as SceneNode & ChildrenMixin).children.forEach((child) => visit(child));
    };

    visit(node);
    if (targets.length > 0) return targets;

    const fallback = resolveChartTargetWithinSelectionRoot(node);
    return isRecognizedChartSelection(fallback) ? [fallback] : [];
}

function buildSelectionTargetMeta(node: SceneNode): SelectionTargetMeta {
    return {
        id: node.id,
        name: node.name,
        chartType: node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE) || inferChartType(node)
    };
}

function collectSelectedChartTargets(selection: readonly SceneNode[]): SceneNode[] {
    const deduped = new Map<string, SceneNode>();
    selection.forEach((node) => {
        const resolvedNodes = collectChartTargetsWithinSelectionRoot(node);
        resolvedNodes.forEach((resolvedNode) => {
            if (!isRecognizedChartSelection(resolvedNode)) return;
            if (!deduped.has(resolvedNode.id)) {
                deduped.set(resolvedNode.id, resolvedNode);
            }
        });
    });
    return Array.from(deduped.values());
}

function rebuildTrackedTargetSizes(targets: readonly SceneNode[]) {
    trackedTargetSizes.clear();
    targets.forEach((target) => {
        trackedTargetSizes.set(target.id, {
            width: target.width,
            height: target.height
        });
    });
}

async function flushAutoResizeSync(targetId: string) {
    const state = autoResizeSyncQueue.get(targetId);
    if (!state || state.inFlight) return;

    state.inFlight = true;
    try {
        while (state.pending) {
            const postPreviewUpdate = state.pendingPostPreviewUpdate;
            state.pending = false;
            state.pendingPostPreviewUpdate = false;

            const tracked = figma.getNodeById(targetId);
            if (!tracked || tracked.type === 'PAGE' || tracked.type === 'DOCUMENT') {
                trackedTargetSizes.delete(targetId);
                autoResizeSyncQueue.delete(targetId);
                return;
            }

            const trackedScene = tracked as SceneNode;
            if (!isRecognizedChartSelection(trackedScene)) {
                trackedTargetSizes.delete(targetId);
                autoResizeSyncQueue.delete(targetId);
                return;
            }

            await syncChartOnResize(trackedScene, {
                reason: 'auto-resize',
                postPreviewUpdate
            });
            bumpTargetRevision(trackedScene.id);
        }
    } catch (error) {
        console.error('[chart-plugin][auto-resize-sync-failed]', {
            targetId,
            error
        });
    } finally {
        state.inFlight = false;
        if (state.pending) {
            void flushAutoResizeSync(targetId);
        } else if (autoResizeSyncQueue.get(targetId) === state) {
            autoResizeSyncQueue.delete(targetId);
        }
    }
}

function queueAutoResizeSync(target: SceneNode, postPreviewUpdate: boolean) {
    const state = autoResizeSyncQueue.get(target.id) ?? {
        inFlight: false,
        pending: false,
        pendingPostPreviewUpdate: false
    };
    state.pending = true;
    state.pendingPostPreviewUpdate = state.pendingPostPreviewUpdate || postPreviewUpdate;
    autoResizeSyncQueue.set(target.id, state);
    if (!state.inFlight) {
        void flushAutoResizeSync(target.id);
    }
}

function getSelectionTargetsMeta(targets: readonly SceneNode[]): SelectionTargetMeta[] {
    return targets.map((target) => buildSelectionTargetMeta(target));
}

function resolveColColorsFromNode(node: SceneNode, colCount: number, fallbackColor: string) {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_COL_COLORS);
    let saved: any[] = [];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const next: string[] = [];
    for (let i = 0; i < Math.max(1, colCount); i++) {
        next.push(normalizeHexColor(saved[i]) || fallbackColor);
    }
    return next;
}

function resolveColColorModesFromNode(node: SceneNode, colCount: number): ColorMode[] {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_COL_COLOR_MODES);
    let saved: any[] = [];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const next: ColorMode[] = [];
    for (let i = 0; i < Math.max(1, colCount); i++) {
        next.push(normalizeColorMode(saved[i]));
    }
    return next;
}

function resolveColPaintStyleIdsFromNode(node: SceneNode, colCount: number): Array<string | null> {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_COL_PAINT_STYLE_IDS);
    let saved: any[] = [];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const next: Array<string | null> = [];
    for (let i = 0; i < Math.max(1, colCount); i++) {
        next.push(normalizeStyleId(saved[i]));
    }
    return next;
}

function toPaintStyleSelection(style: PaintStyle): PaintStyleSelection {
    const first = Array.isArray(style.paints) ? style.paints[0] : null;
    const isSolid = Boolean(first && first.type === 'SOLID');
    const colorHex = isSolid && first
        ? rgbToHex((first as SolidPaint).color.r, (first as SolidPaint).color.g, (first as SolidPaint).color.b)
        : '#000000';
    return {
        id: style.id,
        name: style.name,
        colorHex,
        isSolid,
        remote: Boolean((style as any).remote)
    };
}

function buildSolidPaintFromHex(hex: string): SolidPaint | null {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return null;
    const raw = normalized.slice(1);
    return {
        type: 'SOLID',
        color: {
            r: parseInt(raw.slice(0, 2), 16) / 255,
            g: parseInt(raw.slice(2, 4), 16) / 255,
            b: parseInt(raw.slice(4, 6), 16) / 255
        }
    };
}

async function loadLocalPaintStyleSelections(): Promise<PaintStyleSelection[]> {
    const styles = await figma.getLocalPaintStylesAsync();
    return styles
        .map((style) => toPaintStyleSelection(style))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function resolveColColorEnabledFromNode(node: SceneNode, colCount: number) {
    const raw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_COL_COLOR_ENABLED);
    let saved: any[] = [];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) saved = parsed;
        } catch { }
    }
    const next: boolean[] = [];
    for (let i = 0; i < Math.max(1, colCount); i++) {
        next.push(Boolean(saved[i]));
    }
    return next;
}

function logSelectionRecognition(node: SceneNode) {
    const savedChartType = node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE);
    const inferredChartType = inferChartType(node);
    const columnCount = collectColumns(node).length;
    const recognized = isRecognizedChartSelection(node);

    debugLog('[chart-plugin][selection]', {
        recognized,
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        savedChartType: savedChartType || null,
        inferredChartType,
        columnCount
    });
}

function resolveStyleExtractTarget(requestedTargetId?: string): SceneNode | null {
    const normalizedRequestedId = typeof requestedTargetId === 'string' ? requestedTargetId.trim() : '';
    if (normalizedRequestedId) {
        const matchedTarget = selectedChartTargets.find((target) => target.id === normalizedRequestedId);
        if (matchedTarget && isRecognizedChartSelection(matchedTarget)) {
            return matchedTarget;
        }
        const requestedNode = figma.getNodeById(normalizedRequestedId);
        if (requestedNode && requestedNode.type !== 'PAGE' && requestedNode.type !== 'DOCUMENT') {
            const resolved = resolveChartTargetFromInnerNode(requestedNode as SceneNode);
            if (isRecognizedChartSelection(resolved)) return resolved;
        }
    }

    if (activeTargetId) {
        const activeTarget = selectedChartTargets.find((target) => target.id === activeTargetId);
        if (activeTarget && isRecognizedChartSelection(activeTarget)) return activeTarget;
        const activeNode = figma.getNodeById(activeTargetId);
        if (activeNode && activeNode.type !== 'PAGE' && activeNode.type !== 'DOCUMENT') {
            const resolved = resolveChartTargetFromInnerNode(activeNode as SceneNode);
            if (isRecognizedChartSelection(resolved)) return resolved;
        }
    }

    const selection = figma.currentPage.selection;
    if (selection.length === 0) return null;
    const resolvedSelection = resolveChartTargetFromInnerNode(selection[0]);
    if (isRecognizedChartSelection(resolvedSelection)) return resolvedSelection;
    return null;
}

function buildStyleExtractPayloadFromNode(node: SceneNode, chartType: string) {
    // 주입된 payload가 없으므로 역산(Inference) 수행
    const structure = inferStructureFromGraph(chartType, node);

    // 숨겨진 레이어 제외하고 카운트 (Visible Column Only)
    const cols = collectColumns(node);
    const visibleCols = cols.filter(c => c.node.visible);
    const stackedGroupStructure = (chartType === 'stackedBar' || chartType === 'stacked')
        ? (visibleCols.length > 0 ? visibleCols : cols).map((colObj) => {
            let parent: SceneNode = colObj.node;
            if ('children' in colObj.node) {
                const tab = (colObj.node as SceneNode & ChildrenMixin).children.find((n: SceneNode) => n.name === 'tab');
                if (tab) parent = tab;
            }
            if (!('children' in parent)) return 0;
            const group = (parent as SceneNode & ChildrenMixin).children.find((n: SceneNode) => MARK_NAME_PATTERNS.STACKED_GROUP.test(n.name));
            if (!group || !('children' in group)) return 0;
            const visibleBars = (group as SceneNode & ChildrenMixin).children.filter(
                (n: SceneNode) => MARK_NAME_PATTERNS.STACKED_SUB_INSTANCE.test(n.name) && n.visible
            );
            return visibleBars.length;
        })
        : null;
    const extractedMarkNum = stackedGroupStructure || structure.markNum;
    const colCount = visibleCols.length > 0
        ? visibleCols.length
        : (Array.isArray(extractedMarkNum)
            ? Math.max(1, extractedMarkNum.length)
            : (cols.length > 0 ? cols.length : 5));

    const styleInfo = extractStyleFromNode(node, chartType, { columns: cols });
    const markRatioForUi = resolveMarkRatioFromNode(node, styleInfo.markRatio);
    let rowCount = 1;
    const savedValuesRaw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_VALUES);
    if (savedValuesRaw) {
        try {
            const parsed = JSON.parse(savedValuesRaw);
            if (Array.isArray(parsed)) rowCount = parsed.length;
        } catch { }
    }
    if (!savedValuesRaw) {
        if (chartType === 'stackedBar' || chartType === 'stacked') {
            rowCount = Array.isArray(extractedMarkNum) ? Math.max(1, Math.max(...extractedMarkNum) + 1) : 1;
        } else {
            rowCount = typeof extractedMarkNum === 'number' ? Math.max(1, extractedMarkNum) : 1;
        }
    }
    const isInstanceTarget = node.type === 'INSTANCE';
    const extractedRowColors = Array.from({ length: Math.max(1, rowCount) }, (_, i) =>
        normalizeHexColor(styleInfo.colors[i]) || getDefaultRowColor(i)
    );
    const extractedRowColorModes = Array.from({ length: Math.max(1, rowCount) }, () => 'hex' as ColorMode);
    const extractedRowPaintStyleIds = Array.from({ length: Math.max(1, rowCount) }, () => null as string | null);
    const extractedColColors = Array.from({ length: Math.max(1, colCount) }, () => extractedRowColors[0] || '#3B82F6');
    const extractedColColorModes = Array.from({ length: Math.max(1, colCount) }, () => 'hex' as ColorMode);
    const extractedColPaintStyleIds = Array.from({ length: Math.max(1, colCount) }, () => null as string | null);
    const extractedColEnabled = Array.from({ length: Math.max(1, colCount) }, () => false);
    const extractedMarkColorSource: 'row' | 'col' = 'row';
    const localOverrideState = isInstanceTarget
        ? loadLocalStyleOverrides(node)
        : { overrides: {} as LocalStyleOverrides, mask: {} as LocalStyleOverrideMask };

    const rowColorsForUi = (localOverrideState.mask.rowColors && Array.isArray(localOverrideState.overrides.rowColors))
        ? normalizeRowColors(localOverrideState.overrides.rowColors)
        : (isInstanceTarget
            ? extractedRowColors
            : resolveRowColorsFromNode(node, chartType, rowCount, styleInfo.colors));
    const rowColorModesForUi = (localOverrideState.mask.rowColorModes && Array.isArray(localOverrideState.overrides.rowColorModes))
        ? normalizeColorModes(localOverrideState.overrides.rowColorModes)
        : (isInstanceTarget
            ? extractedRowColorModes
            : resolveRowColorModesFromNode(node, rowCount));
    const rowPaintStyleIdsForUi = (localOverrideState.mask.rowPaintStyleIds && Array.isArray(localOverrideState.overrides.rowPaintStyleIds))
        ? normalizeStyleIds(localOverrideState.overrides.rowPaintStyleIds)
        : (isInstanceTarget
            ? extractedRowPaintStyleIds
            : resolveRowPaintStyleIdsFromNode(node, rowCount));
    const colColorsForUi = (localOverrideState.mask.colColors && Array.isArray(localOverrideState.overrides.colColors))
        ? normalizeRowColors(localOverrideState.overrides.colColors)
        : (isInstanceTarget
            ? extractedColColors
            : resolveColColorsFromNode(node, colCount, rowColorsForUi[0] || '#3B82F6'));
    const colColorModesForUi = (localOverrideState.mask.colColorModes && Array.isArray(localOverrideState.overrides.colColorModes))
        ? normalizeColorModes(localOverrideState.overrides.colColorModes)
        : (isInstanceTarget
            ? extractedColColorModes
            : resolveColColorModesFromNode(node, colCount));
    const colPaintStyleIdsForUi = (localOverrideState.mask.colPaintStyleIds && Array.isArray(localOverrideState.overrides.colPaintStyleIds))
        ? normalizeStyleIds(localOverrideState.overrides.colPaintStyleIds)
        : (isInstanceTarget
            ? extractedColPaintStyleIds
            : resolveColPaintStyleIdsFromNode(node, colCount));
    const colColorEnabledForUi = (localOverrideState.mask.colColorEnabled && Array.isArray(localOverrideState.overrides.colColorEnabled))
        ? localOverrideState.overrides.colColorEnabled.map((v) => Boolean(v))
        : (isInstanceTarget ? extractedColEnabled : resolveColColorEnabledFromNode(node, colCount));
    const markColorSource = localOverrideState.mask.markColorSource
        ? (localOverrideState.overrides.markColorSource === 'col' ? 'col' : 'row')
        : (isInstanceTarget ? extractedMarkColorSource : (node.getPluginData(PLUGIN_DATA_KEYS.LAST_MARK_COLOR_SOURCE) === 'col' ? 'col' : 'row'));
    const assistLineVisible = node.getPluginData(PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_VISIBLE) === 'true';
    const xAxisLabelsVisible = node.getPluginData(PLUGIN_DATA_KEYS.LAST_X_AXIS_LABELS_VISIBLE) !== 'false';
    const barLabelVisible = resolveBarLabelVisibleFromNode(node);
    const barLabelSource = resolveBarLabelSourceFromNode(node);
    const yAxisVisible = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_AXIS_VISIBLE) !== 'false';
    const assistLineEnabledRaw = node.getPluginData(PLUGIN_DATA_KEYS.LAST_ASSIST_LINE_ENABLED);
    let assistLineEnabled = { min: false, max: false, avg: false, ctr: false };
    if (assistLineEnabledRaw) {
        try {
            const parsed = JSON.parse(assistLineEnabledRaw);
            assistLineEnabled = {
                min: Boolean(parsed?.min),
                max: Boolean(parsed?.max),
                avg: Boolean(parsed?.avg),
                ctr: Boolean(parsed?.ctr)
            };
        } catch { }
    }

    return {
        chartType: chartType,
        markNum: extractedMarkNum,
        yCount: structure.cellCount || 4,
        colCount: colCount,
        previewPlotWidth: getPlotAreaWidth(node),
        previewPlotHeight: getGraphHeight(node as FrameNode),

        colors: styleInfo.colors.length > 0 ? styleInfo.colors : ['#3b82f6', '#9CA3AF'],
        markRatio: markRatioForUi,
        rowColors: rowColorsForUi,
        rowColorModes: rowColorModesForUi,
        rowPaintStyleIds: rowPaintStyleIdsForUi,
        colColors: colColorsForUi,
        colColorModes: colColorModesForUi,
        colPaintStyleIds: colPaintStyleIdsForUi,
        colColorEnabled: colColorEnabledForUi,
        markColorSource,
        xAxisLabelsVisible,
        barLabelVisible,
        barLabelSource,
        yAxisVisible,
        assistLineVisible,
        assistLineEnabled,
        cornerRadius: styleInfo.cornerRadius,
        strokeWidth: resolveStrokeWidthForUi(node, undefined, styleInfo.strokeWidth),
        cellFillStyle: styleInfo.cellFillStyle || null,
        lineBackgroundStyle: styleInfo.lineBackgroundStyle || null,
        markStyle: styleInfo.markStyle || null,
        markStyles: styleInfo.markStyles || [],
        colStrokeStyle: styleInfo.colStrokeStyle || null,
        chartContainerStrokeStyle: styleInfo.chartContainerStrokeStyle || null,
        assistLineStrokeStyle: styleInfo.assistLineStrokeStyle || null,
        cellStrokeStyles: styleInfo.cellStrokeStyles || [],
        rowStrokeStyles: styleInfo.rowStrokeStyles || [],
        isInstanceTarget,
        extractedStyleSnapshot: {
            rowColors: extractedRowColors,
            rowColorModes: extractedRowColorModes,
            rowPaintStyleIds: extractedRowPaintStyleIds,
            colColors: extractedColColors,
            colColorModes: extractedColColorModes,
            colPaintStyleIds: extractedColPaintStyleIds,
            colColorEnabled: extractedColEnabled,
            markColorSource: extractedMarkColorSource,
            cellFillStyle: styleInfo.cellFillStyle || null,
            lineBackgroundStyle: styleInfo.lineBackgroundStyle || null,
            markStyle: styleInfo.markStyle || null,
            markStyles: styleInfo.markStyles || [],
            rowStrokeStyles: styleInfo.rowStrokeStyles || [],
            colStrokeStyle: styleInfo.colStrokeStyle || null,
            chartContainerStrokeStyle: styleInfo.chartContainerStrokeStyle || null,
            assistLineStrokeStyle: styleInfo.assistLineStrokeStyle || null
        },
        localStyleOverrides: localOverrideState.overrides,
        localStyleOverrideMask: localOverrideState.mask
    };
}

function postStyleExtracted(
    node: SceneNode,
    source: 'extract_style' | 'on_demand',
    reason: 'style_tab' | 'export_tab',
    force?: boolean
) {
    const revision = getTargetRevision(node.id);
    const cacheKey = `${node.id}:${revision}`;
    const cached = !force ? styleExtractCache.get(cacheKey) : null;
    const chartType = node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE) || inferChartType(node);
    const payload = cached?.payload || buildStyleExtractPayloadFromNode(node, chartType);
    if (!cached) {
        styleExtractCache.set(cacheKey, { revision, payload });
    }
    figma.ui.postMessage({
        type: 'style_extracted',
        source,
        reason,
        payload
    });
}

// Message Handler
figma.ui.onmessage = async (msg) => {
    if (msg.type === 'resize') {
        figma.ui.resize(msg.width, msg.height);
    }
    else if (msg.type === 'generate' || msg.type === 'apply') {
        const {
            type,
            mode,
            values,
            rawValues,
            cols,
            rows,
            cellCount,
            yMin,
            yMax,
            yLabelFormat,
            markNum,
            strokeWidth,
            markRatio,
            rowColors,
            rowColorModes,
            rowPaintStyleIds,
            colColors,
            colColorModes,
            colPaintStyleIds,
            colColorEnabled,
            rowHeaderLabels,
            markColorSource,
            rawYMaxAuto,
            linePointVisible,
            lineFeature2Enabled,
            assistLineVisible,
            assistLineEnabled,
            assistLineStyle,
            markStyle,
            markStyles,
            xAxisLabels,
            xAxisLabelsVisible,
            barLabelVisible,
            barLabelSource,
            yAxisVisible,
            cellFillStyle,
            lineBackgroundStyle,
            rowStrokeStyles,
            colStrokeStyle,
            cellTopStyle,
            cellBottomStyle,
            tabRightStyle,
            gridContainerStyle,
            styleApplyMode,
            localStyleOverrides,
            localStyleOverrideMask
        } = msg.payload;

        const perf = new PerfTracker();
        const applyRunId = ++latestApplyRunId;
        const isCancelled = () => applyRunId !== latestApplyRunId;
        let wasCancelled = false;
        const normalizedRowColors = normalizeRowColors(rowColors);
        const normalizedRowColorModes = normalizeColorModes(rowColorModes);
        const normalizedRowPaintStyleIds = normalizeStyleIds(rowPaintStyleIds);
        const normalizedColColors = normalizeRowColors(colColors);
        const normalizedColColorModes = normalizeColorModes(colColorModes);
        const normalizedColPaintStyleIds = normalizeStyleIds(colPaintStyleIds);
        const normalizedColColorEnabled = Array.isArray(colColorEnabled)
            ? colColorEnabled.map((v: unknown) => Boolean(v))
            : [];
        const requestedStyleApplyMode = normalizeStyleApplyMode(styleApplyMode);
        const normalizedLocalOverrides = normalizeLocalStyleOverrides(localStyleOverrides);
        const normalizedLocalMask = normalizeLocalStyleOverrideMask(localStyleOverrideMask);
        const nodes = figma.currentPage.selection;
        let targetNode: FrameNode | ComponentNode | InstanceNode | null = null;

        targetNode = await perf.step('target-resolve', async () => {
            if (msg.type === 'apply') {
                let resolvedNode: SceneNode | null = null;
                const requestedTargetId = typeof msg.payload?.targetId === 'string' ? msg.payload.targetId : null;
                if (requestedTargetId) {
                    const matchedTarget = selectedChartTargets.find((target) => target.id === requestedTargetId);
                    const requestedNode = matchedTarget || figma.getNodeById(requestedTargetId);
                    if (requestedNode && requestedNode.type !== 'PAGE' && requestedNode.type !== 'DOCUMENT') {
                        resolvedNode = requestedNode as SceneNode;
                    }
                }
                if (!resolvedNode && nodes.length > 0) {
                    resolvedNode = resolveChartTargetFromInnerNode(nodes[0]);
                }
                if (!resolvedNode) {
                    figma.notify("Please select a chart component instance.");
                    return null;
                }
                if (!isRecognizedChartSelection(resolvedNode)) {
                    figma.notify("Please select a chart component instance.");
                    return null;
                }
                const applyPolicy: ApplyPolicy =
                    resolvedNode.type === 'COMPONENT'
                        ? 'template-master'
                        : (resolvedNode.type === 'INSTANCE' ? 'instance-data' : 'default');
                debugLog('[chart-plugin][apply]', {
                    selectedNodeId: nodes[0]?.id || null,
                    targetNodeId: resolvedNode.id,
                    selectedNodeName: nodes[0]?.name || null,
                    targetNodeName: resolvedNode.name,
                    applyPolicy
                });
                return resolvedNode as FrameNode;
            }

            const component = await getOrImportComponent();
            if (!component) {
                figma.notify(`Master Component '${(await import('./constants')).MASTER_COMPONENT_CONFIG.NAME}' not found.`);
                return null;
            }

            let instance;
            if (component.type === "COMPONENT_SET") {
                const defaultVar = component.defaultVariant;
                if (!defaultVar) {
                    figma.notify("Error: Default Variant not found");
                    return null;
                }
                instance = defaultVar.createInstance();
            } else {
                instance = component.createInstance();
            }

            const { x, y } = figma.viewport.center;
            instance.x = x - (instance.width / 2);
            instance.y = y - (instance.height / 2);

            figma.currentPage.appendChild(instance);
            figma.viewport.scrollAndZoomIntoView([instance]);
            figma.currentPage.selection = [instance];
            return instance;
        });
        if (!targetNode) return;
        if (msg.type === 'apply') {
            activeTargetId = targetNode.id;
        }
        await withLoadingOpacity(targetNode, async () => {
        const isTemplateMasterApply = msg.type === 'apply' && (targetNode as any).type === 'COMPONENT';
        const applyPolicy: ApplyPolicy = isTemplateMasterApply
            ? 'template-master'
            : (targetNode.type === 'INSTANCE' ? 'instance-data' : 'default');
        const resolvedStyleApplyMode: StyleApplyMode =
            targetNode.type === 'INSTANCE' ? 'data_only' : requestedStyleApplyMode;
        const isDataOnlyApply = resolvedStyleApplyMode === 'data_only';
        const persistedLocal = targetNode.type === 'INSTANCE'
            ? loadLocalStyleOverrides(targetNode)
            : { overrides: {} as LocalStyleOverrides, mask: {} as LocalStyleOverrideMask };
        const effectiveLocalMask = hasTruthyMask(normalizedLocalMask)
            ? normalizedLocalMask
            : persistedLocal.mask;
        const effectiveLocalOverrides = hasTruthyMask(normalizedLocalMask)
            ? normalizedLocalOverrides
            : persistedLocal.overrides;
        const columns = await perf.step('collect-columns', () => collectColumns(targetNode));
        let templateExistingValues: any[][] | null = null;
        let templateExistingMode: 'raw' | 'percent' | null = null;
        if (isTemplateMasterApply) {
            const loaded = await perf.step('load-template-data', () => loadChartData(targetNode as SceneNode, type));
            if (Array.isArray(loaded.values)) {
                templateExistingValues = isStackedType(type)
                    ? loaded.values.slice(1)
                    : loaded.values;
            }
            const savedMode = targetNode.getPluginData(PLUGIN_DATA_KEYS.LAST_MODE);
            templateExistingMode = savedMode === 'percent' ? 'percent' : 'raw';
            debugLog('[chart-plugin][apply-policy]', {
                applyPolicy,
                targetNodeId: targetNode.id,
                targetNodeType: targetNode.type,
                savedRows: Array.isArray(loaded.values) ? loaded.values.length : 0,
                savedMode: templateExistingMode
            });
        }

        const drawValues = isTemplateMasterApply && Array.isArray(templateExistingValues)
            ? templateExistingValues
            : values;
        const drawMode: 'raw' | 'percent' = isTemplateMasterApply
            ? (templateExistingMode || 'raw')
            : mode;
        const drawRawValues = isTemplateMasterApply && Array.isArray(templateExistingValues)
            ? templateExistingValues
            : rawValues;

        // 2. Variant Setup
        await perf.step('variant-setup', () => {
            if (targetNode.type === "INSTANCE") {
                const variantValue = VARIANT_MAPPING[type] || 'bar';
                setVariantProperty(targetNode, "Type", variantValue);
            }
        });

        const effectiveY = await perf.step('resolve-y-range', () => resolveEffectiveYRange({
            chartType: type,
            mode: drawMode,
            values: drawValues,
            yMin,
            yMax,
            rawYMaxAuto: drawMode === 'raw' ? rawYMaxAuto : false
        }));

        // 3. Basic Setup
        const graphColCount = cols;
        await perf.step('basic-setup', () => {
            setLayerVisibility(targetNode, "col-", graphColCount, columns);
            applyColumnXEmptyVisibility(targetNode, xAxisLabelsVisible !== false, columns);
            applyCells(targetNode, cellCount);
            applyYAxis(targetNode, cellCount, { yMin: effectiveY.yMin, yMax: effectiveY.yMax, yLabelFormat });
            applyYAxisEmptyVisibility(targetNode, hasVisibleXEmpty(targetNode as FrameNode));
            applyYAxisVisibility(targetNode, yAxisVisible !== false);
        });

        // 4. Draw Chart
        const H = getGraphHeight(targetNode as FrameNode);
        const xEmptyHeight = getXEmptyHeight(targetNode as FrameNode);
        const chartLegendHeight = getChartLegendHeight(targetNode as FrameNode);
        if (type === 'bar') {
            debugLog('[chart-plugin][bar-height-debug][graph]', {
                graphId: targetNode.id,
                graphName: targetNode.name,
                graphHeight: 'height' in targetNode ? targetNode.height : null,
                xEmptyHeight,
                chartLegendHeight,
                computedH: H
            });
        }
        const drawRowColors = !isDataOnlyApply
            ? normalizedRowColors
            : (effectiveLocalMask.rowColors ? normalizeRowColors(effectiveLocalOverrides.rowColors) : undefined);
        const drawRowColorModes = !isDataOnlyApply
            ? normalizedRowColorModes
            : (effectiveLocalMask.rowColorModes ? normalizeColorModes(effectiveLocalOverrides.rowColorModes) : undefined);
        const drawRowPaintStyleIds = !isDataOnlyApply
            ? normalizedRowPaintStyleIds
            : (effectiveLocalMask.rowPaintStyleIds ? normalizeStyleIds(effectiveLocalOverrides.rowPaintStyleIds) : undefined);
        const drawColColors = !isDataOnlyApply
            ? normalizedColColors
            : (effectiveLocalMask.colColors ? normalizeRowColors(effectiveLocalOverrides.colColors) : undefined);
        const drawColColorModes = !isDataOnlyApply
            ? normalizedColColorModes
            : (effectiveLocalMask.colColorModes ? normalizeColorModes(effectiveLocalOverrides.colColorModes) : undefined);
        const drawColPaintStyleIds = !isDataOnlyApply
            ? normalizedColPaintStyleIds
            : (effectiveLocalMask.colPaintStyleIds ? normalizeStyleIds(effectiveLocalOverrides.colPaintStyleIds) : undefined);
        const drawColColorEnabled = !isDataOnlyApply
            ? normalizedColColorEnabled
            : (effectiveLocalMask.colColorEnabled
                ? (Array.isArray(effectiveLocalOverrides.colColorEnabled)
                    ? effectiveLocalOverrides.colColorEnabled.map((v) => Boolean(v))
                    : [])
                : undefined);
        const drawMarkColorSource = !isDataOnlyApply
            ? (markColorSource === 'col' ? 'col' : 'row')
            : (effectiveLocalMask.markColorSource
                ? (effectiveLocalOverrides.markColorSource === 'col' ? 'col' : 'row')
                : undefined);
        const drawAssistLineStyle = !isDataOnlyApply
            ? assistLineStyle
            : (effectiveLocalMask.assistLineStyle ? effectiveLocalOverrides.assistLineStyle : undefined);
        const drawMarkStyle = !isDataOnlyApply
            ? markStyle
            : (effectiveLocalMask.markStyle ? effectiveLocalOverrides.markStyle : undefined);
        const drawMarkStyles = !isDataOnlyApply
            ? markStyles
            : (effectiveLocalMask.markStyles ? effectiveLocalOverrides.markStyles : undefined);

        const drawConfig = {
            values: drawValues,
            rawValues: drawRawValues,
            mode: drawMode,
            markNum,
            rows,
            rowHeaderLabels: Array.isArray(rowHeaderLabels) ? rowHeaderLabels : [],
            yMin: effectiveY.yMin,
            yMax: effectiveY.yMax,
            rawYMaxAuto: effectiveY.rawYMaxAuto,
            strokeWidth,
            markRatio,
            rowColors: drawRowColors,
            rowColorModes: drawRowColorModes,
            rowPaintStyleIds: drawRowPaintStyleIds,
            colColors: drawColColors,
            colColorModes: drawColColorModes,
            colPaintStyleIds: drawColPaintStyleIds,
            colColorEnabled: drawColColorEnabled,
            markColorSource: drawMarkColorSource,
            barLabelVisible: type === 'bar'
                ? (typeof barLabelVisible === 'boolean'
                    ? barLabelVisible
                    : resolveBarLabelVisibleFromNode(targetNode))
                : false,
            barLabelSource: type === 'bar'
                ? ((barLabelSource === 'y' || barLabelSource === 'row')
                    ? barLabelSource
                    : resolveBarLabelSourceFromNode(targetNode))
                : 'row',
            linePointVisible: linePointVisible !== false,
            lineFeature2Enabled: lineFeature2Enabled === true,
            assistLineVisible,
            assistLineEnabled,
            assistLineStyle: drawAssistLineStyle,
            markStyle: drawMarkStyle,
            markStyles: drawMarkStyles,
            deferLineSegmentStrokeStyling: type === 'line'
        };

        const lineApplyResult = await perf.step('draw-chart', async () => {
            if (type === "bar") {
                await applyBar(drawConfig, H, targetNode, {
                    chunkSize: APPLY_CHUNK_SIZE_BAR,
                    shouldCancel: isCancelled,
                    yieldControl: nextTick
                });
                if (isCancelled()) {
                    wasCancelled = true;
                    return { ok: false, errorCode: 'cancelled', message: 'Bar apply cancelled.' } as const;
                }
                applyAssistLines(drawConfig, targetNode, H, { xEmptyHeight });
                return { ok: true } as const;
            }
            if (type === "line") {
                const result = await applyLine(drawConfig, H, targetNode, {
                    chunkSize: APPLY_CHUNK_SIZE_LINE,
                    shouldCancel: isCancelled,
                    yieldControl: nextTick
                });
                if (!result.ok) return result;
                if (isCancelled()) {
                    wasCancelled = true;
                    return { ok: false, errorCode: 'cancelled', message: 'Line apply cancelled.' } as const;
                }
                applyAssistLines(drawConfig, targetNode, H, { xEmptyHeight });
                return result;
            }
            if (isStackedType(type)) {
                await applyStackedBar(drawConfig, H, targetNode, columns, {
                    chunkSize: APPLY_CHUNK_SIZE_STACKED,
                    shouldCancel: isCancelled,
                    yieldControl: nextTick
                });
                if (isCancelled()) {
                    wasCancelled = true;
                    return { ok: false, errorCode: 'cancelled', message: 'Stacked apply cancelled.' } as const;
                }
                applyAssistLines(drawConfig, targetNode, H, { xEmptyHeight });
            }
            return { ok: true } as const;
        });
        if (!lineApplyResult.ok && (lineApplyResult as any).errorCode === 'cancelled') {
            wasCancelled = true;
            return;
        }
        if (type === 'line' && !lineApplyResult.ok) {
            figma.notify('Line apply failed: required line structure is missing.');
            console.error('[chart-plugin][line-apply-failed]', {
                targetNodeId: targetNode.id,
                targetNodeName: targetNode.name,
                lineApplyResult
            });
            return;
        }

        await perf.step('post-draw-layout', () => {
            const xEmptyAlign: 'center' | 'right' =
                type === 'line'
                    ? 'right'
                    : 'center';
            const xEmptyAlignResult = applyColumnXEmptyAlign(targetNode, xEmptyAlign, columns);
            debugLog('[chart-plugin][x-empty-align]', { type, align: xEmptyAlign, ...xEmptyAlignResult });
            const xEmptyLabelResult = applyColumnXEmptyLabels(
                targetNode,
                Array.isArray(xAxisLabels) ? xAxisLabels : [],
                columns
            );
            debugLog('[chart-plugin][x-empty-label]', { type, ...xEmptyLabelResult });
            const legendLabelResult = applyLegendLabelsFromRowHeaders(
                targetNode,
                {
                    chartType: type,
                    rowHeaderLabels: Array.isArray(rowHeaderLabels) ? rowHeaderLabels : [],
                    rowColors: normalizedRowColors,
                    markNum,
                    xAxisLabels: Array.isArray(xAxisLabels) ? xAxisLabels : [],
                    colColors: normalizedColColors,
                    colColorEnabled: normalizedColColorEnabled,
                    columns
                }
            );
            debugLog('[chart-plugin][legend-label]', { type, ...legendLabelResult });
        });

        const runtimeStrokePayload = isDataOnlyApply
            ? {
                chartType: type,
                markNum,
                ...(effectiveLocalMask.rowColors ? { rowColors: normalizeRowColors(effectiveLocalOverrides.rowColors) } : {}),
                ...(effectiveLocalMask.rowColorModes ? { rowColorModes: normalizeColorModes(effectiveLocalOverrides.rowColorModes) } : {}),
                ...(effectiveLocalMask.rowPaintStyleIds ? { rowPaintStyleIds: normalizeStyleIds(effectiveLocalOverrides.rowPaintStyleIds) } : {}),
                ...(effectiveLocalMask.colColors ? { colColors: normalizeRowColors(effectiveLocalOverrides.colColors) } : {}),
                ...(effectiveLocalMask.colColorModes ? { colColorModes: normalizeColorModes(effectiveLocalOverrides.colColorModes) } : {}),
                ...(effectiveLocalMask.colPaintStyleIds ? { colPaintStyleIds: normalizeStyleIds(effectiveLocalOverrides.colPaintStyleIds) } : {}),
                ...(effectiveLocalMask.colColorEnabled ? {
                    colColorEnabled: Array.isArray(effectiveLocalOverrides.colColorEnabled)
                        ? effectiveLocalOverrides.colColorEnabled.map((v) => Boolean(v))
                        : []
                } : {}),
                ...(effectiveLocalMask.cellFillStyle ? { cellFillStyle: effectiveLocalOverrides.cellFillStyle } : {}),
                ...(effectiveLocalMask.lineBackgroundStyle ? { lineBackgroundStyle: effectiveLocalOverrides.lineBackgroundStyle } : {}),
                ...(effectiveLocalMask.cellTopStyle ? { cellTopStyle: effectiveLocalOverrides.cellTopStyle } : {}),
                ...(effectiveLocalMask.tabRightStyle ? { tabRightStyle: effectiveLocalOverrides.tabRightStyle } : {}),
                ...(effectiveLocalMask.gridContainerStyle ? { gridContainerStyle: effectiveLocalOverrides.gridContainerStyle } : {}),
                ...(effectiveLocalMask.markStyle ? { markStyle: effectiveLocalOverrides.markStyle } : {}),
                ...(effectiveLocalMask.markStyles ? { markStyles: effectiveLocalOverrides.markStyles } : {}),
                ...(effectiveLocalMask.rowStrokeStyles ? { rowStrokeStyles: effectiveLocalOverrides.rowStrokeStyles } : {}),
                ...(effectiveLocalMask.colStrokeStyle ? { colStrokeStyle: effectiveLocalOverrides.colStrokeStyle } : {}),
                ...(effectiveLocalMask.assistLineStyle ? { assistLineStyle: effectiveLocalOverrides.assistLineStyle } : {}),
                ...(Array.isArray(rowHeaderLabels) ? { rowHeaderLabels } : {}),
                ...(Array.isArray(xAxisLabels) ? { xAxisLabels } : {})
            }
            : {
                chartType: type,
                rowColors: normalizedRowColors,
                rowColorModes: normalizedRowColorModes,
                rowPaintStyleIds: normalizedRowPaintStyleIds,
                colColors: normalizedColColors,
                colColorModes: normalizedColColorModes,
                colPaintStyleIds: normalizedColPaintStyleIds,
                colColorEnabled: normalizedColColorEnabled,
                rowHeaderLabels: Array.isArray(rowHeaderLabels) ? rowHeaderLabels : [],
                xAxisLabels: Array.isArray(xAxisLabels) ? xAxisLabels : [],
                cellFillStyle,
                lineBackgroundStyle,
                cellTopStyle: cellTopStyle ?? cellBottomStyle,
                tabRightStyle,
                gridContainerStyle,
                markStyle,
                markStyles,
                rowStrokeStyles,
                colStrokeStyle,
                markNum
            };

        const strokeInjectionResult = await perf.step('stroke-injection', async () => {
            const mergeScope = (
                acc: { candidates: number; applied: number; skipped: number; errors: number },
                next: { candidates: number; applied: number; skipped: number; errors: number }
            ) => {
                acc.candidates += next.candidates;
                acc.applied += next.applied;
                acc.skipped += next.skipped;
                acc.errors += next.errors;
                return acc;
            };
            const combined = {
                cellFill: { candidates: 0, applied: 0, skipped: 0, errors: 0 },
                lineBackground: { candidates: 0, applied: 0, skipped: 0, errors: 0 },
                mark: { candidates: 0, applied: 0, skipped: 0, errors: 0 },
                legend: { candidates: 0, applied: 0, skipped: 0, errors: 0 },
                cellTop: { candidates: 0, applied: 0, skipped: 0, errors: 0 },
                tabRight: { candidates: 0, applied: 0, skipped: 0, errors: 0 },
                gridContainer: { candidates: 0, applied: 0, skipped: 0, errors: 0 },
                resolved: {
                    cellFill: false,
                    lineBackground: false,
                    mark: false,
                    legend: false,
                    cellTop: false,
                    tabRight: false,
                    gridContainer: false
                }
            };

            for (let start = 0; start < columns.length; start += APPLY_CHUNK_SIZE_STROKE) {
                if (isCancelled()) {
                    wasCancelled = true;
                    return combined;
                }
                const chunk = columns.slice(start, start + APPLY_CHUNK_SIZE_STROKE);
                const partial = applyStrokeInjection(targetNode, runtimeStrokePayload, chunk, {
                    applyColumnScopes: true,
                    applyLegendScope: false,
                    applyGridContainerScope: false
                });
                mergeScope(combined.cellFill, partial.cellFill);
                mergeScope(combined.lineBackground, partial.lineBackground);
                mergeScope(combined.mark, partial.mark);
                mergeScope(combined.cellTop, partial.cellTop);
                mergeScope(combined.tabRight, partial.tabRight);
                combined.resolved.cellFill = combined.resolved.cellFill || partial.resolved.cellFill;
                combined.resolved.lineBackground = combined.resolved.lineBackground || partial.resolved.lineBackground;
                combined.resolved.mark = combined.resolved.mark || partial.resolved.mark;
                combined.resolved.cellTop = combined.resolved.cellTop || partial.resolved.cellTop;
                combined.resolved.tabRight = combined.resolved.tabRight || partial.resolved.tabRight;
                await nextTick();
            }

            if (!isCancelled()) {
                const globalScopes = applyStrokeInjection(targetNode, runtimeStrokePayload, columns, {
                    applyColumnScopes: false,
                    applyLegendScope: true,
                    applyGridContainerScope: true
                });
                mergeScope(combined.legend, globalScopes.legend);
                mergeScope(combined.gridContainer, globalScopes.gridContainer);
                combined.resolved.legend = globalScopes.resolved.legend;
                combined.resolved.gridContainer = globalScopes.resolved.gridContainer;
            } else {
                wasCancelled = true;
            }

            return combined;
        });
        debugLog('[chart-plugin][stroke-injection]', strokeInjectionResult);
        if (wasCancelled || isCancelled()) {
            wasCancelled = true;
            return;
        }
        if (type === 'line') {
            await perf.step('flat-padding-sync', () => syncFlatLineFillBottomPadding(targetNode, columns));
        }

        await perf.step('save-and-sync', () => {
            saveChartData(
                targetNode,
                { ...msg.payload, styleApplyMode: resolvedStyleApplyMode },
                undefined,
                { skipDataKeys: isTemplateMasterApply }
            );
            if (targetNode.type === 'INSTANCE') {
                saveLocalStyleOverrides(targetNode, effectiveLocalOverrides, effectiveLocalMask);
            }
            bumpTargetRevision(targetNode.id);
            debugLog('[chart-plugin][save-policy]', {
                applyPolicy,
                targetNodeId: targetNode.id,
                skipDataKeys: isTemplateMasterApply
            });
            figma.ui.postMessage({
                type: 'preview_plot_size_updated',
                previewPlotWidth: getPlotAreaWidth(targetNode),
                previewPlotHeight: getGraphHeight(targetNode as FrameNode)
            });
            if (msg.type === 'apply') {
                figma.ui.postMessage({ type: 'apply_completed', targetId: targetNode.id });
            }
        });
        });
        if (wasCancelled || isCancelled()) {
            figma.ui.postMessage({
                type: 'apply_cancelled',
                targetId: targetNode.id
            });
            return;
        }

        const perfReport = perf.done();
        logApplyPerf(perfReport, {
            messageType: msg.type,
            chartType: type,
            targetNodeId: targetNode.id,
            targetNodeName: targetNode.name,
            targetNodeType: targetNode.type,
            applyPolicy
        });

        if (msg.type === 'generate') {
            figma.notify("Chart Generated!");
        } else {
            figma.notify("Chart Updated & Style Synced!");
        }
    }

    // Export style extraction (legacy path, kept for backward compatibility)
    else if (msg.type === 'extract_style') {
        const node = resolveStyleExtractTarget();
        if (!node) {
            figma.notify("Please select a chart component instance.");
            return;
        }
        postStyleExtracted(node, 'extract_style', 'export_tab', true);
        figma.notify("Style Extracted!");
    }
    else if (msg.type === 'request_style_extract') {
        const requestedTargetId = typeof msg.payload?.targetId === 'string'
            ? msg.payload.targetId
            : (typeof msg.targetId === 'string' ? msg.targetId : undefined);
        const node = resolveStyleExtractTarget(requestedTargetId);
        if (!node) {
            figma.notify("Please select a chart component instance.");
            return;
        }
        const reason = msg.reason === 'style_tab' || msg.payload?.reason === 'style_tab'
            ? 'style_tab'
            : 'export_tab';
        const force = Boolean(msg.force ?? msg.payload?.force);
        postStyleExtracted(node, 'on_demand', reason, force);
    }
    else if (msg.type === 'list_paint_styles') {
        const list = await loadLocalPaintStyleSelections();
        figma.ui.postMessage({ type: 'paint_styles_loaded', list });
    }
    else if (msg.type === 'create_paint_style') {
        const name = typeof msg.name === 'string' ? msg.name.trim() : '';
        const paint = buildSolidPaintFromHex(msg.colorHex);
        if (!name) {
            figma.ui.postMessage({ type: 'paint_style_error', reason: 'Style name is required.' });
            return;
        }
        if (!paint) {
            figma.ui.postMessage({ type: 'paint_style_error', reason: 'Invalid HEX color.' });
            return;
        }
        const created = figma.createPaintStyle();
        created.name = name;
        created.paints = [paint];
        figma.ui.postMessage({ type: 'paint_style_created', style: toPaintStyleSelection(created) });
        figma.ui.postMessage({ type: 'paint_styles_loaded', list: await loadLocalPaintStyleSelections() });
    }
    else if (msg.type === 'rename_paint_style') {
        const id = typeof msg.id === 'string' ? msg.id : '';
        const name = typeof msg.name === 'string' ? msg.name.trim() : '';
        if (!id || !name) {
            figma.ui.postMessage({ type: 'paint_style_error', reason: 'Invalid style id or name.' });
            return;
        }
        const style = figma.getStyleById(id);
        if (!style || style.type !== 'PAINT') {
            figma.ui.postMessage({ type: 'paint_style_error', reason: 'Paint style not found.' });
            return;
        }
        if ((style as PaintStyle).remote) {
            figma.ui.postMessage({ type: 'paint_style_error', reason: 'Remote style cannot be renamed.' });
            return;
        }
        (style as PaintStyle).name = name;
        figma.ui.postMessage({ type: 'paint_style_renamed', id, name });
        figma.ui.postMessage({ type: 'paint_styles_loaded', list: await loadLocalPaintStyleSelections() });
    }
    else if (msg.type === 'update_paint_style_color') {
        const id = typeof msg.id === 'string' ? msg.id : '';
        const paint = buildSolidPaintFromHex(msg.colorHex);
        if (!id || !paint) {
            figma.ui.postMessage({ type: 'paint_style_error', reason: 'Invalid style id or color.' });
            return;
        }
        const style = figma.getStyleById(id);
        if (!style || style.type !== 'PAINT') {
            figma.ui.postMessage({ type: 'paint_style_error', reason: 'Paint style not found.' });
            return;
        }
        if ((style as PaintStyle).remote) {
            figma.ui.postMessage({ type: 'paint_style_error', reason: 'Remote style cannot be updated.' });
            return;
        }
        (style as PaintStyle).paints = [paint];
        figma.ui.postMessage({ type: 'paint_style_updated', id, colorHex: normalizeHexColor(msg.colorHex) || '#000000' });
        figma.ui.postMessage({ type: 'paint_styles_loaded', list: await loadLocalPaintStyleSelections() });
    }
    else if (msg.type === 'load_style_templates') {
        const list = await loadStyleTemplates(msg.chartType);
        figma.ui.postMessage({ type: 'style_templates_loaded', list });
    }
    else if (msg.type === 'save_style_template') {
        const result = await saveStyleTemplate(msg.name, msg.payload, msg.chartType, msg.thumbnailDataUrl);
        if (result.error) {
            figma.ui.postMessage({ type: 'style_template_error', reason: result.error });
            return;
        }
        figma.ui.postMessage({ type: 'style_template_saved', list: result.list || [] });
    }
    else if (msg.type === 'delete_style_template') {
        const result = await deleteStyleTemplate(msg.id, msg.chartType);
        if (result.error) {
            figma.ui.postMessage({ type: 'style_template_error', reason: result.error });
            return;
        }
        figma.ui.postMessage({ type: 'style_template_deleted', id: msg.id, list: result.list || [] });
    }
    else if (msg.type === 'rename_style_template') {
        const result = await renameStyleTemplate(msg.id, msg.name, msg.chartType);
        if (result.error) {
            figma.ui.postMessage({ type: 'style_template_error', reason: result.error });
            return;
        }
        figma.ui.postMessage({ type: 'style_template_renamed', id: msg.id, list: result.list || [] });
    }
    else if (msg.type === 'overwrite_style_template') {
        const result = await overwriteStyleTemplate(msg.id, msg.payload, msg.chartType, msg.thumbnailDataUrl);
        if (result.error) {
            figma.ui.postMessage({ type: 'style_template_error', reason: result.error });
            return;
        }
        figma.ui.postMessage({ type: 'style_template_overwritten', id: msg.id, list: result.list || [] });
    }
    else if (msg.type === 'select_chart_target') {
        const requestedTargetId = typeof msg.targetId === 'string' ? msg.targetId : '';
        if (!requestedTargetId) return;
        const nextTarget = selectedChartTargets.find((target) => target.id === requestedTargetId);
        if (!nextTarget || !isRecognizedChartSelection(nextTarget)) return;
        activeTargetId = nextTarget.id;
        initPluginUI(nextTarget, false, {
            reason: 'selection',
            isCType: false,
            selectionTargets: getSelectionTargetsMeta(selectedChartTargets),
            activeTargetId,
            deferStyleExtract: true
        });
    }
};


// Selection Change
figma.on("selectionchange", () => {
    const selection = figma.currentPage.selection;
    if (selection.length === 1) {
        const node = selection[0];
        const resolvedNode = resolveChartTargetFromInnerNode(node);
        const isCType = detectCTypeSelection(node, resolvedNode);
        if (isCType) {
            const resizedCount = applyCTypeResizeRules(node);
            if (resizedCount > 0) {
                debugLog('[chart-plugin][ctype-resize-fill]', {
                    selectedNodeId: node.id,
                    resizedCount
                });
            }
        }
        logSelectionRecognition(resolvedNode);
        debugLog('[chart-plugin][selection-resolve]', {
            selectedNodeId: node.id,
            resolvedNodeId: resolvedNode.id,
            selectedNodeName: node.name,
            resolvedNodeName: resolvedNode.name,
            isCType
        });
    }

    selectedChartTargets = collectSelectedChartTargets(selection);
    if (selectedChartTargets.length === 0) {
        activeTargetId = null;
        rebuildTrackedTargetSizes([]);
        debugLog('[chart-plugin][selection]', {
            recognized: false,
            reason: selection.length === 0 ? 'empty-selection' : 'selection-without-chart',
            selectionCount: selection.length
        });
        figma.ui.postMessage({ type: 'init', chartType: null });
        return;
    }

    if (!activeTargetId || !selectedChartTargets.some((target) => target.id === activeTargetId)) {
        activeTargetId = selectedChartTargets[0].id;
    }
    rebuildTrackedTargetSizes(selectedChartTargets);

    const activeTarget = selectedChartTargets.find((target) => target.id === activeTargetId) || selectedChartTargets[0];
    activeTargetId = activeTarget.id;
    initPluginUI(activeTarget, false, {
        reason: 'selection',
        isCType: selection.length === 1 ? detectCTypeSelection(selection[0], activeTarget) : false,
        selectionTargets: getSelectionTargetsMeta(selectedChartTargets),
        activeTargetId,
        deferStyleExtract: true
    });
});

// Auto-Resize Loop
setInterval(() => {
    if (trackedTargetSizes.size === 0) return;
    Array.from(trackedTargetSizes.entries()).forEach(([targetId, prevSize]) => {
        const tracked = figma.getNodeById(targetId);
        if (!tracked || tracked.type === 'PAGE' || tracked.type === 'DOCUMENT') {
            trackedTargetSizes.delete(targetId);
            return;
        }

        const trackedScene = tracked as SceneNode;
        if (!isRecognizedChartSelection(trackedScene)) {
            trackedTargetSizes.delete(targetId);
            return;
        }

        if (Math.abs(trackedScene.width - prevSize.width) > 1 || Math.abs(trackedScene.height - prevSize.height) > 1) {
            debugLog('[chart-plugin][auto-resize]', {
                nodeId: trackedScene.id,
                prevWidth: prevSize.width,
                nextWidth: trackedScene.width,
                prevHeight: prevSize.height,
                nextHeight: trackedScene.height
            });
            queueAutoResizeSync(trackedScene, trackedScene.id === activeTargetId);
            trackedTargetSizes.set(targetId, {
                width: trackedScene.width,
                height: trackedScene.height
            });
        }
    });
}, 500);
