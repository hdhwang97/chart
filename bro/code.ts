import { CHART_TYPES } from './src/shared/constants';

// code.ts

// ==========================================
// 1. CONFIG & CONSTANTS
// ==========================================

const MASTER_COMPONENT_CONFIG = {
  NAME: "Chart_test", 
  KEY: "" 
};

const STORAGE_KEY_COMPONENT_ID = "cached_chart_component_id";

// Variant & Property Names
const VARIANT_PROPERTY_TYPE = "Type"; 
const VARIANT_PROPERTY_MARK_NUM = "markNum"; 
const VARIANT_PROPERTY_LINE_NUM = "lineNum"; 
const VARIANT_PROPERTY_CEL_TYPE = "celType"; 
const VARIANT_PROPERTY_Y_LABEL = "yLabel"; 
const VARIANT_PROPERTY_Y_END = "yEnd";     

const VARIANT_MAPPING: { [key: string]: string } = {
  [CHART_TYPES.BAR]: CHART_TYPES.BAR,
  [CHART_TYPES.LINE]: CHART_TYPES.LINE,
  [CHART_TYPES.STACKED_BAR]: CHART_TYPES.STACKED_BAR
};

const LINE_VARIANT_KEY_DEFAULT = "direction"; 
const LINE_VARIANT_VALUES = {
  UP: "up",
  DOWN: "down",
  FLAT: "flat"
} as const;

// [Data Keys] 저장할 키 목록
const PLUGIN_DATA_KEYS = {
  MODIFIED: "isChartModified",
  CHART_TYPE: "chartType",
  
  // 데이터 값
  LAST_VALUES: "lastAppliedValues",       // UI용 원본 (All 포함)
  LAST_DRAWING_VALUES: "lastDrawingValues", // 그리기용 (All 제외)
  
  // 차트 설정 (이 부분들이 확실히 저장됨)
  LAST_MODE: "lastAppliedMode",           
  LAST_CELL_COUNT: "lastCellCount",       
  LAST_MARK_NUM: "lastMarkNum", 
  LAST_Y_MIN: "lastYMin",                 
  LAST_Y_MAX: "lastYMax",
} as const;

// Naming Patterns (Regex)
const MARK_NAME_PATTERNS = {
  BAR_INSTANCE: /^bar$/, 
  BAR_ITEM_SINGLE: /^bar$/, 
  BAR_ITEM_MULTI: /^bar[-_]?0*(\d+)$/,
  
  STACKED_GROUP: /^st\.bar\.group$|^bar[-_]?group$/, 
  STACKED_SUB_INSTANCE: /^st\.bar.*$|^bar.*$/,
  STACKED_SEGMENT: /^bar[-_]?0*(\d+)$/,

  LINE: /^line[-_]?0*(\d*)$/, 
  COL_ALL: /^col-0*(\d+)$/,
  
  CEL: /^cel[-_]?0*(\d+)$/,
  Y_AXIS_CONTAINER: /^y-axis$/,
  Y_CEL_ITEM: /^y_cel[-_]?0*(\d+)$/
};

// ==========================================
// 2. DATA LAYER (저장/로드 핵심 로직)
// ==========================================

// Helper: JSON Parse with safety
const safeParse = (data: string | undefined) => (data ? JSON.parse(data) : null);

// [핵심 1] 차트 데이터 저장 (모든 설정을 빠짐없이 저장)
function saveChartData(node: SceneNode, msg: any) {
    // 1. 기본 설정 및 값 저장
    node.setPluginData(PLUGIN_DATA_KEYS.CHART_TYPE, msg.type);
    node.setPluginData(PLUGIN_DATA_KEYS.LAST_VALUES, JSON.stringify(msg.rawValues));
    node.setPluginData(PLUGIN_DATA_KEYS.LAST_DRAWING_VALUES, JSON.stringify(msg.values));
    node.setPluginData(PLUGIN_DATA_KEYS.LAST_MODE, msg.mode);
    node.setPluginData(PLUGIN_DATA_KEYS.LAST_Y_MIN, String(msg.yMin));
    node.setPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX, String(msg.yMax));
    
    // 2. [요청사항 반영] Cell Count와 Mark Num 명시적 저장
    node.setPluginData(PLUGIN_DATA_KEYS.LAST_CELL_COUNT, String(msg.cellCount));
    if (msg.markNum) {
        node.setPluginData(PLUGIN_DATA_KEYS.LAST_MARK_NUM, JSON.stringify(msg.markNum));
    }
}

