// code.ts

// ==========================================
// 1. CONFIG & CONSTANTS
// ==========================================

const LINE_VARIANT_KEY = "direction"; 
const LINE_VARIANT_VALUES = {
  UP: "up",
  DOWN: "down",
  FLAT: "flat"
} as const;

const CHART_TYPE_VALUES = {
  BAR: "bar",
  STACKED_BAR: "stackedBar",
  LINE: "line",
} as const;

const MARK_NAME_PATTERNS = {
  // [변경] Bar와 Line 모두 단순 이름 허용
  BAR: /^bar$/,
  LINE: /^line$/, 

  // Col: 데이터 매핑용
  COL_ALL: /^col-0*(\d+)$/,
  
  // Stacked
  STACKED: /^bar_(\d+)_(\d+)$/,
};

// ==========================================
// 2. UTILITIES (기존 동일)
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

// ==========================================
// 3. DETECTION (구조 기반 감지)
// ==========================================

function isChartInstance(node: SceneNode): boolean {
  return node.type === "INSTANCE";
}

function detectChartType(node: SceneNode): string | null {
  let foundType: string | null = null;
  let stop = false;

  traverse(node, (n) => {
    if (stop) return;
    if (!n.visible) return;

    // [변경] 단순 이름 'line' 감지
    if (MARK_NAME_PATTERNS.LINE.test(n.name)) {
      foundType = "line";
      stop = true;
      return;
    }
    if (MARK_NAME_PATTERNS.BAR.test(n.name)) {
      foundType = "bar";
      stop = true; 
      return;
    }
    if (MARK_NAME_PATTERNS.STACKED.test(n.name)) {
      foundType = "stackedBar";
      stop = true;
      return;
    }
  });

  return foundType;
}

// ==========================================
// 4. COLLECTION
// ==========================================

// Column 수집 (Bar, Line 공용)
function collectColumns(root: SceneNode) {
  const cols: {index: number, node: SceneNode}[] = [];
  traverse(root, (node) => {
    if (!node.visible) return;
    const match = MARK_NAME_PATTERNS.COL_ALL.exec(node.name);
    if (match) {
      if ("children" in node) {
        cols.push({
          index: parseInt(match[1], 10),
          node: node
        });
      }
    }
  });
  return cols.sort((a, b) => a.index - b.index);
}

// Stacked만 별도 수집
function collectMarks(root: SceneNode) {
  const stacked: any[] = [];
  traverse(root, (node) => {
    if (!node.name || !node.visible) return;
    let m;
    if ((m = MARK_NAME_PATTERNS.STACKED.exec(node.name))) {
       // @ts-ignore
      if (node.paddingTop !== undefined) {
         // @ts-ignore
        stacked.push({ barIndex: parseInt(m[1]), segIndex: parseInt(m[2]), node });
      }
    }
  });
  return { stacked };
}

// ==========================================
// 5. NORMALIZATION
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

// ==========================================
// 6. APPLY LOGIC (Bar & Line 공통 구조화)
// ==========================================

// 공통 탐색 함수: Col -> Tab -> Mark(bar/line)
function findMarkInCol(colNode: SceneNode, markPattern: RegExp): (SceneNode & LayoutMixin) | null {
    // 1. Tab 찾기
    let tabNode: SceneNode | null = null;
    const children = "children" in colNode ? (colNode as FrameNode).children : [];
    
    // @ts-ignore
    if (colNode.findOne) tabNode = colNode.findOne(n => n.name === "tab");
    else tabNode = children.find(n => n.name === "tab") || null;
    
    if (!tabNode) return null;

    // 2. Mark 찾기 (bar 또는 line)
    let markNode: (SceneNode & LayoutMixin) | null = null;
    // @ts-ignore
    if (tabNode.findOne) markNode = tabNode.findOne(n => n.visible && markPattern.test(n.name));
    // @ts-ignore
    else if ("children" in tabNode) markNode = tabNode.children.find(n => n.visible && markPattern.test(n.name));

    // @ts-ignore
    if (markNode && markNode.paddingBottom !== undefined) return markNode;
    
    return null;
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
    
    if (barNode) {
        barNode.paddingBottom = val;
    }
  }
}

