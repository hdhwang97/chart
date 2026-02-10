type GridFns = {
  renderGrid: () => void;
  updateGridSize: (rows: number, cols: number) => void;
  addRow: () => void;
  addColumn: () => void;
  deleteRow: (row: number) => void;
  deleteColumn: (col: number) => void;
};

let impl: GridFns;

export function registerGridFunctions(fns: GridFns) {
  impl = fns;
}

export const renderGrid = () => impl.renderGrid();
export const updateGridSize = (rows: number, cols: number) => impl.updateGridSize(rows, cols);
export const addRow = () => impl.addRow();
export const addColumn = () => impl.addColumn();
export const deleteRow = (row: number) => impl.deleteRow(row);
export const deleteColumn = (col: number) => impl.deleteColumn(col);
