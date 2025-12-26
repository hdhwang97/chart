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

const PLUGIN_DATA_KEYS = {
  MODIFIED: "isChartModified",
  LAST_VALUES: "lastAppliedValues",       
  LAST_DRAWING_VALUES: "lastDrawingValues", 
  LAST_MODE: "lastAppliedMode",           
  LAST_CELL_COUNT: "lastCellCount",       
  LAST_Y_MIN: "lastYMin",                 
  LAST_Y_MAX: "lastYMax"                  
} as const;

const MARK_NAME_PATTERNS = {
  BAR_INSTANCE: /^bar$/, 
  BAR_ITEM_SINGLE: /^bar$/,
  BAR_ITEM_MULTI: /^bar[-_]?0*(\d+)$/,
  LINE: /^line[-_]?0*(\d*)$/, 
  COL_ALL: /^col-0*(\d+)$/,
  STACKED: /^bar_(\d+)_(\d+)$/,
  CEL: /^cel[-_]?0*(\d+)$/,
  Y_AXIS_CONTAINER: /^y-axis$/,
  Y_CEL_ITEM: /^y_cel[-_]?0*(\d+)$/
};

let prevWidth = 0;
let prevHeight = 0;
let currentSelectionId: string | null = null;

// ==========================================
// 2. UTILITIES
// ==========================================

