import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as ts from "typescript";

type WebviewToExtMessage =
  | { type: "requestActiveFile" }
  | { type: "requestSelection" }
  | { type: "analyzeActiveFile" };

type AnalysisCallV1 = { name: string; count: number };

type AnalysisCallV2 = {
  calleeName: string;
  count: number;
  declFile: string | null;
  declRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  } | null;
  isExternal: boolean;
};

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
        // ✅ V1/V2 모두 수용 (Webview 쪽에서 구버전 호환 처리)
        calls: Array<AnalysisCallV1 | AnalysisCallV2>;
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

    lastTextEditor = vscode.window.activeTextEditor;
    lastSelection = vscode.window.activeTextEditor?.selection;

    panel.webview.onDidReceiveMessage(
      async (msg: WebviewToExtMessage) => {
        try {
          if (msg.type === "requestActiveFile") return postActiveFile(panel);
          if (msg.type === "requestSelection") return postSelection(panel);
          if (msg.type === "analyzeActiveFile") return postAnalysis(panel);
        } catch (e) {
          console.error("[codegraph] onDidReceiveMessage error:", e);
        }
      },
      undefined,
      context.subscriptions,
    );

    postActiveFile(panel);
    postSelection(panel);

    const subActive = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        lastTextEditor = editor;
        lastSelection = editor.selection;
      }
      postActiveFile(panel);
    });

    const subChange = vscode.workspace.onDidChangeTextDocument((e) => {
      const active =
        lastTextEditor?.document ?? vscode.window.activeTextEditor?.document;
      if (!active) return;
      if (e.document.uri.toString() !== active.uri.toString()) return;
      postActiveFile(panel);
    });

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
    calls: result.calls, // ✅ V2로 생성(하지만 UI는 V1도 호환)
  };
  console.log("[analysis.calls sample]", result.calls.slice(0, 6));

  panel.webview.postMessage({
    type: "analysisResult",
    payload,
  } satisfies ExtToWebviewMessage);
}

