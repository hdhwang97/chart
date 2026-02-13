import { MARK_NAME_PATTERNS, VARIANT_PROPERTY_CEL_TYPE, VARIANT_PROPERTY_Y_LABEL, VARIANT_PROPERTY_Y_END } from '../constants';
import { traverse, findActualPropKey } from '../utils';

// ==========================================
// SHARED DRAWING HELPERS
// ==========================================

export function collectColumns(node: SceneNode) {
    const cols: { node: SceneNode, index: number }[] = [];
    if ("children" in node) {
        for (const child of (node as any).children) {
            const match = MARK_NAME_PATTERNS.COL_ALL.exec(child.name);
            if (match) {
                cols.push({ node: child, index: parseInt(match[1], 10) });
            }
        }
    }
    return cols.sort((a, b) => a.index - b.index);
}

export function getGraphHeight(node: FrameNode) {
    let xh = 0;
    const xEmpty = node.findOne(n => n.name === "x-empty");
    if (xEmpty) xh = xEmpty.height;
    return node.height - xh;
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
    if (!("children" in parent)) return;
    (parent as any).children.forEach((child: SceneNode) => {
        if (child.name.startsWith(namePrefix)) {
            const num = parseInt(child.name.replace(namePrefix, ""));
            child.visible = num <= count;
        }
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
