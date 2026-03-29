import { CLIENT_STORAGE_KEYS } from './constants';
import { normalizeHexColor } from './utils';
import type {
    AssistLineInjectionStyle,
    CellFillInjectionStyle,
    ColorMode,
    GridStrokeInjectionStyle,
    LineBackgroundInjectionStyle,
    MarkInjectionStyle,
    SideStrokeInjectionStyle,
    StyleTemplateChartType,
    StyleTemplateItem,
    StyleTemplatePayload,
    StyleTemplateStoredPayload
} from '../shared/style-types';

const MAX_STYLE_TEMPLATES = 20;

function normalizeTemplateChartType(value: unknown): StyleTemplateChartType {
    if (value === 'line') return 'line';
    if (value === 'stackedBar' || value === 'stacked') return 'stackedBar';
    return 'bar';
}

function clampThickness(value: unknown): number | undefined {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return Math.max(0, Math.min(20, Math.round(n * 100) / 100));
}

function normalizeSideStyle(value: unknown): SideStrokeInjectionStyle | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const source = value as SideStrokeInjectionStyle;
    const color = normalizeHexColor(source.color);
    const thickness = clampThickness(source.thickness);
    const visible = typeof source.visible === 'boolean' ? source.visible : undefined;
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);
    if (!color && thickness === undefined && visible === undefined && !strokeStyle) return undefined;
    return {
        color: color || undefined,
        thickness: visible === false ? 0 : thickness,
        visible,
        strokeStyle
    };
}

function normalizeGridStyle(value: unknown): GridStrokeInjectionStyle | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const source = value as GridStrokeInjectionStyle;
    const base = normalizeSideStyle(source);
    const enableIndividualStroke = source.enableIndividualStroke !== false;
    const sides = {
        top: source.sides?.top !== false,
        right: source.sides?.right !== false,
        bottom: source.sides?.bottom !== false,
        left: source.sides?.left !== false
    };
    if (!base && source.enableIndividualStroke === undefined && source.sides === undefined) return undefined;
    return {
        ...(base || {}),
        enableIndividualStroke,
        sides
    };
}

function normalizeAssistLineStyle(value: unknown): AssistLineInjectionStyle | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const source = value as AssistLineInjectionStyle;
    const color = normalizeHexColor(source.color);
    const thickness = clampThickness(source.thickness);
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);
    if (!color && thickness === undefined && !strokeStyle) return undefined;
    return {
        color: color || undefined,
        thickness,
        strokeStyle
    };
}

function normalizeCellFillStyle(value: unknown): CellFillInjectionStyle | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const source = value as CellFillInjectionStyle;
    const color = normalizeHexColor(source.color);
    const visible = typeof source.visible === 'boolean' ? source.visible : undefined;
    if (!color && visible === undefined) return undefined;
    return {
        color: color || undefined,
        visible
    };
}

function normalizeLineBackgroundStyle(value: unknown): LineBackgroundInjectionStyle | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const source = value as LineBackgroundInjectionStyle;
    const color = normalizeHexColor(source.color);
    const opacityRaw = Number(source.opacity);
    const opacity = Number.isFinite(opacityRaw)
        ? Math.max(0, Math.min(1, opacityRaw))
        : undefined;
    const visible = typeof source.visible === 'boolean' ? source.visible : undefined;
    if (!color && opacity === undefined && visible === undefined) return undefined;
    return {
        color: color || undefined,
        opacity,
        visible
    };
}

