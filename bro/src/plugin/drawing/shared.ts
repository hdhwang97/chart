import { MARK_NAME_PATTERNS, VARIANT_PROPERTY_CEL_TYPE, VARIANT_PROPERTY_Y_LABEL, VARIANT_PROPERTY_Y_END } from '../constants';
import { traverse, findActualPropKey } from '../utils';
import { formatYLabelValue, normalizeYLabelFormatMode } from '../../shared/y-label-format';

// ==========================================
// SHARED DRAWING HELPERS
// ==========================================

export type ColRef = { node: SceneNode; index: number };

export function collectColumns(node: SceneNode) {
    const cols: ColRef[] = [];
    const seen = new Set<number>();
    const pushIfColumn = (candidate: SceneNode) => {
        const match = MARK_NAME_PATTERNS.COL_ALL.exec(candidate.name);
        if (!match) return;
        const index = parseInt(match[1], 10);
        if (seen.has(index)) return;
        seen.add(index);
        cols.push({ node: candidate, index });
    };

    // 지원 구조:
    // - Graph -> col-N
    // - Graph -> col -> col-N
    // - Graph -> ... -> col -> col-N (재귀)
    traverse(node, (candidate) => {
        if (candidate.id === node.id) return;
        pushIfColumn(candidate);
    });

    return cols.sort((a, b) => a.index - b.index);
}

export function getGraphHeight(node: FrameNode) {
    const xEmptyHeight = getXEmptyHeight(node);
    const chartLegendHeight = getChartLegendHeight(node);
    return Math.max(0, node.height - xEmptyHeight - chartLegendHeight);
}

export function getPlotAreaWidth(node: SceneNode): number {
    const chartMain = 'findOne' in node
        ? (node as SceneNode & ChildrenMixin).findOne((candidate) => candidate.name === 'chart_main') as SceneNode | null
        : null;
    if (chartMain && 'children' in chartMain) {
        const colContainer = (chartMain as SceneNode & ChildrenMixin).children.find((child) => child.name === 'col') || null;
        if (colContainer && 'width' in colContainer && typeof colContainer.width === 'number') {
            return Math.max(0, colContainer.width);
        }
    }

    const fallback = 'findOne' in node
        ? (node as SceneNode & ChildrenMixin).findOne((candidate) => candidate.name === 'col') as SceneNode | null
        : null;
    if (fallback && 'width' in fallback && typeof fallback.width === 'number') {
        return Math.max(0, fallback.width);
    }

    return 0;
}

function findColumnXEmptyLayer(colNode: SceneNode): SceneNode | null {
    let target: SceneNode | null = null;

    if ('children' in colNode) {
        const direct = (colNode as SceneNode & ChildrenMixin).children.find((child) => child.name === 'x-empty') || null;
        if (direct) target = direct;
    }

    if (!target) {
        traverse(colNode, (node) => {
            if (target) return;
            if (node.id === colNode.id) return;
            if (node.name === 'x-empty') {
                target = node;
            }
        });
    }

    return target;
}

function findColumnXEmptyPropKey(props: InstanceNode['componentProperties']): string | null {
    return findActualPropKey(props, 'xEmpty')
        || findActualPropKey(props, 'x-empty')
        || findActualPropKey(props, 'x_empty')
        || findActualPropKey(props, 'XEmpty')
        || findActualPropKey(props, 'X-empty')
        || findActualPropKey(props, 'X_empty');
}

function readColumnXEmptyProperty(colNode: SceneNode): boolean | null {
    if (colNode.type !== 'INSTANCE') return null;
    try {
        const props = colNode.componentProperties;
        const propKey = findColumnXEmptyPropKey(props);
        if (!propKey) return null;
        const rawValue = props[propKey]?.value;
        if (typeof rawValue === 'boolean') return rawValue;
        if (typeof rawValue === 'string') {
            const normalized = rawValue.trim().toLowerCase();
            if (normalized === 'true') return true;
            if (normalized === 'false') return false;
        }
    } catch {
        // ignore and fall back to layer visibility
    }
    return null;
}

export function isColumnXEmptyVisible(colNode: SceneNode): boolean {
    if (!colNode.visible) return false;

    const propVisible = readColumnXEmptyProperty(colNode);
    if (propVisible === false) return false;

    const xEmptyLayer = findColumnXEmptyLayer(colNode);
    if (!xEmptyLayer) return false;
    return xEmptyLayer.visible;
}

