// ==========================================
// 1. CONFIG & CONSTANTS
// ==========================================

const MASTER_COMPONENT_CONFIG = {
  NAME: "Chart_test", 
  KEY: "" // 필요한 경우 컴포넌트 Key 입력
};

const STORAGE_KEY_COMPONENT_ID = "cached_chart_component_id";

// Variant & Property Names
const VARIANT_PROPERTY_TYPE = "Type"; 
const VARIANT_PROPERTY_MARK_NUM = "markNum"; // Bar, Line의 개수 또는 Stacked Bar Group의 Item 개수
const VARIANT_PROPERTY_LINE_NUM = "lineNum"; 

// [Y-Axis] Properties
const VARIANT_PROPERTY_CEL_TYPE = "celType"; 
const VARIANT_PROPERTY_Y_LABEL = "yLabel"; 
const VARIANT_PROPERTY_Y_END = "yEnd";     

const VARIANT_MAPPING: { [key: string]: string } = {
  'bar': 'bar',           
  'line': 'line',         
  'stackedBar': 'stacked' 
};

const LINE_VARIANT_KEY_DEFAULT = "direction"; 
const LINE_VARIANT_VALUES = {
  UP: "up",
  DOWN: "down",
  FLAT: "flat"
} as const;

// [Update] Added LAST_MARK_NUM to store Variable Group Structure
const PLUGIN_DATA_KEYS = {
  MODIFIED: "isChartModified",
  LAST_VALUES: "lastAppliedValues",       
  LAST_DRAWING_VALUES: "lastDrawingValues", 
  LAST_MODE: "lastAppliedMode",           
  LAST_CELL_COUNT: "lastCellCount",       
  LAST_Y_MIN: "lastYMin",                 
  LAST_Y_MAX: "lastYMax",
  LAST_MARK_NUM: "lastMarkNum", // Stores structure like [2, 3, 2]
  CHART_TYPE: "chartType"
} as const;

// Naming Patterns (Regex)
const MARK_NAME_PATTERNS = {
  BAR_INSTANCE: /^bar$/, 
  BAR_ITEM_SINGLE: /^bar$/, 
  BAR_ITEM_MULTI: /^bar[-_]?0*(\d+)$/,
  
  // Stacked Bar Patterns
  STACKED_GROUP: /^st\.bar\.group$|^bar[-_]?group$/, 
  STACKED_SUB_INSTANCE: /^st\.bar$|^bar$/, 
  STACKED_SEGMENT: /^bar[-_]?0*(\d+)$/,

  LINE: /^line[-_]?0*(\d*)$/, 
  COL_ALL: /^col-0*(\d+)$/,
  
  CEL: /^cel[-_]?0*(\d+)$/,
  Y_AXIS_CONTAINER: /^y-axis$/,
  Y_CEL_ITEM: /^y_cel[-_]?0*(\d+)$/
};

// ==========================================
// 2. UTILITIES & HELPERS
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

// [Added from code2] Color Extraction
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

    // 1. Bar / Stacked Bar
    if (chartType === "bar" || chartType === "stackedBar") {
        // @ts-ignore
        const barInstance = targetParent.children.find(n => MARK_NAME_PATTERNS.BAR_INSTANCE.test(n.name));
        
        if (barInstance && "children" in barInstance) {
            // Check enough items to capture stacked colors too
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
    // 2. Line Chart
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

// [Added from code2] Component Loader
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
            const importComponent = await figma.importComponentByKeyAsync(KEY);
            return importComponent;
        } catch (e) {}
    }
    
    // Search in current page then root
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
// 3. MAIN LOGIC
// ==========================================

