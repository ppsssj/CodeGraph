import { analyzeTypeScriptWithTypes } from "./analyze";

export function analyzeActiveFile(args: {
  code: string;
  fileName: string;
  languageId: string;
}) {
  return analyzeTypeScriptWithTypes(args);
}
