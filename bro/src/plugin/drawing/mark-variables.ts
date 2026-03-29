import { buildSolidPaint, normalizeHexColor } from '../utils';

export type VariableUpdateMode = 'overwrite' | 'create';

type MarkSlotKind = 'color' | 'number';
type PaintField = 'fills' | 'strokes';
type NumberField = 'strokeWeight' | 'strokeTopWeight' | 'strokeRightWeight' | 'strokeBottomWeight' | 'strokeLeftWeight' | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft';

const COLOR_COLLECTION_NAME = 'chart-color';
const NUMBER_COLLECTION_NAME = 'chart-number';

function isSceneNodeWithPaintField(node: SceneNode, field: PaintField): node is SceneNode & GeometryMixin {
    return field in node;
}

function toRgbValue(hex: string): RGBA | null {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return null;
    const paint = buildSolidPaint(normalized);
    if (!paint) return null;
    return {
        ...paint.color,
        a: 1
    };
}

function parseBoundAliasId(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const alias = value as { id?: unknown };
    return typeof alias.id === 'string' ? alias.id : null;
}

function readNodeBoundColorVariableId(node: SceneNode, field: PaintField): string | null {
    const aliases = (node.boundVariables as any)?.[field];
    if (!Array.isArray(aliases) || aliases.length === 0) return null;
    return parseBoundAliasId(aliases[0]);
}

function readNodeBoundNumberVariableId(node: SceneNode, fields: NumberField[]): string | null {
    for (const field of fields) {
        const alias = (node.boundVariables as any)?.[field];
        const aliasId = parseBoundAliasId(alias);
        if (aliasId) return aliasId;
    }
    return null;
}

function normalizeNumber(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
}

function ensureCollection(name: string): VariableCollection {
    const existing = figma.variables.getLocalVariableCollections().find((collection) => collection.name === name);
    if (existing) return existing;
    return figma.variables.createVariableCollection(name);
}

export class MarkVariableBinder {
    private readonly graphNodeId: string;
    private readonly updateMode: VariableUpdateMode;
    private readonly colorCollection: VariableCollection;
    private readonly numberCollection: VariableCollection;
    private readonly slotVariableIdMap: Record<string, string>;
    private readonly localVariableIdCache = new Map<string, Variable | null>();
    private readonly localColorVariableByName = new Map<string, Variable>();
    private readonly localNumberVariableByName = new Map<string, Variable>();

    constructor(params: {
        graphNodeId: string;
        updateMode: VariableUpdateMode;
        slotVariableIdMap?: Record<string, string>;
    }) {
        this.graphNodeId = params.graphNodeId;
        this.updateMode = params.updateMode;
        this.slotVariableIdMap = { ...(params.slotVariableIdMap || {}) };
        this.colorCollection = ensureCollection(COLOR_COLLECTION_NAME);
        this.numberCollection = ensureCollection(NUMBER_COLLECTION_NAME);
        const locals = figma.variables.getLocalVariables();
        locals.forEach((variable) => {
            this.localVariableIdCache.set(variable.id, variable);
            if (variable.variableCollectionId === this.colorCollection.id && variable.resolvedType === 'COLOR') {
                this.localColorVariableByName.set(variable.name, variable);
            }
            if (variable.variableCollectionId === this.numberCollection.id && variable.resolvedType === 'FLOAT') {
                this.localNumberVariableByName.set(variable.name, variable);
            }
        });
    }

    getSlotVariableIdMap() {
        return { ...this.slotVariableIdMap };
    }

    bindStrokeColor(node: SceneNode, markIndex: number, hex?: string) {
        this.bindPaintColor(node, 'strokes', `color/${markIndex}_str`, hex);
    }

    bindFillColor(node: SceneNode, markIndex: number, hex?: string) {
        this.bindPaintColor(node, 'fills', `color/${markIndex}_fill`, hex);
    }

    bindLineBackgroundColor(node: SceneNode, markIndex: number, hex?: string, opacity?: number) {
        this.bindPaintColor(node, 'fills', `color/${markIndex}_area`, hex, opacity);
    }

    bindLinePointStrokeColor(node: SceneNode, markIndex: number, hex?: string) {
        this.bindPaintColor(node, 'strokes', `color/${markIndex}_pt_stroke`, hex);
    }

    bindLinePointFillColor(node: SceneNode, markIndex: number, hex?: string) {
        this.bindPaintColor(node, 'fills', `color/${markIndex}_pt_fill`, hex);
    }

    bindStrokeThickness(node: SceneNode, markIndex: number, thickness?: number) {
        this.bindNumber(node, [`strokeWeight`, `strokeTopWeight`, `strokeRightWeight`, `strokeLeftWeight`], `number/${markIndex}_thk`, thickness);
    }