// [핵심 2] 차트 데이터 불러오기 (저장된 값 우선, 없으면 구조만 파악)
async function loadChartData(node: SceneNode, chartType: string) {
    // A. 저장된 데이터 확인
    const savedValuesStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_VALUES);
    const savedCell = node.getPluginData(PLUGIN_DATA_KEYS.LAST_CELL_COUNT);
    const savedMarkNumStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MARK_NUM);
    
    // B. 저장된 데이터가 있으면 -> 그걸 그대로 반환 (시각적 역산 무시)
    if (savedValuesStr) {
        return {
            values: JSON.parse(savedValuesStr),
            markNum: savedMarkNumStr ? JSON.parse(savedMarkNumStr) : 1,
            cellCount: Number(savedCell) || 4,
            isSaved: true
        };
    }

    // C. 저장된 게 없으면 -> 구조(Structure)만 파악하여 빈 데이터 생성
    const structure = inferStructureFromGraph(chartType, node);
    return {
        values: structure.values,     // 0으로 채워진 빈 배열
        markNum: structure.markNum,   // 감지된 막대/그룹 개수
        cellCount: structure.cellCount, // 감지된 눈금 개수
        isSaved: false
    };
}


// ==========================================
// 3. UTILITIES & HELPERS
// ==========================================

