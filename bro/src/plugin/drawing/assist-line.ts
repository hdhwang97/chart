import { collectColumns } from './shared';
import { clamp, traverse, findActualPropKey, normalizeHexColor, tryApplyStroke } from '../utils';

type AssistMetricType = 'min' | 'max' | 'avg';

type AssistLineEnabled = {
    min: boolean;
    max: boolean;
    avg: boolean;
};

type AssistLineStyle = {
    color?: string;
    thickness?: number;
};

const DEFAULT_ASSIST_LINE_ENABLED: AssistLineEnabled = {
    min: false,
    max: false,
    avg: false
};

function normalizeAssistLineEnabled(value: any): AssistLineEnabled {
    if (!value || typeof value !== 'object') {
        return { ...DEFAULT_ASSIST_LINE_ENABLED };
    }
    return {
        min: Boolean((value as any).min),
        max: Boolean((value as any).max),
        avg: Boolean((value as any).avg)
    };
}

function parseMetricFromName(name: string): AssistMetricType | null {
    const lower = name.toLowerCase();
    if (!lower.includes('asst_line')) return null;
    if (lower.includes('min') || lower.includes('최소')) return 'min';
    if (lower.includes('max') || lower.includes('최대')) return 'max';
    if (lower.includes('avg') || lower.includes('average') || lower.includes('평균')) return 'avg';
    return null;
}

function resolveAssistLineNodes(graph: SceneNode): Record<AssistMetricType, SceneNode[]> {
    const nodes: Record<AssistMetricType, SceneNode[]> = {
        min: [],
        max: [],
        avg: []
    };

    traverse(graph, (node) => {
        const metric = parseMetricFromName(node.name);
        if (!metric) return;
        nodes[metric].push(node);
    });

    return nodes;
}

function computeMetrics(values: any[][]): Record<AssistMetricType, number> {
    const flat: number[] = [];
    if (Array.isArray(values)) {
        values.forEach((row) => {
            if (!Array.isArray(row)) return;
            row.forEach((v) => {
                const n = Number(v);
                flat.push(Number.isFinite(n) ? n : 0);
            });
        });
    }

    if (flat.length === 0) {
        return { min: 0, max: 0, avg: 0 };
    }

    const min = Math.min(...flat);
    const max = Math.max(...flat);
    const sum = flat.reduce((acc, n) => acc + n, 0);
    const avg = sum / flat.length;
    return { min, max, avg };
}

function formatMetricValue(value: number): string {
    const normalized = Math.round(value * 10) / 10;
    if (Number.isInteger(normalized)) return String(normalized);
    return normalized.toFixed(1).replace(/\.0$/, '');
}

function toPaddingTop(value: number, yMin: number, yMax: number, graphHeight: number): number {
    const safeHeight = Math.max(0, graphHeight);
    const range = yMax - yMin;
    const safeRange = Number.isFinite(range) && Math.abs(range) > 0 ? range : 1;
    const ratio = clamp((value - yMin) / safeRange, 0, 1);
    const valuePx = safeHeight * ratio;
    return Math.max(0, safeHeight - valuePx);
}

function resolveReferenceHeight(graph: SceneNode, fallbackHeight: number): number {
    const cols = collectColumns(graph);
    const refCol = cols.find((c) => c.node.visible) || cols[0];
    if (refCol) {
        const colNode = refCol.node;
        if ('children' in colNode) {
            const tab = (colNode as SceneNode & ChildrenMixin).children.find((child) => child.name === 'tab');
            if (tab && 'height' in tab && tab.height > 0) {
                return tab.height;
            }
        }
        if ('height' in colNode && colNode.height > 0) {
            return colNode.height;
        }
    }
    if (fallbackHeight > 0) return fallbackHeight;
    if ('height' in graph && graph.height > 0) return graph.height;
    return 0;
}

function trySetAssistLineData(instance: InstanceNode, value: string): boolean {
    try {
        const key = findActualPropKey(instance.componentProperties, 'Asst_line_data');
        if (!key) return false;
        instance.setProperties({ [key]: value });
        return true;
    } catch {
        return false;
    }
}

function normalizeAssistLineStyle(value: unknown): AssistLineStyle | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as AssistLineStyle;
    const color = normalizeHexColor(source.color);
    const thicknessRaw = typeof source.thickness === 'number' ? source.thickness : Number(source.thickness);
    const thickness = Number.isFinite(thicknessRaw) && thicknessRaw >= 0 ? thicknessRaw : undefined;
    if (!color && thickness === undefined) return null;
    return {
        color: color || undefined,
        thickness
    };
}

