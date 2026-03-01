export type StrokeAlign = 'CENTER' | 'INSIDE' | 'OUTSIDE';
export type StyleApplyMode = 'data_only' | 'include_style';
export type StyleSourceMode = 'master_extracted' | 'local_override';
export type ColorMode = 'hex' | 'paint_style';

export type PaintStyleSelection = {
    id: string;
    name: string;
    colorHex: string;
    isSolid?: boolean;
    remote?: boolean;
};

export type StrokeStyleSnapshot = {
    color?: string;
    opacity?: number;
    weight?: number;
    weightTop?: number;
    weightRight?: number;
    weightBottom?: number;
    weightLeft?: number;
    align?: StrokeAlign;
    dashPattern?: number[];
};

export type CellStrokeStyle = {
    row: number;
    col: number;
    stroke: StrokeStyleSnapshot;
};

export type RowStrokeStyle = {
    row: number;
    stroke: StrokeStyleSnapshot;
};

export type SideStrokeInjectionStyle = {
    color?: string;
    thickness?: number;
    visible?: boolean;
    strokeStyle?: 'solid' | 'dash';
};

export type CellFillInjectionStyle = {
    color?: string;
};

export type AssistLineInjectionStyle = {
    color?: string;
    thickness?: number;
    strokeStyle?: 'solid' | 'dash';
};

export type MarkInjectionStyle = {
    fillColor?: string;
    strokeColor?: string;
    thickness?: number;
    strokeStyle?: 'solid' | 'dash';
};

export type GridStrokeInjectionStyle = {
    color?: string;
    thickness?: number;
    visible?: boolean;
    strokeStyle?: 'solid' | 'dash';
    enableIndividualStroke?: boolean;
    sides?: {
        top?: boolean;
        right?: boolean;
        bottom?: boolean;
        left?: boolean;
    };
};

export type StrokeInjectionPayload = {
    cellFillStyle?: CellFillInjectionStyle;
    cellTopStyle?: SideStrokeInjectionStyle;
    /** @deprecated legacy alias. Use `cellTopStyle`. */
    cellBottomStyle?: SideStrokeInjectionStyle;
    tabRightStyle?: SideStrokeInjectionStyle;
    gridContainerStyle?: GridStrokeInjectionStyle;
    assistLineStyle?: AssistLineInjectionStyle;
    markStyle?: MarkInjectionStyle;
    markStyles?: MarkInjectionStyle[];
};

export type LocalStyleOverrides = {
    rowColors?: string[];
    rowColorModes?: ColorMode[];
    rowPaintStyleIds?: Array<string | null>;
    colColors?: string[];
    colColorModes?: ColorMode[];
    colPaintStyleIds?: Array<string | null>;
    colColorEnabled?: boolean[];
    markColorSource?: 'row' | 'col';
    assistLineVisible?: boolean;
    assistLineEnabled?: { min?: boolean; max?: boolean; avg?: boolean; ctr?: boolean };
    cellFillStyle?: CellFillInjectionStyle;
    cellTopStyle?: SideStrokeInjectionStyle;
    tabRightStyle?: SideStrokeInjectionStyle;
    gridContainerStyle?: GridStrokeInjectionStyle;
    assistLineStyle?: AssistLineInjectionStyle;
    markStyle?: MarkInjectionStyle;
    markStyles?: MarkInjectionStyle[];
    rowStrokeStyles?: RowStrokeStyle[];
    colStrokeStyle?: StrokeStyleSnapshot | null;
};

export type LocalStyleOverrideMask = {
    rowColors?: boolean;
    rowColorModes?: boolean;
    rowPaintStyleIds?: boolean;
    colColors?: boolean;
    colColorModes?: boolean;
    colPaintStyleIds?: boolean;
    colColorEnabled?: boolean;
    markColorSource?: boolean;
    assistLineVisible?: boolean;
    assistLineEnabled?: boolean;
    cellFillStyle?: boolean;
    cellTopStyle?: boolean;
    tabRightStyle?: boolean;
    gridContainerStyle?: boolean;
    assistLineStyle?: boolean;
    markStyle?: boolean;
    markStyles?: boolean;
    rowStrokeStyles?: boolean;
    colStrokeStyle?: boolean;
};

export type StyleTemplatePayload = StrokeInjectionPayload;

export type StyleTemplateItem = {
    id: string;
    name: string;
    payload: StyleTemplatePayload;
    createdAt: number;
    updatedAt: number;
};
