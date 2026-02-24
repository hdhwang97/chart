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
    cellBottomStyle?: SideStrokeInjectionStyle;
    tabRightStyle?: SideStrokeInjectionStyle;
    gridContainerStyle?: GridStrokeInjectionStyle;
    assistLineStyle?: AssistLineInjectionStyle;
    markStyle?: MarkInjectionStyle;
    markStyles?: MarkInjectionStyle[];
};

export type StyleTemplatePayload = StrokeInjectionPayload;

export type StyleTemplateItem = {
    id: string;
    name: string;
    payload: StyleTemplatePayload;
    createdAt: number;
    updatedAt: number;
};
