// code.ts
import {
  CHART_COMPONENT_SET_NAME,
  CHART_COMPONENT_NAME_PREFIX,
  CHART_TYPE_PROP_KEY,
  CHART_TYPE_VALUES,
  MARK_NAME_PATTERNS,
} from "./config";

// === 타입 정의 ===
type ChartType = "bar" | "stackedBar" | "line";
type Mode = "percent" | "raw";

interface ApplyPayload {
  type: ChartType;
  mode: Mode;
  height?: number;
  values: any; // bar/line: number[], stackedBar: number[][]
}

// UI로 보내는 init 메시지
interface InitMessage {
  type: "init";
  uiMode: "create" | "edit";
  chartType: ChartType | null;
  inferredMode: Mode | null;
  values: any;
  height: number | null;
  note?: string;
}

// UI로 보내는 log 메시지
interface LogMessage {
  type: "log";
  ok: boolean;
  message: string;
}

// 공통 유틸 함수들
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
    "paddingBottom" in node &&
    "paddingLeft" in node &&
    "paddingRight" in node
  );
}

// 차트 인스턴스 탐지
function findChartInstance(node: SceneNode): InstanceNode | null {
  let current: BaseNode | null = node;
  while (current && current.type !== "PAGE") {
    if (current.type === "INSTANCE") {
      const inst = current as InstanceNode;
      const comp = inst.mainComponent;
      const parent = comp?.parent;
      if (comp && parent && parent.type === "COMPONENT_SET") {
        if (parent.name === CHART_COMPONENT_SET_NAME) {
          return inst;
        }
        if (comp.name.startsWith(CHART_COMPONENT_NAME_PREFIX)) {
          return inst;
        }
      }
    }
    current = current.parent;
  }
  return null;
}

function getChartTypeFromInstance(inst: InstanceNode): ChartType | null {
  const props = inst.componentProperties;
  const prop = props[CHART_TYPE_PROP_KEY];
  if (!prop || prop.type !== "VARIANT") return null;
  const v = prop.value;
  if (v === CHART_TYPE_VALUES.BAR) return "bar";
  if (v === CHART_TYPE_VALUES.STACKED_BAR) return "stackedBar";
  if (v === CHART_TYPE_VALUES.LINE) return "line";
  return null;
}

// Mark 수집
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

function collectMarks(root: SceneNode): {
  bars: BarMark[];
  stacked: StackedMark[];
  lines: LineMark[];
} {
  const bars: BarMark[] = [];
  const stacked: StackedMark[] = [];
  const lines: LineMark[] = [];

  traverse(root, (node) => {
    const name = node.name;
    if (!name) return;
    let m: RegExpExecArray | null;

    if ((m = MARK_NAME_PATTERNS.STACKED.exec(name))) {
      const barIndex = parseInt(m[1], 10);
      const segIndex = parseInt(m[2], 10);
      if (isPaddingNode(node)) {
        stacked.push({ barIndex, segIndex, node: node as SceneNode & LayoutMixin });
      }
      return;
    }

    if ((m = MARK_NAME_PATTERNS.BAR.exec(name))) {
      const index = parseInt(m[1], 10);
      if (isPaddingNode(node)) {
        bars.push({ index, node: node as SceneNode & LayoutMixin });
      }
      return;
    }

    if ((m = MARK_NAME_PATTERNS.LINE.exec(name))) {
      const index = parseInt(m[1], 10);
      if (isPaddingNode(node)) {
        lines.push({ index, node: node as SceneNode & LayoutMixin });
      }
      return;
    }
  });

  return { bars, stacked, lines };
}

// 정규화 로직
function normalizePercent(values: number[], H: number): { px: number[]; note: string } {
  const px = values.map((v) => {
    const vClamped = clamp(v, 0, 100);
    return (H * vClamped) / 100;
  });
  return { px, note: "" };
}

function normalizeRaw(values: number[], H: number): { px: number[]; note: string } {
  const positive = values.map((v) => Math.max(0, v));
  const maxVal = Math.max(...positive, 0);
  if (maxVal <= 0) {
    return {
      px: values.map(() => 0),
      note: "raw 데이터의 최대값이 0 이하입니다. 모든 값은 0으로 처리됩니다.",
    };
  }
  const px = positive.map((v) => (H * v) / maxVal);
  return { px, note: "" };
}

