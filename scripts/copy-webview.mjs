import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..");
const from = path.join(root, "webview-ui", "dist");
const to = path.join(root, "media", "webview");

fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });

fs.cpSync(from, to, { recursive: true });
console.log(`[copy-webview] ${from} -> ${to}`);