function traverse(node: SceneNode, fn: (n: SceneNode) => void) {
  fn(node);
  if ("children" in node) {
    for (const child of node.children) {
      traverse(child as SceneNode, fn);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function setLayerVisibility(root: SceneNode, prefix: string, activeCount: number) {
  const pattern = new RegExp(`^${prefix}0*(\\d+)$`);
  traverse(root, (node) => {
    const match = pattern.exec(node.name);
    if (match) {
      const index = parseInt(match[1], 10);
      if (!isNaN(index)) {
        node.visible = index <= activeCount;
      }
    }
  });
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

// [색상 추출 함수]
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

    console.log(`🎨 [Color Extraction] Start extracting colors for ${chartType} chart...`);

    // 2. Bar / Stacked Bar
    if (chartType === "bar" || chartType === "stackedBar") {
        // @ts-ignore
        const barInstance = targetParent.children.find(n => MARK_NAME_PATTERNS.BAR_INSTANCE.test(n.name));
        
        if (barInstance && "children" in barInstance) {
            for (let i = 1; i <= 25; i++) {
                const pat = new RegExp(`^bar[-_]?0*(${i})$`);
                // @ts-ignore
                const barItem = barInstance.children.find((n: SceneNode) => {
                    // Extract에서는 호환성을 위해 bar와 bar-01 모두 체크 (하지만 bar-01 우선)
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
                        console.log(`   👉 Series ${i} (Bar): ${hexCode}`);
                    }
                }
            }
        }
    } 
    // Line Chart
    else if (chartType === "line") {
        const layers = findAllLineLayers(targetParent);
        layers.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        
        layers.forEach((layer, idx) => {
            if (!layer.visible) return;

            let hexCode = "#CCCCCC";
            let found = false;

            if ("children" in layer) {
                // @ts-ignore
                const children = layer.children;
                for (const child of children) {
                    if (!child.visible) continue;
                    if ("fills" in child && Array.isArray(child.fills) && child.fills.length > 0) {
                        const paint = child.fills[0];
                        if (paint.type === "SOLID") {
                            hexCode = rgbToHex(paint.color.r, paint.color.g, paint.color.b);
                            found = true;
                            break;
                        }
                    }
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
            console.log(`   👉 Series ${idx + 1} (Line - ${layer.name}): ${hexCode}`);
        });
    }
    
    console.log(`✅ [Color Extraction] Final Colors:`, colors);
    return colors;
}

async function findMasterComponent(): Promise<ComponentNode | ComponentSetNode | null> {
    const { KEY, NAME } = MASTER_COMPONENT_CONFIG;

    const cachedId = await figma.clientStorage.getAsync(STORAGE_KEY_COMPONENT_ID);
    if (cachedId) {
        const cachedNode = figma.getNodeById(cachedId);
        if (cachedNode && (cachedNode.type === "COMPONENT" || cachedNode.type === "COMPONENT_SET")) {
            console.log(`🚀 Instant Load: "${cachedNode.name}"`);
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

    console.log(`Searching for: "${NAME}"...`);
    
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
// 3. DETECTION & COLLECTION
// ==========================================

function isChartInstance(node: SceneNode): boolean {
  return node.type === "INSTANCE";
}

function detectChartType(node: SceneNode): string | null {
  if (node.type === "INSTANCE" && node.componentProperties[VARIANT_PROPERTY_TYPE]) {
      const val = node.componentProperties[VARIANT_PROPERTY_TYPE].value;
      const key = Object.keys(VARIANT_MAPPING).find(k => VARIANT_MAPPING[k] === val);
      if (key) return key;
  }

  let foundType: string | null = null;
  let stop = false;
  traverse(node, (n) => {
    if (stop || !n.visible) return;
    if (MARK_NAME_PATTERNS.LINE.test(n.name)) { foundType = "line"; stop = true; }
    else if (MARK_NAME_PATTERNS.BAR_INSTANCE.test(n.name)) { foundType = "bar"; stop = true; }
    else if (MARK_NAME_PATTERNS.STACKED.test(n.name)) { foundType = "stackedBar"; stop = true; }
  });
  return foundType;
}

function collectColumns(root: SceneNode) {
  const cols: {index: number, node: SceneNode}[] = [];
  traverse(root, (node) => {
    if (!node.visible) return;
    const match = MARK_NAME_PATTERNS.COL_ALL.exec(node.name);
    if (match && "children" in node) {
      cols.push({ index: parseInt(match[1], 10), node: node });
    }
  });
  return cols.sort((a, b) => a.index - b.index);
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

// ==========================================
// 5. APPLY LOGIC
// ==========================================

function normalizePercent(values: number[], H: number): number[] {
  return values.map((v) => (H * clamp(v, 0, 100)) / 100);
}

function normalizeRaw(values: number[], H: number): number[] {
  const positive = values.map((v) => Math.max(0, v));
  const maxVal = Math.max(...positive, 0);
  if (maxVal <= 0) return values.map(() => 0);
  return positive.map((v) => (H * v) / maxVal);
}

function applyCells(graph: SceneNode, cellCount: number) {
    if (cellCount < 1) return;
    const columns = collectColumns(graph);

    columns.forEach(col => {
        traverse(col.node, (node) => {
            const match = MARK_NAME_PATTERNS.CEL.exec(node.name);
            if (match) {
                const index = parseInt(match[1], 10);
                if (!isNaN(index)) {
                    node.visible = index <= cellCount;
                }
            }
        });
    });
}

function applyYAxis(graph: SceneNode, cellCount: number, dataPayload: any) {
    if (cellCount < 1) return;

    const minVal = (dataPayload && dataPayload.yMin !== undefined) ? Number(dataPayload.yMin) : 0;
    const maxVal = (dataPayload && dataPayload.yMax !== undefined) ? Number(dataPayload.yMax) : 100;
    
    let yAxisContainer: SceneNode | null = null;
    traverse(graph, (node) => {
        if (MARK_NAME_PATTERNS.Y_AXIS_CONTAINER.test(node.name)) {
            yAxisContainer = node;
        }
    });

    if (!yAxisContainer) return; 

    const formatValue = (val: number) => {
        return Number.isInteger(val) ? String(val) : val.toFixed(1).replace('.0','');
    };

    const stepValue = (maxVal - minVal) / cellCount;

    traverse(yAxisContainer, (child) => {
        const match = MARK_NAME_PATTERNS.Y_CEL_ITEM.exec(child.name);
        
        if (match) {
            const index = parseInt(match[1], 10);
            
            if (!isNaN(index)) {
                const isVisible = index <= cellCount;
                child.visible = isVisible;

                if (isVisible && child.type === "INSTANCE") {
                    try {
                        const propsToSet: any = {};
                        const currentProps = child.componentProperties;

                        const valLabel = minVal + stepValue * (index - 1);
                        const valEnd = minVal + stepValue * index;

                        const textLabel = formatValue(valLabel);
                        const textEnd = formatValue(valEnd);

                        const keyCelType = findActualPropKey(currentProps, VARIANT_PROPERTY_CEL_TYPE);
                        const keyLabel = findActualPropKey(currentProps, VARIANT_PROPERTY_Y_LABEL);
                        const keyEnd = findActualPropKey(currentProps, VARIANT_PROPERTY_Y_END);

                        if (keyLabel) {
                            propsToSet[keyLabel] = textLabel;
                        }

                        if (index === cellCount) {
                            if (keyCelType) propsToSet[keyCelType] = "end";
                            if (keyEnd) propsToSet[keyEnd] = textEnd;
                        } else {
                            if (keyCelType) propsToSet[keyCelType] = "default";
                        }

                        if (Object.keys(propsToSet).length > 0) {
                            child.setProperties(propsToSet);
                        }

                    } catch (e: any) {
                        console.error(`ERROR on ${child.name}: ${e.message}`);
                    }
                }
            }
        }
    });
}

// [수정됨] Apply Bar Logic - 1개일 때도 bar-01 사용으로 통일
function applyBar(config: any, H: number, graph: SceneNode) {
  let values2D: any[][] = [];
  if (config.values.length > 0 && Array.isArray(config.values[0])) {
      values2D = config.values;
  } else {
      values2D = [config.values];
  }

  const rowCount = values2D.length;
  const colCount = values2D[0].length;
  const columns = collectColumns(graph);
  
  if (H <= 0) return;

  const flatValues = values2D.flat().map((v: any) => Number(v) || 0);
  const normMap = config.mode === "percent" 
        ? normalizePercent(flatValues, H) 
        : normalizeRaw(flatValues, H);

  columns.forEach(col => {
      const colIdx = col.index - 1; 
      if (colIdx >= colCount) return;

      const tabNode = "children" in col.node 
          ? (col.node as FrameNode).children.find(n => n.name === "tab") 
          : null;
      
      if (!tabNode || !("children" in tabNode)) return;

      const barInstance = tabNode.children.find(n => MARK_NAME_PATTERNS.BAR_INSTANCE.test(n.name)) as InstanceNode;

      if (!barInstance || barInstance.type !== "INSTANCE") return;

      try {
          barInstance.setProperties({ [VARIANT_PROPERTY_MARK_NUM]: String(rowCount) });
      } catch(e) {}

      for (let r = 0; r < rowCount; r++) {
          const valPx = normMap[(r * colCount) + colIdx];
          
          let targetBar: (SceneNode & LayoutMixin) | undefined;

          // [변경] rowCount가 1이든 아니든 무조건 인덱스(bar-01) 기반으로 찾음
          const targetNum = r + 1;
          const multiPattern = new RegExp(`^bar[-_]?0*(${targetNum})$`); 
          targetBar = barInstance.children.find(n => multiPattern.test(n.name)) as (SceneNode & LayoutMixin);

          if (targetBar && targetBar.paddingBottom !== undefined) {
              targetBar.visible = true;
              targetBar.paddingBottom = valPx;
          }
      }
  });
}

function applyLine(config: any, H: number, graph: SceneNode) {
  let values2D: any[][] = [];
  if (config.values.length > 0 && Array.isArray(config.values[0])) {
      values2D = config.values;
  } else {
      values2D = [config.values];
  }

  const rowCount = values2D.length;     
  const colCount = values2D[0].length;  
  const columns = collectColumns(graph);

  if (H <= 0) return;

  const flatValues = values2D.flat().map((v: any) => Number(v) || 0);
  const normMap = config.mode === "percent" 
        ? normalizePercent(flatValues, H) 
        : normalizeRaw(flatValues, H);

  const segmentCount = Math.max(0, colCount - 1);

  for (let i = 0; i < segmentCount; i++) {
      const colIndex = i + 1; 
      const targetCol = columns.find(c => c.index === colIndex);
      if (!targetCol) continue;

      let parentNode: SceneNode = targetCol.node;
      // @ts-ignore
      const tabNode = targetCol.node.children ? (targetCol.node as FrameNode).children.find(n => n.name === "tab") : null;
      if (tabNode) parentNode = tabNode;

      const lineLayers = findAllLineLayers(parentNode);

      for (let r = 0; r < rowCount; r++) {
          const startVal = normMap[(r * colCount) + i];
          const endVal = normMap[(r * colCount) + (i + 1)];

          const minY = Math.min(startVal, endVal);
          const maxY = Math.max(startVal, endVal);

          const targetNum = r + 1;
          const targetLayer = lineLayers.find(layer => {
              const match = MARK_NAME_PATTERNS.LINE.exec(layer.name);
              if (!match) return false;
              const numStr = match[1]; 
              const layerNum = match[1] ? parseInt(match[1], 10) : 1; 
              return layerNum === targetNum;
          });

          if (targetLayer) {
              targetLayer.visible = true; 
              targetLayer.paddingBottom = minY;
              targetLayer.paddingTop = H - maxY;

              if (targetLayer.type === "INSTANCE") {
                  let dir = LINE_VARIANT_VALUES.FLAT;
                  if (endVal > startVal) dir = LINE_VARIANT_VALUES.UP;
                  else if (endVal < startVal) dir = LINE_VARIANT_VALUES.DOWN;
                  
                  try {
                     const props: any = {};
                     props[LINE_VARIANT_KEY_DEFAULT] = dir;       
                     props[VARIANT_PROPERTY_LINE_NUM] = String(targetNum); 
                     targetLayer.setProperties(props);
                  } catch(e) {}
              }
          }
      }

      lineLayers.forEach(layer => {
          const match = MARK_NAME_PATTERNS.LINE.exec(layer.name);
          if (match) {
              const numStr = match[1];
              const layerNum = match[1] ? parseInt(match[1], 10) : 1;
              if (layerNum > rowCount) {
                  layer.visible = false;
              }
          }
      });
  }
}

function applyStackedBar(config: any, H: number, graph: SceneNode) {
    // Placeholder
}

function handleApplyData(payload: any, graph: SceneNode) {
    try {
        let xh = 0;
        // @ts-ignore
        const xEmpty = graph.findOne ? graph.findOne(n => n.name === "x-empty") : null;
        if (xEmpty) xh = xEmpty.height;
        // @ts-ignore
        const H = graph.height - xh;

        const graphColCount = payload.type === 'line' ? Math.max(0, payload.cols - 1) : payload.cols;
        setLayerVisibility(graph, "col-", graphColCount);

        if (payload.cellCount) {
            applyCells(graph, payload.cellCount);
            applyYAxis(graph, payload.cellCount, payload); 
        }

        if (payload.type === "bar") applyBar(payload, H, graph);
        else if (payload.type === "line") applyLine(payload, H, graph);
        else if (payload.type === "stackedBar") applyStackedBar(payload, H, graph);

        const storageValues = payload.rawValues ? payload.rawValues : payload.values;
        const drawingValues = payload.values;

        graph.setPluginData(PLUGIN_DATA_KEYS.MODIFIED, "true");
        graph.setPluginData(PLUGIN_DATA_KEYS.LAST_VALUES, JSON.stringify(storageValues)); 
        graph.setPluginData(PLUGIN_DATA_KEYS.LAST_DRAWING_VALUES, JSON.stringify(drawingValues));
        graph.setPluginData(PLUGIN_DATA_KEYS.LAST_MODE, payload.mode); 
        
        if (payload.cellCount) {
            graph.setPluginData(PLUGIN_DATA_KEYS.LAST_CELL_COUNT, String(payload.cellCount));
        }
        if (payload.yMin !== undefined) graph.setPluginData(PLUGIN_DATA_KEYS.LAST_Y_MIN, String(payload.yMin));
        if (payload.yMax !== undefined) graph.setPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX, String(payload.yMax));

        return true;
    } catch (e: any) {
        console.error(e);
        figma.notify("Error applying data: " + e.message);
        return false;
    }
}

// ==========================================
// 6. INFER LOGIC (Read from Figma)
// ==========================================

function inferValuesFromGraph(chartType: string, fullHeight: number, graph: SceneNode) {
  let xh = 0;
  // @ts-ignore
  const xEmpty = graph.findOne ? graph.findOne(n => n.name === "x-empty") : null;
  if (xEmpty) xh = xEmpty.height;
  
  const H = fullHeight - xh;
  if (H <= 0) return null;

  const cols = collectColumns(graph);
  if (!cols.length) return null;

  // [Cell Count 추론]
  let detectedCellCount = 0;
  if (cols.length > 0) {
      traverse(cols[0].node, (node) => {
          if (node.visible) {
               const match = MARK_NAME_PATTERNS.CEL.exec(node.name);
               if (match) {
                   const idx = parseInt(match[1], 10);
                   if (idx > detectedCellCount) detectedCellCount = idx;
               }
          }
      });
  }
  if (detectedCellCount === 0) detectedCellCount = 4; // 기본값


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

              if (index === 0) {
                  extractedValues[r].push(startVal);
              }
              extractedValues[r].push(endVal);
          });
      }
      return { mode: "percent", values: extractedValues, cellCount: detectedCellCount };
  }

  if (chartType === "bar") {
    let rowCount = 1;
    for(const col of cols) {
        const tabNode = "children" in col.node ? (col.node as FrameNode).children.find(n => n.name === "tab") : null;
        if(tabNode) {
            const barInstance = tabNode.children.find(n => MARK_NAME_PATTERNS.BAR_INSTANCE.test(n.name)) as InstanceNode;
            if(barInstance && barInstance.type === "INSTANCE") {
                if(barInstance.componentProperties[VARIANT_PROPERTY_MARK_NUM]) {
                    const val = barInstance.componentProperties[VARIANT_PROPERTY_MARK_NUM].value;
                    rowCount = parseInt(String(val), 10) || 1;
                }
                break; 
            }
        }
    }

    const extractedValues: number[][] = Array.from({ length: rowCount }, () => []);

    cols.forEach((c) => {
        const tabNode = "children" in c.node ? (c.node as FrameNode).children.find(n => n.name === "tab") : null;
        let barInstance: InstanceNode | null = null;
        if (tabNode) {
            barInstance = tabNode.children.find(n => MARK_NAME_PATTERNS.BAR_INSTANCE.test(n.name)) as InstanceNode;
        }

        for (let r = 0; r < rowCount; r++) {
            let val = 0;
            if (barInstance) {
                let targetBar: (SceneNode & LayoutMixin) | undefined;
                if (rowCount === 1) {
                    targetBar = barInstance.children.find(n => MARK_NAME_PATTERNS.BAR_ITEM_SINGLE.test(n.name)) as (SceneNode & LayoutMixin);
                } else {
                    const targetNum = r + 1;
                    const multiPattern = new RegExp(`^bar[-_]?0*(${targetNum})$`);
                    targetBar = barInstance.children.find(n => multiPattern.test(n.name)) as (SceneNode & LayoutMixin);
                }

                if (targetBar && targetBar.paddingBottom !== undefined) {
                    const ratio = targetBar.paddingBottom / H;
                    val = Math.round(ratio * 100 * 10) / 10;
                }
            }
            extractedValues[r].push(val);
        }
    });

    return { mode: "percent", values: extractedValues, cellCount: detectedCellCount };
  }
  return null;
}

// ==========================================
// 7. MAIN HANDLERS
// ==========================================

if (figma.editorType !== "figma") figma.closePlugin();
figma.showUI(__html__, { width: 300, height: 400 });

function updateUI() {
  const selection = figma.currentPage.selection;
  let chartType = null;
  
  let inferredValues = null; 
  let lastValues = null; 
  let lastMode = "raw"; 
  let lastCellCount = 4; 
  let extractedColors: string[] = []; 

  let height = null;
  let isModified = false;
  let uiMode = "create";

  if (selection.length === 1) {
    const node = selection[0];
    if (isChartInstance(node)) {
        chartType = detectChartType(node);
        if (chartType && "height" in node) {
            uiMode = "edit";
            // @ts-ignore
            height = node.height; 
            
            const inferredObj = inferValuesFromGraph(chartType, height, node);
            if (inferredObj) {
                inferredValues = inferredObj.values;
                if (inferredObj.cellCount) lastCellCount = inferredObj.cellCount;
            }

            const modifiedFlag = node.getPluginData(PLUGIN_DATA_KEYS.MODIFIED);
            const lastDataStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_VALUES);
            const lastModeStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MODE);
            const lastCellStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_CELL_COUNT);
            const lastYMinStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MIN);
            const lastYMaxStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX);

            // [NEW] 색상 추출
            extractedColors = extractChartColors(node, chartType);

            isModified = modifiedFlag === "true";
            
            if (lastDataStr) {
                try { 
                    lastValues = JSON.parse(lastDataStr); 
                    if (lastModeStr) lastMode = lastModeStr;
                } catch(e) {}
            }
            if (lastCellStr) lastCellCount = parseInt(lastCellStr, 10) || 4;

            figma.ui.postMessage({
                type: "init",
                uiMode,
                chartType,
                inferredValues,
                lastValues, 
                lastMode,   
                lastCellCount, 
                height,
                isModified,
                markColors: extractedColors, 
                lastYMin: lastYMinStr ? parseFloat(lastYMinStr) : undefined,
                lastYMax: lastYMaxStr ? parseFloat(lastYMaxStr) : undefined
            });
            return;
        }
    }
  }

  figma.ui.postMessage({
    type: "init",
    uiMode,
    chartType,
    inferredValues,
    lastValues, 
    lastMode,   
    lastCellCount, 
    height,
    isModified,
    markColors: extractedColors 
  });
}

