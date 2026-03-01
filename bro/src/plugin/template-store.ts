import { CLIENT_STORAGE_KEYS } from './constants';
import { normalizeHexColor } from './utils';
import type {
    AssistLineInjectionStyle,
    CellFillInjectionStyle,
    GridStrokeInjectionStyle,
    MarkInjectionStyle,
    SideStrokeInjectionStyle,
    StyleTemplateItem,
    StyleTemplatePayload
} from '../shared/style-types';

const MAX_STYLE_TEMPLATES = 20;

function clampThickness(value: unknown): number | undefined {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return Math.max(0, Math.min(20, Math.round(n)));
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
    if (!color) return undefined;
    return { color };
}

function normalizeMarkStyle(value: unknown): MarkInjectionStyle | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const source = value as MarkInjectionStyle;
    const fillColor = normalizeHexColor(source.fillColor);
    const strokeColor = normalizeHexColor(source.strokeColor);
    const thickness = clampThickness(source.thickness);
    const strokeStyle = source.strokeStyle === 'dash' ? 'dash' : (source.strokeStyle === 'solid' ? 'solid' : undefined);
    if (!fillColor && !strokeColor && thickness === undefined && !strokeStyle) return undefined;
    return {
        fillColor: fillColor || undefined,
        strokeColor: strokeColor || undefined,
        thickness,
        strokeStyle
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

function normalizePayload(value: unknown): StyleTemplatePayload | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as StyleTemplatePayload;
    const payload: StyleTemplatePayload = {};

    const cellFillStyle = normalizeCellFillStyle(source.cellFillStyle);
    const cellTopStyle = normalizeSideStyle(source.cellTopStyle || source.cellBottomStyle);
    const tabRightStyle = normalizeSideStyle(source.tabRightStyle);
    const gridContainerStyle = normalizeGridStyle(source.gridContainerStyle);
    const assistLineStyle = normalizeAssistLineStyle(source.assistLineStyle);
    const markStyle = normalizeMarkStyle(source.markStyle);
    const markStyles = normalizeMarkStyles(source.markStyles);
    const colColors = normalizeColorArray((source as any).colColors);
    const colColorEnabled = normalizeBooleanArray((source as any).colColorEnabled);

    if (cellFillStyle) payload.cellFillStyle = cellFillStyle;
    if (cellTopStyle) payload.cellTopStyle = cellTopStyle;
    if (tabRightStyle) payload.tabRightStyle = tabRightStyle;
    if (gridContainerStyle) payload.gridContainerStyle = gridContainerStyle;
    if (assistLineStyle) payload.assistLineStyle = assistLineStyle;
    if (markStyle) payload.markStyle = markStyle;
    if (markStyles) payload.markStyles = markStyles;
    if (colColors) payload.colColors = colColors;
    if (colColorEnabled) payload.colColorEnabled = colColorEnabled;

    const hasAnyField = Object.keys(payload).length > 0;
    return hasAnyField ? payload : null;
}

function normalizeTemplateName(name: unknown): string | null {
    if (typeof name !== 'string') return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (trimmed.length > 40) return null;
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
    const payload = normalizePayload(source.payload);
    const createdAt = Number(source.createdAt);
    const updatedAt = Number(source.updatedAt);

    if (!id || !name || !payload) return null;
    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;

    return {
        id,
        name,
        payload,
        createdAt,
        updatedAt
    };
}

export async function loadStyleTemplates(): Promise<StyleTemplateItem[]> {
    const raw = await figma.clientStorage.getAsync(CLIENT_STORAGE_KEYS.STYLE_TEMPLATES);
    const parsed = Array.isArray(raw) ? raw : [];
    const normalized = parsed
        .map((item) => normalizeTemplateItem(item))
        .filter((item): item is StyleTemplateItem => Boolean(item));
    return sortTemplates(normalized).slice(0, MAX_STYLE_TEMPLATES);
}

async function persistTemplates(items: StyleTemplateItem[]) {
    const trimmed = sortTemplates(items).slice(0, MAX_STYLE_TEMPLATES);
    await figma.clientStorage.setAsync(CLIENT_STORAGE_KEYS.STYLE_TEMPLATES, trimmed);
    return trimmed;
}

export async function saveStyleTemplate(name: unknown, payloadInput: unknown): Promise<{ list?: StyleTemplateItem[]; error?: string }> {
    const normalizedName = normalizeTemplateName(name);
    if (!normalizedName) return { error: 'Template name must be 1-40 chars.' };

    const payload = normalizePayload(payloadInput);
    if (!payload) return { error: 'Template payload is empty or invalid.' };

    const list = await loadStyleTemplates();
    if (list.length >= MAX_STYLE_TEMPLATES) {
        return { error: `Maximum ${MAX_STYLE_TEMPLATES} templates allowed.` };
    }

    const now = Date.now();
    const item: StyleTemplateItem = {
        id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
        name: normalizedName,
        payload,
        createdAt: now,
        updatedAt: now
    };

    const next = await persistTemplates([item, ...list]);
    return { list: next };
}

export async function deleteStyleTemplate(id: unknown): Promise<{ list?: StyleTemplateItem[]; error?: string }> {
    if (typeof id !== 'string' || !id.trim()) return { error: 'Invalid template id.' };
    const list = await loadStyleTemplates();
    const next = list.filter((item) => item.id !== id);
    if (next.length === list.length) return { error: 'Template not found.' };
    return { list: await persistTemplates(next) };
}

export async function renameStyleTemplate(id: unknown, name: unknown): Promise<{ list?: StyleTemplateItem[]; error?: string }> {
    if (typeof id !== 'string' || !id.trim()) return { error: 'Invalid template id.' };
    const normalizedName = normalizeTemplateName(name);
    if (!normalizedName) return { error: 'Template name must be 1-40 chars.' };

    const list = await loadStyleTemplates();
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
    return { list: await persistTemplates(next) };
}