// Bar 적용
function applyBar(config: ApplyPayload, H: number, graph: SceneNode) {
  if (!Array.isArray(config.values)) {
    throw new Error("Bar 차트의 values는 숫자 배열이어야 합니다.");
  }
  const values = (config.values as any[]).map((v) => Number(v) || 0);

  const { bars } = collectMarks(graph);
  const sorted = bars.sort((a, b) => a.index - b.index);
  const barNodes = sorted.map((b) => b.node);

  const targetCount = Math.min(values.length, barNodes.length);
  if (targetCount === 0) return;

  const norm =
    config.mode === "percent" ? normalizePercent(values, H) : normalizeRaw(values, H);

  for (let i = 0; i < targetCount; i++) {
    const node = barNodes[i];
    const valuePx = norm.px[i];
    node.paddingBottom = valuePx;
  }
}

// Stacked Bar 적용
function applyStackedBar(config: ApplyPayload, H: number, graph: SceneNode) {
  if (!Array.isArray(config.values) || !Array.isArray(config.values[0])) {
    throw new Error("StackedBar 차트의 values는 2차원 숫자 배열이어야 합니다.");
  }
  const values = config.values as number[][];

  const { stacked } = collectMarks(graph);
  const groupsMap = new Map<number, StackedMark[]>();

  for (const s of stacked) {
    if (!groupsMap.has(s.barIndex)) groupsMap.set(s.barIndex, []);
    groupsMap.get(s.barIndex)!.push(s);
  }

  const barIndices = Array.from(groupsMap.keys()).sort((a, b) => a - b);
  const useGroupCount = Math.min(values.length, barIndices.length);

  if (config.mode === "percent") {
    for (let g = 0; g < useGroupCount; g++) {
      const barIndex = barIndices[g];
      const marks = groupsMap
        .get(barIndex)!
        .sort((a, b) => a.segIndex - b.segIndex)
        .map((x) => x.node);

      const groupValues = values[g].map((v) => Number(v) || 0);
      const segCount = Math.min(groupValues.length, marks.length);

      const norm = normalizePercent(groupValues, H);
      for (let i = 0; i < segCount; i++) {
        const node = marks[i];
        node.paddingBottom = norm.px[i];
      }
    }
  } else {
    // raw → 각 그룹 합 기준으로 정규화
    const sums = values.map((group) =>
      group.reduce((acc, v) => acc + Math.max(0, Number(v) || 0), 0)
    );
    const maxSum = Math.max(...sums, 0);
    if (maxSum <= 0) {
      // 모두 0
      for (const s of stacked) {
        s.node.paddingBottom = 0;
      }
      return;
    }

    for (let g = 0; g < useGroupCount; g++) {
      const barIndex = barIndices[g];
      const marks = groupsMap
        .get(barIndex)!
        .sort((a, b) => a.segIndex - b.segIndex)
        .map((x) => x.node);

      const groupValues = values[g].map((v) => Number(v) || 0);
      const segCount = Math.min(groupValues.length, marks.length);

      for (let i = 0; i < segCount; i++) {
        const v = Math.max(0, groupValues[i]);
        const ratio = v / maxSum;
        const valuePx = H * ratio;
        marks[i].paddingBottom = valuePx;
      }
    }
  }
}