function applyAssistLineVisualStyle(node: SceneNode, style: AssistLineStyle | null) {
    if (!style) return;

    const applyToNode = (target: SceneNode) => {
        if (style.color) tryApplyStroke(target, style.color);
        if (typeof style.thickness === 'number') {
            try {
                if (
                    'strokeTopWeight' in target
                    && 'strokeRightWeight' in target
                    && 'strokeBottomWeight' in target
                    && 'strokeLeftWeight' in target
                ) {
                    const withIndividual = target as SceneNode & IndividualStrokesMixin & { individualStrokeWeights?: boolean };
                    if ('individualStrokeWeights' in withIndividual) {
                        withIndividual.individualStrokeWeights = true;
                    }
                    withIndividual.strokeTopWeight = style.thickness;
                    withIndividual.strokeRightWeight = 0;
                    withIndividual.strokeBottomWeight = 0;
                    withIndividual.strokeLeftWeight = 0;
                } else if ('strokeWeight' in target) {
                    (target as SceneNode & GeometryMixin).strokeWeight = style.thickness;
                }
            } catch { }
        }
    };

    let containerLayer: SceneNode | null = null;
    traverse(node, (child) => {
        if (containerLayer) return;
        if (child.id === node.id) return;
        if (!child.visible) return;
        if (child.name === 'Container') {
            containerLayer = child;
        }
    });

    if (containerLayer) {
        applyToNode(containerLayer);
    }
}

export function applyAssistLines(config: any, graph: SceneNode, fallbackHeight: number) {
    const assistLineVisible = Boolean(config?.assistLineVisible);
    const enabled = normalizeAssistLineEnabled(config?.assistLineEnabled);
    const values = Array.isArray(config?.values) ? config.values : [];
    const metrics = computeMetrics(values);
    const yMin = Number.isFinite(Number(config?.yMin)) ? Number(config.yMin) : 0;
    const yMax = Number.isFinite(Number(config?.yMax)) ? Number(config.yMax) : 100;
    const graphHeight = resolveReferenceHeight(graph, fallbackHeight);
    const nodesByMetric = resolveAssistLineNodes(graph);
    const assistLineStyle = normalizeAssistLineStyle(config?.assistLineStyle);

    (['min', 'max', 'avg'] as AssistMetricType[]).forEach((metric) => {
        const metricNodes = nodesByMetric[metric];
        const isEnabled = assistLineVisible && enabled[metric];
        const metricValue = metrics[metric];
        const metricText = formatMetricValue(metricValue);
        const paddingTop = toPaddingTop(metricValue, yMin, yMax, graphHeight);

        if (metricNodes.length === 0) {
            console.log('[chart-plugin][assist-line]', {
                metric,
                enabled: isEnabled,
                found: 0
            });
            return;
        }

        metricNodes.forEach((node) => {
            try {
                node.visible = isEnabled;
                if (!isEnabled) {
                    console.log('[chart-plugin][assist-line]', {
                        metric,
                        enabled: isEnabled,
                        nodeId: node.id,
                        nodeName: node.name
                    });
                    return;
                }

                if ('paddingTop' in node) {
                    (node as SceneNode & { paddingTop: number }).paddingTop = paddingTop;
                } else {
                    console.log('[chart-plugin][assist-line]', {
                        metric,
                        enabled: isEnabled,
                        nodeId: node.id,
                        nodeName: node.name,
                        warning: 'paddingTop is not supported'
                    });
                }

                let dataApplied = false;
                if (node.type === 'INSTANCE') {
                    dataApplied = trySetAssistLineData(node, metricText);
                }
                applyAssistLineVisualStyle(node, assistLineStyle);

                console.log('[chart-plugin][assist-line]', {
                    metric,
                    enabled: isEnabled,
                    metricValue,
                    graphHeight,
                    yMin,
                    yMax,
                    paddingTop,
                    nodeId: node.id,
                    nodeName: node.name,
                    dataApplied
                });
            } catch (error) {
                console.warn('[chart-plugin][assist-line]', {
                    metric,
                    enabled: isEnabled,
                    nodeId: node.id,
                    nodeName: node.name,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    });
}
