import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

type WebviewToExtMessage =
  | { type: "requestActiveFile" }
  | { type: "requestSelection" }
  | { type: "analyzeActiveFile" };

type ExtToWebviewMessage =
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

let lastTextEditor: vscode.TextEditor | undefined;
let lastSelection: vscode.Selection | undefined;

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand("codegraph.open", () => {
    const panel = vscode.window.createWebviewPanel(
      "codegraph",
      "CodeGraph",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, "media", "webview")),
        ],
      },
    );

    panel.webview.html = getWebviewHtml(context, panel.webview);

    // 초기 상태 캐시
    lastTextEditor = vscode.window.activeTextEditor;
    lastSelection = vscode.window.activeTextEditor?.selection;

    // Webview -> Extension
    panel.webview.onDidReceiveMessage(
      async (msg: WebviewToExtMessage) => {
        try {
          if (msg.type === "requestActiveFile") {
            postActiveFile(panel);
            return;
          }
          if (msg.type === "requestSelection") {
            postSelection(panel);
            return;
          }
          if (msg.type === "analyzeActiveFile") {
            postAnalysis(panel);
            return;
          }
        } catch (e) {
          console.error("[codegraph] onDidReceiveMessage error:", e);
        }
      },
      undefined,
      context.subscriptions,
    );

    // 패널 열릴 때 1회 전송
    postActiveFile(panel);
    postSelection(panel);

    // Active editor 변경 시 캐시 업데이트
    const subActive = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        lastTextEditor = editor;
        lastSelection = editor.selection;
      }
      postActiveFile(panel);
    });

    // 타이핑 시 active doc 갱신 (현재 active doc만)
    const subChange = vscode.workspace.onDidChangeTextDocument((e) => {
      const active =
        lastTextEditor?.document ?? vscode.window.activeTextEditor?.document;
      if (!active) return;
      if (e.document.uri.toString() !== active.uri.toString()) return;
      postActiveFile(panel);
    });

    // selection 변경 시 캐시 업데이트
    const subSelection = vscode.window.onDidChangeTextEditorSelection((e) => {
      lastTextEditor = e.textEditor;
      lastSelection = e.selections?.[0];
      postSelection(panel);
    });

    panel.onDidDispose(() => {
      subActive.dispose();
      subChange.dispose();
      subSelection.dispose();
    });
  });

  context.subscriptions.push(disposable);
}

function getEditor(): vscode.TextEditor | undefined {
  return lastTextEditor ?? vscode.window.activeTextEditor;
}

function postActiveFile(panel: vscode.WebviewPanel) {
  const editor = getEditor();

  const message: ExtToWebviewMessage = editor
    ? {
        type: "activeFile",
        payload: {
          uri: editor.document.uri.toString(),
          fileName: path.basename(editor.document.fileName),
          languageId: editor.document.languageId,
          text: editor.document.getText(),
          isUntitled: editor.document.isUntitled,
        },
      }
    : { type: "activeFile", payload: null };

  panel.webview.postMessage(message);
}

function postSelection(panel: vscode.WebviewPanel) {
  const editor = getEditor();
  if (!editor) {
    panel.webview.postMessage({
      type: "selection",
      payload: null,
    } satisfies ExtToWebviewMessage);
    return;
  }

  const sel = lastSelection ?? editor.selection;
  const selectionText = editor.document.getText(sel);

  const message: ExtToWebviewMessage = {
    type: "selection",
    payload: {
      uri: editor.document.uri.toString(),
      selectionText,
      start: { line: sel.start.line, character: sel.start.character },
      end: { line: sel.end.line, character: sel.end.character },
    },
  };

  panel.webview.postMessage(message);
}

function postAnalysis(panel: vscode.WebviewPanel) {
  const editor = getEditor();
  if (!editor) {
    panel.webview.postMessage({
      type: "analysisResult",
      payload: null,
    } satisfies ExtToWebviewMessage);
    return;
  }

  const doc = editor.document;
  const text = doc.getText();

  const result = analyzeTypescriptLike(text);

  const payload: Extract<
    ExtToWebviewMessage,
    { type: "analysisResult" }
  >["payload"] = {
    uri: doc.uri.toString(),
    fileName: path.basename(doc.fileName),
    languageId: doc.languageId,
    stats: {
      chars: text.length,
      lines: text.split(/\r?\n/).length,
    },
    imports: result.imports,
    exports: result.exports,
    calls: result.calls,
  };

  panel.webview.postMessage({
    type: "analysisResult",
    payload,
  } satisfies ExtToWebviewMessage);
}

/**
 * 1차 MVP 파서(정규식 기반)
 * - 정확한 AST가 아니라 “보이는 결과를 빨리 만드는” 목적
 * - 다음 단계에서 TypeScript Compiler API로 대체할 예정
 */
