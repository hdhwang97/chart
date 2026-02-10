type CsvFns = {
  handleCsvUpload: (event: Event) => void;
  parseAndApplyCsv: (csvText: string) => void;
  downloadCsv: () => void;
  removeCsv: () => void;
};

let impl: CsvFns;
export function registerCsvFunctions(fns: CsvFns) { impl = fns; }

export const handleCsvUpload = (event: Event) => impl.handleCsvUpload(event);
export const parseAndApplyCsv = (csvText: string) => impl.parseAndApplyCsv(csvText);
export const downloadCsv = () => impl.downloadCsv();
export const removeCsv = () => impl.removeCsv();
