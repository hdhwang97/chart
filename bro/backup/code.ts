// code.ts

// ==========================================
// 1. CONFIG & CONSTANTS (Embedded)
// ==========================================

// 라인 차트의 방향을 결정하는 Variant 속성 이름 (Figma 컴포넌트 속성명과 일치해야 함)
const LINE_VARIANT_KEY = "Direction"; 

// 각 방향에 해당하는 Variant 값
const LINE_VARIANT_VALUES = {
  UP: "up",     // 오르막
  DOWN: "down", // 내리막
  FLAT: "flat"  // 평지
} as const;

const CHART_TYPE_VALUES = {
  BAR: "bar",
  STACKED_BAR: "stackedBar",
  LINE: "line",
} as const;

const MARK_NAME_PATTERNS = {
  // Bar: 이름이 정확히 "bar"인 경우
  BAR: /^bar$/,
  
  // Col: 데이터 매핑용 (col-01, col-1 ...)
  COL_ALL: /^col-0*(\d+)$/,
  
  // Stacked: bar_01_01
  STACKED: /^bar_(\d+)_(\d+)$/,
  
  // Line: line_01, line_1
  LINE: /^line_(\d+)$/,
};

// ==========================================
// 2. TYPES
// ==========================================

type ChartType = typeof CHART_TYPE_VALUES[keyof typeof CHART_TYPE_VALUES];
type Mode = "percent" | "raw";

interface ApplyPayload {
  type: ChartType;
  mode: Mode;
  values: any; // bar/line: number[], stacked: number[][]
  cols?: number;
  rows?: number;
  horizontalPadding?: number;
  height?: number;
}

interface InitMessage {
  type: "init";
  uiMode: "create" | "edit";
  chartType: ChartType | null;
  inferredMode: Mode | null;
  values: any;
  height: number | null;
  note?: string;
}

interface ColInfo {
  index: number;
  node: SceneNode;
}

interface BarMark {
  index: number;
  node: SceneNode & LayoutMixin;
}

interface StackedMark {
  barIndex: number;
  segIndex: number;
  node: SceneNode & LayoutMixin;
}

interface LineMark {
  index: number;
  node: SceneNode & LayoutMixin;
}

// ==========================================
// 3. UTILITIES
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

function isPaddingNode(node: SceneNode): node is SceneNode & LayoutMixin {
  return (
    "paddingTop" in node &&
    "paddingBottom" in node
  );
}

// Visibility 제어 (데이터 개수에 맞춰 레이어 Show/Hide)
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
// 4. DETECTION (Simple Logic)
// ==========================================

function isChartInstance(node: SceneNode): boolean {
  return node.type === "INSTANCE";
}

function detectChartType(node: SceneNode): ChartType | null {
  let foundType: ChartType | null = null;
  let stop = false;

  traverse(node, (n) => {
    if (stop) return;
    if (!n.visible) return; // 숨겨진 레이어는 감지 제외

    // Line 감지
    if (MARK_NAME_PATTERNS.LINE.test(n.name)) {
      foundType = "line";
      stop = true;
      return;
    }

    // Bar 감지
    if (MARK_NAME_PATTERNS.BAR.test(n.name)) {
      foundType = "bar";
      stop = true; 
      return;
    }

    // Stacked 감지
    if (MARK_NAME_PATTERNS.STACKED.test(n.name)) {
      foundType = "stackedBar";
      stop = true;
      return;
    }
  });

  return foundType;
}

// ==========================================
// 5. COLLECTION
// ==========================================

