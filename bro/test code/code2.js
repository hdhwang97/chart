// config
const CHART_COMPONENT_SET_NAME = "Chart / Base";
const CHART_COMPONENT_NAME_PREFIX = "Chart";

const CHART_TYPE_PROP_KEY = "chartType";

const CHART_TYPE_VALUES = {
  BAR: "bar",
  STACKED_BAR: "stackedBar",
  LINE: "line",
};

const MARK_NAME_PATTERNS = {
  BAR: /^bar_(\d+)$/,
  STACKED: /^bar_(\d+)_(\d+)$/,
  LINE: /^line_(\d+)$/,
};

// === 공통 유틸 ===

function traverse(node, fn) {
  fn(node);
  if ("children" in node) {
    for (const child of node.children) {
      traverse(child, fn);
    }
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isPaddingNode(node) {
  return (
    "paddingTop" in node &&
    "paddingBottom" in node &&
    "paddingLeft" in node &&
    "paddingRight" in node
  );
}

// === 우리 차트 인스턴스인지 판별 ===

function findChartInstance(node) {
  let current = node;ㅌㅈ
  while (current && current.type !== "PAGE") {
    if (current.type === "INSTANCE") {
      const inst = current;
      const comp = inst.mainComponent;
      const parent = comp && comp.parent;

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

function getChartTypeFromInstance(inst) {
  const props = inst.componentProperties;
  const prop = props[CHART_TYPE_PROP_KEY];
  if (!prop || prop.type !== "VARIANT") return null;
  const v = prop.value;
  if (v === CHART_TYPE_VALUES.BAR) return "bar";
  if (v === CHART_TYPE_VALUES.STACKED_BAR) return "stackedBar";
  if (v === CHART_TYPE_VALUES.LINE) return "line";
  return null;
}

// === Mark 수집 ===

function collectMarks(root) {
  const bars = [];
  const stacked = [];
  const lines = [];

  traverse(root, (node) => {
    const name = node.name;
    if (!name) return;

    let m;

    if ((m = MARK_NAME_PATTERNS.STACKED.exec(name))) {
      const barIndex = parseInt(m[1], 10);
      const segIndex = parseInt(m[2], 10);
      stacked.push({ barIndex, segIndex, node });
      return;
    }

    if ((m = MARK_NAME_PATTERNS.BAR.exec(name))) {
      const index = parseInt(m[1], 10);
      bars.push({ index, node });
      return;
    }

    if ((m = MARK_NAME_PATTERNS.LINE.exec(name))) {
      const index = parseInt(m[1], 10);
      lines.push({ index, node });
      return;
    }
  });

  return { bars, stacked, lines };
}

// === 정규화 로직 ===

function normalizePercent(values, H) {
  const px = values.map((v) => {
    const vClamped = clamp(v, 0, 100);
    return (H * vClamped) / 100;
  });
  return { px, note: "" };
}

function normalizeRaw(values, H) {
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

// === 타입별 적용 ===

function applyBar(config, H, graph, logs) {
  if (!Array.isArray(config.values)) {
    throw new Error("Bar 차트의 values는 숫자 배열이어야 합니다.");
  }
  const values = config.values;
  const { bars } = collectMarks(graph);
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
    config.mode === "percent" ? normalizePercent(values, H) : normalizeRaw(values, H);
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

function applyStackedBar(config, H, graph, logs) {
  if (!Array.isArray(config.values)) {
    throw new Error("StackedBar 차트의 values는 2차원 숫자 배열이어야 합니다.");
  }
  const values = config.values;
  const { stacked } = collectMarks(graph);

  const groupsMap = new Map();
  for (const s of stacked) {
    if (!groupsMap.has(s.barIndex)) groupsMap.set(s.barIndex, []);
    groupsMap.get(s.barIndex).push({ segIndex: s.segIndex, node: s.node });
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
    for (let g = 0; g < useGroupCount; g++) {
      const barIndex = barIndices[g];
      const nodes = groupsMap
        .get(barIndex)
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
      for (let i = 0; i < segCount; i++) {
        const node = nodes[i];
        if (!isPaddingNode(node)) continue;
        node.paddingBottom = norm.px[i];
      }
    }
  } else {
    const sums = values.map((group) =>
      group.reduce((acc, v) => acc + Math.max(0, v), 0)
    );
    const maxSum = Math.max(...sums, 0);
    if (maxSum <= 0) {
      logs.push(
        "StackedBar raw 모드: 모든 그룹 합이 0 이하입니다. 모든 segment padding을 0으로 설정합니다."
      );
      for (const s of stacked) {
        const node = s.node;
        if (!isPaddingNode(node)) continue;
        node.paddingBottom = 0;
      }
      return;
    }

    for (let g = 0; g < useGroupCount; g++) {
      const barIndex = barIndices[g];
      const nodes = groupsMap
        .get(barIndex)
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

function applyLine(config, H, graph, logs) {
  if (!Array.isArray(config.values)) {
    throw new Error("Line 차트의 values는 숫자 배열이어야 합니다.");
  }
  const values = config.values;
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
    config.mode === "percent" ? normalizePercent(values, H) : normalizeRaw(values, H);
  if (norm.note) logs.push(norm.note);
  const valuePx = norm.px;
  const segmentsToApply = Math.min(segmentCount, lineNodes.length);

  for (let s = 0; s < segmentsToApply; s++) {
    const startValuePx = valuePx[s];
    const endValuePx = valuePx[s + 1];
    const node = lineNodes[s];

    if (!isPaddingNode(node)) continue;
    const isInstance = node.type === "INSTANCE" && "setProperties" in node;

    if (startValuePx < endValuePx) {
      const top = H - endValuePx;
      const bottom = startValuePx;
      node.paddingTop = clamp(top, 0, H);
      node.paddingBottom = clamp(bottom, 0, H);
      if (isInstance) {
        node.setProperties({ direction: "up" });
      }
    } else if (startValuePx > endValuePx) {
      const top = H - startValuePx;
      const bottom = endValuePx;
      node.paddingTop = clamp(top, 0, H);
      node.paddingBottom = clamp(bottom, 0, H);
      if (isInstance) {
        node.setProperties({ direction: "down" });
      }
    } else {
      const v = startValuePx;
      const top = H - v;
      const bottom = v;
      node.paddingTop = clamp(top, 0, H);
      node.paddingBottom = clamp(bottom, 0, H);
      if (isInstance) {
        node.setProperties({ direction: "flat" });
      }
    }
  }
}

// === 역산 (간단 버전, percent 기준) ===

function inferValuesFromGraph(chartType, H, graph) {
  const { bars, stacked, lines } = collectMarks(graph);

  if (chartType === "bar") {
    if (!bars.length) return null;
    const sorted = bars.sort((a, b) => a.index - b.index);
    const values = sorted.map(({ node }) => {
      if (!isPaddingNode(node)) return 0;
      const ratio = node.paddingBottom / H;
      return Math.round(ratio * 1000) / 10;
    });
    return {
      mode: "percent",
      values,
      note: "현재 바 padding을 height 대비 %로 역산한 값입니다.",
    };
  }

  if (chartType === "stackedBar") {
    if (!stacked.length) return null;
    const groupsMap = new Map();
    for (const s of stacked) {
      if (!groupsMap.has(s.barIndex)) groupsMap.set(s.barIndex, []);
      groupsMap.get(s.barIndex).push({ segIndex: s.segIndex, node: s.node });
    }
    const barIndices = Array.from(groupsMap.keys()).sort((a, b) => a - b);
    const values = [];
    for (const barIndex of barIndices) {
      const segments = groupsMap
        .get(barIndex)
        .sort((a, b) => a.segIndex - b.segIndex)
        .map((n) => n.node);
      const row = [];
      for (const n of segments) {
        if (!isPaddingNode(n)) {
          row.push(0);
          continue;
        }
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
    const values = new Array(N).fill(0);

    for (let s = 0; s < segNodes.length; s++) {
      const node = segNodes[s];
      if (!isPaddingNode(node)) continue;

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
        "라인 segment의 padding을 기반으로 상대적인 % 값을 역산했습니다. 정확한 raw 값은 원래 스케일 정보를 잃었기 때문에 복원이 어렵습니다.",
    };
  }

  return null;
}

// === 초기 진입: 생성/수정 모드 판별 & UI 오픈 ===

if (figma.editorType !== "figma") {
  figma.closePlugin("이 플러그인은 Figma 디자인 에디터에서만 동작합니다.");
}

const selection = figma.currentPage.selection;

figma.showUI(__html__, { width: 480, height: 480 });

(async () => {
  let uiMode = "create";
  let chartType = null;
  let inferredMode = null;
  let values = null;
  let height = null;
  let note;

  if (selection.length === 0) {
    uiMode = "create";
  } else if (selection.length === 1) {
    const node = selection[0];
    const chartInst = findChartInstance(node);
    if (chartInst) {
      uiMode = "edit";
      const graphNode = selection[0];
      if ("height" in graphNode) {
        height = graphNode.height;
      }
      const ctype = getChartTypeFromInstance(chartInst);
      if (ctype) {
        chartType = ctype;
      }
      if (height && chartType) {
        const inferred = inferValuesFromGraph(chartType, height, graphNode);
        if (inferred) {
          inferredMode = inferred.mode;
          values = inferred.values;
          note = inferred.note;
        }
      }
    } else {
      uiMode = "create";
      note =
        "선택된 노드가 차트 컴포넌트 인스턴스가 아니라서, 새 차트 생성 모드로 진입합니다.";
    }
  } else {
    uiMode = "create";
    note =
      "여러 개가 선택되어 있어 새 차트 생성 모드로 진입합니다. 하나의 차트만 수정할 수 있습니다.";
  }

  const initMsg = {
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

// === UI → code 메시지 처리 ===

figma.ui.onmessage = (msg) => {
  if (msg.type !== "apply") return;

  const config = msg.payload;
  const logs = [];

  try {
    const sel = figma.currentPage.selection;
    if (sel.length !== 1) {
      throw new Error("그래프(차트) 노드를 한 개 선택한 상태에서 실행해 주세요.");
    }
    const graph = sel[0];
    if (!("height" in graph)) {
      throw new Error("선택된 노드에서 height를 읽을 수 없습니다.");
    }

    if (!config.type || !config.mode || config.values == null) {
      throw new Error(
        `필수 필드(type, mode, values)가 누락되었습니다.\n예: {"type":"bar","mode":"percent","values":[10,20,30]}`
      );
    }

    const graphHeight = graph.height;
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

    figma.ui.postMessage({
      type: "log",
      ok: true,
      message: logs.join("\n"),
    });
    figma.notify("차트 데이터가 적용되었습니다.");
  } catch (e) {
    const errMsg = e && e.message ? e.message : String(e);
    figma.ui.postMessage({ type: "log", ok: false, message: errMsg });
    figma.notify("에러가 발생했습니다.");
  }
};