function traverse(node: SceneNode, callback: (n: SceneNode) => void) {
    callback(node);
    if ("children" in node) {
        for (const child of node.children) {
            traverse(child, callback);
        }
    }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function findActualPropKey(props: any, propName: string): string | null {
    if (!props) return null;
    const keys = Object.keys(props);
    if (keys.includes(propName)) return propName;
    const found = keys.find(k => k.startsWith(propName + '#'));
    return found || null;
}

function findAllLineLayers(parentNode: SceneNode): (SceneNode & LayoutMixin)[] {
    const results: (SceneNode & LayoutMixin)[] = [];
    if ("children" in parentNode) {
        // @ts-ignore
        parentNode.children.forEach(child => {
            if (MARK_NAME_PATTERNS.LINE.test(child.name)) {
                results.push(child as (SceneNode & LayoutMixin));
            }
        });
    }
    return results;
}

function extractChartColors(graph: SceneNode, chartType: string): string[] {
    const colors: string[] = [];
    const columns = collectColumns(graph);
    if (columns.length === 0) return []; 

    const firstCol = columns[0].node;
    let targetParent: SceneNode = firstCol;

    if ("children" in firstCol) {
        // @ts-ignore
        const tab = firstCol.children.find(n => n.name === "tab");
        if (tab) targetParent = tab;
    }

    // 1. Bar / Stacked Bar Color
    if (chartType === "bar" || chartType === "stackedBar") {
        // @ts-ignore
        const barInstance = targetParent.children.find(n => MARK_NAME_PATTERNS.BAR_INSTANCE.test(n.name));
        
        if (barInstance && "children" in barInstance) {
            for (let i = 1; i <= 25; i++) {
                const pat = new RegExp(`^bar[-_]?0*(${i})$`);
                // @ts-ignore
                const barItem = barInstance.children.find((n: SceneNode) => {
                    if (i === 1 && MARK_NAME_PATTERNS.BAR_ITEM_SINGLE.test(n.name)) return true;
                    return pat.test(n.name);
                });
                
                if (barItem && barItem.visible) {
                    if ("fills" in barItem && Array.isArray(barItem.fills) && barItem.fills.length > 0) {
                        const paint = barItem.fills[0];
                        let hexCode = "#CCCCCC";
                        if (paint.type === "SOLID") {
                            hexCode = rgbToHex(paint.color.r, paint.color.g, paint.color.b);
                        }
                        colors.push(hexCode);
                    }
                }
            }
        }
    } 
    // 2. Line Chart Color
    else if (chartType === "line") {
        const layers = findAllLineLayers(targetParent);
        layers.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        
        layers.forEach((layer) => {
            if (!layer.visible) return;
            let hexCode = "#CCCCCC";
            let found = false;

            if ("children" in layer) {
                // @ts-ignore
                const children = layer.children;
                for (const child of children) {
                    if (!child.visible) continue;
                    if ("strokes" in child && Array.isArray(child.strokes) && child.strokes.length > 0) {
                        const paint = child.strokes[0];
                        if (paint.type === "SOLID") {
                            hexCode = rgbToHex(paint.color.r, paint.color.g, paint.color.b);
                            found = true;
                            break; 
                        }
                    }
                }
            }
            if (!found && "strokes" in layer && Array.isArray(layer.strokes) && layer.strokes.length > 0) {
                const paint = layer.strokes[0];
                if (paint.type === "SOLID") {
                    hexCode = rgbToHex(paint.color.r, paint.color.g, paint.color.b);
                }
            }
            colors.push(hexCode);
        });
    }
    return colors;
}

async function getOrImportComponent(): Promise<ComponentNode | ComponentSetNode | null> {
    const { KEY, NAME } = MASTER_COMPONENT_CONFIG;

    const cachedId = await figma.clientStorage.getAsync(STORAGE_KEY_COMPONENT_ID);
    if (cachedId) {
        const cachedNode = figma.getNodeById(cachedId);
        if (cachedNode && (cachedNode.type === "COMPONENT" || cachedNode.type === "COMPONENT_SET")) {
            return cachedNode as ComponentNode | ComponentSetNode;
        } else {
            await figma.clientStorage.setAsync(STORAGE_KEY_COMPONENT_ID, undefined);
        }
    }

    if (KEY) {
        try {
            return await figma.importComponentByKeyAsync(KEY);
        } catch (e) {}
    }
    
    let found = figma.currentPage.findOne(n => 
        (n.type === "COMPONENT" || n.type === "COMPONENT_SET") && n.name === NAME
    );
    if (!found) {
        found = figma.root.findOne(n => 
            (n.type === "COMPONENT" || n.type === "COMPONENT_SET") && n.name === NAME
        );
    }

    if (found) {
        await figma.clientStorage.setAsync(STORAGE_KEY_COMPONENT_ID, found.id);
    }
    return found as (ComponentNode | ComponentSetNode);
}


// ==========================================
// 4. MAIN LOGIC (Controller)
// ==========================================

figma.showUI(__html__, { width: 600, height: 800 });

let currentSelectionId: string | null = null;
let prevWidth = 0;
let prevHeight = 0;

// Message Handler
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'resize') {
    figma.ui.resize(msg.width, msg.height);
  } 
  else if (msg.type === 'generate' || msg.type === 'apply') {
    const { type, mode, values, rawValues, cols, rows, cellCount, yMin, yMax, markNum } = msg.payload;
    
    const nodes = figma.currentPage.selection;
    let targetNode: FrameNode | ComponentNode | InstanceNode;

    if (msg.type === 'apply' && nodes.length > 0) {
       targetNode = nodes[0] as FrameNode; 
    } else {
       // Generate new
       const component = await getOrImportComponent();
       if (!component) {
         figma.notify(`Master Component '${MASTER_COMPONENT_CONFIG.NAME}' not found.`);
         return;
       }
       
       let instance;
        if (component.type === "COMPONENT_SET") {
            const defaultVar = component.defaultVariant;
            if (!defaultVar) {
                figma.notify("Error: Default Variant not found");
                return;
            }
            instance = defaultVar.createInstance();
        } else {
            instance = component.createInstance();
        }

       targetNode = instance;
       
       const { x, y } = figma.viewport.center;
       instance.x = x - (instance.width / 2);
       instance.y = y - (instance.height / 2);
       
       figma.currentPage.appendChild(instance);
       figma.viewport.scrollAndZoomIntoView([instance]);
       figma.currentPage.selection = [instance];
    }

    // 1. [NEW] 중앙화된 데이터 저장 함수 호출
    saveChartData(targetNode, msg.payload);

    // 2. Chart Type Variant Setup
    if (targetNode.type === "INSTANCE") {
        const variantValue = VARIANT_MAPPING[type] || 'bar';
        setVariantProperty(targetNode, VARIANT_PROPERTY_TYPE, variantValue);
    }

    // 3. Basic Setup
    const graphColCount = cols; 
    setLayerVisibility(targetNode, "col-", graphColCount);
    
    applyCells(targetNode, cellCount);
    applyYAxis(targetNode, cellCount, { yMin, yMax });

    // 4. Draw Chart
    const H = getGraphHeight(targetNode);
    const drawConfig = { values, mode, markNum, rows, yMin, yMax };

    if (type === "bar") applyBar(drawConfig, H, targetNode);
    else if (type === "line") applyLine(drawConfig, H, targetNode);
    else if (type === "stackedBar" || type === "stacked") applyStackedBar(drawConfig, H, targetNode);

    if (msg.type === 'generate') {
        figma.notify("Chart Generated!");
    } else {
        figma.notify("Chart Updated!");
    }
  }
};

