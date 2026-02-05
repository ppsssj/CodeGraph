/** Webview -> Extension */
export type WebviewToExtMessage =
  | { type: "requestActiveFile" }
  | { type: "requestSelection" }
  | { type: "analyzeActiveFile" };

/** calls(V1/V2) */
export type CallV1 = { name: string; count: number };

export type CallV2 = {
  calleeName: string;
  count: number;
  declFile: string | null;
  declRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  } | null;
  isExternal: boolean;
};

export type CallItem = CallV1 | CallV2;

/** Extension -> Webview */
export type ExtToWebviewMessage =
  | {
      type: "activeFile";
      payload: {
        uri: string;
        fileName: string;
        languageId: string;
        text: string;
        isUntitled: boolean;
      } | null;
    }
  | {
      type: "selection";
      payload: {
        uri: string;
        selectionText: string;
        start: { line: number; character: number };
        end: { line: number; character: number };
      } | null;
    }
  | {
      type: "analysisResult";
      payload: {
        uri: string;
        fileName: string;
        languageId: string;
        stats: { chars: number; lines: number };
        imports: Array<{
          source: string;
          specifiers: string[];
          kind: "named" | "default" | "namespace" | "side-effect" | "unknown";
        }>;
        exports: Array<{
          name: string;
          kind:
            | "function"
            | "class"
            | "type"
            | "interface"
            | "const"
            | "unknown";
        }>;
        // ✅ V1/V2 호환
        calls: CallItem[];
      } | null;
    };

export type VSCodeApi = {
  postMessage: (msg: WebviewToExtMessage) => void;
  getState: <T = unknown>() => T | undefined;
  setState: (state: unknown) => void;
};

declare global {
  interface Window {
    acquireVsCodeApi: () => VSCodeApi;
  }
}

export function getVSCodeApi(): VSCodeApi {
  return window.acquireVsCodeApi();
}

export function isExtToWebviewMessage(x: unknown): x is ExtToWebviewMessage {
  if (!x || typeof x !== "object") return false;
  const t = (x as { type?: unknown }).type;
  return t === "activeFile" || t === "selection" || t === "analysisResult";
}
