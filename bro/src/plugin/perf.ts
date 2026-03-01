type PerfStepRunner<T> = () => T | Promise<T>;

export type ApplyPerfReport = {
    totalMs: number;
    steps: Record<string, number>;
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

export function shouldLogApplyPerf(messageType: string, chartType: string): boolean {
    return messageType === 'apply' && (chartType === 'stackedBar' || chartType === 'stacked');
}
