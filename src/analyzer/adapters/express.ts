import * as ts from "typescript";
import type {
  FrameworkCallbackHookResolution,
  FrameworkSemanticAdapter,
} from "./types";

const EXPRESS_ROUTE_METHODS = new Set([
  "use",
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "all",
]);

const getImportDeclaration = (
  node: ts.Node | undefined,
): ts.ImportDeclaration | null => {
  let current = node;
  while (current) {
    if (ts.isImportDeclaration(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
};

const isExpressImportDeclaration = (node: ts.Node | undefined): boolean => {
  const importDecl = getImportDeclaration(node);
  return !!(
    importDecl &&
    ts.isStringLiteral(importDecl.moduleSpecifier) &&
    importDecl.moduleSpecifier.text === "express"
  );
};

const getExpressImportKind = (
  symbol: ts.Symbol | undefined,
): string | null => {
  if (!symbol) {
    return null;
  }

  for (const decl of symbol.declarations ?? []) {
    if (!isExpressImportDeclaration(decl)) {
      continue;
    }
    if (ts.isImportSpecifier(decl)) {
      return (decl.propertyName ?? decl.name).text;
    }
    if (ts.isNamespaceImport(decl)) {
      return "*";
    }
    if (ts.isImportClause(decl) && decl.name) {
      return "default";
    }
  }

  return null;
};

const isExpressFactoryCall = (
  checker: ts.TypeChecker,
  expr: ts.LeftHandSideExpression,
): boolean => {
  if (!ts.isIdentifier(expr)) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(expr);
  return getExpressImportKind(symbol) === "default";
};

const isExpressRouterFactory = (
  checker: ts.TypeChecker,
  expr: ts.LeftHandSideExpression,
): boolean => {
  if (ts.isIdentifier(expr)) {
    const symbol = checker.getSymbolAtLocation(expr);
    return getExpressImportKind(symbol) === "Router";
  }

  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "Router") {
    const baseSymbol = checker.getSymbolAtLocation(expr.expression);
    const importKind = getExpressImportKind(baseSymbol);
    return importKind === "default" || importKind === "*";
  }

  return false;
};

const isExpressRouteOwner = (
  checker: ts.TypeChecker,
  expr: ts.Expression,
): boolean => {
  if (ts.isIdentifier(expr)) {
    const symbol = checker.getSymbolAtLocation(expr);
    const decl = symbol?.declarations?.find(ts.isVariableDeclaration);
    const init = decl?.initializer;
    if (!init || !ts.isCallExpression(init)) {
      return false;
    }

    return (
      isExpressFactoryCall(checker, init.expression) ||
      isExpressRouterFactory(checker, init.expression)
    );
  }

  return false;
};

const getRoutePathText = (
  arg: ts.Expression | undefined,
): string | null => {
  if (!arg) {
    return null;
  }
  if (ts.isStringLiteralLike(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }
  return null;
};

export const expressSemanticAdapter: FrameworkSemanticAdapter = {
  name: "express",
  resolveCallbackHook({
    checker,
    call,
    expression,
  }): FrameworkCallbackHookResolution | null {
    if (!ts.isPropertyAccessExpression(expression)) {
      return null;
    }

    const methodName = expression.name.text;
    if (!EXPRESS_ROUTE_METHODS.has(methodName)) {
      return null;
    }

    if (!isExpressRouteOwner(checker, expression.expression)) {
      return null;
    }

    const pathText = getRoutePathText(call.arguments[0]);
    const callbackArgIndex =
      methodName === "use"
        ? pathText
          ? 1
          : 0
        : pathText
          ? 1
          : 0;
    const name = pathText
      ? `route.${methodName}:${pathText}`
      : `route.${methodName}`;

    return {
      name,
      callbackArgIndex,
    };
  },
};