// Bar Chart용 Column 수집
function collectColumns(root: SceneNode): ColInfo[] {
  const cols: ColInfo[] = [];
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

// Stacked, Line용 Mark 수집
function collectMarks(root: SceneNode): { stacked: StackedMark[]; lines: LineMark[] } {
  const stacked: StackedMark[] = [];
  const lines: LineMark[] = [];

  traverse(root, (node) => {
    if (!node.name || !node.visible) return;
    let m: RegExpExecArray | null;

    if ((m = MARK_NAME_PATTERNS.STACKED.exec(node.name))) {
      if (isPaddingNode(node)) {
        stacked.push({ barIndex: parseInt(m[1], 10), segIndex: parseInt(m[2], 10), node });
      }
      return;
    }
    if ((m = MARK_NAME_PATTERNS.LINE.exec(node.name))) {
      if (isPaddingNode(node)) {
        lines.push({ index: parseInt(m[1], 10), node });
      }
      return;
    }
  });

  return { stacked, lines };
}

// ==========================================
// 6. NORMALIZATION
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
// 7. APPLY LOGIC
// ==========================================

// Bar Chart: Col -> Tab -> Bar 구조 탐색 및 적용
function applyBar(config: ApplyPayload, H: number, graph: SceneNode) {
  const values = (config.values as any[]).map((v) => Number(v) || 0);
  const columns = collectColumns(graph);
  
  if (H <= 0) return;

  const normPx = config.mode === "percent" ? normalizePercent(values, H) : normalizeRaw(values, H);
  
  for (let i = 0; i < values.length; i++) {
    const currentIndex = i + 1; 
    const val = normPx[i];

    const targetCol = columns.find(c => c.index === currentIndex);

    if (!targetCol) continue;

    // Col 내부에서 Tab 찾기
    let tabNode: SceneNode | null = null;
    const colChildren = (targetCol.node as FrameNode).children; // FrameNode 등 자식이 있는 타입이라 가정

    if ("findOne" in targetCol.node) {
        // @ts-ignore
        tabNode = targetCol.node.findOne(n => n.name === "tab"); 
    } else if (colChildren) {
        tabNode = colChildren.find(n => n.name === "tab") || null;
    }

    if (!tabNode) continue;

    // Tab 내부에서 Bar 찾기
    let barNode: (SceneNode & LayoutMixin) | null = null;
    
    if ("findOne" in tabNode) {
        // @ts-ignore
        barNode = tabNode.findOne(n => n.visible && MARK_NAME_PATTERNS.BAR.test(n.name));
    } else if ("children" in tabNode) {
        // @ts-ignore
        barNode = tabNode.children.find(n => n.visible && MARK_NAME_PATTERNS.BAR.test(n.name));
    }

    if (barNode && "paddingBottom" in barNode) {
        barNode.paddingBottom = val;
        
        if (typeof config.horizontalPadding === "number") {
            barNode.paddingLeft = config.horizontalPadding;
            barNode.paddingRight = config.horizontalPadding;
        }
    }
  }
}

// Line Chart: N개의 데이터 -> N-1개의 세그먼트 적용
function applyLine(config: ApplyPayload, H: number, graph: SceneNode) {
  const rawValues = (config.values as any[]).map((v) => Number(v) || 0);
  const { lines } = collectMarks(graph);
  const sortedLines = lines.sort((a, b) => a.index - b.index);

  if (H <= 0) return;

  const normPx = config.mode === "percent" ? normalizePercent(rawValues, H) : normalizeRaw(rawValues, H);
  
  // 세그먼트 적용 개수 = (데이터 개수 - 1)와 (라인 레이어 개수) 중 작은 값
  const segmentsToApply = Math.min(Math.max(0, rawValues.length - 1), sortedLines.length);

  for (let s = 0; s < segmentsToApply; s++) {
    const startVal = normPx[s];
    const endVal = normPx[s+1];
    const line = sortedLines[s];

    if (startVal === undefined || endVal === undefined) continue;

    const minY = Math.min(startVal, endVal);
    const maxY = Math.max(startVal, endVal);

    // Padding으로 위치 잡기
    const padBot = minY;
    const padTop = H - maxY;

    line.node.paddingBottom = padBot;
    line.node.paddingTop = padTop;

    // Variant(Direction) 변경
    if (line.node.type === "INSTANCE") {
        let dir = LINE_VARIANT_VALUES.FLAT;
        if (endVal > startVal) dir = LINE_VARIANT_VALUES.UP;
        else if (endVal < startVal) dir = LINE_VARIANT_VALUES.DOWN;
        
        try {
           const props: {[key: string]: string} = {};
           props[LINE_VARIANT_KEY] = dir;
           line.node.setProperties(props);
        } catch(e) { 
           console.error(`[Error] line_${line.index} 속성(${LINE_VARIANT_KEY}) 적용 실패.`);
        }
    }
  }
}

// Stacked Bar Apply
function applyStackedBar(config: ApplyPayload, H: number, graph: SceneNode) {
  const values = config.values as number[][];
  const { stacked } = collectMarks(graph);
  if (H <= 0) return;

  const groupsMap = new Map<number, StackedMark[]>();
  stacked.forEach(s => {
    if (!groupsMap.has(s.barIndex)) groupsMap.set(s.barIndex, []);
    groupsMap.get(s.barIndex)!.push(s);
  });

  values.forEach((groupValues, gIndex) => {
    const barIndex = gIndex + 1;
    const marks = groupsMap.get(barIndex);
    if (!marks) return;

    marks.sort((a, b) => a.segIndex - b.segIndex);

    if (config.mode === "percent") {
      const normPx = normalizePercent(groupValues, H);
      marks.forEach(m => {
        if (normPx[m.segIndex - 1] !== undefined) {
          m.node.paddingBottom = normPx[m.segIndex - 1];
        }
      });
    } else {
      const total = groupValues.reduce((sum, v) => sum + Math.max(0, v), 0);
      marks.forEach(m => {
        const val = groupValues[m.segIndex - 1] || 0;
        const hPx = total > 0 ? (Math.max(0, val) / total) * H : 0;
        m.node.paddingBottom = hPx;
      });
    }
  });
}

// ==========================================
// 8. INFER (Reverse Engineering)
// ==========================================

function inferValuesFromGraph(chartType: ChartType, H: number, graph: SceneNode): { mode: Mode; values: any; note?: string } | null {
  // Bar Chart 역산
  if (chartType === "bar") {
    const cols = collectColumns(graph);
    if (!cols.length) return null;

    const values = cols.map(c => {
        let tabNode: SceneNode | null = null;
        if ("findOne" in c.node) {
            // @ts-ignore
            tabNode = c.node.findOne(n => n.name === "tab");
        } else if ("children" in c.node) {
            // @ts-ignore
            tabNode = c.node.children.find(n => n.name === "tab");
        }
        
        if (!tabNode) return 0;

        let barNode: (SceneNode & LayoutMixin) | null = null;
        if ("findOne" in tabNode) {
            // @ts-ignore
            barNode = tabNode.findOne(n => n.visible && MARK_NAME_PATTERNS.BAR.test(n.name));
        } else if ("children" in tabNode) {
            // @ts-ignore
            barNode = tabNode.children.find(n => n.visible && MARK_NAME_PATTERNS.BAR.test(n.name));
        }

        if (barNode && isPaddingNode(barNode)) {
             const ratio = barNode.paddingBottom / H;
             return Math.round(ratio * 1000) / 10;
        }
        return 0;
    });
    return { mode: "percent", values, note: "Bar padding 역산됨" };
  }

  // Line Chart 역산
  if (chartType === "line") {
      const { lines } = collectMarks(graph);
      const segmentCount = lines.length;
      
      if (segmentCount === 0) return null;

      // N개 세그먼트 -> N+1개 데이터 포인트
      const values = new Array(segmentCount + 1).fill(0);
      
      return { 
          mode: "percent", 
          values: values, 
          note: `Line segments(${segmentCount}) 감지 -> 데이터 ${segmentCount + 1}개로 설정` 
      };
  }

  return null;
}

// ==========================================
// 9. MAIN EXECUTION & EVENTS
// ==========================================

if (figma.editorType !== "figma") {
  figma.closePlugin("이 플러그인은 Figma 디자인 에디터에서만 동작합니다.");
}

figma.showUI(__html__, { width: 480, height: 520 });

function updateUI() {
  const selection = figma.currentPage.selection;
  console.log(`[Event] Selection Changed. 선택 수: ${selection.length}`);

  let chartType: ChartType | null = null;
  let values: any = null;
  let height: number | null = null;

  if (selection.length === 1) {
    const node = selection[0];
    
    // 1. 인스턴스 확인
    if (isChartInstance(node)) {
        
        // 2. 차트 타입 감지
        chartType = detectChartType(node);

        if (chartType) {
            console.log(`   > 차트 인식 성공: ${chartType}`);
            if ("height" in node) {
                height = (node as GeometryMixin).height; 
                // 3. 역산
                const inferred = inferValuesFromGraph(chartType, height, node);
                if (inferred) values = inferred.values;
            }
        } else {
             // 인스턴스지만 차트 레이어(bar, line 등)가 없는 경우
             // chartType은 null 유지 -> UI는 Step 1(Create) 표시
        }
    }
  }

  const initMsg: InitMessage = {
    type: "init",
    uiMode: chartType ? "edit" : "create",
    chartType,
    inferredMode: values ? "percent" : null,
    values,
    height,
  };
  figma.ui.postMessage(initMsg);
}

// 초기 실행 및 이벤트 등록
updateUI();
figma.on("selectionchange", updateUI);

// 메시지 핸들러
figma.ui.onmessage = async (msg: any) => {
  if (msg.type === 'create') {
    figma.notify("생성 기능 구현 중");
    return;
  }

  if (msg.type === "apply") {
    const payload = msg.payload as ApplyPayload;
    const sel = figma.currentPage.selection;

    if (sel.length !== 1) {
      figma.notify("차트를 선택해주세요.");
      return;
    }
    const graph = sel[0] as SceneNode & LayoutMixin & GeometryMixin;
    
    try {
      // Geometry 계산
      let yw = 0; 
      let xh = 0;

      // findOne은 SceneNode 타입에 존재하지 않을 수 있어 타입가드 필요하나 편의상 사용
      // @ts-ignore
      const yAxisNode = graph.findOne ? graph.findOne(n => n.name === "y-axis") : null;
      // @ts-ignore
      const xEmptyNode = graph.findOne ? graph.findOne(n => n.name === "x-empty") : null;

      if (yAxisNode) yw = yAxisNode.width;
      if (xEmptyNode) xh = xEmptyNode.height;

      const graphHeight = graph.height - xh;
      if (graphHeight <= 0) throw new Error("그래프 높이(H)를 계산할 수 없습니다.");

      // Visibility 제어
      if (payload.type === "line") {
          // Line: 데이터 N개 -> 세그먼트 N-1개
          const requiredSegments = Math.max(0, payload.values.length - 1);
          setLayerVisibility(graph, "line_", requiredSegments);
      } else {
          // Bar/Stacked: 데이터 개수만큼
          const count = Array.isArray(payload.values) ? payload.values.length : 0;
          setLayerVisibility(graph, "col-", count);
      }
      
      // Apply Functions
      if (payload.type === "bar") applyBar(payload, graphHeight, graph);
      else if (payload.type === "stackedBar") applyStackedBar(payload, graphHeight, graph);
      else if (payload.type === "line") applyLine(payload, graphHeight, graph);

      figma.notify("차트가 업데이트되었습니다.");
    } catch (e: any) {
      figma.notify("에러: " + e.message);
      console.error(e);
    }
  }
};