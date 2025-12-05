// code.ts

type ChartType = "bar" | "stackedBar" | "line";
type Mode = "percent" | "raw";

interface ChartConfig {
  type: ChartType;
  mode: Mode;
  height?: number;
  horizontalPadding?: number;
  values: any; // 타입별로 검사
}

interface ApplyMessage {
  type: "apply";
  payload: string; // JSON 문자열
}

interface LogMessage {
  type: "log";
  ok: boolean;
  message: string;
}

if (figma.editorType !== "figma") {
  figma.closePlugin("이 플러그인은 Figma 디자인 에디터에서만 동작합니다.");
}

// 시작 시 selection 확인
const selection = figma.currentPage.selection;

if (selection.length !== 1) {
  figma.showUI(__html__, { width: 420, height: 420 });
  figma.ui.postMessage({
    type: "log",
    ok: false,
    message: "그래프 컴포넌트를 한 개 선택한 상태에서 플러그인을 실행해 주세요."
  } as LogMessage);
} else {
  figma.showUI(__html__, { width: 420, height: 420 });
  figma.ui.postMessage({
    type: "log",
    ok: true,
    message:
      "선택된 Graph 노드를 기준으로 JSON 데이터를 입력한 뒤 [Apply]를 눌러주세요."
  } as LogMessage);
}

// === 유틸 함수들 ===

function isPaddingNode(node: SceneNode): node is any {
  return (
    "paddingTop" in node &&
    "paddingBottom" in node &&
    "paddingLeft" in node &&
    "paddingRight" in node
  );
}

