import { MARK_NAME_PATTERNS } from './constants';

// ==========================================
// UTILITIES & HELPERS
// ==========================================

export function traverse(node: SceneNode, callback: (n: SceneNode) => void) {
    callback(node);
    if ("children" in node) {
        for (const child of (node as any).children) {
            traverse(child, callback);
        }
    }
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function rgbToHex(r: number, g: number, b: number): string {
    const toHex = (value: number) => {
        const hex = Math.round(value * 255).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function findActualPropKey(props: any, propName: string): string | null {
    if (!props) return null;
    const keys = Object.keys(props);
    if (keys.includes(propName)) return propName;
    const found = keys.find(k => k.startsWith(propName + '#'));
    return found || null;
}

export function findAllLineLayers(parentNode: SceneNode): (SceneNode & LayoutMixin)[] {
    const results: (SceneNode & LayoutMixin)[] = [];
    if ("children" in parentNode) {
        (parentNode as any).children.forEach((child: SceneNode) => {
            if (MARK_NAME_PATTERNS.LINE.test(child.name)) {
                results.push(child as (SceneNode & LayoutMixin));
            }
        });
    }
    return results;
}

export function normalizeHexColor(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const m = value.trim().toUpperCase().match(/^#?([0-9A-F]{6})$/);
    if (!m) return null;
    return `#${m[1]}`;
}

export function hexToRgb01(hex: string) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return null;
    const raw = normalized.slice(1);
    return {
        r: parseInt(raw.slice(0, 2), 16) / 255,
        g: parseInt(raw.slice(2, 4), 16) / 255,
        b: parseInt(raw.slice(4, 6), 16) / 255
    };
}

export function buildSolidPaint(hex: string): SolidPaint | null {
    const rgb = hexToRgb01(hex);
    if (!rgb) return null;
    return {
        type: 'SOLID',
        color: rgb
    };
}

export function tryApplyFill(node: SceneNode, hex: string) {
    if (!('fills' in node)) return false;
    const paint = buildSolidPaint(hex);
    if (!paint) return false;
    try {
        (node as SceneNode & GeometryMixin).fills = [paint];
        return true;
    } catch (e) {
        console.warn('[chart-plugin][color] fill override skipped', {
            nodeId: node.id,
            nodeName: node.name,
            error: e instanceof Error ? e.message : String(e)
        });
        return false;
    }
}

export function tryApplyStroke(node: SceneNode, hex: string) {
    if (!('strokes' in node)) return false;
    const paint = buildSolidPaint(hex);
    if (!paint) return false;
    try {
        (node as SceneNode & GeometryMixin).strokes = [paint];
        return true;
    } catch (e) {
        console.warn('[chart-plugin][color] stroke override skipped', {
            nodeId: node.id,
            nodeName: node.name,
            error: e instanceof Error ? e.message : String(e)
        });
        return false;
    }
}
