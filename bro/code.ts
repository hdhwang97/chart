// code.ts

// ==========================================
// 1. CONFIG & CONSTANTS (사용자 설정)
// ==========================================

// [설정 1] 마스터 컴포넌트 이름 및 키
const MASTER_COMPONENT_CONFIG = {
  NAME: "Chart_test", 
  KEY: "" // 로컬이면 비워두세요.
};

// [설정 2] 캐싱 키 (재검색 방지용)
const STORAGE_KEY_COMPONENT_ID = "cached_chart_component_id";

// [설정 3] Variant 속성 이름
const VARIANT_PROPERTY_NAME = "Type"; 

// [설정 4] UI 값 -> Figma Variant 값 (소문자 변경 완료)
const VARIANT_MAPPING: { [key: string]: string } = {
  'bar': 'bar',           // 기존 'Bar' -> 'bar'
  'line': 'line',         // 기존 'Line' -> 'line'
  'stackedBar': 'stacked' // 기존 'Stacked' -> 'stacked'
};

// ------------------------------------------

const LINE_VARIANT_KEY_DEFAULT = "direction"; 
const LINE_VARIANT_VALUES = {
  UP: "up",
  DOWN: "down",
  FLAT: "flat"
} as const;

const PLUGIN_DATA_KEYS = {
  MODIFIED: "isChartModified",
  LAST_VALUES: "lastAppliedValues"
} as const;

const MARK_NAME_PATTERNS = {
  BAR: /^bar$/,
  LINE: /^line$/, 
  COL_ALL: /^col-0*(\d+)$/,
  STACKED: /^bar_(\d+)_(\d+)$/,
};

// 리사이즈 감지용 변수
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

