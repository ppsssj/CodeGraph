/** Webview -> Extension */
export type WebviewToExtMessage =
  | { type: "requestActiveFile" }
  | { type: "requestSelection" }
  | { type: "analyzeActiveFile" };

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
        calls: Array<{ name: string; count: number }>;
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