// [핵심 변경] Line도 Col 구조 기반으로 변경
function applyLine(config: any, H: number, graph: SceneNode) {
  const rawValues = config.values.map((v:any) => Number(v) || 0);
  const columns = collectColumns(graph); // Col 수집

  if (H <= 0) return;
  const normPx = config.mode === "percent" ? normalizePercent(rawValues, H) : normalizeRaw(rawValues, H);

  // 세그먼트 개수 = 데이터 개수 - 1
  // Line 세그먼트는 col-01, col-02... 순서대로 매핑됨
  // col-01의 line은 values[0] -> values[1]을 연결
  const segmentCount = Math.max(0, rawValues.length - 1);

  for (let i = 0; i < segmentCount; i++) {
      const colIndex = i + 1; // col-01부터 시작
      const startVal = normPx[i];
      const endVal = normPx[i+1];

      // 해당 순번의 컬럼 찾기
      const targetCol = columns.find(c => c.index === colIndex);
      if (!targetCol) continue;

      // 컬럼 안의 'tab > line' 찾기
      const lineNode = findMarkInCol(targetCol.node, MARK_NAME_PATTERNS.LINE);
      if (!lineNode) continue;

      // 값 적용
      const minY = Math.min(startVal, endVal);
      const maxY = Math.max(startVal, endVal);
      
      lineNode.paddingBottom = minY;
      lineNode.paddingTop = H - maxY;

      // Variant 적용
      if (lineNode.type === "INSTANCE") {
          let dir = LINE_VARIANT_VALUES.FLAT;
          if (endVal > startVal) dir = LINE_VARIANT_VALUES.UP;
          else if (endVal < startVal) dir = LINE_VARIANT_VALUES.DOWN;
          
          try {
             const props: any = {};
             props[LINE_VARIANT_KEY] = dir;
             lineNode.setProperties(props);
          } catch(e) {}
      }
  }
}

function applyStackedBar(config: any, H: number, graph: SceneNode) {
    // (기존 코드 유지)
    // ...
}

// ==========================================
// 7. INFER (Reverse Engineering)
// ==========================================

// code.ts 내 inferValuesFromGraph 함수 수정