// Selection Change
figma.on("selectionchange", () => {
    const selection = figma.currentPage.selection;
    if (selection.length === 1) {
        const node = selection[0];
        initPluginUI(node);
        
        if (node.id !== currentSelectionId) {
            currentSelectionId = node.id;
            prevWidth = node.width;
            prevHeight = node.height;
        }
    } else {
        currentSelectionId = null;
        figma.ui.postMessage({ type: 'init', chartType: null });
    }
});

// Auto-Resize Loop
setInterval(() => {
    if (!currentSelectionId) return;
    figma.currentPage.selection.forEach(node => {
        if (node.id === currentSelectionId) {
            if (Math.abs(node.width - prevWidth) > 1 || Math.abs(node.height - prevHeight) > 1) {
                initPluginUI(node, true); // true = autoApply
                prevWidth = node.width;
                prevHeight = node.height;
            }
        }
    });
}, 500);


// ==========================================
// 5. HELPER FUNCTIONS (Init & Inference)
// ==========================================

async function initPluginUI(node: SceneNode, autoApply = false) {
    const chartType = node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE) || inferChartType(node);
    
    // [NEW] 통합 데이터 로드 함수 사용
    const chartData = await loadChartData(node, chartType);
    
    // Auto-Resize 처리
    if (autoApply && chartData.isSaved) {
        const lastDrawingVals = node.getPluginData(PLUGIN_DATA_KEYS.LAST_DRAWING_VALUES);
        const lastMode = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MODE);
        const lastYMin = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MIN);
        const lastYMax = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX);

        let valuesToUse = chartData.values;
        if (lastDrawingVals) {
             try { valuesToUse = JSON.parse(lastDrawingVals); } catch(e){}
        }

        const payload = {
            type: chartType,
            mode: lastMode || 'raw',
            values: valuesToUse,
            rawValues: chartData.values,
            cols: 0, 
            cellCount: chartData.cellCount,
            yMin: Number(lastYMin)||0,
            yMax: Number(lastYMax)||100,
            markNum: chartData.markNum
        };
        
        const H = getGraphHeight(node as FrameNode);
        if(chartType === 'stackedBar' || chartType === 'stacked') applyStackedBar(payload, H, node);
        else if(chartType === 'bar') applyBar(payload, H, node);
        else if(chartType === 'line') applyLine(payload, H, node);
        return; 
    }
    
    const lastMode = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MODE);
    const lastYMin = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MIN);
    const lastYMax = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX);
    const extractedColors = extractChartColors(node, chartType);

    figma.ui.postMessage({
        type: 'init',
        uiMode: 'edit',
        chartType: chartType,
        
        // 데이터 전송 (저장된 값 우선, 없으면 구조 기반 빈 값)
        savedValues: chartData.values, 
        savedMarkNum: chartData.markNum,
        lastCellCount: chartData.cellCount,
        
        lastMode: lastMode,
        lastYMin: lastYMin ? Number(lastYMin) : undefined,
        lastYMax: lastYMax ? Number(lastYMax) : undefined,
        
        markColors: extractedColors
    });
}