updateUI();
figma.on("selectionchange", updateUI);

figma.ui.onmessage = async (msg: any) => {
  if (msg.type === "resize") {
    figma.ui.resize(msg.width, msg.height);
    return;
  }
  
  if (msg.type === "apply") {
    const payload = msg.payload;
    const sel = figma.currentPage.selection;
    if (sel.length !== 1) { figma.notify("선택된 차트가 없습니다."); return; }
    
    const graph = sel[0];
    const success = handleApplyData(payload, graph);
    if(success) {
        figma.notify("데이터 적용 완료");
        updateUI();
    }
  }

  if (msg.type === "generate") {
      try {
          const payload = msg.payload;
          const masterComponent = await findMasterComponent();
          if (!masterComponent) {
              figma.notify(`'${MASTER_COMPONENT_CONFIG.NAME}' 컴포넌트를 찾을 수 없습니다.`);
              return;
          }

          let newInstance: InstanceNode;
          if (masterComponent.type === "COMPONENT_SET") {
              const defaultVar = masterComponent.defaultVariant;
              if (!defaultVar) {
                  figma.notify("오류: Default Variant 없음");
                  return;
              }
              newInstance = defaultVar.createInstance();
          } else {
              newInstance = masterComponent.createInstance();
          }
          
          const targetVariantValue = VARIANT_MAPPING[payload.type]; 
          if (targetVariantValue) {
              try {
                  newInstance.setProperties({ [VARIANT_PROPERTY_TYPE]: targetVariantValue });
              } catch (e) {
                  console.warn("Type set failed:", e);
              }
          }

          const { x, y } = figma.viewport.center;
          newInstance.x = x - (newInstance.width / 2);
          newInstance.y = y - (newInstance.height / 2);
          figma.currentPage.appendChild(newInstance);

          const success = handleApplyData(payload, newInstance);
          
          if(success) {
              figma.currentPage.selection = [newInstance];
              figma.notify("새 차트 생성 완료");
          } else {
              newInstance.remove();
          }
      } catch (err: any) {
          console.error("Generate Error:", err);
          figma.notify("오류: " + err.message);
      }
  }
};