export function hasVisibleXEmpty(node: FrameNode): boolean {
    const columns = collectColumns(node).filter((col) => col.node.visible);
    if (columns.length > 0) {
        return columns.some((col) => isColumnXEmptyVisible(col.node));
    }

    const fallback = node.findOne((candidate) => candidate.name === 'x-empty');
    return Boolean(fallback?.visible);
}

export function getXEmptyHeight(node: FrameNode): number {
    const columns = collectColumns(node).filter((col) => col.node.visible);
    for (const col of columns) {
        if (!isColumnXEmptyVisible(col.node)) continue;
        const xEmpty = findColumnXEmptyLayer(col.node);
        if (xEmpty && typeof xEmpty.height === 'number') {
            return Math.max(0, xEmpty.height);
        }
    }

    const fallback = node.findOne((candidate) => candidate.name === 'x-empty' && candidate.visible);
    if (!fallback || typeof fallback.height !== 'number') return 0;
    return Math.max(0, fallback.height);
}

export function getChartLegendHeight(node: FrameNode): number {
    let total = 0;
    traverse(node, (candidate) => {
        if (candidate.id === node.id) return;
        if (candidate.name !== 'chart_legend') return;
        if (!('height' in candidate) || typeof candidate.height !== 'number') return;
        total += Math.max(0, candidate.height);
    });
    return total;
}

export function setVariantProperty(instance: InstanceNode, key: string, value: string): boolean {
    try {
        const props = instance.componentProperties;
        const propKey = Object.keys(props).find(k => k === key || k.startsWith(key + "#"));
        if (propKey && props[propKey].value !== value) {
            instance.setProperties({ [propKey]: value });
            return true;
        }
    } catch (e) { }
    return false;
}

export function setLayerVisibility(parent: SceneNode, namePrefix: string, count: number, precomputedCols?: ColRef[]) {
    if (namePrefix === 'col-') {
        const columns = precomputedCols ?? collectColumns(parent);
        columns.forEach(({ node, index }) => {
            node.visible = index <= count;
        });
        return;
    }

    if (!("children" in parent)) return;
    const rootChildren = (parent as SceneNode & ChildrenMixin).children;
    const targets: SceneNode[] = [];
    rootChildren.forEach((child: SceneNode) => {
        if (child.name.startsWith(namePrefix)) {
            targets.push(child);
        }
    });
    targets.forEach((child: SceneNode) => {
        const num = parseInt(child.name.replace(namePrefix, ""), 10);
        if (!Number.isFinite(num)) return;
        child.visible = num <= count;
    });
}

export function applyCells(node: SceneNode, count: number) {
    traverse(node, n => {
        const match = MARK_NAME_PATTERNS.CEL.exec(n.name);
        if (match) {
            const idx = parseInt(match[1]);
            n.visible = idx <= count;
        }
    });
}

export function applyYAxis(node: SceneNode, cellCount: number, payload: any) {
    const { yMin, yMax } = payload;
    const yAxis = (node as FrameNode).findOne(n => MARK_NAME_PATTERNS.Y_AXIS_CONTAINER.test(n.name));
    if (!yAxis || !("children" in yAxis)) return;

    const step = (yMax - yMin) / cellCount;
    const yLabelFormat = normalizeYLabelFormatMode(payload?.yLabelFormat);

    (yAxis as any).children.forEach((child: SceneNode) => {
        const match = MARK_NAME_PATTERNS.Y_CEL_ITEM.exec(child.name);
        if (match) {
            const idx = parseInt(match[1]);
            if (idx <= cellCount) {
                child.visible = true;
                if (child.type === "INSTANCE") {
                    try {
                        const propsToSet: any = {};
                        const currentProps = child.componentProperties;
                        const valLabel = yMin + (step * (idx - 1));
                        const valEnd = yMin + (step * idx);
                        const textLabel = formatYLabelValue(valLabel, yLabelFormat);
                        const textEnd = formatYLabelValue(valEnd, yLabelFormat);

                        const keyCelType = findActualPropKey(currentProps, VARIANT_PROPERTY_CEL_TYPE);
                        const keyLabel = findActualPropKey(currentProps, VARIANT_PROPERTY_Y_LABEL);
                        const keyEnd = findActualPropKey(currentProps, VARIANT_PROPERTY_Y_END);

                        if (keyLabel) propsToSet[keyLabel] = textLabel;
                        if (idx === cellCount) {
                            if (keyCelType) propsToSet[keyCelType] = "end";
                            if (keyEnd) propsToSet[keyEnd] = textEnd;
                        } else {
                            if (keyCelType) propsToSet[keyCelType] = "default";
                        }
                        if (Object.keys(propsToSet).length > 0) child.setProperties(propsToSet);
                    } catch (e) { }
                }
            } else {
                child.visible = false;
            }
        }
    });
}