// [리팩토링] 구조(Structure)만 파악하는 역산 함수
// 더 이상 높이(값)를 계산하지 않고, 레이어 개수만 세어서 반환함
function inferStructureFromGraph(chartType: string, graph: SceneNode) {
    const cols = collectColumns(graph);
    
    // 1. Detect Cell Count (Y축 눈금)
    let detectedCellCount = 4;
    const yAxis = (graph as FrameNode).findOne(n => MARK_NAME_PATTERNS.Y_AXIS_CONTAINER.test(n.name));
    if(yAxis && "children" in yAxis) {
            let maxIdx = 0;
            yAxis.children.forEach(c => {
                const match = MARK_NAME_PATTERNS.Y_CEL_ITEM.exec(c.name);
                if(match && c.visible) maxIdx = Math.max(maxIdx, parseInt(match[1]));
            });
            if(maxIdx > 0) detectedCellCount = maxIdx;
    }
    
    // 2. Count Columns
    const colCount = cols.length || 1;

    // 3. Detect Mark Count (Rows) & Generate Empty Values
    let markNum: any = 1;
    let rowCount = 1;

    if (chartType === "stackedBar") {
        // 그룹별 구조 파악 (예: [2, 3, 2] 형태)
        const groupStructure: number[] = [];
        cols.forEach(colObj => {
            let parent = colObj.node;
            if("children" in parent) {
                // @ts-ignore
                const tab = parent.children.find(n => n.name === "tab");
                if(tab) parent = tab;
            }
            // @ts-ignore
            const group = parent.children.find(n => MARK_NAME_PATTERNS.STACKED_GROUP.test(n.name));
            if(group && "children" in group) {
                // @ts-ignore
                const visibleBars = group.children.filter(n => MARK_NAME_PATTERNS.STACKED_SUB_INSTANCE.test(n.name) && n.visible);
                groupStructure.push(visibleBars.length);
            } else {
                groupStructure.push(0);
            }
        });
        markNum = groupStructure;
        rowCount = Math.max(...groupStructure) || 1;

    } else if (chartType === "bar" || chartType === "line") {
        // 단일 컬럼 내 최대 레이어 개수 파악
        let maxRows = 1;
        cols.forEach(c => {
            let parent = c.node;
            // @ts-ignore
            const tab = c.node.children ? (c.node as FrameNode).children.find(n => n.name === "tab") : null;
            if(tab) parent = tab;
            
            // Bar or Line 카운트
            let count = 0;
            // @ts-ignore
            if (parent.children) {
                 // @ts-ignore
                parent.children.forEach(child => {
                     if (!child.visible) return;
                     if (chartType === "bar") {
                         if (MARK_NAME_PATTERNS.BAR_ITEM_MULTI.test(child.name)) count++;
                     } else {
                         if (MARK_NAME_PATTERNS.LINE.test(child.name)) count++;
                     }
                });
            }
            // 단일 Bar 레이어 처리
            if (chartType === "bar" && count === 0) {
                 // @ts-ignore
                 const singleBar = parent.children.find(n => MARK_NAME_PATTERNS.BAR_ITEM_SINGLE.test(n.name));
                 if(singleBar && singleBar.visible) count = 1;
            }
            if(count > maxRows) maxRows = count;
        });
        markNum = maxRows;
        rowCount = maxRows;
    }

    // 4. 빈 데이터 생성 (0으로 채움)
    const emptyValues = Array.from({ length: rowCount }, () => Array(colCount).fill(0));

    return {
        values: emptyValues,
        markNum: markNum,
        cellCount: detectedCellCount
    };
}