function traverse(node: SceneNode, fn: (node: SceneNode) => void) {
  fn(node);
  if ("children" in node) {
    for (const child of node.children) {
      traverse(child, fn);
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// === Mark 수집 ===

type BarNodeInfo = { index: number; node: SceneNode };
type StackedNodeInfo = { barIndex: number; segIndex: number; node: SceneNode };
type LineNodeInfo = { index: number; node: SceneNode };

function collectMarks(root: SceneNode) {
  const bars: BarNodeInfo[] = [];
  const stacked: StackedNodeInfo[] = [];
  const lines: LineNodeInfo[] = [];

  const reBar = /^bar_(\d+)$/;
  const reStacked = /^bar_(\d+)_(\d+)$/;
  const reLine = /^line_(\d+)$/;

  traverse(root, (node) => {
    const name = (node as any).name as string | undefined;
    if (!name) return;

    let m: RegExpExecArray | null;

    if ((m = reStacked.exec(name))) {
      const barIndex = parseInt(m[1], 10);
      const segIndex = parseInt(m[2], 10);
      stacked.push({ barIndex, segIndex, node });
      return;
    }

    if ((m = reBar.exec(name))) {
      const index = parseInt(m[1], 10);
      bars.push({ index, node });
      return;
    }

    if ((m = reLine.exec(name))) {
      const index = parseInt(m[1], 10);
      lines.push({ index, node });
      return;
    }
  });

  return { bars, stacked, lines };
}

// === 공통 정규화 로직 ===

function normalizePercent(values: number[], H: number) {
  const px = values.map((v) => {
    const vClamped = clamp(v, 0, 100);
    return (H * vClamped) / 100;
  });
  return { px, note: "" };
}

function normalizeRaw(values: number[], H: number) {
  const positive = values.map((v) => Math.max(0, v));
  const maxVal = Math.max(...positive, 0);
  if (maxVal <= 0) {
    return {
      px: values.map(() => 0),
      note: "raw 데이터의 최대값이 0 이하입니다. 모든 값은 0으로 처리됩니다."
    };
  }
  const px = positive.map((v) => (H * v) / maxVal);
  return { px, note: "" };
}

// === 타입별 적용 함수 ===

function applyBar(config: ChartConfig, H: number, graph: SceneNode, logs: string[]) {
  if (!Array.isArray(config.values)) {
    throw new Error("Bar 차트의 values는 숫자 배열이어야 합니다.");
  }

  const values: number[] = config.values;
  const { bars } = collectMarks(graph);

  // index 기준으로 정렬
  const sorted = bars.sort((a, b) => a.index - b.index);
  const barNodes = sorted.map((b) => b.node);

  let log = `Bar Mark 개수: ${barNodes.length}, 데이터 개수: ${values.length}`;

  if (values.length > barNodes.length) {
    log += "\n- 데이터가 Mark 개수보다 많아 초과 값은 무시됩니다.";
  } else if (values.length < barNodes.length) {
    log += "\n- Mark 개수가 데이터보다 많아 일부 Mark는 변경되지 않습니다.";
  }
  logs.push(log);

  const targetCount = Math.min(values.length, barNodes.length);

  const norm =
    config.mode === "percent"
      ? normalizePercent(values, H)
      : normalizeRaw(values, H);

  if (norm.note) logs.push(norm.note);

  for (let i = 0; i < targetCount; i++) {
    const node = barNodes[i];
    if (!isPaddingNode(node)) continue;

    const valuePx = norm.px[i];
    node.paddingBottom = valuePx;

    if (typeof config.horizontalPadding === "number") {
      node.paddingLeft = config.horizontalPadding;
      node.paddingRight = config.horizontalPadding;
    }
  }
}

function applyStackedBar(
  config: ChartConfig,
  H: number,
  graph: SceneNode,
  logs: string[]
) {
  if (!Array.isArray(config.values)) {
    throw new Error("StackedBar 차트의 values는 2차원 숫자 배열이어야 합니다.");
  }

  const values: number[][] = config.values;
  const { stacked } = collectMarks(graph);

  // barIndex 별로 그룹화
  const groupsMap = new Map<
    number,
    { segIndex: number; node: SceneNode }[]
  >();

  for (const s of stacked) {
    if (!groupsMap.has(s.barIndex)) {
      groupsMap.set(s.barIndex, []);
    }
    groupsMap.get(s.barIndex)!.push({ segIndex: s.segIndex, node: s.node });
  }

  const barIndices = Array.from(groupsMap.keys()).sort((a, b) => a - b);

  let log = `Stacked Bar 그룹 수(실제 Mark 기준): ${barIndices.length}, 데이터 그룹 수: ${values.length}`;
  if (values.length > barIndices.length) {
    log += "\n- 데이터 그룹이 Mark 그룹 수보다 많아 초과 그룹은 무시됩니다.";
  } else if (values.length < barIndices.length) {
    log += "\n- Mark 그룹이 데이터 그룹 수보다 많아 일부 그룹은 변경되지 않습니다.";
  }
  logs.push(log);

  const useGroupCount = Math.min(values.length, barIndices.length);

  if (config.mode === "percent") {
    // percent 모드: 각 segment를 0~100%로 간주
    for (let g = 0; g < useGroupCount; g++) {
      const barIndex = barIndices[g];
      const nodes = groupsMap
        .get(barIndex)!
        .sort((a, b) => a.segIndex - b.segIndex)
        .map((n) => n.node);

      const groupValues = values[g];
      const segCount = Math.min(groupValues.length, nodes.length);

      if (groupValues.length !== nodes.length) {
        logs.push(
          `- bar_${barIndex}_* 그룹: Mark(${nodes.length}) vs 데이터(${groupValues.length}) 불일치, 공통 구간만 적용`
        );
      }

      const norm = normalizePercent(groupValues, H);
      if (norm.note) logs.push(norm.note);

      for (let i = 0; i < segCount; i++) {
        const node = nodes[i];
        if (!isPaddingNode(node)) continue;
        node.paddingBottom = norm.px[i];
      }
    }
  } else {
    // raw 모드: 그룹 합 기준 정규화 (maxSum)
    // 먼저 모든 그룹의 합 계산
    const sums: number[] = values.map((group) =>
      group.reduce((acc, v) => acc + Math.max(0, v), 0)
    );
    const maxSum = Math.max(...sums, 0);

    if (maxSum <= 0) {
      logs.push(
        "StackedBar raw 모드: 모든 그룹 합이 0 이하입니다. 모든 segment padding을 0으로 설정합니다."
      );
      // 그냥 다 0으로
      for (const { node } of stacked) {
        if (!isPaddingNode(node)) continue;
        node.paddingBottom = 0;
      }
      return;
    }

    for (let g = 0; g < useGroupCount; g++) {
      const barIndex = barIndices[g];
      const nodes = groupsMap
        .get(barIndex)!
        .sort((a, b) => a.segIndex - b.segIndex)
        .map((n) => n.node);

      const groupValues = values[g];
      const segCount = Math.min(groupValues.length, nodes.length);

      if (groupValues.length !== nodes.length) {
        logs.push(
          `- bar_${barIndex}_* 그룹: Mark(${nodes.length}) vs 데이터(${groupValues.length}) 불일치, 공통 구간만 적용`
        );
      }

      for (let i = 0; i < segCount; i++) {
        const v = Math.max(0, groupValues[i]);
        const ratio = v / maxSum;
        const valuePx = H * ratio;
        const node = nodes[i];
        if (!isPaddingNode(node)) continue;
        node.paddingBottom = valuePx;
      }
    }
  }
}

function applyLine(config: ChartConfig, H: number, graph: SceneNode, logs: string[]) {
  if (!Array.isArray(config.values)) {
    throw new Error("Line 차트의 values는 숫자 배열이어야 합니다.");
  }

  const values: number[] = config.values;
  if (values.length < 2) {
    throw new Error("Line 차트는 최소 2개 이상의 데이터가 필요합니다.");
  }

  const { lines } = collectMarks(graph);
  const sorted = lines.sort((a, b) => a.index - b.index);
  const lineNodes = sorted.map((l) => l.node);

  const segmentCount = values.length - 1;
  let log = `Line segment Mark 개수: ${lineNodes.length}, 필요 segment 개수(values.length - 1 = ${segmentCount})`;
  if (segmentCount > lineNodes.length) {
    log += "\n- segment 수가 Mark 개수보다 많아 일부 segment는 적용되지 않습니다.";
  } else if (segmentCount < lineNodes.length) {
    log += "\n- Mark 수가 segment 수보다 많아 일부 Mark는 변경되지 않습니다.";
  }
  logs.push(log);

  const norm =
    config.mode === "percent"
      ? normalizePercent(values, H)
      : normalizeRaw(values, H);

  if (norm.note) logs.push(norm.note);

  const valuePx = norm.px; // 0 ~ H (바닥 기준 높이)
  const segmentsToApply = Math.min(segmentCount, lineNodes.length);
for (let s = 0; s < segmentsToApply; s++) {
  const startValuePx = valuePx[s];
  const endValuePx   = valuePx[s + 1];
  const node         = lineNodes[s];

  if (!isPaddingNode(node)) continue;

  // INSTANCE인지 확인 (컴포넌트 인스턴스여야 variant 변경 가능)
  const isInstance = node.type === "INSTANCE" && "setProperties" in node;

  if (startValuePx < endValuePx) {
    // 상승 구간
    const top    = H - endValuePx;
    const bottom = startValuePx;
    node.paddingTop    = clamp(top, 0, H);
    node.paddingBottom = clamp(bottom, 0, H);

    if (isInstance) {
      // direction = "up" 배리언트 선택
      (node as InstanceNode).setProperties({ direction: "up" });
    }

  } else if (startValuePx > endValuePx) {
    // 하강 구간
    const top    = H - startValuePx;
    const bottom = endValuePx;
    node.paddingTop    = clamp(top, 0, H);
    node.paddingBottom = clamp(bottom, 0, H);

    if (isInstance) {
      // direction = "down" 배리언트 선택
      (node as InstanceNode).setProperties({ direction: "down" });
    }

  } else {
    // 플랫 구간
    const v      = startValuePx;
    const top    = H - v;
    const bottom = v;
    node.paddingTop    = clamp(top, 0, H);
    node.paddingBottom = clamp(bottom, 0, H);

    if (isInstance) {
      (node as InstanceNode).setProperties({ direction: "flat" });
    }
  }
}

}

// === 메인 메시지 핸들러 ===

figma.ui.onmessage = (msg: ApplyMessage) => {
  if (msg.type !== "apply") return;

  const logs: string[] = [];
  try {
    if (selection.length !== 1) {
      throw new Error("그래프 컴포넌트를 한 개 선택한 상태에서 실행해 주세요.");
    }

    const graph = selection[0];
    if (!("height" in graph)) {
      throw new Error("선택된 노드에서 height를 읽을 수 없습니다.");
    }

    let config: ChartConfig;
    try {
      config = JSON.parse(msg.payload);
    } catch (e) {
      throw new Error("JSON 파싱 오류입니다. 형식을 다시 확인해 주세요.");
    }

    if (!config.type || !config.mode || config.values == null) {
      throw new Error(
        `필수 필드(type, mode, values)가 누락되었습니다.\n예: {"type":"bar","mode":"percent","values":[10,20,30]}`
      );
    }

    const graphHeight = (graph as any).height as number;
    const H = config.height != null ? config.height : graphHeight;

    if (!H || H <= 0) {
      throw new Error(
        "그래프 높이(H)를 계산할 수 없습니다. Graph 컴포넌트 height를 확인하거나 JSON에 height 값을 입력해 주세요."
      );
    }

    logs.push(`Graph height(H) = ${H}`);
    logs.push(`type = ${config.type}, mode = ${config.mode}`);

    switch (config.type) {
      case "bar":
        applyBar(config, H, graph, logs);
        break;
      case "stackedBar":
        applyStackedBar(config, H, graph, logs);
        break;
      case "line":
        applyLine(config, H, graph, logs);
        break;
      default:
        throw new Error(`지원하지 않는 type 입니다: ${config.type}`);
    }

    const message = logs.join("\n");
    figma.ui.postMessage({ type: "log", ok: true, message } as LogMessage);
    figma.notify("차트 데이터가 적용되었습니다.");
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    figma.ui.postMessage({ type: "log", ok: false, message: errMsg } as LogMessage);
    figma.notify("에러가 발생했습니다.");
  }
};