/**
 * AST + TypeChecker 기반 분석:
 * - imports/exports 정확 추출
 * - calls는 정규화 + 정의 위치(파일/Range)까지 resolve
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
  calls: Array<AnalysisCallV2>;
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
          true,
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
  };

  const program = ts.createProgram([inMemoryFileName], compilerOptions, host);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(inMemoryFileName);

  if (!sf) {
    return { imports: [], exports: [], calls: [] };
  }

  const imports = extractImports(sf);
  const exports = extractExports(sf);
  const calls = extractCallsResolved(sf, checker);

  return { imports, exports, calls };
}

function pickScriptKind(fileName: string, languageId: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx") || languageId === "typescriptreact")
    return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx") || languageId === "javascriptreact")
    return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || languageId === "javascript")
    return ts.ScriptKind.JS;
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
        imports.push({ source, specifiers, kind: "named" });
        continue;
      }
    }

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
        push(
          ts.isIdentifier(decl.name) ? decl.name.text : decl.name.getText(sf),
          "const",
        );
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

/** ✅ calls: 정규화 + declaration 위치 resolve */
function extractCallsResolved(
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): Array<AnalysisCallV2> {
  type Key = string;
  const map = new Map<Key, AnalysisCallV2 & { _declPos: number | null }>();

  const bump = (item: AnalysisCallV2 & { declPos: number | null }) => {
    const key = `${item.calleeName}@@${item.declFile ?? "null"}@@${item.declPos ?? "null"}`;
    const prev = map.get(key);
    if (prev) {
      prev.count += 1;
      return;
    }
    map.set(key, {
      calleeName: item.calleeName,
      count: 1,
      declFile: item.declFile,
      declRange: item.declRange,
      isExternal: item.isExternal,
      _declPos: item.declPos,
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      bump(resolveCallToDeclaration(node, sf, checker));
    } else if (ts.isNewExpression(node)) {
      bump(resolveNewToDeclaration(node, sf, checker));
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);

  return [...map.values()]
    .map(({ _declPos, ...rest }) => rest)
    .sort((a, b) => b.count - a.count)
    .slice(0, 60);
}

function resolveCallToDeclaration(
  call: ts.CallExpression,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): AnalysisCallV2 & { declPos: number | null } {
  const calleeName = normalizeCalleeName(call.expression, sf, checker);

  const sig = checker.getResolvedSignature(call);
  const declFromSig = sig?.getDeclaration();

  const sym = checker.getSymbolAtLocation(call.expression);
  const declFromSym = sym ? pickBestDeclaration(sym, checker) : undefined;

  const decl = declFromSig ?? declFromSym ?? null;
  const loc = decl ? declLocation(decl) : null;

  const isExternal = loc ? isExternalFile(loc.fileName) : false;

  return {
    calleeName,
    count: 1,
    declFile: loc ? loc.fileName : null,
    declRange: loc ? loc.range : null,
    isExternal,
    declPos: loc ? loc.pos : null,
  };
}

function resolveNewToDeclaration(
  node: ts.NewExpression,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): AnalysisCallV2 & { declPos: number | null } {
  const ctorExpr = node.expression;
  const calleeName = `new ${normalizeCtorName(ctorExpr, sf, checker)}`;

  const t = checker.getTypeAtLocation(ctorExpr);
  const constructSigs = t.getConstructSignatures();
  const declFromSig = constructSigs[0]?.getDeclaration();

  const sym = checker.getSymbolAtLocation(ctorExpr);
  const declFromSym = sym ? pickBestDeclaration(sym, checker) : undefined;

  const decl = declFromSig ?? declFromSym ?? null;
  const loc = decl ? declLocation(decl) : null;

  const isExternal = loc ? isExternalFile(loc.fileName) : false;

  return {
    calleeName,
    count: 1,
    declFile: loc ? loc.fileName : null,
    declRange: loc ? loc.range : null,
    isExternal,
    declPos: loc ? loc.pos : null,
  };
}

function normalizeCalleeName(
  expr: ts.Expression,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): string {
  if (ts.isIdentifier(expr)) return expr.text;

  if (ts.isPropertyAccessExpression(expr)) {
    const method = expr.name.text;
    const recv = expr.expression;

    const t = checker.getTypeAtLocation(recv);
    const recvTypeName = friendlyTypeName(t, checker);

    return recvTypeName
      ? `${recvTypeName}.${method}`
      : `${recv.getText(sf)}.${method}`;
  }

  if (ts.isElementAccessExpression(expr)) {
    return `${expr.expression.getText(sf)}[...]`;
  }

  if (ts.isParenthesizedExpression(expr)) {
    return normalizeCalleeName(expr.expression, sf, checker);
  }

  return expr.getText(sf);
}

function normalizeCtorName(
  expr: ts.Expression,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const t = checker.getTypeAtLocation(expr);
    const name = friendlyTypeName(t, checker);
    return name || expr.getText(sf);
  }
  return expr.getText(sf);
}

function friendlyTypeName(type: ts.Type, checker: ts.TypeChecker): string {
  const sym = type.getSymbol();
  if (sym) {
    const aliased =
      sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const name = aliased.getName();
    if (name && name !== "__type") return name;
  }
  return checker.typeToString(type);
}

function pickBestDeclaration(
  sym: ts.Symbol,
  checker: ts.TypeChecker,
): ts.Declaration | undefined {
  const s =
    sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  const decls = s.getDeclarations();
  if (!decls || decls.length === 0) return undefined;

  // 구현체 우선
  const impl = decls.find(
    (d) =>
      ts.isMethodDeclaration(d) ||
      ts.isFunctionDeclaration(d) ||
      ts.isFunctionExpression(d) ||
      ts.isClassDeclaration(d) ||
      ts.isInterfaceDeclaration(d),
  );

  return impl ?? decls[0];
}

function declLocation(decl: ts.Declaration): {
  fileName: string;
  pos: number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
} {
  const sf = decl.getSourceFile();
  const start = decl.getStart(sf, false);
  const end = decl.getEnd();

  const s = sf.getLineAndCharacterOfPosition(start);
  const e = sf.getLineAndCharacterOfPosition(end);

  return {
    fileName: sf.fileName,
    pos: start,
    range: {
      start: { line: s.line, character: s.character },
      end: { line: e.line, character: e.character },
    },
  };
}

function isExternalFile(fileName: string): boolean {
  const norm = fileName.replace(/\\/g, "/");
  return norm.includes("/node_modules/") || norm.includes("/typescript/lib/");
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
