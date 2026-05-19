const fs = require("fs");
const path = require("path");
const UglifyJS = require("./Frontend/node_modules/uglify-js");
const CleanCSS = require("./Frontend/node_modules/clean-css");

function minifyJSFile(source, target) {
  const code = fs.readFileSync(source, "utf-8");
  const result = UglifyJS.minify(code, {
    compress: true,
    mangle: true,
  });

  if (result.error) throw result.error;

  fs.writeFileSync(target, result.code);
  console.log(`✓ ${path.relative(__dirname, target)} criado`);
}

function minifyCSSFile(source, target) {
  const code = fs.readFileSync(source, "utf-8");
  const result = new CleanCSS({ level: 2 }).minify(code);

  if (result.errors.length) throw new Error(result.errors.join("\n"));

  fs.writeFileSync(target, result.styles);
  console.log(`✓ ${path.relative(__dirname, target)} criado`);
}

minifyJSFile(
  path.join(__dirname, "Frontend", "script.js"),
  path.join(__dirname, "Frontend", "script.min.js"),
);

minifyCSSFile(
  path.join(__dirname, "Frontend", "style.css"),
  path.join(__dirname, "Frontend", "style.min.css"),
);

minifyJSFile(
  path.join(__dirname, "Frontend", "historico", "historico.js"),
  path.join(__dirname, "Frontend", "historico", "historico.min.js"),
);

minifyCSSFile(
  path.join(__dirname, "Frontend", "historico", "historico.css"),
  path.join(__dirname, "Frontend", "historico", "historico.min.css"),
);

minifyJSFile(
  path.join(__dirname, "Frontend", "tv", "tv.js"),
  path.join(__dirname, "Frontend", "tv", "tv.min.js"),
);

minifyCSSFile(
  path.join(__dirname, "Frontend", "tv", "tv.css"),
  path.join(__dirname, "Frontend", "tv", "tv.min.css"),
);

console.log("\n✓ Todos os arquivos foram minificados com segurança.");
