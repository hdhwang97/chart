export type StrokeAlign = 'CENTER' | 'INSIDE' | 'OUTSIDE';

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
};

export type AssistLineInjectionStyle = {
    color?: string;
    thickness?: number;
};

export type GridStrokeInjectionStyle = {
    color?: string;
    thickness?: number;
    visible?: boolean;
    enableIndividualStroke?: boolean;
    sides?: {
        top?: boolean;
        right?: boolean;
        bottom?: boolean;
        left?: boolean;
    };
};

export type StrokeInjectionPayload = {
    cellBottomStyle?: SideStrokeInjectionStyle;
    tabRightStyle?: SideStrokeInjectionStyle;
    gridContainerStyle?: GridStrokeInjectionStyle;
    assistLineStyle?: AssistLineInjectionStyle;
};