function normalizeMarkStyle(value: unknown): MarkInjectionStyle | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const source = value as MarkInjectionStyle;
    const fillColor = normalizeHexColor(source.fillColor);
    const strokeColor = normalizeHexColor(source.strokeColor);
    const linePointStrokeColor = normalizeHexColor(source.linePointStrokeColor);
    const linePointFillColor = normalizeHexColor(source.linePointFillColor);
    const linePointThickness = clampThickness(source.linePointThickness);
    const linePointPadding = clampThickness(source.linePointPadding);
    const lineBackgroundColor = normalizeHexColor(source.lineBackgroundColor);
    const lineBackgroundOpacityRaw = Number(source.lineBackgroundOpacity);
    const lineBackgroundOpacity = Number.isFinite(lineBackgroundOpacityRaw)
        ? Math.max(0, Math.min(1, lineBackgroundOpacityRaw))
        : undefined;
    const lineBackgroundVisible = typeof source.lineBackgroundVisible === 'boolean' ? source.lineBackgroundVisible : undefined;
    const thickness = clampThickness(source.thickness);
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);
    const enabled = typeof source.enabled === 'boolean' ? source.enabled : undefined;
    const sides = source.sides && typeof source.sides === 'object'
        ? {
            top: source.sides.top !== false,
            left: source.sides.left !== false,
            right: source.sides.right !== false
        }
        : undefined;
    if (!fillColor && !strokeColor && !linePointStrokeColor && !linePointFillColor && linePointThickness === undefined && linePointPadding === undefined && !lineBackgroundColor && lineBackgroundOpacity === undefined && lineBackgroundVisible === undefined && thickness === undefined && !strokeStyle && enabled === undefined && !sides) return undefined;
    return {
        fillColor: fillColor || undefined,
        strokeColor: strokeColor || undefined,
        linePointStrokeColor: linePointStrokeColor || undefined,
        linePointFillColor: linePointFillColor || undefined,
        linePointThickness,
        linePointPadding,
        lineBackgroundColor: lineBackgroundColor || undefined,
        lineBackgroundOpacity,
        lineBackgroundVisible,
        thickness,
        strokeStyle,
        enabled,
        sides
    };
}

function normalizeMarkStyles(value: unknown): MarkInjectionStyle[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const next = value
        .map((item) => normalizeMarkStyle(item))
        .filter((item): item is MarkInjectionStyle => Boolean(item));
    return next.length > 0 ? next : undefined;
}

function normalizeColorArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const next = value
        .map((item) => normalizeHexColor(item))
        .filter((item): item is string => Boolean(item));
    return next.length > 0 ? next : undefined;
}

function normalizeBooleanArray(value: unknown): boolean[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const next = value.map((item) => Boolean(item));
    return next.length > 0 ? next : undefined;
}

function normalizeColorModeArray(value: unknown): ColorMode[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const next = value.map((item) => item === 'paint_style' ? 'paint_style' : 'hex');
    return next.length > 0 ? next : undefined;
}

function normalizeStyleIdArray(value: unknown): Array<string | null> | undefined {
    if (!Array.isArray(value)) return undefined;
    const next = value.map((item) => (typeof item === 'string' && item.trim()) ? item : null);
    return next.length > 0 ? next : undefined;
}

function hasAnyPayloadField(payload: StyleTemplatePayload): boolean {
    return Object.keys(payload).length > 0;
}