    bindFlatTopStrokeThickness(node: SceneNode, markIndex: number, thickness?: number) {
        this.bindNumber(node, [`strokeTopWeight`], `number/${markIndex}_thk`, thickness);
    }

    bindLinePointThickness(node: SceneNode, markIndex: number, thickness?: number) {
        this.bindNumber(node, [`strokeWeight`, `strokeTopWeight`, `strokeRightWeight`, `strokeBottomWeight`, `strokeLeftWeight`], `number/${markIndex}_pt_thk`, thickness);
    }

    bindLinePointRadius(node: SceneNode, markIndex: number, padding?: number) {
        this.bindNumber(node, [`paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`], `number/${markIndex}_pt_radius`, padding);
    }

    private bindPaintColor(node: SceneNode, field: PaintField, slotKey: string, hex?: string, opacity?: number) {
        const normalizedHex = typeof hex === 'string' ? normalizeHexColor(hex) : null;
        if (!normalizedHex) return;
        const rgbValue = toRgbValue(normalizedHex);
        if (!rgbValue) return;
        if (!isSceneNodeWithPaintField(node, field)) return;
        const target = node as SceneNode & GeometryMixin;
        const current = Array.isArray(target[field]) ? [...target[field]] : [];
        const first = current[0];
        const fallbackPaint = buildSolidPaint(normalizedHex, opacity);
        if (!fallbackPaint) return;
        const solidPaint: SolidPaint = first && first.type === 'SOLID'
            ? { ...first }
            : fallbackPaint;
        if (typeof opacity === 'number') {
            solidPaint.opacity = Math.max(0, Math.min(1, opacity));
        }

        const variable = this.resolveVariable({
            kind: 'color',
            slotKey,
            node,
            paintField: field
        });
        if (!variable) return;
        variable.setValueForMode(this.colorCollection.defaultModeId, rgbValue);
        const boundPaint = figma.variables.setBoundVariableForPaint(solidPaint, 'color', variable);
        current[0] = boundPaint;
        target[field] = current;
    }

    private bindNumber(
        node: SceneNode,
        fields: NumberField[],
        slotKey: string,
        rawValue?: number
    ) {
        const numeric = normalizeNumber(rawValue);
        if (numeric === null) return;
        const variable = this.resolveVariable({
            kind: 'number',
            slotKey,
            node,
            numberFields: fields
        });
        if (!variable) return;
        variable.setValueForMode(this.numberCollection.defaultModeId, numeric);
        fields.forEach((field) => {
            try {
                node.setBoundVariable(field, variable);
            } catch {
                // ignored: not all node types support all fields
            }
        });
    }

    private resolveVariable(params: {
        kind: MarkSlotKind;
        slotKey: string;
        node: SceneNode;
        paintField?: PaintField;
        numberFields?: NumberField[];
    }): Variable | null {
        const expectedType: VariableResolvedDataType = params.kind === 'color' ? 'COLOR' : 'FLOAT';
        const collection = params.kind === 'color' ? this.colorCollection : this.numberCollection;

        if (this.updateMode === 'overwrite') {
            const fromSlotMap = this.readVariableById(this.slotVariableIdMap[params.slotKey], expectedType);
            if (fromSlotMap) {
                this.slotVariableIdMap[params.slotKey] = fromSlotMap.id;
                return fromSlotMap;
            }

            const boundId = params.kind === 'color'
                ? (params.paintField ? readNodeBoundColorVariableId(params.node, params.paintField) : null)
                : readNodeBoundNumberVariableId(params.node, params.numberFields || []);
            const fromNodeBound = this.readVariableById(boundId, expectedType);
            if (fromNodeBound) {
                this.slotVariableIdMap[params.slotKey] = fromNodeBound.id;
                return fromNodeBound;
            }
        }

        const variableName = `${this.graphNodeId}/${params.slotKey}`;
        const fromName = params.kind === 'color'
            ? this.localColorVariableByName.get(variableName)
            : this.localNumberVariableByName.get(variableName);
        const resolved = fromName || figma.variables.createVariable(variableName, collection, expectedType);
        if (params.kind === 'color') this.localColorVariableByName.set(variableName, resolved);
        else this.localNumberVariableByName.set(variableName, resolved);
        this.localVariableIdCache.set(resolved.id, resolved);
        this.slotVariableIdMap[params.slotKey] = resolved.id;
        return resolved;
    }

    private readVariableById(id: string | null | undefined, expectedType: VariableResolvedDataType): Variable | null {
        if (!id) return null;
        const cached = this.localVariableIdCache.get(id);
        if (cached !== undefined) {
            return cached && cached.resolvedType === expectedType ? cached : null;
        }
        const variable = figma.variables.getVariableById(id);
        this.localVariableIdCache.set(id, variable || null);
        if (!variable || variable.resolvedType !== expectedType) return null;
        return variable;
    }
}
