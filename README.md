# CodeGraph (VS Code Extension + Webview)

CodeGraph는 VS Code 확장(Extension Host)과 Webview(React + Vite)로 구성된 코드 분석/시각화 도구의 MVP입니다.

## Architecture

- **Extension**: `src/extension.ts`
  - VS Code API로 Active Editor 텍스트/Selection을 읽고 Webview로 전달
  - Webview 요청(`requestActiveFile`, `requestSelection`, `analyzeActiveFile`) 처리
- **Webview UI**: `webview-ui/` (React + Vite)
  - `window.acquireVsCodeApi()`로 Extension과 메시지 통신
  - Inspector에서 Active File/Selection/Analysis 결과 표시

## Requirements

- Node.js LTS 권장 (18+)
- VS Code 최신 버전 권장

## Install

```bash
npm install
cd webview-ui
npm install
```

## Repo Structure

```bash
.
├─ src/                  # VS Code extension source
├─ webview-ui/           # React + Vite webview UI
├─ media/webview/        # webview build output (generated)
├─ scripts/              # build/copy scripts (if present)
├─ package.json
└─ README.md
```
