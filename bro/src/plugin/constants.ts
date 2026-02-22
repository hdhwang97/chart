// ==========================================
// CONFIG & CONSTANTS
// ==========================================

export const MASTER_COMPONENT_CONFIG = {
    NAME: "Chart_test",
    KEY: ""
};

export const STORAGE_KEY_COMPONENT_ID = "cached_chart_component_id";

// Variant & Property Names
export const VARIANT_PROPERTY_TYPE = "Type";
export const VARIANT_PROPERTY_MARK_NUM = "markNum";
export const VARIANT_PROPERTY_LINE_NUM = "lineNum";
export const VARIANT_PROPERTY_CEL_TYPE = "celType";
export const VARIANT_PROPERTY_Y_LABEL = "yLabel";
export const VARIANT_PROPERTY_Y_END = "yEnd";

export const VARIANT_MAPPING: { [key: string]: string } = {
    'bar': 'bar',
    'line': 'line',
    'stackedBar': 'stackedBar'
};

export const LINE_VARIANT_KEY_DEFAULT = "direction";
export const LINE_VARIANT_VALUES = {
    UP: "up",
    DOWN: "down",
    FLAT: "flat"
} as const;

// [Data Keys] 저장할 키 목록
export const PLUGIN_DATA_KEYS = {
    MODIFIED: "isChartModified",
    CHART_TYPE: "chartType",

    // 데이터 값
    LAST_VALUES: "lastAppliedValues",       // UI용 원본 (All 포함)
    LAST_DRAWING_VALUES: "lastDrawingValues", // 그리기용 (All 제외)

    // 차트 설정
    LAST_MODE: "lastAppliedMode",
    LAST_CELL_COUNT: "lastCellCount",
    LAST_MARK_NUM: "lastMarkNum",
    LAST_Y_MIN: "lastYMin",
    LAST_Y_MAX: "lastYMax",

    // 스타일 관련 키
    LAST_BAR_PADDING: "lastBarPadding",
    LAST_ROW_COLORS: "lastRowColors",
    LAST_CORNER_RADIUS: "lastCornerRadius",
    LAST_STROKE_WIDTH: "lastStrokeWidth",
    LAST_ASSIST_LINE_ENABLED: "lastAssistLineEnabled",
    LAST_ASSIST_LINE_VISIBLE: "lastAssistLineVisible",
    LAST_CELL_BOTTOM_STYLE: "lastCellBottomStyle",
    LAST_TAB_RIGHT_STYLE: "lastTabRightStyle",
    LAST_GRID_CONTAINER_STYLE: "lastGridContainerStyle"
} as const;

// Naming Patterns (Regex)
export const MARK_NAME_PATTERNS = {
    BAR_INSTANCE: /^bar$/,
    BAR_ITEM_SINGLE: /^bar$/,
    BAR_ITEM_MULTI: /^bar[-_]?0*(\d+)$/,

    STACKED_GROUP: /^st\.bar\.group$|^bar[-_]?group$/,
    STACKED_SUB_INSTANCE: /^st\.bar.*$|^bar.*$/,
    STACKED_SEGMENT: /^bar[-_]?0*(\d+)$/,

    LINE: /^line[-_]?0*(\d*)$/,
    COL_ALL: /^col-0*(\d+)$/,

    CEL: /^cel[-_]?0*(\d+)$/,
    Y_AXIS_CONTAINER: /^y-axis$/,
    Y_CEL_ITEM: /^y_cel[-_]?0*(\d+)$/
};
