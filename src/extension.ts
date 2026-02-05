import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as ts from "typescript";

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

  const result = analyzeTypeScriptWithTypes({
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
  };

  panel.webview.postMessage({
    type: "analysisResult",
    payload,
  } satisfies ExtToWebviewMessage);
}

/**
 * TypeScript Compiler API(AST + TypeChecker) 기반 분석기
 * - import/export를 AST로 정확 추출
 * - calls는 CallExpression/NewExpression 기반으로 추출
 * - PropertyAccess(예: c.inc())는 TypeChecker로 수신 타입을 구해 Counter.inc() 형태로 정규화
 */
function analyzeTypeScriptWithTypes(args: {
  code: string;
  fileName: string;
  languageId: string;
}): {
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
  const { code, fileName, languageId } = args;

  const scriptKind = pickScriptKind(fileName, languageId);
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.React,
    allowJs: true,
    checkJs: false,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    strict: false,
  };

  // 활성 파일은 in-memory SourceFile로 공급하고, 나머지는 디스크에서 읽어오는 Host
  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const inMemoryFileName = fileName;

  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile: (
      requested,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    ) => {
      if (path.resolve(requested) === path.resolve(inMemoryFileName)) {
        return ts.createSourceFile(
          requested,
          code,
          languageVersion,
          /*setParentNodes*/ true,
          scriptKind,
        );
      }
      return defaultHost.getSourceFile(
        requested,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
    },
    fileExists: defaultHost.fileExists,
    readFile: defaultHost.readFile,
  };

  const program = ts.createProgram([inMemoryFileName], compilerOptions, host);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(inMemoryFileName);
  if (!sf) return { imports: [], exports: [], calls: [] };

  const imports = extractImports(sf);
  const exports = extractExports(sf);
  const calls = extractCallsNormalized(sf, checker);

  return { imports, exports, calls };
}

function pickScriptKind(fileName: string, languageId: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx") || languageId === "typescriptreact") {
    return ts.ScriptKind.TSX;
  }
  if (lower.endsWith(".jsx") || languageId === "javascriptreact") {
    return ts.ScriptKind.JSX;
  }
  if (lower.endsWith(".js") || languageId === "javascript") {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function isExported(node: ts.Node): boolean {
  const mods = ts.getCombinedModifierFlags(node as ts.Declaration);
  return (mods & ts.ModifierFlags.Export) !== 0;
}

function hasDefaultModifier(node: ts.Node): boolean {
  const mods = ts.getCombinedModifierFlags(node as ts.Declaration);
  return (mods & ts.ModifierFlags.Default) !== 0;
}

function extractImports(sf: ts.SourceFile): Array<{
  source: string;
  specifiers: string[];
  kind: "named" | "default" | "namespace" | "side-effect" | "unknown";
}> {
  const imports: Array<{
    source: string;
    specifiers: string[];
    kind: "named" | "default" | "namespace" | "side-effect" | "unknown";
  }> = [];

  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    const source = ts.isStringLiteral(st.moduleSpecifier)
      ? st.moduleSpecifier.text
      : st.moduleSpecifier.getText(sf);

    // import "x";
    if (!st.importClause) {
      imports.push({ source, specifiers: [], kind: "side-effect" });
      continue;
    }

    const specifiers: string[] = [];
    const { name, namedBindings } = st.importClause;

    if (name) specifiers.push(name.text);

    if (namedBindings) {
      if (ts.isNamespaceImport(namedBindings)) {
        specifiers.push(namedBindings.name.text);
        imports.push({ source, specifiers, kind: "namespace" });
        continue;
      }
      if (ts.isNamedImports(namedBindings)) {
        for (const el of namedBindings.elements) {
          const imported = el.propertyName?.text ?? el.name.text;
          const local = el.name.text;
          specifiers.push(
            imported === local ? imported : `${imported} as ${local}`,
          );
        }
        imports.push({
          source,
          specifiers,
          kind: specifiers.length ? "named" : "unknown",
        });
        continue;
      }
    }

    // default only
    if (name && !namedBindings) {
      imports.push({ source, specifiers, kind: "default" });
      continue;
    }

    imports.push({ source, specifiers, kind: "unknown" });
  }

  return imports;
}

