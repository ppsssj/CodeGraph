import * as ts from "typescript";
import type {
  FrameworkDecoratedMethodOwnerResolution,
  FrameworkSemanticAdapter,
} from "./types";

const NEST_ROUTE_DECORATORS = new Set([
  "Get",
  "Post",
  "Put",
  "Patch",
  "Delete",
  "Options",
  "Head",
  "All",
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

const isNestImportDeclaration = (node: ts.Node | undefined): boolean => {
  const importDecl = getImportDeclaration(node);
  return !!(
    importDecl &&
    ts.isStringLiteral(importDecl.moduleSpecifier) &&
    importDecl.moduleSpecifier.text === "@nestjs/common"
  );
};

const getNestImportKind = (symbol: ts.Symbol | undefined): string | null => {
  if (!symbol) {
    return null;
  }

  for (const decl of symbol.declarations ?? []) {
    if (!isNestImportDeclaration(decl)) {
      continue;
    }
    if (ts.isImportSpecifier(decl)) {
      return (decl.propertyName ?? decl.name).text;
    }
    if (ts.isNamespaceImport(decl)) {
      return "*";
    }
  }

  return null;
};

const getDecorators = (node: ts.Node): readonly ts.Decorator[] => {
  if (!ts.canHaveDecorators(node)) {
    return [];
  }
  return ts.getDecorators(node) ?? [];
};

const getDecoratorName = (
  checker: ts.TypeChecker,
  decorator: ts.Decorator,
): string | null => {
  const expr = decorator.expression;

  if (ts.isIdentifier(expr)) {
    const symbol = checker.getSymbolAtLocation(expr);
    return getNestImportKind(symbol);
  }

  if (ts.isCallExpression(expr)) {
    return getDecoratorName(
      checker,
      ts.factory.createDecorator(expr.expression as ts.LeftHandSideExpression),
    );
  }

  if (ts.isPropertyAccessExpression(expr)) {
    const baseSymbol = checker.getSymbolAtLocation(expr.expression);
    const importKind = getNestImportKind(baseSymbol);
    if (importKind === "*") {
      return expr.name.text;
    }
  }

  return null;
};

const getDecoratorArgumentText = (
  decorator: ts.Decorator,
): string | null => {
  if (!ts.isCallExpression(decorator.expression)) {
    return null;
  }

  const firstArg = decorator.expression.arguments[0];
  if (!firstArg) {
    return null;
  }
  if (
    ts.isStringLiteralLike(firstArg) ||
    ts.isNoSubstitutionTemplateLiteral(firstArg)
  ) {
    return firstArg.text;
  }

  return null;
};

const normalizeRoutePath = (...parts: Array<string | null>) => {
  const normalized = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);

  if (normalized.length === 0) {
    return "/";
  }

  return `/${normalized.join("/")}`;
};

const getControllerPath = (
  checker: ts.TypeChecker,
  classDecl: ts.ClassDeclaration,
): string | null => {
  for (const decorator of getDecorators(classDecl)) {
    if (getDecoratorName(checker, decorator) !== "Controller") {
      continue;
    }
    return getDecoratorArgumentText(decorator) ?? "/";
  }

  return null;
};

const getRouteDecorator = (
  checker: ts.TypeChecker,
  methodDecl: ts.MethodDeclaration,
): { method: string; path: string } | null => {
  for (const decorator of getDecorators(methodDecl)) {
    const name = getDecoratorName(checker, decorator);
    if (!name || !NEST_ROUTE_DECORATORS.has(name)) {
      continue;
    }
    return {
      method: name.toLowerCase(),
      path: getDecoratorArgumentText(decorator) ?? "",
    };
  }

  return null;
};

export const nestSemanticAdapter: FrameworkSemanticAdapter = {
  name: "nest",
  resolveDecoratedMethodOwner({
    checker,
    classDecl,
    methodDecl,
  }): FrameworkDecoratedMethodOwnerResolution | null {
    const controllerPath = getControllerPath(checker, classDecl);
    if (controllerPath === null) {
      return null;
    }

    const route = getRouteDecorator(checker, methodDecl);
    if (!route) {
      return null;
    }

    return {
      name: `route.${route.method}:${normalizeRoutePath(controllerPath, route.path)}`,
    };
  },
};