export function applyYAxisEmptyVisibility(node: SceneNode, visible: boolean) {
    const yAxis = (node as FrameNode).findOne((candidate) => MARK_NAME_PATTERNS.Y_AXIS_CONTAINER.test(candidate.name));
    if (!yAxis) return;

    traverse(yAxis, (candidate) => {
        if (candidate.id === yAxis.id) return;
        if (candidate.name !== 'y_empty') return;
        candidate.visible = visible;
    });
}

export function applyYAxisVisibility(node: SceneNode, visible: boolean) {
    const yAxis = (node as FrameNode).findOne((candidate) => MARK_NAME_PATTERNS.Y_AXIS_CONTAINER.test(candidate.name));
    if (!yAxis) return;
    yAxis.visible = visible;
}

export function applyColumnXEmptyVisibility(graph: SceneNode, visible: boolean, precomputedCols?: ColRef[]) {
    const columns = precomputedCols ?? collectColumns(graph);
    const result = { candidates: columns.length, applied: 0, skipped: 0 };

    columns.forEach((col) => {
        let changed = false;

        if (col.node.type === 'INSTANCE') {
            try {
                const propKey = findColumnXEmptyPropKey(col.node.componentProperties);
                if (propKey) {
                    const current = col.node.componentProperties[propKey]?.value;
                    if (current !== visible) {
                        col.node.setProperties({ [propKey]: visible });
                        changed = true;
                    }
                }
            } catch {
                // fall back to layer visibility below
            }
        }

        const xEmptyLayer = findColumnXEmptyLayer(col.node);
        if (xEmptyLayer) {
            if (xEmptyLayer.visible !== visible) {
                xEmptyLayer.visible = visible;
                changed = true;
            }
        }

        if (changed) result.applied += 1;
        else result.skipped += 1;
    });

    return result;
}

export function applyColumnXEmptyAlign(graph: SceneNode, align: 'center' | 'right', precomputedCols?: ColRef[]) {
    const columns = precomputedCols ?? collectColumns(graph);
    const result = { candidates: columns.length, applied: 0, skipped: 0 };

    columns.forEach((col) => {
        const target = findColumnXEmptyInstance(col.node);

        if (!target) {
            result.skipped += 1;
            return;
        }

        const changed =
            setVariantProperty(target, 'align', align)
            || setVariantProperty(target, 'Align', align);

        if (changed) result.applied += 1;
        else result.skipped += 1;
    });

    return result;
}

function findColumnXEmptyInstance(colNode: SceneNode): InstanceNode | null {
    let target: InstanceNode | null = null;

    if ('children' in colNode) {
        const direct = (colNode as SceneNode & ChildrenMixin).children.find(
            (child) => child.name === 'x-empty' && child.type === 'INSTANCE'
        );
        if (direct && direct.type === 'INSTANCE') {
            target = direct;
        }
    }

    if (!target) {
        traverse(colNode, (node) => {
            if (target) return;
            if (node.name === 'x-empty' && node.type === 'INSTANCE') {
                target = node;
            }
        });
    }

    return target;
}

function normalizeLabel(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim() : '';
}

function resolveLabelWithFallback(labels: string[], primaryIndex: number, fallbackIndex: number): string {
    const primary = normalizeLabel(labels[primaryIndex]);
    if (primary) return primary;
    if (fallbackIndex === primaryIndex) return '';
    return normalizeLabel(labels[fallbackIndex]);
}

function findXEmptyTypePropKey(props: InstanceNode['componentProperties']): string | null {
    return findActualPropKey(props, 'type')
        || findActualPropKey(props, 'Type');
}

function findXEmptyZrPropKey(props: InstanceNode['componentProperties']): string | null {
    return findActualPropKey(props, 'zr')
        || findActualPropKey(props, 'ZR');
}

