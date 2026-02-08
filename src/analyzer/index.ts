//src/analyzer/index.ts (패널이 호출할 “단일 진입점”)
import { analyzeTypeScriptWithTypes } from "./analyze";

export function analyzeActiveFile(args: {
  code: string;
  fileName: string;
  languageId: string;
}) {
  return analyzeTypeScriptWithTypes(args);
}
