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

/** Graph (MVP: active file only) */
export type Position = { line: number; character: number };
export type Range = { start: Position; end: Position };

export type GraphNodeKind = "function" | "method" | "class" | "external";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  name: string;
  file: string;
  range: Range;
  signature?: string;
};

export type GraphEdgeKind = "calls" | "constructs";

export type GraphEdge = {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  target: string;
};

export type GraphPayload = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

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

        // ✅ Graph payload (optional to keep backward compatibility)
        graph?: GraphPayload;
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
  // In the VS Code Webview this function is provided by the host.
  // During local dev (vite) `window.acquireVsCodeApi` is undefined —
  // provide a safe fallback so the UI can run in the browser.
  if (typeof window.acquireVsCodeApi === "function") {
    return window.acquireVsCodeApi();
  }

  // Dev fallback: log posted messages and keep simple state.
  let __vscode_state: unknown = undefined;
  return {
    postMessage: (msg: WebviewToExtMessage) => {
      // eslint-disable-next-line no-console
      console.debug("[vscode.postMessage - dev shim]", msg);
      try {
        window.dispatchEvent(new MessageEvent("message", { data: msg }));
      } catch {
        // ignore
      }
    },
    getState: <T = unknown>() => __vscode_state as T | undefined,
    setState: (s: unknown) => {
      __vscode_state = s;
    },
  };
}

export function isExtToWebviewMessage(x: unknown): x is ExtToWebviewMessage {
  if (!x || typeof x !== "object") return false;
  const t = (x as { type?: unknown }).type;
  return t === "activeFile" || t === "selection" || t === "analysisResult";
}
