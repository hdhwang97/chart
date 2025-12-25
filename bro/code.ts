// code.ts

// ==========================================
// 1. CONFIG & CONSTANTS (사용자 설정)
// ==========================================

const MASTER_COMPONENT_CONFIG = {
  NAME: "Chart_test", 
  KEY: "" 
};

const STORAGE_KEY_COMPONENT_ID = "cached_chart_component_id";

// Variant Properties Key Names
const VARIANT_PROPERTY_TYPE = "Type"; 
const VARIANT_PROPERTY_MARK_NUM = "markNum"; // Bar 차트용 (Row 개수)
const VARIANT_PROPERTY_LINE_NUM = "lineNum"; // Line 차트용 (Series 번호)

const VARIANT_MAPPING: { [key: string]: string } = {
  'bar': 'bar',           
  'line': 'line',         
  'stackedBar': 'stacked' 
};

// Line Direction Values
const LINE_VARIANT_KEY_DEFAULT = "direction"; 
const LINE_VARIANT_VALUES = {
  UP: "up",
  DOWN: "down",
  FLAT: "flat"
} as const;

// [수정] 데이터 저장을 위한 키 추가 (Drawing Values 분리)
const PLUGIN_DATA_KEYS = {
  MODIFIED: "isChartModified",
  LAST_VALUES: "lastAppliedValues",       // UI 복구용 (원본 Raw 데이터)
  LAST_DRAWING_VALUES: "lastDrawingValues", // 리사이즈용 (화면 표시 데이터)
  LAST_MODE: "lastAppliedMode"            // 모드 (raw / percent)
} as const;

const MARK_NAME_PATTERNS = {
  // Bar Chart Patterns
  BAR_INSTANCE: /^bar$/, 
  BAR_ITEM_SINGLE: /^bar$/,
  BAR_ITEM_MULTI: /^bar[-_]?0*(\d+)$/,

  // Line Chart Patterns (line, line-01, line-02...)
  LINE: /^line[-_]?0*(\d*)$/, 

  COL_ALL: /^col-0*(\d+)$/,
  STACKED: /^bar_(\d+)_(\d+)$/,
};

// 리사이즈 감지 변수
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

// 컴포넌트 찾기 (캐싱 적용)
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
    const startTime = Date.now();
    
    let found = figma.currentPage.findOne(n => 
        (n.type === "COMPONENT" || n.type === "COMPONENT_SET") && n.name === NAME
    );

    if (!found) {
        found = figma.root.findOne(n => 
            (n.type === "COMPONENT" || n.type === "COMPONENT_SET") && n.name === NAME
        );
    }

    const duration = Date.now() - startTime;

    if (found) {
        console.log(`✅ Found: "${found.name}" (${duration}ms)`);
        await figma.clientStorage.setAsync(STORAGE_KEY_COMPONENT_ID, found.id);
    } else {
        console.error(`❌ Failed: "${NAME}" not found. (${duration}ms)`);
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

// ==========================================
// 4. HELPER: FIND MARK
// ==========================================

function findChildByNamePattern(parentNode: SceneNode, pattern: RegExp): (SceneNode & LayoutMixin) | null {
    // @ts-ignore
    if (parentNode.findOne) return parentNode.findOne(n => pattern.test(n.name));
    // @ts-ignore
    if ("children" in parentNode) return parentNode.children.find(n => pattern.test(n.name));
    return null;
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
// 5. APPLY LOGIC (Write to Figma)
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

// Bar Logic
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

          if (rowCount === 1) {
              targetBar = barInstance.children.find(n => MARK_NAME_PATTERNS.BAR_ITEM_SINGLE.test(n.name)) as (SceneNode & LayoutMixin);
          } else {
              const targetNum = r + 1;
              const multiPattern = new RegExp(`^bar[-_]?0*(${targetNum})$`); 
              targetBar = barInstance.children.find(n => multiPattern.test(n.name)) as (SceneNode & LayoutMixin);
          }

          if (targetBar && targetBar.paddingBottom !== undefined) {
              targetBar.visible = true;
              targetBar.paddingBottom = valPx;
          }
      }
  });
}

// Line Logic
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
              const layerNum = numStr ? parseInt(numStr, 10) : 1; 
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
              const layerNum = numStr ? parseInt(numStr, 10) : 1;
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

        const count = payload.type === 'line' ? Math.max(0, payload.cols - 1) : payload.cols;
        setLayerVisibility(graph, "col-", count);

        // [Drawing] 그래프를 그릴 때는 payload.values 사용 (화면에 보이는 값, 예: 100%)
        if (payload.type === "bar") applyBar(payload, H, graph);
        else if (payload.type === "line") applyLine(payload, H, graph);
        else if (payload.type === "stackedBar") applyStackedBar(payload, H, graph);

        // [Saving] 데이터 저장 로직 분리
        // 1. lastValues: UI 복구용 원본 데이터 (payload.rawValues가 있으면 사용, 없으면 values)
        // 2. lastDrawingValues: 리사이즈용 표시 데이터 (payload.values)
        const storageValues = payload.rawValues ? payload.rawValues : payload.values;
        const drawingValues = payload.values;

        graph.setPluginData(PLUGIN_DATA_KEYS.MODIFIED, "true");
        graph.setPluginData(PLUGIN_DATA_KEYS.LAST_VALUES, JSON.stringify(storageValues)); 
        graph.setPluginData(PLUGIN_DATA_KEYS.LAST_DRAWING_VALUES, JSON.stringify(drawingValues));
        graph.setPluginData(PLUGIN_DATA_KEYS.LAST_MODE, payload.mode); 

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
      return { mode: "percent", values: extractedValues };
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

    return { mode: "percent", values: extractedValues };
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
            if (inferredObj) inferredValues = inferredObj.values;

            const modifiedFlag = node.getPluginData(PLUGIN_DATA_KEYS.MODIFIED);
            const lastDataStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_VALUES);
            const lastModeStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MODE);

            isModified = modifiedFlag === "true";
            
            if (lastDataStr) {
                try { 
                    lastValues = JSON.parse(lastDataStr); 
                    if (lastModeStr) lastMode = lastModeStr;
                } catch(e) {}
            }
        }
    }
  }

  // UI에는 항상 '저장된 Raw 값(lastValues)'을 보냅니다.
  figma.ui.postMessage({
    type: "init",
    uiMode,
    chartType,
    inferredValues,
    lastValues, 
    lastMode,   
    height,
    isModified
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
        
        // [수정] 리사이즈 로직 개선
        const isModified = node.getPluginData(PLUGIN_DATA_KEYS.MODIFIED) === "true";
        const lastValuesStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_VALUES);
        const lastDrawingStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_DRAWING_VALUES); // [NEW]
        const lastModeStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_MODE);
        
        if (isModified) {
            try {
                // 리사이즈 시에는 'Drawing Values'(화면 표시 값)를 최우선으로 사용합니다.
                // 그래야 % 모드일 때 원본 데이터가 아닌 % 비율대로 그래프가 그려집니다.
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

                    const payload = { 
                        values: valsToUse, 
                        mode: lastModeStr || 'raw', 
                        cols: colsCount,
                        type: chartType
                    }; 
                    
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