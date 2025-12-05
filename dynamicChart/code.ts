// code.ts (2025-10-27, 'UI 자동 리사이즈' 적용)

// --- 1. 타입 정의 ---
type BarPadding = { h?: number; left?: number; right?: number };

// type: "bar"
type SingleBarPayload = {
  type: "bar";
  totalHeight: number; // y
  baseName: string; // "bar_"
  padding?: BarPadding;
  items: number[]; // [59, 75, 30]
};

// type: "stackedBar"
type StackBarPayload = {
  type: "stackedBar";
  totalHeight: number; // y
  baseName: string; // "bar_"
  padding?: BarPadding;
  // items: [ [10, 20, 15], [30, 10] ] (비율 배열의 배열)
  items: number[][]; 
};

type InputPayload = SingleBarPayload | StackBarPayload;


// --- 2. UI 실행 ---

// 초기 높이를 320으로 시작하되, 나중에 변경될 수 있음
figma.showUI(__html__, { width: 420, height: 320, title: "Apply Chart Padding" });

// --- 3. 헬퍼 함수 ---

/**
 * Auto Layout이 적용된 프레임, 컴포넌트, 인스턴스인지 확인
 */
function isAL(n: SceneNode): n is FrameNode | ComponentNode | InstanceNode {
  return (n.type === "FRAME" || n.type === "COMPONENT" || n.type === "INSTANCE") && n.layoutMode !== "NONE";
}

/**
 * 노드를 찾아 패딩을 적용하는 공통 함수
 * @param node 적용할 노드
 * @param newBottomPadding 계산된 바의 높이 (px)
 * @param padding 공통 좌/우 패딩
 */
function applyBarPadding(
  node: FrameNode | ComponentNode | InstanceNode, 
  newBottomPadding: number, 
  padding?: BarPadding
) {
  const left   = padding?.left ?? padding?.h ?? node.paddingLeft;
  const right  = padding?.right ?? padding?.h ?? node.paddingRight;

  // top은 항상 기존 값 유지
  node.paddingTop = node.paddingTop;
  node.paddingBottom = newBottomPadding;
  node.paddingLeft = left;
  node.paddingRight = right;
}

// --- 4. 핵심 로직 함수 ---

/**
 * 'type: "bar"' 로직 처리
 */
function processSingleBars(
  container: SceneNode, 
  payload: SingleBarPayload
): { applied: number, skipped: number } {

  let applied = 0, skipped = 0;
  const y = payload.totalHeight;
  
  if (!("findAll" in container)) return { applied: 0, skipped: payload.items.length };

  payload.items.forEach((ratio, index) => {
    const nodeName = `${payload.baseName}${index + 1}`; // 예: "bar_1"
    
    // 컨테이너 *내에서* 이름으로 노드 검색
    const node = container.findAll(
      n => isAL(n) && n.name.trim() === nodeName
    )[0] as (FrameNode | ComponentNode | InstanceNode) | undefined;

    if (node) {
      try {
        const newBottomPadding = y * (ratio / 100); // px로 계산
        applyBarPadding(node, newBottomPadding, payload.padding);
        applied++;
      } catch (e) {
        skipped++; // 노드가 잠겨있을 경우
      }
    } else {
      skipped++; // 노드를 못 찾은 경우
    }
  });
  return { applied, skipped };
}

/**
 * 'type: "stackedBar"' 로직 처리
 */
function processStackedBars(
  container: SceneNode, 
  payload: StackBarPayload
): { applied: number, skipped: number } {
  
  let appliedParents = 0, skippedParents = 0;
  const y = payload.totalHeight;

  if (!("findAll" in container)) return { applied: 0, skipped: payload.items.length };
  
  // 1. 부모 바(bar_1, bar_2...) 순회 (i = 0, 1, ...)
  for (let i = 0; i < payload.items.length; i++) {
    const subRatios = payload.items[i]; // 예: [10, 20, 15]
    const parentName = `${payload.baseName}${i + 1}`; // 예: "bar_1"

    // 컨테이너 *내에서* 부모 노드 검색
    const parentNode = container.findAll(
      n => isAL(n) && n.name.trim() === parentName
    )[0] as (FrameNode | ComponentNode | InstanceNode) | undefined;

    if (!parentNode || !("findAll" in parentNode)) {
      skippedParents++;
      continue;
    }

    let appliedChildren = 0;

    // 2. 자식 바(bar_1-1, bar_1-2...) 순회 (j = 0, 1, ...)
    for (let j = 0; j < subRatios.length; j++) {
      const subRatio = subRatios[j]; // 예: 10
      const childName = `${parentName}-${j + 1}`; // 예: "bar_1-1"

      // 부모 노드 *내에서* 자식 노드 검색
      const childNode = parentNode.findAll(
        n => isAL(n) && n.name.trim() === childName
      )[0] as (FrameNode | ComponentNode | InstanceNode) | undefined;

      if (childNode) {
        try {
          // 자식 바의 px 높이를 'totalHeight(y)' 기준으로 계산
          const newBottomPadding = y * (subRatio / 100); // 수식 적용 (px)
          applyBarPadding(childNode, newBottomPadding, payload.padding);
          appliedChildren++;
        } catch (e) {
          // 자식 노드 잠김
        }
      }
    }
    
    if (appliedChildren > 0) appliedParents++;
    else skippedParents++;
  }
  
  return { applied: appliedParents, skipped: skippedParents };
}

// --- 5. 메시지 핸들러 (라우터) ---

figma.ui.onmessage = async (msg) => {
  
  // 'resize' 타입 처리
  if (msg.type === 'resize') {
    // 420은 고정 폭, msg.height는 ui.html이 보낸 새 높이
    figma.ui.resize(420, msg.height);
    return;
  }

  // 'apply-json' 타입 처리
  if (msg.type === 'apply-json') {
    let payload: InputPayload;
    try {
      payload = JSON.parse(msg.text);
    } catch {
      figma.notify("JSON 파싱 실패");
      return;
    }

    // --- 선택 영역 확인 (필수) ---
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.notify("차트가 포함된 부모 프레임 1개를 선택해주세요.");
      return;
    }
    if (selection.length > 1) {
      figma.notify("1개의 컨테이너만 선택해주세요.");
      return;
    }
    const container = selection[0];
    
    if (!("findAll" in container)) {
       figma.notify("선택한 레이어는 자식 노드를 검색할 수 없습니다. (프레임이나 그룹을 선택하세요)");
       return;
    }
    
    let results = { applied: 0, skipped: 0 };

    // --- 타입에 따라 로직 분기 ---
    if (payload.type === "bar") {
      results = processSingleBars(container, payload);
    } else if (payload.type === "stackedBar") {
      results = processStackedBars(container, payload);
    } else {
      figma.notify("JSON 'type'은 'bar' 또는 'stackedBar'여야 합니다.");
      return;
    }

    figma.notify(`적용: ${results.applied} · 대상 없음/오류: ${results.skipped}`);
    
    // 'apply-json'이 아닌 다른 타입은 무시
  }
};