function extractExports(sf: ts.SourceFile): Array<{
  name: string;
  kind: "function" | "class" | "type" | "interface" | "const" | "unknown";
}> {
  const exports: Array<{
    name: string;
    kind: "function" | "class" | "type" | "interface" | "const" | "unknown";
  }> = [];

  const push = (
    name: string,
    kind: "function" | "class" | "type" | "interface" | "const" | "unknown",
  ) => {
    if (!name) return;
    exports.push({ name, kind });
  };

  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && isExported(st)) {
      push(
        st.name?.text ?? (hasDefaultModifier(st) ? "default" : ""),
        "function",
      );
      continue;
    }
    if (ts.isClassDeclaration(st) && isExported(st)) {
      push(st.name?.text ?? (hasDefaultModifier(st) ? "default" : ""), "class");
      continue;
    }
    if (ts.isTypeAliasDeclaration(st) && isExported(st)) {
      push(st.name.text, "type");
      continue;
    }
    if (ts.isInterfaceDeclaration(st) && isExported(st)) {
      push(st.name.text, "interface");
      continue;
    }
    if (ts.isVariableStatement(st) && isExported(st)) {
      for (const decl of st.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) push(decl.name.text, "const");
        else push(decl.name.getText(sf), "const");
      }
      continue;
    }

    if (ts.isExportDeclaration(st)) {
      if (!st.exportClause) {
        push("*", "unknown");
        continue;
      }
      if (ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          const exported = el.name.text;
          const local = el.propertyName?.text ?? el.name.text;
          push(
            exported === local ? exported : `${local} as ${exported}`,
            "unknown",
          );
        }
      }
      continue;
    }

    if (ts.isExportAssignment(st)) {
      push("default", "unknown");
      continue;
    }
  }

  return exports;
}

function extractCallsNormalized(
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();

  const bump = (name: string) => {
    if (!name) return;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  };

  const normalizeCallExpressionName = (expr: ts.Expression): string => {
    if (ts.isIdentifier(expr)) return expr.text;

    if (ts.isPropertyAccessExpression(expr)) {
      const method = expr.name.text;
      const recv = expr.expression;

      // 타입 기반 정규화: Counter.inc / this.xxx 도 포함
      if (
        ts.isIdentifier(recv) ||
        recv.kind === ts.SyntaxKind.ThisKeyword ||
        recv.kind === ts.SyntaxKind.SuperKeyword
      ) {
        const t = checker.getTypeAtLocation(recv);
        const typeName = friendlyTypeName(t, checker);
        if (typeName) return `${typeName}.${method}`;
      }

      // fallback
      return `${recv.getText(sf)}.${method}`;
    }

    if (ts.isParenthesizedExpression(expr))
      return normalizeCallExpressionName(expr.expression);
    if (ts.isElementAccessExpression(expr))
      return `${expr.expression.getText(sf)}[...]`;
    return expr.getText(sf);
  };

  const normalizeNewExpressionName = (expr: ts.Expression): string => {
    if (ts.isIdentifier(expr)) return `new ${expr.text}`;
    if (ts.isPropertyAccessExpression(expr)) {
      const rhs = expr.name.text;
      const lhs = expr.expression;
      return `new ${lhs.getText(sf)}.${rhs}`;
    }
    return `new ${expr.getText(sf)}`;
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      bump(normalizeCallExpressionName(node.expression));
    } else if (ts.isNewExpression(node)) {
      bump(normalizeNewExpressionName(node.expression));
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}

function friendlyTypeName(type: ts.Type, checker: ts.TypeChecker): string {
  if (type.isUnion()) return checker.typeToString(type);

  const aliasSym = type.aliasSymbol;
  if (aliasSym) {
    const aliased =
      aliasSym.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(aliasSym)
        : aliasSym;
    return aliased.getName();
  }

  const sym = type.getSymbol();
  if (sym) {
    const s =
      sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const name = s.getName();
    if (name && name !== "__type") return name;
  }

  return checker.typeToString(type);
}

function getWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
) {
  const webviewDistPath = path.join(context.extensionPath, "media", "webview");
  const indexPath = path.join(webviewDistPath, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");

  const assetBaseUri = webview
    .asWebviewUri(vscode.Uri.file(webviewDistPath))
    .toString();
  html = html.replace(/href="\//g, `href="${assetBaseUri}/`);
  html = html.replace(/src="\//g, `src="${assetBaseUri}/`);

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
