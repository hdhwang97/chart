import { MARK_NAME_PATTERNS, VARIANT_PROPERTY_CEL_TYPE, VARIANT_PROPERTY_Y_LABEL, VARIANT_PROPERTY_Y_END } from '../constants';
import { traverse, findActualPropKey } from '../utils';

// ==========================================
// SHARED DRAWING HELPERS
// ==========================================

export function collectColumns(node: SceneNode) {
    const cols: { node: SceneNode, index: number }[] = [];
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

export function getXEmptyHeight(node: FrameNode): number {
    const xEmpty = node.findOne(n => n.name === "x-empty");
    if (!xEmpty) return 0;
    return Math.max(0, xEmpty.height);
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

export function setLayerVisibility(parent: SceneNode, namePrefix: string, count: number) {
    if (namePrefix === 'col-') {
        collectColumns(parent).forEach(({ node, index }) => {
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
    const formatValue = (val: number) => Number.isInteger(val) ? String(val) : val.toFixed(1).replace('.0', '');

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
                        const textLabel = formatValue(valLabel);
                        const textEnd = formatValue(valEnd);

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

export function applyColumnXEmptyAlign(graph: SceneNode, align: 'center' | 'right') {
    const columns = collectColumns(graph);
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

export function applyColumnXEmptyLabels(graph: SceneNode, labels: string[]) {
    const columns = collectColumns(graph);
    const result = { candidates: columns.length, applied: 0, skipped: 0 };

    if (!Array.isArray(labels) || labels.length === 0) {
        result.skipped = columns.length;
        return result;
    }

    columns.forEach((col, colIndex) => {
        const target = findColumnXEmptyInstance(col.node);
        const rawLabel = labels[colIndex];
        const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';

        if (!target || !label) {
            result.skipped += 1;
            return;
        }

        try {
            const props = target.componentProperties;
            const propKey =
                findActualPropKey(props, 'x-label')
                || findActualPropKey(props, 'x_label')
                || findActualPropKey(props, 'X-label')
                || findActualPropKey(props, 'X_label');
            if (!propKey) {
                result.skipped += 1;
                return;
            }

            if (props[propKey].value !== label) {
                target.setProperties({ [propKey]: label });
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
    labels: string[],
    markNum: number | number[] | undefined,
    chartType: string
) {
    const result = {
        containers: 0,
        candidates: 0,
        applied: 0,
        skipped: 0,
        errors: 0
    };

    if (chartType !== 'bar' && chartType !== 'line') {
        return result;
    }

    const resolvedLabels = Array.isArray(labels)
        ? labels.map((label) => (typeof label === 'string' ? label.trim() : ''))
        : [];
    const maxIndexFromMarkNum = typeof markNum === 'number' && Number.isFinite(markNum)
        ? Math.max(0, Math.floor(markNum))
        : null;

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

            if (maxIndexFromMarkNum !== null && index > maxIndexFromMarkNum) {
                result.skipped += 1;
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
