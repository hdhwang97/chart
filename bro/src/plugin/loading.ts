import { clamp } from './utils';

const loadingOpacityState = new Map<string, { depth: number; originalOpacity: number }>();
const DEFAULT_LOADING_OPACITY = 0.3;
const LOADING_OPACITY_RENDER_DELAY_MS = 32;

function canSetOpacity(node: SceneNode): node is SceneNode & BlendMixin {
    return 'opacity' in node;
}

function delay(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function beginLoadingOpacity(node: SceneNode, opacity = DEFAULT_LOADING_OPACITY): boolean {
    if (!canSetOpacity(node)) return false;
    const current = loadingOpacityState.get(node.id);
    if (current) {
        current.depth += 1;
        loadingOpacityState.set(node.id, current);
        return true;
    }
    try {
        loadingOpacityState.set(node.id, {
            depth: 1,
            originalOpacity: node.opacity
        });
        node.opacity = clamp(opacity, 0, 1);
        return true;
    } catch (e) {
        loadingOpacityState.delete(node.id);
        console.warn('[chart-plugin][loading-opacity] apply skipped', {
            nodeId: node.id,
            nodeName: node.name,
            error: e instanceof Error ? e.message : String(e)
        });
        return false;
    }
}

export function endLoadingOpacity(node: SceneNode) {
    const current = loadingOpacityState.get(node.id);
    if (!current) return;
    if (current.depth > 1) {
        current.depth -= 1;
        loadingOpacityState.set(node.id, current);
        return;
    }
    loadingOpacityState.delete(node.id);
    if (!canSetOpacity(node)) return;
    try {
        node.opacity = current.originalOpacity;
    } catch (e) {
        console.warn('[chart-plugin][loading-opacity] restore skipped', {
            nodeId: node.id,
            nodeName: node.name,
            error: e instanceof Error ? e.message : String(e)
        });
    }
}

export async function withLoadingOpacity<T>(
    node: SceneNode,
    task: () => Promise<T> | T,
    opacity = DEFAULT_LOADING_OPACITY
): Promise<T> {
    const hadExistingLoadingState = loadingOpacityState.has(node.id);
    const applied = beginLoadingOpacity(node, opacity);
    if (applied && !hadExistingLoadingState) {
        await delay(LOADING_OPACITY_RENDER_DELAY_MS);
    }
    try {
        return await task();
    } finally {
        endLoadingOpacity(node);
    }
}