function normalizeFlatPayload(value: unknown): StyleTemplatePayload | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as StyleTemplatePayload;
    const payload: StyleTemplatePayload = {};

    const rowColors = normalizeColorArray((source as any).rowColors);
    const linePointVisible = typeof (source as any).linePointVisible === 'boolean'
        ? Boolean((source as any).linePointVisible)
        : undefined;
    const lineFeature2Enabled = typeof (source as any).lineFeature2Enabled === 'boolean'
        ? Boolean((source as any).lineFeature2Enabled)
        : undefined;
    const rowColorModes = normalizeColorModeArray((source as any).rowColorModes);
    const rowPaintStyleIds = normalizeStyleIdArray((source as any).rowPaintStyleIds);
    const cellFillStyle = normalizeCellFillStyle(source.cellFillStyle);
    const lineBackgroundStyle = normalizeLineBackgroundStyle(source.lineBackgroundStyle);
    const cellTopStyle = normalizeSideStyle(source.cellTopStyle || source.cellBottomStyle);
    const tabRightStyle = normalizeSideStyle(source.tabRightStyle);
    const gridContainerStyle = normalizeGridStyle(source.gridContainerStyle);
    const assistLineStyle = normalizeAssistLineStyle(source.assistLineStyle);
    const markStyle = normalizeMarkStyle(source.markStyle);
    const markStyles = normalizeMarkStyles(source.markStyles);
    const colColors = normalizeColorArray((source as any).colColors);
    const colColorEnabled = normalizeBooleanArray((source as any).colColorEnabled);
    const colColorModes = normalizeColorModeArray((source as any).colColorModes);
    const colPaintStyleIds = normalizeStyleIdArray((source as any).colPaintStyleIds);

    if (rowColors) payload.rowColors = rowColors;
    if (linePointVisible !== undefined) payload.linePointVisible = linePointVisible;
    if (lineFeature2Enabled !== undefined) payload.lineFeature2Enabled = lineFeature2Enabled;
    if (rowColorModes) payload.rowColorModes = rowColorModes;
    if (rowPaintStyleIds) payload.rowPaintStyleIds = rowPaintStyleIds;
    if (cellFillStyle) payload.cellFillStyle = cellFillStyle;
    if (lineBackgroundStyle) payload.lineBackgroundStyle = lineBackgroundStyle;
    if (cellTopStyle) payload.cellTopStyle = cellTopStyle;
    if (tabRightStyle) payload.tabRightStyle = tabRightStyle;
    if (gridContainerStyle) payload.gridContainerStyle = gridContainerStyle;
    if (assistLineStyle) payload.assistLineStyle = assistLineStyle;
    if (markStyle) payload.markStyle = markStyle;
    if (markStyles) payload.markStyles = markStyles;
    if (colColors) payload.colColors = colColors;
    if (colColorEnabled) payload.colColorEnabled = colColorEnabled;
    if (colColorModes) payload.colColorModes = colColorModes;
    if (colPaintStyleIds) payload.colPaintStyleIds = colPaintStyleIds;

    return hasAnyPayloadField(payload) ? payload : null;
}

function isStructuredPayload(value: unknown): value is StyleTemplateStoredPayload {
    if (!value || typeof value !== 'object') return false;
    const source = value as any;
    return typeof source.common === 'object' || typeof source.byChart === 'object';
}

function pickCommonPayload(flat: StyleTemplatePayload): StyleTemplatePayload {
    const common: StyleTemplatePayload = {};
    if (flat.cellFillStyle) common.cellFillStyle = flat.cellFillStyle;
    if (flat.cellTopStyle) common.cellTopStyle = flat.cellTopStyle;
    if (flat.tabRightStyle) common.tabRightStyle = flat.tabRightStyle;
    if (flat.gridContainerStyle) common.gridContainerStyle = flat.gridContainerStyle;
    if (flat.assistLineStyle) common.assistLineStyle = flat.assistLineStyle;
    if (flat.markStyle) common.markStyle = flat.markStyle;
    if (flat.markStyles) common.markStyles = flat.markStyles;
    return common;
}

function pickChartPayload(flat: StyleTemplatePayload, chartType: StyleTemplateChartType): StyleTemplatePayload {
    const scoped: StyleTemplatePayload = {};
    if (flat.rowColors) scoped.rowColors = flat.rowColors;
    if (flat.rowColorModes) scoped.rowColorModes = flat.rowColorModes;
    if (flat.rowPaintStyleIds) scoped.rowPaintStyleIds = flat.rowPaintStyleIds;

    if (chartType === 'bar') {
        if (flat.colColors) scoped.colColors = flat.colColors;
        if (flat.colColorEnabled) scoped.colColorEnabled = flat.colColorEnabled;
        if (flat.colColorModes) scoped.colColorModes = flat.colColorModes;
        if (flat.colPaintStyleIds) scoped.colPaintStyleIds = flat.colPaintStyleIds;
    }
    if (chartType === 'line') {
        if (flat.lineBackgroundStyle) scoped.lineBackgroundStyle = flat.lineBackgroundStyle;
        if (typeof flat.linePointVisible === 'boolean') scoped.linePointVisible = flat.linePointVisible;
        if (typeof flat.lineFeature2Enabled === 'boolean') scoped.lineFeature2Enabled = flat.lineFeature2Enabled;
    }
    return scoped;
}

