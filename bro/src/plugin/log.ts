export function isPluginDebugEnabled(): boolean {
    try {
        const flag = (globalThis as { __CHART_PLUGIN_DEBUG__?: unknown }).__CHART_PLUGIN_DEBUG__;
        return flag === true;
    } catch {
        return false;
    }
}

export function debugLog(...args: unknown[]) {
    if (!isPluginDebugEnabled()) return;
    console.log(...args);
}
