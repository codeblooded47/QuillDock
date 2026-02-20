import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const filesToCopy = [
  "manifest.json",
  "background.js",
  "content_script.js",
  "db.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "README.md",
  "product.md"
];

const foldersToCopy = ["icons", "templates"];

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

for (const file of filesToCopy) {
  const sourcePath = path.join(rootDir, file);
  const destinationPath = path.join(distDir, file);

  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

for (const folder of foldersToCopy) {
  const sourcePath = path.join(rootDir, folder);
  const destinationPath = path.join(distDir, folder);

  if (!fs.existsSync(sourcePath)) {
    continue;
  }

  fs.rmSync(destinationPath, { force: true, recursive: true });
  fs.cpSync(sourcePath, destinationPath, { recursive: true });
}

console.log("Extension static files copied to dist.");