figma.showUI(__html__, { width: 300, height: 400 });

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
       targetNode = nodes[0] as FrameNode; // Apply to selection
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
       
       // Center in viewport
       const { x, y } = figma.viewport.center;
       instance.x = x - (instance.width / 2);
       instance.y = y - (instance.height / 2);
       
       figma.currentPage.appendChild(instance);
       figma.viewport.scrollAndZoomIntoView([instance]);
       figma.currentPage.selection = [instance];
    }

    // [Save Plugin Data]
    targetNode.setPluginData(PLUGIN_DATA_KEYS.CHART_TYPE, type);
    targetNode.setPluginData(PLUGIN_DATA_KEYS.LAST_VALUES, JSON.stringify(rawValues));
    targetNode.setPluginData(PLUGIN_DATA_KEYS.LAST_MODE, mode);
    targetNode.setPluginData(PLUGIN_DATA_KEYS.LAST_CELL_COUNT, String(cellCount));
    targetNode.setPluginData(PLUGIN_DATA_KEYS.LAST_Y_MIN, String(yMin));
    targetNode.setPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX, String(yMax));
    
    // Save markNum (Group Structure)
    if (markNum) {
        targetNode.setPluginData(PLUGIN_DATA_KEYS.LAST_MARK_NUM, JSON.stringify(markNum));
    }

    // 1. Chart Type Variant Setup
    if (targetNode.type === "INSTANCE") {
        const variantValue = VARIANT_MAPPING[type] || 'bar';
        setVariantProperty(targetNode, VARIANT_PROPERTY_TYPE, variantValue);
    }

    // 2. Basic Setup
    const graphColCount = (type === 'line') ? Math.max(0, cols - 1) : cols;
    setLayerVisibility(targetNode, "col-", graphColCount);
    
    applyCells(targetNode, cellCount);
    applyYAxis(targetNode, cellCount, { yMin, yMax });

    // 3. Draw Chart
    const H = getGraphHeight(targetNode);
    const drawConfig = { values, mode, markNum, rows, yMin, yMax };

    if (type === "bar") applyBar(drawConfig, H, targetNode);
    else if (type === "line") applyLine(drawConfig, H, targetNode);
    else if (type === "stackedBar") applyStackedBar(drawConfig, H, targetNode);

    if (msg.type === 'generate') {
        figma.notify("Chart Generated!");
    } else {
        figma.notify("Chart Updated!");
    }
  }
};

// Selection Change & Init
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
// 4. DRAWING FUNCTIONS
// ==========================================

function applyStackedBar(config: any, H: number, graph: SceneNode) {
    const { values, mode, markNum } = config; 
    
    if (!values || values.length === 0) return;

    const rowCount = values.length; // Stack Layers
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

        // Determine Bars in THIS Group
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
                if (mode === "raw") ratio = val / maxSum;
                else ratio = Math.min(Math.max(val, 0), 100) / 100;

                const finalHeight = Math.round((H * ratio) * 10) / 10;
                if ('paddingBottom' in targetLayer) {
                    targetLayer.paddingBottom = finalHeight;
                }
            }
        }
    }
}

function applyBar(config: any, H: number, graph: SceneNode) {
    const { values, mode, markNum } = config;
    const cols = collectColumns(graph);
    
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
        
        // @ts-ignore
        const barInst = targetParent.children.find(n => MARK_NAME_PATTERNS.BAR_INSTANCE.test(n.name));
        
        if(barInst && barInst.type === "INSTANCE") {
             setVariantProperty(barInst, VARIANT_PROPERTY_MARK_NUM, String(numMarks));
             for(let m=0; m<numMarks; m++) {
                 let val = 0;
                 if (values.length > m) val = Number(values[m][cIdx]) || 0;
                 
                 const targetNum = m + 1;
                 const pattern = (numMarks === 1) ? MARK_NAME_PATTERNS.BAR_ITEM_SINGLE : new RegExp(`^bar[-_]?0*(${targetNum})$`);
                 
                 // @ts-ignore
                 const barLayer = barInst.children.find(n => pattern.test(n.name)) as (SceneNode & LayoutMixin);
                 if(barLayer) {
                     if(val === 0) barLayer.visible = false;
                     else {
                         barLayer.visible = true;
                         let ratio = (mode === "raw") ? (val / maxVal) : (val / 100);
                         const finalH = H * ratio;
                         if('paddingBottom' in barLayer) barLayer.paddingBottom = finalH;
                     }
                 }
             }
        }
    });
}