function analyzeTypescriptLike(code: string): {
  imports: Array<{
    source: string;
    specifiers: string[];
    kind: "named" | "default" | "namespace" | "side-effect" | "unknown";
  }>;
  exports: Array<{
    name: string;
    kind: "function" | "class" | "type" | "interface" | "const" | "unknown";
  }>;
  calls: Array<{ name: string; count: number }>;
} {
  // comments 제거(대충)
  const noComments = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  // --- imports ---
  const imports: Array<{
    source: string;
    specifiers: string[];
    kind: "named" | "default" | "namespace" | "side-effect" | "unknown";
  }> = [];

  // import "x";
  for (const m of noComments.matchAll(/import\s+["']([^"']+)["']\s*;?/g)) {
    imports.push({ source: m[1], specifiers: [], kind: "side-effect" });
  }

  // import ... from "x";
  for (const m of noComments.matchAll(
    /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?/g,
  )) {
    const raw = (m[1] ?? "").trim();
    const source = m[2];

    if (!raw) {
      imports.push({ source, specifiers: [], kind: "unknown" });
      continue;
    }

    // namespace import: * as X
    const ns = raw.match(/^\*\s+as\s+([A-Za-z0-9_$]+)/);
    if (ns) {
      imports.push({ source, specifiers: [ns[1]], kind: "namespace" });
      continue;
    }

    // named import: { a as b, c }
    const named = raw.match(/^\{([\s\S]*?)\}$/);
    if (named) {
      const inside = named[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/\s+as\s+/g, " as "));
      imports.push({ source, specifiers: inside, kind: "named" });
      continue;
    }

    // default import: X
    // default + named: X, { a }
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 1) {
      imports.push({ source, specifiers: [parts[0]], kind: "default" });
    } else {
      const defaultName = parts[0];
      const rest = parts.slice(1).join(",").trim();
      const specifiers: string[] = [defaultName];
      const named2 = rest.match(/^\{([\s\S]*?)\}$/);
      if (named2) {
        specifiers.push(
          ...named2[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => s.replace(/\s+as\s+/g, " as ")),
        );
        imports.push({ source, specifiers, kind: "named" });
      } else {
        imports.push({ source, specifiers, kind: "unknown" });
      }
    }
  }

  // --- exports ---
  const exports: Array<{
    name: string;
    kind: "function" | "class" | "type" | "interface" | "const" | "unknown";
  }> = [];

  // export function Foo
  for (const m of noComments.matchAll(
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
  )) {
    exports.push({ name: m[1], kind: "function" });
  }
  // export class Foo
  for (const m of noComments.matchAll(/\bexport\s+class\s+([A-Za-z0-9_$]+)/g)) {
    exports.push({ name: m[1], kind: "class" });
  }
  // export type Foo
  for (const m of noComments.matchAll(/\bexport\s+type\s+([A-Za-z0-9_$]+)/g)) {
    exports.push({ name: m[1], kind: "type" });
  }
  // export interface Foo
  for (const m of noComments.matchAll(
    /\bexport\s+interface\s+([A-Za-z0-9_$]+)/g,
  )) {
    exports.push({ name: m[1], kind: "interface" });
  }
  // export const Foo
  for (const m of noComments.matchAll(/\bexport\s+const\s+([A-Za-z0-9_$]+)/g)) {
    exports.push({ name: m[1], kind: "const" });
  }

  // --- calls ---
  // 아주 단순하게 identifier(...) 패턴 집계
  const callCounts = new Map<string, number>();
  for (const m of noComments.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
    const name = m[1];

    // 키워드/선언문 필터(대충)
    if (
      name === "if" ||
      name === "for" ||
      name === "while" ||
      name === "switch" ||
      name === "catch" ||
      name === "function" ||
      name === "return" ||
      name === "typeof" ||
      name === "new"
    ) {
      continue;
    }

    callCounts.set(name, (callCounts.get(name) ?? 0) + 1);
  }

  const calls = [...callCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  return { imports, exports, calls };
}

function getWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
) {
  const webviewDistPath = path.join(context.extensionPath, "media", "webview");
  const indexPath = path.join(webviewDistPath, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");

  // /assets/... -> webview uri 치환
  const assetBaseUri = webview
    .asWebviewUri(vscode.Uri.file(webviewDistPath))
    .toString();
  html = html.replace(/href="\//g, `href="${assetBaseUri}/`);
  html = html.replace(/src="\//g, `src="${assetBaseUri}/`);

  // CSP
  const csp = [
    `default-src 'none';`,
    `img-src ${webview.cspSource} https: data:;`,
    `style-src ${webview.cspSource} 'unsafe-inline';`,
    `script-src ${webview.cspSource};`,
    `font-src ${webview.cspSource} https: data:;`,
  ].join(" ");

  html = html.replace(
    "</head>",
    `<meta http-equiv="Content-Security-Policy" content="${csp}"></head>`,
  );

  return html;
}

export function deactivate() {}