function inferChartType(node: SceneNode): string {
    if (node.type === "INSTANCE") {
        const props = node.componentProperties;
        if (props[VARIANT_PROPERTY_TYPE]) return props[VARIANT_PROPERTY_TYPE].value;
    }
    let found = 'bar';
    traverse(node, n => {
        if (MARK_NAME_PATTERNS.STACKED_GROUP.test(n.name)) found = 'stackedBar';
        if (MARK_NAME_PATTERNS.LINE.test(n.name)) found = 'line';
    });
    return found;
}

function collectColumns(node: SceneNode) {
    const cols: { node: SceneNode, index: number }[] = [];
    if ("children" in node) {
        for (const child of node.children) {
            const match = MARK_NAME_PATTERNS.COL_ALL.exec(child.name);
            if (match) {
                cols.push({ node: child, index: parseInt(match[1], 10) });
            }
        }
    }
    return cols.sort((a, b) => a.index - b.index);
}

function getGraphHeight(node: FrameNode) {
    let xh = 0;
    const xEmpty = node.findOne(n => n.name === "x-empty");
    if (xEmpty) xh = xEmpty.height;
    return node.height - xh;
}

function setVariantProperty(instance: InstanceNode, key: string, value: string) {
    try {
        const props = instance.componentProperties;
        const propKey = Object.keys(props).find(k => k === key || k.startsWith(key + "#"));
        if (propKey && props[propKey].value !== value) {
            instance.setProperties({ [propKey]: value });
        }
    } catch (e) {}
}

function setLayerVisibility(parent: SceneNode, namePrefix: string, count: number) {
    if (!("children" in parent)) return;
    parent.children.forEach(child => {
        if (child.name.startsWith(namePrefix)) {
            const num = parseInt(child.name.replace(namePrefix, ""));
            child.visible = num <= count;
        }
    });
}

function applyCells(node: SceneNode, count: number) {
    traverse(node, n => {
        const match = MARK_NAME_PATTERNS.CEL.exec(n.name);
        if (match) {
            const idx = parseInt(match[1]);
            n.visible = idx <= count;
        }
    });
}

// ==========================================
// 6. DRAWING FUNCTIONS (Apply Logic)
// ==========================================

function applyStackedBar(config: any, H: number, graph: SceneNode) {
    const { values, mode, markNum } = config; 
    if (!values || values.length === 0) return;

    const rowCount = values.length; 
    const totalDataCols = values[0].length; 

    // Max Sum Calc for Normalization
    let globalMaxSum = 100;
    if (mode === "raw") {
        const colSums = new Array(totalDataCols).fill(0);
        for (let c = 0; c < totalDataCols; c++) {
            let sum = 0;
            for (let r = 0; r < rowCount; r++) {
                sum += (Number(values[r][c]) || 0);
            }
            colSums[c] = sum;
        }
        globalMaxSum = Math.max(...colSums);
        if (globalMaxSum === 0) globalMaxSum = 1;
    }

    const columns = collectColumns(graph);
    let globalDataIdx = 0; 

    columns.forEach((colObj, index) => {
        if (globalDataIdx >= totalDataCols) return;

        let currentGroupBarCount = 1; 
        if (Array.isArray(markNum)) {
            if (index < markNum.length) currentGroupBarCount = markNum[index];
            else currentGroupBarCount = 2; 
        } else {
            currentGroupBarCount = Number(markNum) || 1;
        }

        let targetParent: SceneNode = colObj.node;
        if ("children" in colObj.node) {
            // @ts-ignore
            const tab = colObj.node.children.find(n => n.name === "tab");
            if (tab) targetParent = tab;
        }

        let groupInstance: InstanceNode | null = null;
        if ("children" in targetParent) {
            // @ts-ignore
            groupInstance = targetParent.children.find(n => MARK_NAME_PATTERNS.STACKED_GROUP.test(n.name));
        }

        if (groupInstance && groupInstance.type === "INSTANCE") {
            try {
                const props = groupInstance.componentProperties;
                const countPropKey = Object.keys(props).find(k => k === VARIANT_PROPERTY_MARK_NUM || k === "Count" || k === "Size");
                if (countPropKey && props[countPropKey].value !== String(currentGroupBarCount)) {
                    groupInstance.setProperties({ [countPropKey]: String(currentGroupBarCount) });
                }
            } catch (e) {}

            // @ts-ignore
            const subBars = groupInstance.children.filter(n => MARK_NAME_PATTERNS.STACKED_SUB_INSTANCE.test(n.name));
            // @ts-ignore
            subBars.sort((a, b) => {
                const numA = parseInt(a.name.match(/\d+/)?.[0] || "0");
                const numB = parseInt(b.name.match(/\d+/)?.[0] || "0");
                return numA - numB;
            });

            subBars.forEach((subBar, subIdx) => {
                if (subIdx >= currentGroupBarCount) {
                    subBar.visible = false;
                    return;
                }
                if (globalDataIdx < totalDataCols) {
                    subBar.visible = true;
                    applySegmentsToBar(subBar, values, globalDataIdx, rowCount, H, globalMaxSum, mode);
                    globalDataIdx++;
                } else {
                    subBar.visible = false;
                }
            });
        }
    });
}