function findXEmptyLabelPropKey(props: InstanceNode['componentProperties']): string | null {
    return findActualPropKey(props, 'x-label')
        || findActualPropKey(props, 'x_label')
        || findActualPropKey(props, 'X-label')
        || findActualPropKey(props, 'X_label');
}

function isStartTypeXEmpty(target: InstanceNode): boolean {
    try {
        const props = target.componentProperties;
        const typeKey = findXEmptyTypePropKey(props);
        if (!typeKey) return false;
        return String(props[typeKey]?.value || '').trim().toLowerCase() === 'start';
    } catch {
        return false;
    }
}

function resolveZrMode(columns: ColRef[]): boolean {
    const firstCol = columns.find((col) => col.index === 1) || columns[0];
    if (!firstCol) return false;
    const firstXEmpty = findColumnXEmptyInstance(firstCol.node);
    if (!firstXEmpty) return false;
    return isStartTypeXEmpty(firstXEmpty);
}

function resolveXLabelForColumn(labels: string[], colIndex: number, zrMode: boolean): string {
    if (!zrMode) return resolveLabelWithFallback(labels, colIndex, colIndex);
    return resolveLabelWithFallback(labels, colIndex + 1, colIndex);
}

function resolveLegendFallbackLabel(labels: string[], colIndex: number, zrMode: boolean): string {
    if (!zrMode) return resolveLabelWithFallback(labels, colIndex, colIndex);
    if (colIndex === 0) {
        return resolveLabelWithFallback(labels, 0, 1);
    }
    return resolveLabelWithFallback(labels, colIndex + 1, colIndex);
}

function readLegendLabelFromXEmpty(
    target: InstanceNode,
    colIndex: number,
    labels: string[],
    zrMode: boolean
): string {
    try {
        const props = target.componentProperties;
        if (zrMode && colIndex === 0) {
            const zrKey = findXEmptyZrPropKey(props);
            const zrLabel = zrKey ? normalizeLabel(props[zrKey]?.value) : '';
            if (zrLabel) return zrLabel;
        }
        const xLabelKey = findXEmptyLabelPropKey(props);
        const xLabel = xLabelKey ? normalizeLabel(props[xLabelKey]?.value) : '';
        if (xLabel) return xLabel;
    } catch {
        // Keep fallback chain below.
    }
    return resolveLegendFallbackLabel(labels, colIndex, zrMode);
}

export function applyColumnXEmptyLabels(graph: SceneNode, labels: string[], precomputedCols?: ColRef[]) {
    const columns = precomputedCols ?? collectColumns(graph);
    const result = { candidates: columns.length, applied: 0, skipped: 0 };

    if (!Array.isArray(labels) || labels.length === 0) {
        result.skipped = columns.length;
        return result;
    }

    const zrMode = resolveZrMode(columns);

    columns.forEach((col, colIndex) => {
        const target = findColumnXEmptyInstance(col.node);
        if (!target) {
            result.skipped += 1;
            return;
        }

        try {
            const props = target.componentProperties;
            const updates: Record<string, string> = {};
            let hasWritableValue = false;

            if (zrMode && colIndex === 0) {
                const zrKey = findXEmptyZrPropKey(props);
                const zrLabel = normalizeLabel(labels[0]);
                if (zrKey && zrLabel) {
                    hasWritableValue = true;
                    if (normalizeLabel(props[zrKey]?.value) !== zrLabel) {
                        updates[zrKey] = zrLabel;
                    }
                }
            }

            const xLabelKey = findXEmptyLabelPropKey(props);
            const xLabel = resolveXLabelForColumn(labels, colIndex, zrMode);
            if (xLabelKey && xLabel) {
                hasWritableValue = true;
                if (normalizeLabel(props[xLabelKey]?.value) !== xLabel) {
                    updates[xLabelKey] = xLabel;
                }
            }

            if (!hasWritableValue) {
                result.skipped += 1;
                return;
            }

            if (Object.keys(updates).length > 0) {
                target.setProperties(updates);
                result.applied += 1;
            } else {
                result.skipped += 1;
            }
        } catch {
            result.skipped += 1;
        }
    });

    return result;
}