function applyLine(config: any, H: number, graph: SceneNode) {
    const { values, mode } = config; 
    let min = 0, max = 100;
    
    // [Improved safe calculation from code2 principles]
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
                
                // Normalization using range
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

// ==========================================
// 5. HELPER FUNCTIONS
// ==========================================

function initPluginUI(node: SceneNode, autoApply = false) {
    const chartType = node.getPluginData(PLUGIN_DATA_KEYS.CHART_TYPE) || inferChartType(node);
    
    // Retrieve Saved Data
    const lastVals = node.getPluginData(PLUGIN_DATA_KEYS.LAST_VALUES);
    const lastMarkNum = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MARK_NUM);
    const lastMode = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MODE);
    const lastYMin = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MIN);
    const lastYMax = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX);
    const lastCell = node.getPluginData(PLUGIN_DATA_KEYS.LAST_CELL_COUNT);

    // [New] Extract Colors
    const extractedColors = extractChartColors(node, chartType);

    // Auto Apply Logic (Resize)
    if (autoApply && lastVals) {
        let markNumToUse: any = 1;
        if (lastMarkNum) {
            try { markNumToUse = JSON.parse(lastMarkNum); } catch(e) {}
        }

        const payload = {
            type: chartType,
            mode: lastMode || 'raw',
            values: JSON.parse(lastVals),
            rawValues: JSON.parse(lastVals),
            cols: 0, // Recalculated inside
            cellCount: Number(lastCell)||4,
            yMin: Number(lastYMin)||0,
            yMax: Number(lastYMax)||100,
            markNum: markNumToUse 
        };
        
        const H = getGraphHeight(node as FrameNode);
        if(chartType === 'stackedBar') applyStackedBar(payload, H, node);
        else if(chartType === 'bar') applyBar(payload, H, node);
        else if(chartType === 'line') applyLine(payload, H, node);
        return; 
    }

    // Infer Data
    const inferred = inferValuesFromGraph(chartType, (node as FrameNode).height, node);
    
    figma.ui.postMessage({
        type: 'init',
        uiMode: 'edit',
        chartType: chartType,
        
        // 1. Inferred Data
        inferredValues: inferred ? inferred.values : null,
        inferredMarkNum: inferred ? inferred.markNum : null,
        
        // 2. Saved Data (UI will prioritize this)
        savedValues: lastVals ? JSON.parse(lastVals) : null,
        savedMarkNum: lastMarkNum ? JSON.parse(lastMarkNum) : null,
        
        lastMode: lastMode,
        lastCellCount: Number(lastCell) || inferred?.cellCount || 4,
        lastYMin: lastYMin ? Number(lastYMin) : undefined,
        lastYMax: lastYMax ? Number(lastYMax) : undefined,
        
        // 3. Colors
        markColors: extractedColors
    });
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

// Unified Inference (Bar & Stacked)
function inferValuesFromGraph(chartType: string, fullHeight: number, graph: SceneNode) {
    let xh = 0;
    // @ts-ignore
    const xEmpty = graph.findOne ? graph.findOne(n => n.name === "x-empty") : null;
    if (xEmpty) xh = xEmpty.height;
    
    const H = fullHeight - xh;
    if (H <= 0) return null;
  
    const cols = collectColumns(graph);
    if (!cols.length) return null;
  
    // Detect Cell Count
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
  
    // 1. STACKED BAR INFERENCE
    if (chartType === "stackedBar") {
        const groupStructure: number[] = [];
        const flattenedBars: SceneNode[] = [];
        
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
                // @ts-ignore
                visibleBars.sort((a, b) => {
                    const numA = parseInt(a.name.match(/\d+/)?.[0] || "0");
                    const numB = parseInt(b.name.match(/\d+/)?.[0] || "0");
                    return numA - numB;
                });
                
                groupStructure.push(visibleBars.length);
                flattenedBars.push(...visibleBars);
            } else {
                groupStructure.push(0); 
            }
        });

        let maxRows = 1;
        if(flattenedBars.length > 0) {
             // @ts-ignore
             const segments = flattenedBars[0].children.filter(n => MARK_NAME_PATTERNS.STACKED_SEGMENT.test(n.name) && n.visible);
             if(segments.length > 0) maxRows = segments.length;
        }

        const extractedValues: number[][] = Array.from({ length: maxRows }, () => []);

        for (let r = 0; r < maxRows; r++) {
            flattenedBars.forEach(bar => {
                let val = 0;
                // @ts-ignore
                const segment = bar.children.find(n => {
                    const match = MARK_NAME_PATTERNS.STACKED_SEGMENT.exec(n.name);
                    return match && parseInt(match[1]) === (r + 1);
                });
                
                if (segment && segment.visible && 'paddingBottom' in segment) {
                    const ratio = segment.paddingBottom / H;
                    val = Math.round(ratio * 100 * 10) / 10;
                }
                extractedValues[r].push(val);
            });
        }

        return { 
            mode: "percent", 
            values: extractedValues, 
            cellCount: detectedCellCount,
            markNum: groupStructure 
        };
    }

    // 2. LINE CHART INFERENCE (Restored from code2)
    if (chartType === "line") {
        let maxRows = 1;
        cols.forEach(c => {
            let parent = c.node;
            // @ts-ignore
            const tab = c.node.children ? (c.node as FrameNode).children.find(n => n.name === "tab") : null;
            if(tab) parent = tab;
            
            const layers = findAllLineLayers(parent);
            layers.forEach(l => {
                if(!l.visible) return;
                const match = MARK_NAME_PATTERNS.LINE.exec(l.name);
                if(match) {
                    const num = match[1] ? parseInt(match[1], 10) : 1;
                    if(num > maxRows) maxRows = num;
                }
            });
        });

        const extractedValues: number[][] = Array.from({ length: maxRows }, () => []);

        for (let r = 0; r < maxRows; r++) {
            const targetNum = r + 1;
            cols.forEach((c, index) => {
                let parentNode: SceneNode = c.node;
                // @ts-ignore
                const tabNode = c.node.children ? (c.node as FrameNode).children.find(n => n.name === "tab") : null;
                if (tabNode) parentNode = tabNode;

                const lineLayers = findAllLineLayers(parentNode);
                const targetLayer = lineLayers.find(layer => {
                    const match = MARK_NAME_PATTERNS.LINE.exec(layer.name);
                    if (!match) return false;
                    const layerNum = match[1] ? parseInt(match[1], 10) : 1;
                    return layerNum === targetNum;
                });

                let startVal = 0;
                let endVal = 0;

                if (targetLayer && targetLayer.visible && targetLayer.type === "INSTANCE") {
                    const pb = targetLayer.paddingBottom;
                    const pt = targetLayer.paddingTop;    
                    const props = targetLayer.componentProperties;
                    
                    let foundDir = "";
                    for (const valueObj of Object.values(props)) {
                        const rawVal = String(valueObj.value).toLowerCase().trim();
                        if (rawVal === LINE_VARIANT_VALUES.UP) foundDir = LINE_VARIANT_VALUES.UP;
                        else if (rawVal === LINE_VARIANT_VALUES.DOWN) foundDir = LINE_VARIANT_VALUES.DOWN;
                    }
                    
                    const minPx = pb;
                    const maxPx = H - pt;
                    const minVal = Math.round((minPx / H) * 100 * 10) / 10;
                    const maxVal = Math.round((maxPx / H) * 100 * 10) / 10;

                    if (foundDir === LINE_VARIANT_VALUES.UP) {
                        startVal = minVal;
                        endVal = maxVal;
                    } else if (foundDir === LINE_VARIANT_VALUES.DOWN) {
                        startVal = maxVal;
                        endVal = minVal;
                    } else {
                        startVal = minVal;
                        endVal = minVal;
                    }
                }

                if (index === 0) extractedValues[r].push(startVal);
                extractedValues[r].push(endVal);
            });
        }
        return { mode: "percent", values: extractedValues, cellCount: detectedCellCount };
    }

    // 3. BAR CHART INFERENCE
    if (chartType === "bar") {
        let rowCount = 1; 
        const extractedValues: number[][] = [[]];
        cols.forEach(c => extractedValues[0].push(0)); 
        return { mode: "percent", values: extractedValues, cellCount: detectedCellCount };
    }

    return null;
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