// [NEW] 최적화된 컴포넌트 찾기 (캐싱 + 현재페이지 우선 검색)
async function findMasterComponent(): Promise<ComponentNode | ComponentSetNode | null> {
    const { KEY, NAME } = MASTER_COMPONENT_CONFIG;

    // 1. [Fastest] 저장된 ID가 있는지 확인 (캐싱)
    const cachedId = await figma.clientStorage.getAsync(STORAGE_KEY_COMPONENT_ID);
    if (cachedId) {
        const cachedNode = figma.getNodeById(cachedId);
        if (cachedNode && (cachedNode.type === "COMPONENT" || cachedNode.type === "COMPONENT_SET")) {
            console.log(`🚀 Instant Load (from Cache): "${cachedNode.name}"`);
            return cachedNode as ComponentNode | ComponentSetNode;
        } else {
            // ID가 유효하지 않다면(삭제됨) 캐시 초기화
            console.log("Cache invalid, searching again...");
            await figma.clientStorage.setAsync(STORAGE_KEY_COMPONENT_ID, undefined);
        }
    }

    // 2. Key로 찾기 (라이브러리)
    if (KEY) {
        try {
            const importComponent = await figma.importComponentByKeyAsync(KEY);
            return importComponent;
        } catch (e) {}
    }

    console.log(`Searching for component/set with name: "${NAME}"...`);
    const startTime = Date.now();
    let found: SceneNode | null = null;

    // 3. [Fast] 현재 페이지 먼저 검색 (대부분 여기 있음)
    found = figma.currentPage.findOne(n => 
        (n.type === "COMPONENT" || n.type === "COMPONENT_SET") && n.name === NAME
    );

    // 4. [Slow] 현재 페이지에 없다면 전체 검색 (24초 걸리던 부분)
    if (!found) {
        console.log("Not found in current page. Searching entire document (this may take time)...");
        found = figma.root.findOne(n => 
            (n.type === "COMPONENT" || n.type === "COMPONENT_SET") && n.name === NAME
        );
    }

    const duration = Date.now() - startTime;

    if (found) {
        console.log(`✅ Found: "${found.name}" (${duration}ms)`);
        // 찾았으면 ID 저장 (다음번엔 0초)
        await figma.clientStorage.setAsync(STORAGE_KEY_COMPONENT_ID, found.id);
    } else {
        console.error(`❌ Failed! Could not find "${NAME}". (${duration}ms)`);
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
  let foundType: string | null = null;
  let stop = false;

  // Variant 속성으로 먼저 판단
  if (node.type === "INSTANCE" && node.componentProperties[VARIANT_PROPERTY_NAME]) {
      const val = node.componentProperties[VARIANT_PROPERTY_NAME].value;
      const key = Object.keys(VARIANT_MAPPING).find(k => VARIANT_MAPPING[k] === val);
      if (key) return key;
  }

  // 내부 레이어 이름으로 판단
  traverse(node, (n) => {
    if (stop) return;
    if (!n.visible) return;

    if (MARK_NAME_PATTERNS.LINE.test(n.name)) { foundType = "line"; stop = true; return; }
    if (MARK_NAME_PATTERNS.BAR.test(n.name)) { foundType = "bar"; stop = true; return; }
    if (MARK_NAME_PATTERNS.STACKED.test(n.name)) { foundType = "stackedBar"; stop = true; return; }
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

function findMarkInCol(colNode: SceneNode, markPattern: RegExp): (SceneNode & LayoutMixin) | null {
    let tabNode: SceneNode | null = null;
    const children = "children" in colNode ? (colNode as FrameNode).children : [];
    
    // @ts-ignore
    if (colNode.findOne) tabNode = colNode.findOne(n => n.name === "tab");
    else tabNode = children.find(n => n.name === "tab") || null;
    
    if (!tabNode) return null;

    let markNode: (SceneNode & LayoutMixin) | null = null;
    // @ts-ignore
    if (tabNode.findOne) markNode = tabNode.findOne(n => n.visible && markPattern.test(n.name));
    // @ts-ignore
    else if ("children" in tabNode) markNode = tabNode.children.find(n => n.visible && markPattern.test(n.name));

    // @ts-ignore
    if (markNode && markNode.paddingBottom !== undefined) return markNode;
    
    return null;
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

function applyBar(config: any, H: number, graph: SceneNode) {
  const values = config.values.map((v:any) => Number(v) || 0);
  const columns = collectColumns(graph);
  
  if (H <= 0) return;
  const normPx = config.mode === "percent" ? normalizePercent(values, H) : normalizeRaw(values, H);
  
  for (let i = 0; i < values.length; i++) {
    const colIndex = i + 1; 
    const val = normPx[i];
    const targetCol = columns.find(c => c.index === colIndex);
    if (!targetCol) continue;

    const barNode = findMarkInCol(targetCol.node, MARK_NAME_PATTERNS.BAR);
    if (barNode) { barNode.paddingBottom = val; }
  }
}

function applyLine(config: any, H: number, graph: SceneNode) {
  const rawValues = config.values.map((v:any) => Number(v) || 0);
  const columns = collectColumns(graph); 

  if (H <= 0) return;
  const normPx = config.mode === "percent" ? normalizePercent(rawValues, H) : normalizeRaw(rawValues, H);
  const segmentCount = Math.max(0, rawValues.length - 1);

  for (let i = 0; i < segmentCount; i++) {
      const colIndex = i + 1; 
      const startVal = normPx[i];
      const endVal = normPx[i+1];

      const targetCol = columns.find(c => c.index === colIndex);
      if (!targetCol) continue;

      const lineNode = findMarkInCol(targetCol.node, MARK_NAME_PATTERNS.LINE);
      if (!lineNode) continue;

      const minY = Math.min(startVal, endVal);
      const maxY = Math.max(startVal, endVal);
      
      lineNode.paddingBottom = minY;
      lineNode.paddingTop = H - maxY;

      if (lineNode.type === "INSTANCE") {
          let dir = LINE_VARIANT_VALUES.FLAT;
          if (endVal > startVal) dir = LINE_VARIANT_VALUES.UP;
          else if (endVal < startVal) dir = LINE_VARIANT_VALUES.DOWN;
          
          try {
             const props: any = {};
             props[LINE_VARIANT_KEY_DEFAULT] = dir;
             lineNode.setProperties(props);
          } catch(e) {}
      }
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

        const count = payload.type === "line" ? Math.max(0, payload.values.length - 1) : payload.values.length;
        setLayerVisibility(graph, "col-", count);

        if (payload.type === "bar") applyBar(payload, H, graph);
        else if (payload.type === "line") applyLine(payload, H, graph);
        else if (payload.type === "stackedBar") applyStackedBar(payload, H, graph);

        graph.setPluginData(PLUGIN_DATA_KEYS.MODIFIED, "true");
        graph.setPluginData(PLUGIN_DATA_KEYS.LAST_VALUES, JSON.stringify(payload.values));

        return true;
    } catch (e: any) {
        console.error(e);
        figma.notify("Error applying data: " + e.message);
        return false;
    }
}

// ==========================================
// 6. INFER LOGIC
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
      const values: number[] = [];
      cols.forEach((c, index) => {
          const lineNode = findMarkInCol(c.node, MARK_NAME_PATTERNS.LINE);
          if (lineNode && lineNode.type === "INSTANCE") {
              const pb = lineNode.paddingBottom;
              const pt = lineNode.paddingTop;
              const minVal = pb;
              const maxVal = H - pt;
              const props = lineNode.componentProperties;
              let foundDir = "";
              for (const valueObj of Object.values(props)) {
                  const rawVal = String(valueObj.value).toLowerCase().trim();
                  if (rawVal === LINE_VARIANT_VALUES.UP) foundDir = LINE_VARIANT_VALUES.UP;
                  else if (rawVal === LINE_VARIANT_VALUES.DOWN) foundDir = LINE_VARIANT_VALUES.DOWN;
              }
              let startPx = 0; let endPx = 0;
              if (foundDir === LINE_VARIANT_VALUES.UP) { startPx = minVal; endPx = maxVal; }
              else if (foundDir === LINE_VARIANT_VALUES.DOWN) { startPx = maxVal; endPx = minVal; }
              else { startPx = minVal; endPx = minVal; }

              if (index === 0) { values.push(startPx); values.push(endPx); }
              else { values.push(endPx); }
          } else {
              if (index === 0) values.push(0); values.push(0);
          }
      });
      const normalizedValues = values.map(v => Math.round((v / H) * 100 * 10) / 10);
      return { mode: "percent", values: normalizedValues };
  }

  if (chartType === "bar") {
    const values = cols.map(c => {
        const barNode = findMarkInCol(c.node, MARK_NAME_PATTERNS.BAR);
        if (barNode) {
             const ratio = barNode.paddingBottom / H;
             return Math.round(ratio * 100 * 10) / 10;
        }
        return 0;
    });
    return { mode: "percent", values };
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
  let values = null;
  let height = null;
  let isModified = false;
  let lastValues = null;
  
  let uiMode = "create";

  if (selection.length === 1) {
    const node = selection[0];
    if (isChartInstance(node)) {
        chartType = detectChartType(node);
        if (chartType && "height" in node) {
            uiMode = "edit";
            // @ts-ignore
            height = node.height; 
            const inferred = inferValuesFromGraph(chartType, height, node);
            // @ts-ignore
            if (inferred) values = inferred.values;

            const modifiedFlag = node.getPluginData(PLUGIN_DATA_KEYS.MODIFIED);
            const lastDataStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_VALUES);
            isModified = modifiedFlag === "true";
            if (lastDataStr) {
                try { lastValues = JSON.parse(lastDataStr); } catch(e) {}
            }
        }
    }
  }

  figma.ui.postMessage({
    type: "init",
    uiMode,
    chartType,
    values,
    height,
    isModified, 
    lastValues
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
        figma.notify("차트 데이터 업데이트 완료");
        updateUI();
    }
  }

  // [CASE 2] Generate (신규 생성) - 캐싱 및 최적화 적용
  if (msg.type === "generate") {
      try {
          const payload = msg.payload;
          
          // 1. 컴포넌트 찾기 (캐싱 활용)
          const masterComponent = await findMasterComponent();
          if (!masterComponent) {
              figma.notify(`'${MASTER_COMPONENT_CONFIG.NAME}' 컴포넌트를 찾을 수 없습니다.`);
              return;
          }

          // 2. 인스턴스 생성
          let newInstance: InstanceNode;

          if (masterComponent.type === "COMPONENT_SET") {
              const defaultVar = masterComponent.defaultVariant;
              if (!defaultVar) {
                  figma.notify("오류: Component Set에 Default Variant가 설정되지 않았습니다.");
                  return;
              }
              newInstance = defaultVar.createInstance();
          } else {
              newInstance = masterComponent.createInstance();
          }
          
          // 3. Variant 속성 변경 (소문자 매핑 적용)
          const targetVariantValue = VARIANT_MAPPING[payload.type]; 
          if (targetVariantValue) {
              try {
                  newInstance.setProperties({ [VARIANT_PROPERTY_NAME]: targetVariantValue });
              } catch (e) {
                  console.warn("Variant property setting failed:", e);
                  figma.notify(`Variant 설정 실패. '${VARIANT_PROPERTY_NAME}=${targetVariantValue}' 확인 필요.`);
              }
          }

          // 4. 화면 배치
          const { x, y } = figma.viewport.center;
          newInstance.x = x - (newInstance.width / 2);
          newInstance.y = y - (newInstance.height / 2);
          figma.currentPage.appendChild(newInstance);

          // 5. 데이터 주입
          const success = handleApplyData(payload, newInstance);
          
          if(success) {
              figma.currentPage.selection = [newInstance];
              figma.notify("새 차트 생성 완료");
          } else {
              newInstance.remove();
          }
      } catch (err: any) {
          console.error("Generate Error:", err);
          figma.notify("생성 중 오류 발생: " + err.message);
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
        const lastDataStr = node.getPluginData(PLUGIN_DATA_KEYS.LAST_VALUES);
        
        if (isModified && lastDataStr) {
            try {
                const lastValues = JSON.parse(lastDataStr);
                const chartType = detectChartType(node);
                
                let xh = 0;
                // @ts-ignore
                const xEmpty = node.findOne ? node.findOne(n => n.name === "x-empty") : null;
                if (xEmpty) xh = xEmpty.height;
                const H = node.height - xh;

                const payload = { values: lastValues, mode: 'raw' }; 
                if (chartType === "bar") applyBar(payload, H, node);
                else if (chartType === "line") applyLine(payload, H, node);
                else if (chartType === "stackedBar") applyStackedBar(payload, H, node);

            } catch(e) { console.warn("Auto-Apply Failed:", e); }
        }
        prevWidth = node.width;
        prevHeight = node.height;
        updateUI(); 
      }
    }
  } else {
    currentSelectionId = null;
  }
}, 500);