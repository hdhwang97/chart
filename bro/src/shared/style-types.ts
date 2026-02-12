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
