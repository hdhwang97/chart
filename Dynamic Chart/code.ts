// code.ts
type Padding = { h?: number; v?: number; left?: number; right?: number; top?: number; bottom?: number };
type InputItem = { name?: string; nodeId?: string; padding: Padding };
type InputPayload = { items: InputItem[] };

// UI 띄우기 (ui.html 파일 표시)
figma.showUI(__html__, { width: 420, height: 320 });

function isAL(n: SceneNode): n is FrameNode | ComponentNode | InstanceNode {
  return (n.type === "FRAME" || n.type === "COMPONENT" || n.type === "INSTANCE") && "layoutMode" in n;
}

function targetsByName(name: string) {
  return figma.currentPage.findAll(n =>
    (n.type === "FRAME" || n.type === "COMPONENT" || n.type === "INSTANCE") &&
    "layoutMode" in n &&
    "name" in n &&
    n.name.trim() === name.trim()
  ) as (FrameNode | ComponentNode | InstanceNode)[];
}


function targetById(id: string) {
  const n = figma.getNodeById(id);
  return n && isAL(n) ? n : null;
}

function applyPadding(node: FrameNode | ComponentNode | InstanceNode, p: Padding) {
  // 모든 레이어가 Auto Layout이라고 가정
  const left   = p.left   ?? p.h ?? node.paddingLeft;
  const right  = p.right  ?? p.h ?? node.paddingRight;
  const top    = p.top    ?? p.v ?? node.paddingTop;
  const bottom = p.bottom ?? p.v ?? node.paddingBottom;

  node.paddingLeft = left;
  node.paddingRight = right;
  node.paddingTop = top;
  node.paddingBottom = bottom;
}

figma.ui.onmessage = (msg) => {
  if (msg.type !== "apply-json") return;

  let payload: InputPayload;
  try {
    payload = JSON.parse(msg.text);
  } catch {
    figma.notify("JSON 파싱 실패");
    return;
  }
  if (!payload.items?.length) {
    figma.notify("items가 비어 있습니다");
    return;
  }

  let applied = 0, skipped = 0, blocked = 0;

  for (const item of payload.items) {
    const pads = item.padding;
    if (!pads) { skipped++; continue; }

    const nodes: (FrameNode|ComponentNode|InstanceNode)[] =
      item.nodeId ? (targetById(item.nodeId) ? [targetById(item.nodeId)!] : [])
                  : item.name ? targetsByName(item.name) : [];

    if (!nodes.length) { skipped++; continue; }

    for (const n of nodes) {
      try {
        applyPadding(n, pads);
        applied++;
      } catch {
        // 인스턴스 오버라이드 제한 등으로 실패 가능
        blocked++;
      }
    }
  }

  figma.notify(`패딩 적용: ${applied} · 대상 없음: ${skipped} · 잠김/오류: ${blocked}`);
};
