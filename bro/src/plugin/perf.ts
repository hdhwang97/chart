type PerfStepRunner<T> = () => T | Promise<T>;

export type ApplyPerfReport = {
    totalMs: number;
    steps: Record<string, number>;
};

type PerfLogMeta = {
    messageType: string;
    chartType: string;
    targetNodeId?: string;
    targetNodeName?: string;
    targetNodeType?: string;
    applyPolicy?: string;
    reason?: string;
};

export class PerfTracker {
    private readonly startTs: number;
    private readonly steps: Record<string, number>;

    constructor() {
        this.startTs = Date.now();
        this.steps = {};
    }

    async step<T>(name: string, runner: PerfStepRunner<T>): Promise<T> {
        const stepStart = Date.now();
        const result = await runner();
        const elapsed = Date.now() - stepStart;
        this.steps[name] = (this.steps[name] || 0) + elapsed;
        return result;
    }

    done(): ApplyPerfReport {
        return {
            totalMs: Date.now() - this.startTs,
            steps: { ...this.steps }
        };
    }
}

function toSeconds(ms: number) {
    return Math.round((ms / 1000) * 1000) / 1000;
}

function toPercent(ms: number, totalMs: number) {
    if (!Number.isFinite(totalMs) || totalMs <= 0) return '0%';
    return `${Math.round((ms / totalMs) * 100)}%`;
}

export function logApplyPerf(report: ApplyPerfReport, meta: PerfLogMeta) {
    const highlightedSteps = ['load-chart-data', 'resolve-y-range', 'basic-setup', 'draw-chart', 'stroke-injection', 'flat-padding-sync', 'style-payload-build', 'save-and-sync', 'post-preview-update'];
    const stepRows = Object.entries(report.steps)
        .sort((a, b) => b[1] - a[1])
        .map(([step, ms]) => ({
            step,
            ms,
            sec: toSeconds(ms),
            share: toPercent(ms, report.totalMs)
        }));
    const highlightRows = highlightedSteps
        .filter((step) => typeof report.steps[step] === 'number')
        .map((step) => ({
            step,
            ms: report.steps[step],
            sec: toSeconds(report.steps[step]),
            share: toPercent(report.steps[step], report.totalMs)
        }));
    const summaryRows = [{
        messageType: meta.messageType,
        reason: meta.reason || '-',
        chartType: meta.chartType,
        totalMs: report.totalMs,
        totalSec: toSeconds(report.totalMs),
        targetNodeType: meta.targetNodeType || '-',
        applyPolicy: meta.applyPolicy || '-',
        targetNodeName: meta.targetNodeName || '-',
        targetNodeId: meta.targetNodeId || '-'
    }];
    const label = `[chart-plugin][perf] ${meta.messageType}/${meta.chartType}${meta.reason ? `/${meta.reason}` : ''} ${report.totalMs}ms (${toSeconds(report.totalMs)}s)`;

    if (typeof console.groupCollapsed === 'function') {
        console.groupCollapsed(label);
        if (typeof console.table === 'function') {
            console.table(summaryRows);
            if (highlightRows.length > 0) console.table(highlightRows);
            if (stepRows.length > 0) console.table(stepRows);
        } else {
            console.info(label, { summary: summaryRows[0], highlights: highlightRows, steps: stepRows });
        }
        if (typeof console.groupEnd === 'function') {
            console.groupEnd();
        }
        return;
    }

    console.info(label, { summary: summaryRows[0], highlights: highlightRows, steps: stepRows });
}