// ==========================================
// 8. AUTO-RESIZE OBSERVER
// ==========================================

setInterval(() => {
  const selection = figma.currentPage.selection;
  if (selection.length === 1) {
    const node = selection[0];
    if (isChartInstance(node)) {
      if (node.id !== currentSelectionId) {
        currentSelectionId = node.id;
        prevWidth = node.width;
        prevHeight = node.height;
        return;
      }

      if (Math.abs(node.width - prevWidth) > 1 || Math.abs(node.height - prevHeight) > 1) {
        
        const isModified = node.getPluginData(PLUGIN_DATA_KEYS.MODIFIED) === "true";
        const lastValuesStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_VALUES);
        const lastDrawingStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_DRAWING_VALUES); 
        const lastModeStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MODE);
        const lastCellStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_CELL_COUNT); 
        const lastYMinStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MIN);
        const lastYMaxStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_Y_MAX);

        if (isModified) {
            try {
                let valsToUse = null;
                if (lastDrawingStr) {
                    valsToUse = JSON.parse(lastDrawingStr);
                } else if (lastValuesStr) {
                    valsToUse = JSON.parse(lastValuesStr);
                }

                if (valsToUse) {
                    const chartType = detectChartType(node);
                    
                    let xh = 0;
                    // @ts-ignore
                    const xEmpty = node.findOne ? node.findOne(n => n.name === "x-empty") : null;
                    if (xEmpty) xh = xEmpty.height;
                    const H = node.height - xh;

                    let colsCount = 3; 
                    if (Array.isArray(valsToUse) && valsToUse.length > 0) {
                        if (Array.isArray(valsToUse[0])) {
                            colsCount = valsToUse[0].length;
                        } else {
                            colsCount = valsToUse.length;
                        }
                    }

                    const cellCount = lastCellStr ? parseInt(lastCellStr, 10) : 4;
                    const yMin = lastYMinStr ? parseFloat(lastYMinStr) : 0;
                    const yMax = lastYMaxStr ? parseFloat(lastYMaxStr) : 100;

                    const payload = { 
                        values: valsToUse, 
                        mode: lastModeStr || 'raw', 
                        cols: colsCount,
                        type: chartType,
                        cellCount: cellCount,
                        yMin: yMin,
                        yMax: yMax
                    }; 
                    
                    const graphColCount = chartType === 'line' ? Math.max(0, colsCount - 1) : colsCount;
                    setLayerVisibility(node, "col-", graphColCount);
                    
                    applyCells(node, cellCount);
                    applyYAxis(node, cellCount, payload); 

                    if (chartType === "bar") applyBar(payload, H, node);
                    else if (chartType === "line") applyLine(payload, H, node);
                    else if (chartType === "stackedBar") applyStackedBar(payload, H, node);
                }

            } catch(e) { console.warn("Auto-Apply Failed:", e); }
        }
        prevWidth = node.width;
        prevHeight = node.height;
      }
    }
  } else {
    currentSelectionId = null;
  }
}, 500);