//src/panel/CodeGraphPanel.ts (패널/이벤트/메시징 전담)
import * as vscode from "vscode";
import * as path from "path";
import { getWebviewHtml } from "../webview/html";
import { analyzeActiveFile } from "../analyzer";
import type {
  ExtToWebviewMessage,
  WebviewToExtMessage,
} from "../shared/protocol";

export class CodeGraphPanel {
  private lastTextEditor: vscode.TextEditor | undefined;
  private lastSelection: vscode.Selection | undefined;
  private analysisTimer: NodeJS.Timeout | undefined;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
  ) {}

  static open(context: vscode.ExtensionContext) {
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

    const inst = new CodeGraphPanel(context, panel);
    inst.init();
  }

  private init() {
    this.panel.webview.html = getWebviewHtml(this.context, this.panel.webview);

    this.lastTextEditor = vscode.window.activeTextEditor;
    this.lastSelection = vscode.window.activeTextEditor?.selection;

    this.panel.webview.onDidReceiveMessage(
      async (msg: WebviewToExtMessage) => {
        try {
          if (msg.type === "requestActiveFile") return this.postActiveFile();
          if (msg.type === "requestSelection") return this.postSelection();
          if (msg.type === "analyzeActiveFile") return this.postAnalysis();
        } catch (e) {
          console.error("[codegraph] onDidReceiveMessage error:", e);
        }
      },
      undefined,
      this.context.subscriptions,
    );

    // initial push
    this.postActiveFile();
    this.postSelection();

    // ---- MVP: auto-analysis for active file changes (debounced) ----
    const scheduleAnalysis = (delayMs: number) => {
      if (this.analysisTimer) clearTimeout(this.analysisTimer);
      this.analysisTimer = setTimeout(
        () => {
          try {
            this.postAnalysis();
          } catch (e) {
            console.error("[codegraph] auto-analysis error:", e);
          }
        },
        Math.max(0, delayMs),
      );
    };

    const subActive = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        this.lastTextEditor = editor;
        this.lastSelection = editor.selection;
      }
      this.postActiveFile();
      scheduleAnalysis(0);
    });

    const subChange = vscode.workspace.onDidChangeTextDocument((e) => {
      const active =
        this.lastTextEditor?.document ??
        vscode.window.activeTextEditor?.document;
      if (!active) return;
      if (e.document.uri.toString() !== active.uri.toString()) return;

      this.postActiveFile();
      scheduleAnalysis(350);
    });

    const subSave = vscode.workspace.onDidSaveTextDocument((doc) => {
      const active =
        this.lastTextEditor?.document ??
        vscode.window.activeTextEditor?.document;
      if (!active) return;
      if (doc.uri.toString() !== active.uri.toString()) return;

      scheduleAnalysis(0);
    });

    const subSelection = vscode.window.onDidChangeTextEditorSelection((e) => {
      this.lastTextEditor = e.textEditor;
      this.lastSelection = e.selections?.[0];
      this.postSelection();
    });

    this.panel.onDidDispose(() => {
      subActive.dispose();
      subChange.dispose();
      subSave.dispose();
      subSelection.dispose();
      if (this.analysisTimer) clearTimeout(this.analysisTimer);
    });
  }

  private getEditor(): vscode.TextEditor | undefined {
    return this.lastTextEditor ?? vscode.window.activeTextEditor;
  }

  private postActiveFile() {
    const editor = this.getEditor();
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

    this.panel.webview.postMessage(message);
  }

  private postSelection() {
    const editor = this.getEditor();
    if (!editor) {
      this.panel.webview.postMessage({
        type: "selection",
        payload: null,
      } satisfies ExtToWebviewMessage);
      return;
    }

    const sel = this.lastSelection ?? editor.selection;
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

    this.panel.webview.postMessage(message);
  }

  private postAnalysis() {
    const editor = this.getEditor();
    if (!editor) {
      this.panel.webview.postMessage({
        type: "analysisResult",
        payload: null,
      } satisfies ExtToWebviewMessage);
      return;
    }

    const doc = editor.document;
    const text = doc.getText();

    const result = analyzeActiveFile({
      code: text,
      fileName: doc.fileName,
      languageId: doc.languageId,
    });

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
      graph: result.graph,
    };

    console.log("[analysis.calls sample]", result.calls.slice(0, 6));
    console.log(
      "[analysis.graph counts]",
      "nodes=",
      result.graph.nodes.length,
      "edges=",
      result.graph.edges.length,
    );

    this.panel.webview.postMessage({
      type: "analysisResult",
      payload,
    } satisfies ExtToWebviewMessage);
  }
}