function normalizeStructuredPayload(value: unknown, chartType: StyleTemplateChartType): StyleTemplateStoredPayload | null {
    if (!value || typeof value !== 'object') return null;

    if (isStructuredPayload(value)) {
        const source = value as StyleTemplateStoredPayload;
        const common = normalizeFlatPayload(source.common);
        const byChartRaw = source.byChart || {};
        const bar = normalizeFlatPayload(byChartRaw.bar);
        const line = normalizeFlatPayload(byChartRaw.line);
        const stackedBar = normalizeFlatPayload(byChartRaw.stackedBar);
        const next: StyleTemplateStoredPayload = {};
        if (common) next.common = common;
        if (bar || line || stackedBar) {
            next.byChart = {};
            if (bar) next.byChart.bar = bar;
            if (line) next.byChart.line = line;
            if (stackedBar) next.byChart.stackedBar = stackedBar;
        }
        const hasAny = Boolean(next.common) || Boolean(next.byChart && Object.keys(next.byChart).length > 0);
        return hasAny ? next : null;
    }

    const flat = normalizeFlatPayload(value);
    if (!flat) return null;
    const common = pickCommonPayload(flat);
    const scoped = pickChartPayload(flat, chartType);
    const payload: StyleTemplateStoredPayload = {};
    if (hasAnyPayloadField(common)) payload.common = common;
    if (hasAnyPayloadField(scoped)) {
        payload.byChart = { [chartType]: scoped };
    }
    const hasAny = Boolean(payload.common) || Boolean(payload.byChart && Object.keys(payload.byChart).length > 0);
    return hasAny ? payload : null;
}

function normalizeTemplateName(name: unknown): string | null {
    if (typeof name !== 'string') return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (trimmed.length > 40) return null;
    return trimmed;
}

function normalizeThumbnailDataUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed || !trimmed.startsWith('data:image/')) return undefined;
    return trimmed;
}

function sortTemplates(items: StyleTemplateItem[]): StyleTemplateItem[] {
    return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
}

function normalizeTemplateItem(value: unknown): StyleTemplateItem | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as StyleTemplateItem;
    const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : null;
    const name = normalizeTemplateName(source.name);
    const chartType = normalizeTemplateChartType((source as any).chartType);
    const payload = normalizeStructuredPayload(source.payload, chartType);
    const thumbnailDataUrl = normalizeThumbnailDataUrl(source.thumbnailDataUrl);
    const createdAt = Number(source.createdAt);
    const updatedAt = Number(source.updatedAt);

    if (!id || !name || !payload) return null;
    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;

    return {
        id,
        name,
        chartType,
        payload,
        thumbnailDataUrl,
        createdAt,
        updatedAt
    };
}

async function loadAllStyleTemplates(): Promise<StyleTemplateItem[]> {
    const raw = await figma.clientStorage.getAsync(CLIENT_STORAGE_KEYS.STYLE_TEMPLATES);
    const parsed = Array.isArray(raw) ? raw : [];
    const normalized = parsed
        .map((item) => normalizeTemplateItem(item))
        .filter((item): item is StyleTemplateItem => Boolean(item));
    return sortTemplates(normalized);
}

export async function loadStyleTemplates(chartTypeInput?: unknown): Promise<StyleTemplateItem[]> {
    const chartType = normalizeTemplateChartType(chartTypeInput);
    const all = await loadAllStyleTemplates();
    return all
        .filter((item) => normalizeTemplateChartType((item as any).chartType) === chartType)
        .slice(0, MAX_STYLE_TEMPLATES);
}

async function persistTemplates(items: StyleTemplateItem[]) {
    const trimmed = sortTemplates(items);
    await figma.clientStorage.setAsync(CLIENT_STORAGE_KEYS.STYLE_TEMPLATES, trimmed);
    return trimmed;
}