export function applyLegendLabelsFromRowHeaders(
    graph: SceneNode,
    options: {
        chartType: string;
        rowHeaderLabels: string[];
        markNum: number | number[] | undefined;
        xAxisLabels?: string[];
        rowColors?: string[];
        colColors?: string[];
        colColorEnabled?: boolean[];
        columns?: ColRef[];
    }
) {
    const result = {
        containers: 0,
        candidates: 0,
        applied: 0,
        skipped: 0,
        errors: 0
    };

    const chartType = options.chartType;
    if (chartType !== 'bar' && chartType !== 'line') {
        return result;
    }

    const columns = options.columns ?? collectColumns(graph);
    const visibleColIndices = columns
        .filter((col) => col.node.visible)
        .map((col) => Math.max(0, col.index - 1));
    const colColorEnabled = Array.isArray(options.colColorEnabled)
        ? options.colColorEnabled.map((v) => Boolean(v))
        : [];
    const allVisibleColsEnabled = chartType === 'bar'
        && visibleColIndices.length > 0
        && visibleColIndices.every((idx) => Boolean(colColorEnabled[idx]));

    const resolvedRowLabels = Array.isArray(options.rowHeaderLabels)
        ? options.rowHeaderLabels.map((label) => (typeof label === 'string' ? label.trim() : ''))
        : [];
    const rowLabelLimit = typeof options.markNum === 'number' && Number.isFinite(options.markNum)
        ? Math.max(0, Math.floor(options.markNum))
        : resolvedRowLabels.length;

    const resolvedLabels: string[] = [];
    if (!allVisibleColsEnabled) {
        for (let i = 0; i < rowLabelLimit; i++) {
            const fallback = `R${i + 1}`;
            resolvedLabels.push(resolvedRowLabels[i] || fallback);
        }
    }

    if (chartType === 'bar') {
        const zrMode = resolveZrMode(columns);
        visibleColIndices.forEach((colIndex) => {
            if (!colColorEnabled[colIndex]) return;
            const colRef = columns.find((col) => col.index - 1 === colIndex);
            const xEmptyTarget = colRef ? findColumnXEmptyInstance(colRef.node) : null;
            const sourceLabels = Array.isArray(options.xAxisLabels) ? options.xAxisLabels : [];
            const xEmptyLabel = xEmptyTarget
                ? readLegendLabelFromXEmpty(xEmptyTarget, colIndex, sourceLabels, zrMode)
                : resolveLegendFallbackLabel(sourceLabels, colIndex, zrMode);
            resolvedLabels.push(xEmptyLabel || `C${colIndex + 1}`);
        });
    }

    const legendContainers: SceneNode[] = [];
    traverse(graph, (node) => {
        if (node.id === graph.id) return;
        if (MARK_NAME_PATTERNS.LEGEND_CONTAINER.test(node.name)) {
            legendContainers.push(node);
        }
    });

    result.containers = legendContainers.length;
    if (legendContainers.length === 0) return result;

    legendContainers.forEach((container) => {
        if (!('children' in container)) return;
        const legendElems: Array<{ node: SceneNode; index: number }> = [];
        (container as SceneNode & ChildrenMixin).children.forEach((child) => {
            const match = MARK_NAME_PATTERNS.LEGEND_ELEM.exec(child.name);
            if (!match) return;
            const index = Number.parseInt(match[1], 10);
            if (!Number.isFinite(index) || index <= 0) return;
            legendElems.push({ node: child, index });
        });
        legendElems.sort((a, b) => a.index - b.index);

        legendElems.forEach(({ node, index }) => {
            result.candidates += 1;

            if (index > resolvedLabels.length) {
                try {
                    node.visible = false;
                    result.applied += 1;
                } catch {
                    result.errors += 1;
                }
                return;
            }

            try {
                node.visible = true;
            } catch {
                result.errors += 1;
                return;
            }

            const label = resolvedLabels[index - 1];
            if (!label) {
                result.skipped += 1;
                return;
            }

            if (node.type !== 'INSTANCE') {
                result.skipped += 1;
                return;
            }

            try {
                const props = node.componentProperties;
                const propKey =
                    findActualPropKey(props, 'legend_label')
                    || findActualPropKey(props, 'legend-label')
                    || findActualPropKey(props, 'legendLabel')
                    || findActualPropKey(props, 'Legend_label')
                    || findActualPropKey(props, 'LegendLabel');

                if (!propKey) {
                    result.skipped += 1;
                    return;
                }

                if (props[propKey]?.value !== label) {
                    node.setProperties({ [propKey]: label });
                    result.applied += 1;
                } else {
                    result.skipped += 1;
                }
            } catch {
                result.errors += 1;
            }
        });
    });

    return result;
}