// [Updated] applyYAxis: Component Property Logic (code2.ts 기반 복구)
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
            
            // 유효한 인덱스인지 확인
            if (idx <= cellCount) {
                child.visible = true;

                if (child.type === "INSTANCE") {
                    try {
                        const propsToSet: any = {};
                        const currentProps = child.componentProperties;

                        // [값 계산]
                        // yLabel: 해당 셀의 시작 값 (예: 1번 셀은 0 * step)
                        const valLabel = yMin + (step * (idx - 1));
                        // yEnd: 해당 셀의 끝 값 (예: 마지막 셀은 n * step)
                        const valEnd = yMin + (step * idx);

                        const textLabel = formatValue(valLabel);
                        const textEnd = formatValue(valEnd);

                        // [프로퍼티 키 찾기]
                        const keyCelType = findActualPropKey(currentProps, VARIANT_PROPERTY_CEL_TYPE);
                        const keyLabel = findActualPropKey(currentProps, VARIANT_PROPERTY_Y_LABEL);
                        const keyEnd = findActualPropKey(currentProps, VARIANT_PROPERTY_Y_END);

                        // 1. yLabel 설정 (모든 셀 공통)
                        if (keyLabel) {
                            propsToSet[keyLabel] = textLabel;
                        }

                        // 2. 마지막 셀 처리 (yEnd 및 celType)
                        if (idx === cellCount) {
                            if (keyCelType) propsToSet[keyCelType] = "end";
                            // 질문하신대로 마지막 셀의 yEnd에 Y Max 값이 들어갑니다.
                            if (keyEnd) propsToSet[keyEnd] = textEnd;
                        } else {
                            if (keyCelType) propsToSet[keyCelType] = "default";
                        }

                        if (Object.keys(propsToSet).length > 0) {
                            child.setProperties(propsToSet);
                        }

                    } catch(e) {
                        console.error(`Error applying props to ${child.name}`, e);
                    }
                }

            } else {
                child.visible = false;
            }
        }
    });
}

async function loadFontAndSetText(textNode: TextNode, text: string) {
    try {
        await figma.loadFontAsync(textNode.fontName as FontName);
        textNode.characters = text;
    } catch(e) {
        console.log("Font load error", e);
    }
}