import * as ts from "typescript";

export interface FrameworkCallbackHookResolution {
  name: string;
  callbackArgIndex: number;
}

export interface FrameworkStateHookResolution {
  name: string;
  bindingKind: "tuple" | "identifier";
}

export interface FrameworkDecoratedMethodOwnerResolution {
  name: string;
}

export interface FrameworkSemanticAdapter {
  name: string;
  resolveCallbackHook?(args: {
    checker: ts.TypeChecker;
    call: ts.CallExpression;
    expression: ts.LeftHandSideExpression;
  }): FrameworkCallbackHookResolution | null;
  resolveStateHook?(args: {
    checker: ts.TypeChecker;
    expression: ts.LeftHandSideExpression;
  }): FrameworkStateHookResolution | null;
  resolveDecoratedMethodOwner?(args: {
    checker: ts.TypeChecker;
    classDecl: ts.ClassDeclaration;
    methodDecl: ts.MethodDeclaration;
  }): FrameworkDecoratedMethodOwnerResolution | null;
}

export function resolveFrameworkCallbackHook(args: {
  adapters: readonly FrameworkSemanticAdapter[];
  checker: ts.TypeChecker;
  call: ts.CallExpression;
  expression: ts.LeftHandSideExpression;
}): FrameworkCallbackHookResolution | null {
  const { adapters, checker, expression, call } = args;

  for (const adapter of adapters) {
    const hook = adapter.resolveCallbackHook?.({
      checker,
      call,
      expression,
    });
    if (hook) {
      return hook;
    }
  }

  return null;
}

export function resolveFrameworkStateHook(args: {
  adapters: readonly FrameworkSemanticAdapter[];
  checker: ts.TypeChecker;
  expression: ts.LeftHandSideExpression;
}): FrameworkStateHookResolution | null {
  const { adapters, checker, expression } = args;

  for (const adapter of adapters) {
    const hook = adapter.resolveStateHook?.({
      checker,
      expression,
    });
    if (hook) {
      return hook;
    }
  }

  return null;
}

export function resolveFrameworkDecoratedMethodOwner(args: {
  adapters: readonly FrameworkSemanticAdapter[];
  checker: ts.TypeChecker;
  classDecl: ts.ClassDeclaration;
  methodDecl: ts.MethodDeclaration;
}): FrameworkDecoratedMethodOwnerResolution | null {
  const { adapters, checker, classDecl, methodDecl } = args;

  for (const adapter of adapters) {
    const owner = adapter.resolveDecoratedMethodOwner?.({
      checker,
      classDecl,
      methodDecl,
    });
    if (owner) {
      return owner;
    }
  }

  return null;
}