function inferValuesFromGraph(chartType: string, fullHeight: number, graph: SceneNode) {
  // 정확한 역산을 위해 x-empty(축 영역) 높이를 제외한 실제 그래프 높이(H) 계산
  let xh = 0;
  // @ts-ignore
  const xEmpty = graph.findOne ? graph.findOne(n => n.name === "x-empty") : null;
  if (xEmpty) xh = xEmpty.height;
  
  const H = fullHeight - xh;
  if (H <= 0) return null;

  // 공통: 컬럼 수집
  const cols = collectColumns(graph);
  if (!cols.length) return null;

  // [Case 1] Line Chart 역산
  if (chartType === "line") {
      const values: number[] = [];
      
      cols.forEach((c, index) => {
          // 각 컬럼 내부의 line 레이어 찾기
          const lineNode = findMarkInCol(c.node, MARK_NAME_PATTERNS.LINE);
          
          if (lineNode && lineNode.type === "INSTANCE") {
              // 1. 높이값 읽기 (px)
              const pb = lineNode.paddingBottom;
              const pt = lineNode.paddingTop;
              
              const minVal = pb;
              const maxVal = H - pt;
              
              // 2. 방향 읽기 (Variant)
              // config.ts에 정의된 LINE_VARIANT_KEY 사용 (예: "direction")
              // 대소문자 이슈 방지를 위해 소문자로 변환하여 비교하거나, 정확한 키 사용 필요
              const props = lineNode.componentProperties;
              const dirValue = props[LINE_VARIANT_KEY]; // 예: "up", "down"
              
              let startPx = 0;
              let endPx = 0;

              // 방향에 따라 Start/End 할당
              if (dirValue === LINE_VARIANT_VALUES.UP) {
                  startPx = minVal;
                  endPx = maxVal;
              } else if (dirValue === LINE_VARIANT_VALUES.DOWN) {
                  startPx = maxVal;
                  endPx = minVal;
              } else {
                  // FLAT
                  startPx = minVal;
                  endPx = minVal;
              }

              // 3. 값 저장
              // 첫 번째 세그먼트는 시작점과 끝점을 모두 저장
              if (index === 0) {
                  values.push(startPx);
                  values.push(endPx);
              } else {
                  // 두 번째부터는 끝점만 저장 (이어지기 때문)
                  values.push(endPx);
              }
          } else {
              // 라인 노드가 없거나 인스턴스가 아닌 경우, 흐름이 끊기므로 0 처리
              if (index === 0) values.push(0);
              values.push(0);
          }
      });

      // 4. 픽셀(px) -> 데이터(%) 변환 및 반올림
      const normalizedValues = values.map(v => Math.round((v / H) * 100 * 10) / 10);

      return { 
          mode: "percent", 
          values: normalizedValues, 
          note: `Line segments(${cols.length}) -> Data inferred` 
      };
  }

  // [Case 2] Bar Chart 역산 (기존 로직 + H 보정 적용)
  if (chartType === "bar") {
    const values = cols.map(c => {
        const barNode = findMarkInCol(c.node, MARK_NAME_PATTERNS.BAR);
        if (barNode) {
             const ratio = barNode.paddingBottom / H;
             return Math.round(ratio * 100 * 10) / 10;
        }
        return 0;
    });
    return { mode: "percent", values, note: "Bar padding 역산됨" };
  }

  return null;
}

// ==========================================
// 8. MAIN EXECUTION
// ==========================================

if (figma.editorType !== "figma") figma.closePlugin();
figma.showUI(__html__, { width: 480, height: 520 });

function updateUI() {
  const selection = figma.currentPage.selection;
  let chartType = null;
  let values = null;
  let height = null;

  if (selection.length === 1) {
    const node = selection[0];
    if (isChartInstance(node)) {
        chartType = detectChartType(node);
        if (chartType && "height" in node) {
            // @ts-ignore
            height = node.height; 
            const inferred = inferValuesFromGraph(chartType, height, node);
            // @ts-ignore
            if (inferred) values = inferred.values;
        }
    }
  }

  figma.ui.postMessage({
    type: "init",
    uiMode: chartType ? "edit" : "create",
    chartType,
    values,
    height,
  });
}

updateUI();
figma.on("selectionchange", updateUI);

figma.ui.onmessage = async (msg: any) => {
  if (msg.type === 'create') return;
  if (msg.type === "apply") {
    const payload = msg.payload;
    const sel = figma.currentPage.selection;
    if (sel.length !== 1) { figma.notify("선택 오류"); return; }
    const graph = sel[0];
    
    try {
        // 높이 계산 (x-empty 제외)
        let xh = 0;
        // @ts-ignore
        const xEmpty = graph.findOne ? graph.findOne(n => n.name === "x-empty") : null;
        if (xEmpty) xh = xEmpty.height;
        // @ts-ignore
        const H = graph.height - xh;

        // Visibility 설정 (Col 기준)
        // Line은 세그먼트 수 = 데이터 - 1
        const count = payload.type === "line" ? Math.max(0, payload.values.length - 1) : payload.values.length;
        setLayerVisibility(graph, "col-", count);

        if (payload.type === "bar") applyBar(payload, H, graph);
        else if (payload.type === "line") applyLine(payload, H, graph);
        else if (payload.type === "stackedBar") applyStackedBar(payload, H, graph);

        figma.notify("업데이트 완료");
    } catch (e:any) {
        figma.notify("Error: " + e.message);
    }
  }
};