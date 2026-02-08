import * as vscode from "vscode";
import { CodeGraphPanel } from "./panel/CodeGraphPanel";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("codegraph.open", () => {
      CodeGraphPanel.open(context);
    }),
  );
}
