// config.ts
// 1) 차트 컴포넌트 세트 이름 (Figma 디자인 시스템과 일치해야 함)
export const CHART_COMPONENT_SET_NAME = "Chart / Base";
// 컴포넌트 이름 prefix (필터링 용도)
export const CHART_COMPONENT_NAME_PREFIX = "Chart";
// 2) Chart 타입 Variant 프로퍼티 Key
export const CHART_TYPE_PROP_KEY = "chartType";
// Figma Component의 Variant 값과 코드 내부 타입 매핑
export const CHART_TYPE_VALUES = {
    BAR: "bar",
    STACKED_BAR: "stackedBar",
    LINE: "line",
};
// 3) 레이어 네이밍 규칙 (Regex)
export const MARK_NAME_PATTERNS = {
    // 예: bar_0, bar_1
    BAR: /^bar_(\d+)$/,
    // 예: bar_0_1 (그룹_세그먼트)
    STACKED: /^bar_(\d+)_(\d+)$/,
    // 예: line_0, line_1
    LINE: /^line_(\d+)$/,
};
