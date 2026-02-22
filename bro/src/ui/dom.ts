// ==========================================
// DOM ELEMENT ACCESS (lazy)
// ==========================================

function byId<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`[UI] Missing required element: #${id}`);
    }
    return el as T;
}

export const ui = {
    get step1() { return byId<HTMLElement>('step-1'); },
    get step2() { return byId<HTMLElement>('step-2'); },
    get stepStyle() { return byId<HTMLElement>('step-style'); },
    get backBtn() { return byId<HTMLButtonElement>('back-btn'); },
    get mainCta() { return byId<HTMLButtonElement>('main-cta'); },
    get editModeBtn() { return byId<HTMLButtonElement>('edit-mode-btn'); },

    get chartTypeWrapper() { return byId<HTMLElement>('chart-type-wrapper'); },
    get chartTypeIcon() { return byId<HTMLElement>('chart-type-icon'); },
    get chartTypeDisplay() { return byId<HTMLElement>('chart-type-display'); },
    get tabStyleBtn() { return byId<HTMLButtonElement>('tab-style'); },

    get settingColInput() { return byId<HTMLInputElement>('setting-col-input'); },
    get settingCellInput() { return byId<HTMLInputElement>('setting-cell-input'); },
    get settingMarkSelect() { return byId<HTMLSelectElement>('setting-mark-select'); },

    get containerMarkWrapper() { return byId<HTMLElement>('container-mark-wrapper'); },
    get containerMarkNormal() { return byId<HTMLElement>('container-mark-normal'); },

    get labelColInput() { return byId<HTMLElement>('label-col-input'); },
    get labelMarkPosition() { return byId<HTMLElement>('label-mark-position'); },

    get settingYMin() { return byId<HTMLInputElement>('setting-y-min'); },
    get settingYMax() { return byId<HTMLInputElement>('setting-y-max'); },
    get settingMarkRatioInput() { return byId<HTMLInputElement>('setting-mark-ratio-input'); },

    get settingStrokeInput() { return byId<HTMLInputElement>('setting-stroke-input'); },
    get containerMarkRatio() { return byId<HTMLElement>('container-mark-ratio'); },
    get containerStrokeWidth() { return byId<HTMLElement>('container-stroke-width'); },
    get spacerStroke() { return byId<HTMLElement>('spacer-stroke'); },

    get csvInput() { return byId<HTMLInputElement>('csv-upload'); },
    get csvStatusText() { return byId<HTMLElement>('csv-status-text'); },
    get csvDeleteBtn() { return byId<HTMLButtonElement>('csv-delete-btn'); },

    get gridScrollArea() { return byId<HTMLElement>('grid-scroll-area'); },
    get gridContainer() { return byId<HTMLElement>('data-grid'); },
    get rowHeaderContainer() { return byId<HTMLElement>('row-header-container'); },

    get addColFixedBtn() { return byId<HTMLButtonElement>('add-col-fixed-btn'); },
    get addRowFixedBtn() { return byId<HTMLButtonElement>('add-row-fixed-btn'); },
    get resetBtn() { return byId<HTMLButtonElement>('reset-btn'); },

    get modeToggleContainer() { return byId<HTMLElement>('mode-toggle-container'); },
    get modeRawBtn() { return byId<HTMLButtonElement>('mode-raw'); },
    get modePercentBtn() { return byId<HTMLButtonElement>('mode-percent'); },
    get assistLineControl() { return byId<HTMLElement>('assist-line-control'); },
    get assistLineLabelBtn() { return byId<HTMLButtonElement>('assist-line-label-btn'); },
    get assistLineToggleBtn() { return byId<HTMLButtonElement>('assist-line-toggle'); },
    get assistLinePopover() { return byId<HTMLElement>('assist-line-popover'); },
    get assistLineMinCheck() { return byId<HTMLInputElement>('assist-line-min-check'); },
    get assistLineMaxCheck() { return byId<HTMLInputElement>('assist-line-max-check'); },
    get assistLineAvgCheck() { return byId<HTMLInputElement>('assist-line-avg-check'); },

    get tooltipNormal() { return byId<HTMLElement>('tooltip-normal'); },
    get tooltipWarning() { return byId<HTMLElement>('tooltip-warning'); },
    get mainTooltip() { return byId<HTMLElement>('main-tooltip'); },
    get tooltipStackedHint() { return byId<HTMLElement>('tooltip-stacked-hint'); },

    get csvExportBtn() { return byId<HTMLButtonElement>('csv-export-btn'); },
    get toast() { return byId<HTMLElement>('restore-toast'); },
    get toastYesBtn() { return byId<HTMLButtonElement>('toast-yes-btn'); },
    get toastCloseBtn() { return byId<HTMLButtonElement>('toast-close-btn'); },
    get errorToast() { return byId<HTMLElement>('error-toast'); },

    get rowColorPopover() { return byId<HTMLElement>('row-color-popover'); },
    get rowColorPopoverTitle() { return byId<HTMLElement>('row-color-popover-title'); },
    get rowColorPreview() { return byId<HTMLElement>('row-color-preview'); },
    get rowColorWheel() { return byId<HTMLElement>('row-color-wheel'); },
    get rowColorHexInput() { return byId<HTMLInputElement>('row-color-hex-input'); },
    get styleColorPopover() { return byId<HTMLElement>('style-color-popover'); },
    get styleColorPopoverTitle() { return byId<HTMLElement>('style-color-popover-title'); },
    get styleColorPreview() { return byId<HTMLElement>('style-color-preview'); },
    get styleColorWheel() { return byId<HTMLElement>('style-color-wheel'); },
    get styleColorHexInput() { return byId<HTMLInputElement>('style-color-hex-input'); },

    get styleCellBottomColorInput() { return byId<HTMLInputElement>('style-cell-bottom-color'); },
    get styleCellBottomThicknessInput() { return byId<HTMLInputElement>('style-cell-bottom-thickness'); },
    get styleCellBottomVisibleInput() { return byId<HTMLInputElement>('style-cell-bottom-visible'); },
    get styleTabRightColorInput() { return byId<HTMLInputElement>('style-tab-right-color'); },
    get styleTabRightThicknessInput() { return byId<HTMLInputElement>('style-tab-right-thickness'); },
    get styleTabRightVisibleInput() { return byId<HTMLInputElement>('style-tab-right-visible'); },
    get styleGridColorInput() { return byId<HTMLInputElement>('style-grid-color'); },
    get styleGridThicknessInput() { return byId<HTMLInputElement>('style-grid-thickness'); },
    get styleGridVisibleInput() { return byId<HTMLInputElement>('style-grid-visible'); },
    get styleGridSideTopInput() { return byId<HTMLInputElement>('style-grid-side-top'); },
    get styleGridSideRightInput() { return byId<HTMLInputElement>('style-grid-side-right'); },
    get styleGridSideBottomInput() { return byId<HTMLInputElement>('style-grid-side-bottom'); },
    get styleGridSideLeftInput() { return byId<HTMLInputElement>('style-grid-side-left'); },
    get styleAssistLineColorInput() { return byId<HTMLInputElement>('style-assist-line-color'); },
    get styleAssistLineThicknessInput() { return byId<HTMLInputElement>('style-assist-line-thickness'); }
};