function applySegmentsToBar(
    barInstance: SceneNode, 
    values: any[][], 
    colIndex: number, 
    rowCount: number, 
    H: number, 
    maxSum: number, 
    mode: string
) {
    if (!("children" in barInstance)) return;

    for (let r = 0; r < rowCount; r++) {
        const val = Number(values[r][colIndex]) || 0;
        const targetNum = r + 1;
        
        const segmentPattern = new RegExp(`^bar[-_]?0*(${targetNum})$`);
        // @ts-ignore
        const targetLayer = barInstance.children.find(n => segmentPattern.test(n.name)) as (SceneNode & LayoutMixin);

        if (targetLayer) {
            if (val === 0) {
                targetLayer.visible = false;
            } else {
                targetLayer.visible = true;
                let ratio = 0;
                if (mode === "raw") {
                    ratio = maxSum === 0 ? 0 : val / maxSum;
                } else {
                    ratio = Math.min(Math.max(val, 0), 100) / 100;
                }
                const finalHeight = Math.round((H * ratio) * 10) / 10;
                if ('paddingBottom' in targetLayer) {
                    targetLayer.paddingBottom = finalHeight;
                }
            }
        }
    }
    // @ts-ignore
    barInstance.children.forEach(child => {
        const match = /^bar[-_]?0*(\d+)$/.exec(child.name);
        if (match) {
            const layerNum = parseInt(match[1]);
            if (layerNum > rowCount) child.visible = false;
        }
    });
}

function applyBar(config: any, H: number, graph: SceneNode) {
    const { values, mode, markNum } = config;
    const cols = collectColumns(graph);
    
    // 1. Max Value 계산
    let maxVal = 100;
    if (mode === "raw") {
        let allValues: number[] = [];
        values.forEach((row: any[]) => row.forEach(v => allValues.push(Number(v)||0)));
        maxVal = Math.max(...allValues);
        if(maxVal===0) maxVal=1;
    }

    const numMarks = Number(markNum) || 1;

    cols.forEach((colObj, cIdx) => {
        if(cIdx >= values[0].length) return; 

        let targetParent: any = colObj.node;
        if ("children" in colObj.node) {
             // @ts-ignore
             const tab = colObj.node.children.find(n => n.name === "tab");
             if(tab) targetParent = tab;
        }
        
        // 2. Bar Instance (컨테이너) 찾기
        // @ts-ignore
        const barInst = targetParent.children.find(n => MARK_NAME_PATTERNS.BAR_INSTANCE.test(n.name));
        
        if(barInst && barInst.type === "INSTANCE") {
             // Figma 컴포넌트의 'markNum' Variant 속성 변경
             setVariantProperty(barInst, VARIANT_PROPERTY_MARK_NUM, String(numMarks));
             
             for(let m=0; m<numMarks; m++) {
                 let val = 0;
                 if (values.length > m) val = Number(values[m][cIdx]) || 0;
                 
                 const targetNum = m + 1;
                 
                 // [패턴 통일] 
                 // 1개일 때도 내부는 'bar-01'이므로 분기 없이 항상 숫자가 포함된 패턴을 사용합니다.
                 // ^bar : bar로 시작
                 // [-_]? : 하이픈이나 언더바가 있거나 없음
                 // 0* : 숫자 앞 0 허용
                 // (${targetNum})$ : 현재 순번의 숫자로 끝남
                 const pattern = new RegExp(`^bar[-_]?0*(${targetNum})$`);
                 
                 // @ts-ignore
                 const barLayer = barInst.children.find(n => pattern.test(n.name)) as (SceneNode & LayoutMixin);
                 
                 if(barLayer) {
                     if(val === 0) {
                         barLayer.visible = false;
                     } else {
                         barLayer.visible = true;
                         let ratio = (mode === "raw") ? (val / maxVal) : (val / 100);
                         const finalH = Math.round((H * ratio) * 10) / 10;
                         
                         // Autolayout Frame인지 체크 후 높이 적용
                         if('paddingBottom' in barLayer) {
                             barLayer.paddingBottom = finalH;
                         }
                     }
                 }
             }
        }
    });
}


