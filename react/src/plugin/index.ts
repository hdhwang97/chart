figma.showUI(__html__, { width: 450, height: 600 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'DRAW_CHART') {
    try {
      console.log('Received SVG:', msg.svg);

      // 기존 차트 찾아서 제거 (선택사항)
      const existingChart = figma.currentPage.findOne(
        (node) => node.name === 'D3Chart',
      );
      if (existingChart) {
        existingChart.remove();
      }

      // SVG를 Figma 노드로 변환
      const node = figma.createNodeFromSvg(msg.svg);
      node.name = 'D3Chart';

      // 현재 뷰포트 중앙에 배치
      node.x = figma.viewport.center.x - node.width / 2;
      node.y = figma.viewport.center.y - node.height / 2;

      figma.currentPage.appendChild(node);
      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);

      figma.notify('✅ Chart created successfully!');
    } catch (error) {
      console.error('Error creating chart:', error);
      figma.notify('❌ Error creating chart: ' + error.message);
    }
  }
};