// Line 적용
function applyLine(config: ApplyPayload, H: number, graph: SceneNode) {
  if (!Array.isArray(config.values)) {
    throw new Error("Line 차트의 values는 숫자 배열이어야 합니다.");
  }
  const rawValues = (config.values as any[]).map((v) => Number(v) || 0);
  if (rawValues.length < 2) {
    throw new Error("Line 차트는 최소 2개 이상의 데이터가 필요합니다.");
  }

  const { lines } = collectMarks(graph);
  const sorted = lines.sort((a, b) => a.index - b.index);
  const lineNodes = sorted.map((l) => l.node);

  const segmentCount = rawValues.length - 1;
  const segmentsToApply = Math.min(segmentCount, lineNodes.length);
  if (segmentsToApply <= 0) return;

  const norm =
    config.mode === "percent"
      ? normalizePercent(rawValues, H)
      : normalizeRaw(rawValues, H);
  const valuePx = norm.px;

  for (let s = 0; s < segmentsToApply; s++) {
    const startValuePx = valuePx[s];
    const endValuePx = valuePx[s + 1];
    const node = lineNodes[s];

    const isInstance =
      (node as any).type === "INSTANCE" && typeof (node as any).setProperties === "function";

    if (startValuePx < endValuePx) {
      // 상승
      const top = H - endValuePx;
      const bottom = startValuePx;
      node.paddingTop = clamp(top, 0, H);
      node.paddingBottom = clamp(bottom, 0, H);
      if (isInstance) {
        (node as any).setProperties({ direction: "up" });
      }
    } else if (startValuePx > endValuePx) {
      // 하강
      const top = H - startValuePx;
      const bottom = endValuePx;
      node.paddingTop = clamp(top, 0, H);
      node.paddingBottom = clamp(bottom, 0, H);
      if (isInstance) {
        (node as any).setProperties({ direction: "down" });
      }
    } else {
      // 플랫
      const v = startValuePx;
      const top = H - v;
      const bottom = v;
      node.paddingTop = clamp(top, 0, H);
      node.paddingBottom = clamp(bottom, 0, H);
      if (isInstance) {
        (node as any).setProperties({ direction: "flat" });
      }
    }
  }
}

// padding 기반 값 역산 (단순 percent 기준)
function inferValuesFromGraph(
  chartType: ChartType,
  H: number,
  graph: SceneNode
): { mode: Mode; values: any; note?: string } | null {
  const { bars, stacked, lines } = collectMarks(graph);

  if (chartType === "bar") {
    if (!bars.length) return null;
    const sorted = bars.sort((a, b) => a.index - b.index);
    const values = sorted.map(({ node }) => {
      const ratio = node.paddingBottom / H;
      return Math.round(ratio * 1000) / 10;
    });
    return {
      mode: "percent",
      values,
      note: "현재 bar padding을 height 대비 %로 역산한 값입니다.",
    };
  }

  if (chartType === "stackedBar") {
    if (!stacked.length) return null;
    const groupsMap = new Map<number, StackedMark[]>();
    for (const s of stacked) {
      if (!groupsMap.has(s.barIndex)) groupsMap.set(s.barIndex, []);
      groupsMap.get(s.barIndex)!.push(s);
    }
    const barIndices = Array.from(groupsMap.keys()).sort((a, b) => a - b);
    const values: number[][] = [];

    for (const barIndex of barIndices) {
      const segments = groupsMap
        .get(barIndex)!
        .sort((a, b) => a.segIndex - b.segIndex)
        .map((n) => n.node);
      const row: number[] = [];
      for (const n of segments) {
        const ratio = n.paddingBottom / H;
        row.push(Math.round(ratio * 1000) / 10);
      }
      values.push(row);
    }

    return {
      mode: "percent",
      values,
      note: "현재 stacked segment padding을 height 대비 %로 역산한 값입니다.",
    };
  }

  if (chartType === "line") {
    if (!lines.length) return null;
    const sorted = lines.sort((a, b) => a.index - b.index);
    const segNodes = sorted.map((l) => l.node);
    const N = segNodes.length + 1;
    const values: number[] = new Array(N).fill(0);

    for (let s = 0; s < segNodes.length; s++) {
      const node = segNodes[s];
      const top = node.paddingTop;
      const bottom = node.paddingBottom;
      const HminusTop = H - top;

      const sv = bottom;
      const ev = HminusTop;

      const prev = (sv / H) * 100;
      const next = (ev / H) * 100;
      if (s === 0) {
        values[0] = Math.round(prev * 10) / 10;
      }
      values[s + 1] = Math.round(next * 10) / 10;
    }

    return {
      mode: "percent",
      values,
      note:
        "라인 segment의 padding을 기반으로 상대적인 % 값을 역산했습니다. 원래 raw 값 스케일은 복원하지 않습니다.",
    };
  }

  return null;
}

