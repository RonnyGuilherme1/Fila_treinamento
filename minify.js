const fs = require("fs");
const path = require("path");

// Simple minifier function
function minifyJS(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove block comments
    .replace(/\/\/.*/g, "") // Remove line comments
    .replace(/\s+/g, " ") // Collapse whitespace
    .replace(/\s*([{}();:,])\s*/g, "$1") // Remove spaces around symbols
    .trim();
}

function minifyCSS(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove comments
    .replace(/\s+/g, " ") // Collapse whitespace
    .replace(/\s*([{}:;,])\s*/g, "$1") // Remove spaces around symbols
    .trim();
}

// Minify script.js
const scriptPath = path.join(__dirname, "Frontend", "script.js");
const scriptMinPath = path.join(__dirname, "Frontend", "script.min.js");
const scriptCode = fs.readFileSync(scriptPath, "utf-8");
fs.writeFileSync(scriptMinPath, minifyJS(scriptCode));
console.log("✓ script.min.js criado");

// Minify style.css
const stylePath = path.join(__dirname, "Frontend", "style.css");
const styleMinPath = path.join(__dirname, "Frontend", "style.min.css");
const styleCode = fs.readFileSync(stylePath, "utf-8");
fs.writeFileSync(styleMinPath, minifyCSS(styleCode));
console.log("✓ style.min.css criado");

// Minify tv.js
const tvPath = path.join(__dirname, "Frontend", "tv", "tv.js");
const tvMinPath = path.join(__dirname, "Frontend", "tv", "tv.min.js");
const tvCode = fs.readFileSync(tvPath, "utf-8");
fs.writeFileSync(tvMinPath, minifyJS(tvCode));
console.log("✓ tv.min.js criado");

// Minify tv.css
const tvCssPath = path.join(__dirname, "Frontend", "tv", "tv.css");
const tvCssMinPath = path.join(__dirname, "Frontend", "tv", "tv.min.css");
const tvCssCode = fs.readFileSync(tvCssPath, "utf-8");
fs.writeFileSync(tvCssMinPath, minifyCSS(tvCssCode));
console.log("✓ tv.min.css criado");

console.log("\n✓ Todos os arquivos foram minificados com sucesso!");