function applyLine(config: any, H: number, graph: SceneNode) {
    const { values, mode } = config; 
    let min = 0, max = 100;
    
    if (mode === "raw") {
        const flat = values.flat().map(v => Number(v)||0);
        min = Math.min(...flat);
        max = Math.max(...flat);
        if (min === max) { min = 0; max = Math.max(max, 100); }
    } else {
        min = config.yMin !== undefined ? config.yMin : 0;
        max = config.yMax !== undefined ? config.yMax : 100;
    }
    const range = max - min;
    const safeRange = range === 0 ? 1 : range;

    const cols = collectColumns(graph);
    const rowCount = values.length; 

    for(let r=0; r<rowCount; r++) {
        const seriesData = values[r];
        for(let c=0; c < seriesData.length - 1; c++) {
            if(c >= cols.length) break;
            const startVal = Number(seriesData[c]);
            const endVal = Number(seriesData[c+1]);
            
            let parent = cols[c].node;
            if("children" in parent) {
                // @ts-ignore
                const tab = parent.children.find(n=>n.name==="tab");
                if(tab) parent = tab;
            }
            
            // @ts-ignore
            const lineInst = parent.children.find(n => n.name.match(new RegExp(`^line[-_]?0*(${r+1})$`))); 
            
            if(lineInst && lineInst.type === "INSTANCE") {
                lineInst.visible = true;
                
                const startRatio = (startVal - min) / safeRange;
                const endRatio = (endVal - min) / safeRange;
                const startPx = H * clamp(startRatio, 0, 1);
                const endPx = H * clamp(endRatio, 0, 1);
                const pBottom = Math.min(startPx, endPx);
                const pTop = H - Math.max(startPx, endPx);
                
                lineInst.paddingBottom = Math.max(0, pBottom);
                lineInst.paddingTop = Math.max(0, pTop);
                
                let dir = LINE_VARIANT_VALUES.FLAT;
                if (endPx > startPx) dir = LINE_VARIANT_VALUES.UP;
                if (endPx < startPx) dir = LINE_VARIANT_VALUES.DOWN;
                setVariantProperty(lineInst, LINE_VARIANT_KEY_DEFAULT, dir);
            }
        }
    }
}

function applyYAxis(node: SceneNode, cellCount: number, payload: any) {
    const { yMin, yMax } = payload;
    // @ts-ignore
    const yAxis = node.findOne(n => MARK_NAME_PATTERNS.Y_AXIS_CONTAINER.test(n.name));
    if (!yAxis || !("children" in yAxis)) return;

    const step = (yMax - yMin) / cellCount;
    const formatValue = (val: number) => Number.isInteger(val) ? String(val) : val.toFixed(1).replace('.0','');

    yAxis.children.forEach(child => {
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
                    } catch(e) {}
                }
            } else {
                child.visible = false;
            }
        }
    });
}