// === 플러그인 진입점 ===

if (figma.editorType !== "figma") {
  figma.closePlugin("이 플러그인은 Figma 디자인 에디터에서만 동작합니다.");
}

figma.showUI(__html__, { width: 480, height: 520 });

// 초기 init 메시지 전송
(function init() {
  const selection = figma.currentPage.selection;
  let uiMode: "create" | "edit" = "create";
  let chartType: ChartType | null = null;
  let inferredMode: Mode | null = null;
  let values: any = null;
  let height: number | null = null;
  let note: string | undefined;

  if (selection.length === 1) {
    const node = selection[0] as SceneNode;
    const inst = findChartInstance(node);
    if (inst) {
      uiMode = "edit";
      const graph = node;
      if ("height" in graph) {
        height = (graph as GeometryMixin).height;
      }
      const ctype = getChartTypeFromInstance(inst);
      if (ctype && height) {
        chartType = ctype;
        const inferred = inferValuesFromGraph(ctype, height, graph);
        if (inferred) {
          inferredMode = inferred.mode;
          values = inferred.values;
          note = inferred.note;
        }
      } else {
        note =
          "선택된 인스턴스에서 차트 타입 또는 높이를 읽을 수 없습니다. 새 차트 생성 모드로 값을 입력해 주세요.";
      }
    } else {
      note =
        "선택된 노드가 차트 컴포넌트 인스턴스가 아니라서, 새 차트 생성 모드로 진입합니다.";
    }
  } else if (selection.length > 1) {
    note = "여러 개가 선택되어 있어 새 차트 생성 모드로 진입합니다. 하나의 차트만 수정할 수 있습니다.";
  }

  const initMsg: InitMessage = {
    type: "init",
    uiMode,
    chartType,
    inferredMode,
    values,
    height,
    note,
  };
  figma.ui.postMessage(initMsg);
})();

// UI → code 메시지 처리
figma.ui.onmessage = (msg: any) => {
  if (!msg || msg.type !== "apply") return;

  const payload = msg.payload as ApplyPayload;
  const logs: string[] = [];

  try {
    const sel = figma.currentPage.selection;
    if (sel.length !== 1) {
      throw new Error("그래프(차트) 노드를 한 개 선택한 상태에서 실행해 주세요.");
    }
    const graph = sel[0] as SceneNode & GeometryMixin & LayoutMixin;
    if (!("height" in graph)) {
      throw new Error("선택된 노드에서 height를 읽을 수 없습니다.");
    }

    if (!payload.type || !payload.mode || payload.values == null) {
      throw new Error(
        `필수 필드(type, mode, values)가 누락되었습니다.`
      );
    }

    const H = payload.height != null ? payload.height : graph.height;
    if (!H || H <= 0) {
      throw new Error(
        "그래프 높이(H)를 계산할 수 없습니다. Graph 컴포넌트 height를 확인하거나 JSON에 height 값을 입력해 주세요."
      );
    }

    logs.push(`Graph height(H) = ${H}`);
    logs.push(`type = ${payload.type}, mode = ${payload.mode}`);

    if (payload.type === "bar") {
      applyBar(payload, H, graph);
    } else if (payload.type === "stackedBar") {
      applyStackedBar(payload, H, graph);
    } else if (payload.type === "line") {
      applyLine(payload, H, graph);
    } else {
      throw new Error(`지원하지 않는 type 입니다: ${payload.type}`);
    }

    const logMsg: LogMessage = {
      type: "log",
      ok: true,
      message: logs.join("\n"),
    };
    figma.ui.postMessage(logMsg);
    figma.notify("차트가 업데이트되었습니다.");
  } catch (e: any) {
    const errMsg = e && e.message ? e.message : String(e);
    const logMsg: LogMessage = {
      type: "log",
      ok: false,
      message: errMsg,
    };
    figma.ui.postMessage(logMsg);
    figma.notify("에러가 발생했습니다.");
  }
};
