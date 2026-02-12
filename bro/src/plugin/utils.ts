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
