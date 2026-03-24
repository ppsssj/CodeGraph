import * as vscode from "vscode";
import { CodeGraphPanel } from "./panel/CodeGraphPanel";

class CodeGraphSidebarProvider
  implements vscode.WebviewViewProvider
{
  private currentView: vscode.WebviewView | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    if (this.currentView === webviewView) {
      return;
    }

    this.currentView = webviewView;
    CodeGraphPanel.resolveView(this.context, webviewView);

    webviewView.onDidDispose(() => {
      if (this.currentView === webviewView) {
        this.currentView = undefined;
      }
    });
  }

  async show() {
    if (this.currentView) {
      this.currentView.show(false);
      return;
    }

    try {
      await vscode.commands.executeCommand("codegraph.sidebar.focus");
    } catch {
      await vscode.commands.executeCommand("workbench.view.extension.codegraph");
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const sidebarProvider = new CodeGraphSidebarProvider(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("codegraph.open", () => {
      CodeGraphPanel.open(context);
    }),
    vscode.commands.registerCommand("codegraph.openSidebar", async () => {
      await sidebarProvider.show();
    }),
    vscode.window.registerWebviewViewProvider(
      "codegraph.sidebar",
      sidebarProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    ),
  );
}
