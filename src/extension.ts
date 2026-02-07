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

type GraphNodeKind = "file" | "function" | "method" | "class" | "external";
type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  name: string;
  file: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  signature?: string;
};

type GraphEdgeKind = "calls" | "constructs" | "dataflow";
type GraphEdge = {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  target: string;
  label?: string;
};

type GraphPayload = {
  nodes: GraphNode[];
  edges: GraphEdge[];
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

        // ✅ Graph payload (optional)
        graph?: GraphPayload;
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

    // ---- MVP: auto-analysis for active file changes (debounced) ----
    let analysisTimer: NodeJS.Timeout | undefined;
    const scheduleAnalysis = (delayMs: number) => {
      if (analysisTimer) clearTimeout(analysisTimer);
      analysisTimer = setTimeout(
        () => {
          try {
            postAnalysis(panel);
          } catch (e) {
            console.error("[codegraph] auto-analysis error:", e);
          }
        },
        Math.max(0, delayMs),
      );
    };

    const subActive = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        lastTextEditor = editor;
        lastSelection = editor.selection;
      }
      postActiveFile(panel);
      scheduleAnalysis(0);
    });

    const subChange = vscode.workspace.onDidChangeTextDocument((e) => {
      const active =
        lastTextEditor?.document ?? vscode.window.activeTextEditor?.document;
      if (!active) return;
      if (e.document.uri.toString() !== active.uri.toString()) return;
      postActiveFile(panel);

      // ✅ MVP: incremental-ish update (debounced)
      scheduleAnalysis(350);
    });

    const subSave = vscode.workspace.onDidSaveTextDocument((doc) => {
      const active =
        lastTextEditor?.document ?? vscode.window.activeTextEditor?.document;
      if (!active) return;
      if (doc.uri.toString() !== active.uri.toString()) return;
      scheduleAnalysis(0);
    });

    const subSelection = vscode.window.onDidChangeTextEditorSelection((e) => {
      lastTextEditor = e.textEditor;
      lastSelection = e.selections?.[0];
      postSelection(panel);
    });

    panel.onDidDispose(() => {
      subActive.dispose();
      subChange.dispose();
      subSave.dispose();
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

  panel.webview.postMessage({
    type: "analysisResult",
    payload,
  } satisfies ExtToWebviewMessage);
}

/**
 * AST + TypeChecker 기반 분석:
 * - imports/exports 정확 추출
 * - calls는 정규화 + 정의 위치(파일/Range)까지 resolve
 * - graph는 active file의 함수/클래스/메서드 + calls/new edges 생성
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
  graph: GraphPayload;
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
    return {
      imports: [],
      exports: [],
      calls: [],
      graph: { nodes: [], edges: [] },
    };
  }

  const imports = extractImports(sf);
  const exports = extractExports(sf);
  const calls = extractCallsResolved(sf, checker);
  const graph = buildActiveFileGraph(sf, checker);

  return { imports, exports, calls, graph };
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
/**
 * MVP graph builder: active-file only
 * - Nodes: file/function/class/method (named only)
 * - Edges: calls/new constructs (incl. top-level via file node)
 */
function buildActiveFileGraph(
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): GraphPayload {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // declStartPos -> nodeId
  const idByDeclPos = new Map<number, string>();

  const mkId = (kind: GraphNodeKind, name: string, pos: number) =>
    `${kind}:${name}@${pos}`;

  const sourceFileRange = () => {
    const endPos = sf.getEnd();
    const endLC = sf.getLineAndCharacterOfPosition(endPos);
    return {
      start: { line: 0, character: 0 },
      end: { line: endLC.line, character: endLC.character },
    };
  };

  // ✅ 0) file/module root node (top-level owner)
  const filePos = 0;
  const fileNameBase = path.basename(sf.fileName);
  const fileNodeId = mkId("file", fileNameBase, filePos);
  nodes.push({
    id: fileNodeId,
    kind: "file",
    name: fileNameBase,
    file: sf.fileName,
    range: sourceFileRange(),
  });

  const pushNode = (
    decl: ts.Declaration,
    kind: GraphNodeKind,
    name: string,
  ) => {
    const loc = declLocation(decl);
    const id = mkId(kind, name, loc.pos);
    idByDeclPos.set(loc.pos, id);

    let signature: string | undefined = undefined;
    try {
      if (
        ts.isFunctionDeclaration(decl) ||
        ts.isMethodDeclaration(decl) ||
        ts.isConstructorDeclaration(decl)
      ) {
        const sig = checker.getSignatureFromDeclaration(
          decl as ts.SignatureDeclaration,
        );
        if (sig) signature = checker.signatureToString(sig);
      }
    } catch {
      // ignore signature extraction failures
    }

    nodes.push({
      id,
      kind,
      name,
      file: sf.fileName,
      range: loc.range,
      signature,
    });
  };

  // 1) collect nodes (top-level + class members)
  const visitDecls = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      pushNode(node, "function", node.name.text);
    } else if (ts.isClassDeclaration(node) && node.name) {
      pushNode(node, "class", node.name.text);
      for (const m of node.members) {
        if (
          ts.isMethodDeclaration(m) &&
          m.name &&
          ts.isIdentifier(m.name) &&
          m.body
        ) {
          pushNode(m, "method", `${node.name!.text}.${m.name.text}`);
        }
      }
    }
    ts.forEachChild(node, visitDecls);
  };

  visitDecls(sf);

  // helper: resolve call/new target decl pos in this file
  const resolveTargetDeclPos = (
    expr: ts.Expression,
    kind: GraphEdgeKind,
  ): number | null => {
    try {
      if (kind === "calls") {
        const callExpr = expr.parent;
        if (!ts.isCallExpression(callExpr)) return null;
        const sig = checker.getResolvedSignature(callExpr);
        const declFromSig = sig?.getDeclaration();
        const sym = checker.getSymbolAtLocation(callExpr.expression);
        const declFromSym = sym ? pickBestDeclaration(sym, checker) : undefined;
        const decl = (declFromSig ?? declFromSym) as ts.Declaration | undefined;
        if (!decl) return null;
        const loc = declLocation(decl);
        if (loc.fileName !== sf.fileName) return null;
        return loc.pos;
      }

      // constructs
      const newExpr = expr.parent;
      if (!ts.isNewExpression(newExpr)) return null;
      const t = checker.getTypeAtLocation(newExpr.expression);
      const declFromSig = t.getConstructSignatures()[0]?.getDeclaration();
      const sym = checker.getSymbolAtLocation(newExpr.expression);
      const declFromSym = sym ? pickBestDeclaration(sym, checker) : undefined;
      const decl = (declFromSig ?? declFromSym) as ts.Declaration | undefined;
      if (!decl) return null;
      const loc = declLocation(decl);
      if (loc.fileName !== sf.fileName) return null;
      return loc.pos;
    } catch {
      return null;
    }
  };

  // 2) collect edges by walking bodies with owner tracking
  const edgeKey = new Set<string>();
  const addEdge = (
    edgeKind: GraphEdgeKind,
    srcId: string,
    tgtId: string,
    label?: string,
    dedupeHint?: string, // ✅ dataflow 인자 index 등 식별자
  ) => {
    const key = `${edgeKind}:${srcId}->${tgtId}@@${label ?? ""}@@${dedupeHint ?? ""}`;
    if (edgeKey.has(key)) return;
    edgeKey.add(key);
    edges.push({
      id: key, // ✅ ReactFlow id도 키를 그대로 사용 → 충돌 방지
      kind: edgeKind,
      source: srcId,
      target: tgtId,
      label,
    });
  };

  const clampText = (s: string, max = 80) =>
    s.length <= max ? s : `${s.slice(0, max - 1)}…`;

  // REPLACE: 기존 buildDataflowLabel 블록 전체
  const buildDataflowLabel = (
    p: ts.ParameterDeclaration,
    arg: ts.Expression,
  ) => {
    const paramName = clampText(p.name.getText(sf).replace(/\s+/g, " "), 60);
    const argText = clampText(arg.getText(sf).replace(/\s+/g, " "), 80);

    let paramTypeStr = "";
    try {
      if (p.type) {
        paramTypeStr = checker.typeToString(
          checker.getTypeFromTypeNode(p.type),
        );
      } else {
        paramTypeStr = checker.typeToString(checker.getTypeAtLocation(p));
      }
    } catch {
      paramTypeStr = "";
    }

    let argTypeStr = "";
    try {
      argTypeStr = checker.typeToString(checker.getTypeAtLocation(arg));
    } catch {
      argTypeStr = "";
    }

    const left = paramTypeStr ? `${paramName}: ${paramTypeStr}` : paramName;
    const right = argTypeStr ? `${argText}: ${argTypeStr}` : argText;

    return `${left} ← ${right}`;
  };

  const addDataflowEdgesFromSignature = (
    ownerId: string,
    targetId: string,
    sigDecl: ts.SignatureDeclaration | undefined,
    callArgs: readonly ts.Expression[] | undefined,
  ) => {
    if (!sigDecl) return;
    const params = sigDecl.parameters ?? ts.factory.createNodeArray();
    const args = callArgs ?? [];

    const n = Math.min(params.length, args.length);
    for (let i = 0; i < n; i++) {
      const p = params[i];
      const a = args[i];
      if (!p || !a) continue;

      const label = buildDataflowLabel(p, a);
      // ✅ dataflow는 인자별로 별도 edge가 필요 → arg index를 키에 포함
      addEdge("dataflow", ownerId, targetId, label, `arg#${i}`);
    }
  };

  const walk = (node: ts.Node, ownerId: string) => {
    // owner switches
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const pos = node.getStart(sf, false);
      const id = idByDeclPos.get(pos);
      const nextOwner = id ?? ownerId;
      walk(node.body, nextOwner);
      return;
    }

    if (
      ts.isMethodDeclaration(node) &&
      node.body &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      const pos = node.getStart(sf, false);
      const id = idByDeclPos.get(pos);
      const nextOwner = id ?? ownerId;
      walk(node.body, nextOwner);
      return;
    }

    // edge detection
    if (ts.isCallExpression(node)) {
      const targetPos = resolveTargetDeclPos(node.expression, "calls");
      if (targetPos != null) {
        const tgtId = idByDeclPos.get(targetPos);
        if (tgtId) {
          addEdge("calls", ownerId, tgtId);

          // ✅ dataflow: param <- arg (with best-effort type)
          const sig = checker.getResolvedSignature(node);
          const sigDecl = sig?.getDeclaration() as
            | ts.SignatureDeclaration
            | undefined;
          addDataflowEdgesFromSignature(
            ownerId,
            tgtId,
            sigDecl,
            node.arguments,
          );
        }
      }
    }

    if (ts.isNewExpression(node)) {
      const targetPos = resolveTargetDeclPos(node.expression, "constructs");
      if (targetPos != null) {
        const tgtId = idByDeclPos.get(targetPos);
        if (tgtId) {
          addEdge("constructs", ownerId, tgtId);

          // ✅ dataflow for constructor args
          let sigDecl: ts.SignatureDeclaration | undefined = undefined;
          try {
            const t = checker.getTypeAtLocation(node.expression);
            sigDecl = t.getConstructSignatures()[0]?.getDeclaration() as
              | ts.SignatureDeclaration
              | undefined;
          } catch {
            sigDecl = undefined;
          }
          addDataflowEdgesFromSignature(
            ownerId,
            tgtId,
            sigDecl,
            node.arguments,
          );
        }
      }
    }

    ts.forEachChild(node, (c) => walk(c, ownerId));
  };

  // ✅ IMPORTANT: start from file node so top-level calls produce edges
  walk(sf, fileNodeId);

  return { nodes, edges };
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

  // Replace base href and asset URLs
  html = html.replace(
    /<base href="[^"]*" ?\/?>/g,
    `<base href="${assetBaseUri}/" />`,
  );
  html = html.replace(
    /"(\/assets\/[^"]+)"/g,
    (_, p1) => `"${assetBaseUri}${p1}"`,
  );

  // CSP (minimal)
  const cspSource = webview.cspSource;
  const nonce = getNonce();

  html = html.replace(
    /<meta http-equiv="Content-Security-Policy" content="[^"]*"\s*\/?>/g,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">`,
  );

  // Ensure script tags have nonce
  html = html.replace(/<script /g, `<script nonce="${nonce}" `);

  return html;
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
