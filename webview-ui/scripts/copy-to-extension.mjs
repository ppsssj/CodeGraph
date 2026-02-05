import fs from "fs";
import path from "path";

const here = process.cwd(); // webview-ui
const dist = path.join(here, "dist");

// 본인 프로젝트 구조에 맞게 경로만 확인해서 쓰세요.
// webview-ui 폴더 기준으로 extension의 media/webview로 복사
const target = path.resolve(here, "..", "media", "webview");

if (!fs.existsSync(dist)) {
  console.error("[copy] dist not found:", dist);
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

fs.cpSync(dist, target, { recursive: true });

console.log("[copy] dist ->", target);
