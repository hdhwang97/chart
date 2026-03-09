import { traverse } from '../utils';
import { LINE_SERIES_CONTAINER_PATTERN } from '../constants';
import type { ColRef } from './shared';

export const LINE_COMPONENT_NAME = 'line';
export const LINE_FILL_COMPONENT_NAME = 'fill';
export const LINE_FILL_TOP_NAME = 'fill_top';
export const LINE_FILL_BOT_NAME = 'fill_bot';
export const LINE_FILL_TRI_NAME = 'tri';

export type LineBundle = {
    rowIndex: number;
    columnIndex: number;
    container: SceneNode;
    lineNode: SceneNode;
    fillNode: SceneNode;
    fillTop: SceneNode;
    fillBot: SceneNode;
    triNode: SceneNode | null;
};

export type LineStructureIssueReason =
    | 'missing_bundle'
    | 'line_not_instance'
    | 'fill_not_instance'
    | 'line_direction_variant_missing'
    | 'fill_direction_variant_missing'
    | 'line_padding_unsupported'
    | 'fill_top_padding_unsupported'
    | 'fill_bot_padding_unsupported';

export type LineStructureIssue = {
    rowIndex: number;
    segmentIndex: number;
    columnIndex: number;
    containerName: string;
    reason: LineStructureIssueReason;
};

export type LineStructureValidationResult =
    | { ok: true }
    | {
        ok: false;
        errorCode: 'line_structure_missing';
        missing: LineStructureIssue[];
    };

export type LineBundleMatrix = Array<Array<LineBundle | null>>;

export function buildLineSeriesContainerName(rowIndex: number): string {
    return `line-${String(Math.max(0, rowIndex + 1)).padStart(2, '0')}`;
}

export function parseLineSeriesIndex(name: string): number | null {
    const match = LINE_SERIES_CONTAINER_PATTERN.exec(name.trim());
    if (!match) return null;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed - 1;
}

function resolveColumnSearchRoot(colNode: SceneNode): SceneNode {
    if ('children' in colNode) {
        const tab = (colNode as SceneNode & ChildrenMixin).children.find((child) => child.name === 'tab');
        if (tab) return tab;
    }
    return colNode;
}

export function findChildByExactName(parent: SceneNode, name: string): SceneNode | null {
    if (!('children' in parent)) return null;
    const children = (parent as SceneNode & ChildrenMixin).children;
    const direct = children.find((child) => child.name === name);
    if (direct) return direct;
    for (const child of children) {
        const nested = findChildByExactName(child, name);
        if (nested) return nested;
    }
    return null;
}

export function resolveLineBundleInContainer(
    container: SceneNode,
    rowIndex: number,
    columnIndex: number
): LineBundle | null {
    const lineNode = findChildByExactName(container, LINE_COMPONENT_NAME);
    const fillNode = findChildByExactName(container, LINE_FILL_COMPONENT_NAME);
    if (!lineNode || !fillNode) return null;
    const fillTop = findChildByExactName(fillNode, LINE_FILL_TOP_NAME);
    const fillBot = findChildByExactName(fillNode, LINE_FILL_BOT_NAME);
    if (!fillTop || !fillBot) return null;
    const triNode = findChildByExactName(fillTop, LINE_FILL_TRI_NAME);
    return {
        rowIndex,
        columnIndex,
        container,
        lineNode,
        fillNode,
        fillTop,
        fillBot,
        triNode
    };
}

export function resolveLineBundleInColumn(
    colNode: SceneNode,
    rowIndex: number,
    columnIndex = 0
): LineBundle | null {
    const root = resolveColumnSearchRoot(colNode);
    const containerName = buildLineSeriesContainerName(rowIndex);
    const container = findChildByExactName(root, containerName);
    if (!container) return null;
    return resolveLineBundleInContainer(container, rowIndex, columnIndex);
}

export function collectLineBundlesInColumn(colNode: SceneNode, columnIndex = 0): Map<number, LineBundle> {
    const byRow = new Map<number, LineBundle>();
    const root = resolveColumnSearchRoot(colNode);
    traverse(root, (node) => {
        const rowIndex = parseLineSeriesIndex(node.name);
        if (rowIndex === null || byRow.has(rowIndex)) return;
        const bundle = resolveLineBundleInContainer(node, rowIndex, columnIndex);
        if (bundle) byRow.set(rowIndex, bundle);
    });
    return byRow;
}

export function buildLineBundleMatrix(columns: ColRef[], rowCount: number): LineBundleMatrix {
    const safeRows = Math.max(0, Math.floor(rowCount));
    const matrix: LineBundleMatrix = Array.from({ length: safeRows }, () =>
        Array.from({ length: columns.length }, () => null as LineBundle | null)
    );

    columns.forEach((col, c) => {
        const byRow = collectLineBundlesInColumn(col.node, c);
        byRow.forEach((bundle, rowIndex) => {
            if (rowIndex < 0 || rowIndex >= safeRows) return;
            matrix[rowIndex][c] = bundle;
        });
    });

    return matrix;
}

export function validateLineStructureOrError(
    matrix: LineBundleMatrix,
    expectedRows: number,
    expectedSegments: number,
    validateBundle?: (bundle: LineBundle) => LineStructureIssueReason | null
): LineStructureValidationResult {
    const issues: LineStructureIssue[] = [];
    const safeRows = Math.max(0, Math.floor(expectedRows));
    const safeSegments = Math.max(0, Math.floor(expectedSegments));

    for (let rowIndex = 0; rowIndex < safeRows; rowIndex++) {
        for (let segmentIndex = 0; segmentIndex < safeSegments; segmentIndex++) {
            const bundle = matrix[rowIndex]?.[segmentIndex] || null;
            const containerName = buildLineSeriesContainerName(rowIndex);
            if (!bundle) {
                issues.push({
                    rowIndex,
                    segmentIndex,
                    columnIndex: segmentIndex,
                    containerName,
                    reason: 'missing_bundle'
                });
                continue;
            }
            const reason = validateBundle ? validateBundle(bundle) : null;
            if (!reason) continue;
            issues.push({
                rowIndex,
                segmentIndex,
                columnIndex: segmentIndex,
                containerName,
                reason
            });
        }
    }

    if (issues.length === 0) return { ok: true };
    return {
        ok: false,
        errorCode: 'line_structure_missing',
        missing: issues
    };
}

export function hasLineBundleStructureInColumns(columns: ColRef[]): boolean {
    for (let c = 0; c < columns.length; c++) {
        const bundles = collectLineBundlesInColumn(columns[c].node, c);
        if (bundles.size > 0) return true;
    }
    return false;
}

export function detectLineSeriesCountInColumns(columns: ColRef[]): number {
    let maxSeries = 0;
    columns.forEach((col, c) => {
        const bundles = collectLineBundlesInColumn(col.node, c);
        bundles.forEach((_bundle, rowIndex) => {
            maxSeries = Math.max(maxSeries, rowIndex + 1);
        });
    });
    return Math.max(1, maxSeries);
}