export async function saveStyleTemplate(
    name: unknown,
    payloadInput: unknown,
    chartTypeInput?: unknown,
    thumbnailDataUrlInput?: unknown
): Promise<{ list?: StyleTemplateItem[]; error?: string }> {
    const normalizedName = normalizeTemplateName(name);
    if (!normalizedName) return { error: 'Template name must be 1-40 chars.' };
    const chartType = normalizeTemplateChartType(chartTypeInput);

    const payload = normalizeStructuredPayload(payloadInput, chartType);
    if (!payload) return { error: 'Template payload is empty or invalid.' };
    const thumbnailDataUrl = normalizeThumbnailDataUrl(thumbnailDataUrlInput);

    const list = await loadAllStyleTemplates();
    const sameChartTypeCount = list.filter((item) => normalizeTemplateChartType((item as any).chartType) === chartType).length;
    if (sameChartTypeCount >= MAX_STYLE_TEMPLATES) {
        return { error: `Maximum ${MAX_STYLE_TEMPLATES} templates allowed.` };
    }

    const now = Date.now();
    const item: StyleTemplateItem = {
        id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
        name: normalizedName,
        chartType,
        payload,
        thumbnailDataUrl,
        createdAt: now,
        updatedAt: now
    };

    await persistTemplates([item, ...list]);
    return { list: await loadStyleTemplates(chartType) };
}

export async function deleteStyleTemplate(id: unknown, chartTypeInput?: unknown): Promise<{ list?: StyleTemplateItem[]; error?: string }> {
    if (typeof id !== 'string' || !id.trim()) return { error: 'Invalid template id.' };
    const chartType = normalizeTemplateChartType(chartTypeInput);
    const list = await loadAllStyleTemplates();
    const next = list.filter((item) => item.id !== id);
    if (next.length === list.length) return { error: 'Template not found.' };
    await persistTemplates(next);
    return { list: await loadStyleTemplates(chartType) };
}

export async function renameStyleTemplate(
    id: unknown,
    name: unknown,
    chartTypeInput?: unknown
): Promise<{ list?: StyleTemplateItem[]; error?: string }> {
    if (typeof id !== 'string' || !id.trim()) return { error: 'Invalid template id.' };
    const normalizedName = normalizeTemplateName(name);
    if (!normalizedName) return { error: 'Template name must be 1-40 chars.' };
    const chartType = normalizeTemplateChartType(chartTypeInput);

    const list = await loadAllStyleTemplates();
    let found = false;
    const now = Date.now();
    const next = list.map((item) => {
        if (item.id !== id) return item;
        found = true;
        return {
            ...item,
            name: normalizedName,
            updatedAt: now
        };
    });
    if (!found) return { error: 'Template not found.' };
    await persistTemplates(next);
    return { list: await loadStyleTemplates(chartType) };
}

export async function overwriteStyleTemplate(
    id: unknown,
    payloadInput: unknown,
    chartTypeInput?: unknown,
    thumbnailDataUrlInput?: unknown
): Promise<{ list?: StyleTemplateItem[]; error?: string }> {
    if (typeof id !== 'string' || !id.trim()) return { error: 'Invalid template id.' };
    const chartType = normalizeTemplateChartType(chartTypeInput);
    const payload = normalizeStructuredPayload(payloadInput, chartType);
    if (!payload) return { error: 'Template payload is empty or invalid.' };
    const nextThumbnailDataUrl = normalizeThumbnailDataUrl(thumbnailDataUrlInput);

    const list = await loadAllStyleTemplates();
    let found = false;
    const now = Date.now();
    const next = list.map((item) => {
        if (item.id !== id) return item;
        found = true;
        return {
            ...item,
            payload,
            thumbnailDataUrl: nextThumbnailDataUrl || item.thumbnailDataUrl,
            updatedAt: now
        };
    });
    if (!found) return { error: 'Template not found.' };
    await persistTemplates(next);
    return { list: await loadStyleTemplates(chartType) };
}
