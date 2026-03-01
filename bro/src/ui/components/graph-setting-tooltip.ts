import { ui } from '../dom';
import graphColImg from '../assets/tooltips/graph-col.svg';
import cellCountImg from '../assets/tooltips/cell-count.svg';
import markCountImg from '../assets/tooltips/mark-count.svg';
import segmentsImg from '../assets/tooltips/segments.svg';
import colWidthRatioImg from '../assets/tooltips/column-width-ratio.svg';
import yMinImg from '../assets/tooltips/y-min.svg';
import yMaxImg from '../assets/tooltips/y-max.svg';
import thicknessImg from '../assets/tooltips/thickness.svg';

type TooltipContent = {
    imageSrc: string;
    title: string;
    body: string;
};

const TOOLTIP_ID = 'graph-setting-tooltip';

const TOOLTIP_CONTENT_MAP: Record<string, TooltipContent> = {
    'graph-col': {
        imageSrc: graphColImg,
        title: '그래프 열 수',
        body: '차트의 가로 데이터 열 개수를 조절합니다. Stacked에서는 그룹 개수로 동작합니다.'
    },
    'cell-count': {
        imageSrc: cellCountImg,
        title: '셀 개수',
        body: '데이터 입력 그리드의 세로 셀 개수를 지정합니다. 값이 바뀌면 입력 행 구조가 갱신됩니다.'
    },
    'mark-count': {
        imageSrc: markCountImg,
        title: '마크 개수',
        body: '일반 차트에서 마크 개수(행 수)를 설정합니다. Stacked 모드에서는 Segments 설명으로 바뀝니다.'
    },
    segments: {
        imageSrc: segmentsImg,
        title: '세그먼트',
        body: 'Stacked Bar의 각 그룹 내부 바 개수입니다. 값을 바꾸면 모든 그룹에 동일하게 적용됩니다.'
    },
    'column-width-ratio': {
        imageSrc: colWidthRatioImg,
        title: '컬럼 폭 비율',
        body: '막대가 차지하는 가로 폭 비율입니다. 값이 클수록 막대가 넓어집니다.'
    },
    'y-min': {
        imageSrc: yMinImg,
        title: 'Y 최소값',
        body: '미리보기와 출력에서 사용할 Y축 최소 기준값입니다. 모드/데이터 검증과 함께 적용됩니다.'
    },
    'y-max': {
        imageSrc: yMaxImg,
        title: 'Y 최대값',
        body: 'Y축 최대 기준값입니다. Raw 모드에서는 자동 계산 값을 사용할 수 있습니다.'
    },
    thickness: {
        imageSrc: thicknessImg,
        title: '두께',
        body: 'Line 차트에서 선 두께를 설정합니다. 다른 차트 타입에서는 항목이 숨겨질 수 있습니다.'
    }
};

let activeAnchor: HTMLElement | null = null;
let isBound = false;

function getTooltipContent(anchor: HTMLElement): TooltipContent | null {
    const key = anchor.dataset.tooltipKey;
    if (!key) return null;
    if (key === 'mark-count' && /segments/i.test(anchor.textContent || '')) {
        return TOOLTIP_CONTENT_MAP.segments;
    }
    return TOOLTIP_CONTENT_MAP[key] || null;
}

function positionTooltip(anchor: HTMLElement) {
    const tooltip = ui.graphSettingTooltip;
    const anchorRect = anchor.getBoundingClientRect();
    const margin = 8;
    const spacing = 8;

    const tooltipW = tooltip.offsetWidth || 264;
    const tooltipH = tooltip.offsetHeight || 200;

    let left = anchorRect.right + spacing;
    let top = anchorRect.top + (anchorRect.height / 2) - (tooltipH / 2);

    if (left + tooltipW > window.innerWidth - margin) {
        left = anchorRect.left - tooltipW - spacing;
    }

    if (left < margin) {
        left = Math.max(margin, Math.min(anchorRect.left, window.innerWidth - tooltipW - margin));
        top = anchorRect.bottom + spacing;
    }

    if (top + tooltipH > window.innerHeight - margin) {
        top = window.innerHeight - tooltipH - margin;
    }

    if (top < margin) {
        top = margin;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

function openTooltip(anchor: HTMLElement) {
    const content = getTooltipContent(anchor);
    if (!content) return;

    activeAnchor = anchor;
    activeAnchor.setAttribute('aria-describedby', TOOLTIP_ID);

    ui.graphSettingTooltipImage.src = content.imageSrc;
    ui.graphSettingTooltipImage.alt = content.title;
    ui.graphSettingTooltipTitle.textContent = content.title;
    ui.graphSettingTooltipBody.textContent = content.body;

    ui.graphSettingTooltip.classList.add('is-open');
    ui.graphSettingTooltip.setAttribute('aria-hidden', 'false');

    positionTooltip(anchor);
}

function closeTooltip() {
    if (activeAnchor) {
        activeAnchor.removeAttribute('aria-describedby');
    }
    activeAnchor = null;
    ui.graphSettingTooltip.classList.remove('is-open');
    ui.graphSettingTooltip.setAttribute('aria-hidden', 'true');
}

function findTooltipAnchor(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    const anchor = target.closest<HTMLElement>('.gs-tooltip-anchor[data-tooltip-key]');
    if (!anchor) return null;
    if (!ui.graphSettingPanel.contains(anchor)) return null;
    return anchor;
}

function bindEvents() {
    if (isBound) return;
    isBound = true;

    ui.graphSettingPanel.addEventListener('mouseover', (event) => {
        const anchor = findTooltipAnchor(event.target);
        if (!anchor) return;
        if (anchor === activeAnchor) return;
        openTooltip(anchor);
    });

    ui.graphSettingPanel.addEventListener('mouseout', (event) => {
        if (!activeAnchor) return;
        const nextTarget = event.relatedTarget;
        const nextAnchor = findTooltipAnchor(nextTarget);
        if (nextAnchor === activeAnchor) return;
        if (nextAnchor) {
            openTooltip(nextAnchor);
            return;
        }
        closeTooltip();
    });

    ui.graphSettingPanel.addEventListener('focusin', (event) => {
        const anchor = findTooltipAnchor(event.target);
        if (!anchor) return;
        openTooltip(anchor);
    });

    ui.graphSettingPanel.addEventListener('focusout', (event) => {
        if (!activeAnchor) return;
        const nextTarget = event.relatedTarget;
        const nextAnchor = findTooltipAnchor(nextTarget);
        if (nextAnchor === activeAnchor) return;
        if (nextAnchor) {
            openTooltip(nextAnchor);
            return;
        }
        closeTooltip();
    });

    document.addEventListener('click', (event) => {
        if (!activeAnchor) return;
        const target = event.target;
        if (!(target instanceof Node)) {
            closeTooltip();
            return;
        }
        if (ui.graphSettingTooltip.contains(target)) return;
        if (ui.graphSettingPanel.contains(target)) {
            const anchor = findTooltipAnchor(target);
            if (anchor) return;
        }
        closeTooltip();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!activeAnchor) return;
        closeTooltip();
    });

    window.addEventListener('resize', () => {
        if (!activeAnchor) return;
        positionTooltip(activeAnchor);
    });

    ui.step2.addEventListener('scroll', () => {
        if (!activeAnchor) return;
        positionTooltip(activeAnchor);
    }, { passive: true });
}

export function refreshGraphSettingTooltipContent() {
    if (!activeAnchor) return;
    openTooltip(activeAnchor);
}

export function initGraphSettingTooltip() {
    bindEvents();
}
