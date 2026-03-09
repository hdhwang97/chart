export function isUiDebugEnabled(): boolean {
    try {
        const flag = (globalThis as { __CHART_UI_DEBUG__?: unknown }).__CHART_UI_DEBUG__;
        return flag === true;
    } catch {
        return false;
    }
}

export function uiDebugLog(...args: unknown[]) {
    if (!isUiDebugEnabled()) return;
    console.log(...args);
}
