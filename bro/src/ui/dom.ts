// ==========================================
// DOM ELEMENT CACHE
// ==========================================

export const ui = {
    step1: document.getElementById('step-1')!,
    step2: document.getElementById('step-2')!,
    backBtn: document.getElementById('back-btn')!,
    mainCta: document.getElementById('main-cta') as HTMLButtonElement,
    editModeBtn: document.getElementById('edit-mode-btn') as HTMLButtonElement,

    chartTypeWrapper: document.getElementById('chart-type-wrapper')!,
    chartTypeIcon: document.getElementById('chart-type-icon')!,
    chartTypeDisplay: document.getElementById('chart-type-display')!,

    settingColInput: document.getElementById('setting-col-input') as HTMLInputElement,
    settingCellInput: document.getElementById('setting-cell-input') as HTMLInputElement,
    settingMarkSelect: document.getElementById('setting-mark-select') as HTMLSelectElement,

    containerMarkWrapper: document.getElementById('container-mark-wrapper')!,
    containerMarkNormal: document.getElementById('container-mark-normal')!,

    labelColInput: document.getElementById('label-col-input')!,
    labelMarkPosition: document.getElementById('label-mark-position')!,

    settingYMin: document.getElementById('setting-y-min') as HTMLInputElement,
    settingYMax: document.getElementById('setting-y-max') as HTMLInputElement,

    // Stroke Width UI Elements
    settingStrokeInput: document.getElementById('setting-stroke-input') as HTMLInputElement,
    containerStrokeWidth: document.getElementById('container-stroke-width')!,
    spacerStroke: document.getElementById('spacer-stroke')!,

    csvInput: document.getElementById('csv-upload') as HTMLInputElement,
    csvStatusText: document.getElementById('csv-status-text')!,
    csvDeleteBtn: document.getElementById('csv-delete-btn')!,

    gridScrollArea: document.getElementById('grid-scroll-area')!,
    gridContainer: document.getElementById('data-grid')!,
    rowHeaderContainer: document.getElementById('row-header-container')!,

    addColFixedBtn: document.getElementById('add-col-fixed-btn')!,
    addRowFixedBtn: document.getElementById('add-row-fixed-btn')!,
    resetBtn: document.getElementById('reset-btn')!,

    modeToggleContainer: document.getElementById('mode-toggle-container')!,
    modeRawBtn: document.getElementById('mode-raw')!,
    modePercentBtn: document.getElementById('mode-percent')!,

    tooltipNormal: document.getElementById('tooltip-normal')!,
    tooltipWarning: document.getElementById('tooltip-warning')!,
    mainTooltip: document.getElementById('main-tooltip')!,
    tooltipStackedHint: document.getElementById('tooltip-stacked-hint')!,

    csvExportBtn: document.getElementById('csv-export-btn')!,
    toast: document.getElementById('restore-toast')!,
    toastYesBtn: document.getElementById('toast-yes-btn')!,
    toastCloseBtn: document.getElementById('toast-close-btn')!,
    errorToast: document.getElementById('error-toast')!
};
