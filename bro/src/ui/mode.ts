type ModeFns = {
  setMode: (targetMode: string) => void;
  toggleMode: () => void;
  checkDataRange: () => boolean;
  checkCtaValidation: () => void;
};
let impl: ModeFns;
export function registerModeFunctions(fns: ModeFns) { impl = fns; }

export const setMode = (targetMode: string) => impl.setMode(targetMode);
export const toggleMode = () => impl.toggleMode();
export const checkDataRange = () => impl.checkDataRange();
export const checkCtaValidation = () => impl.checkCtaValidation();
