const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function privateFile(file) {
  const value = file.replace(/\\/g, "/").toLowerCase();
  return (
    (/(^|\/)\.env($|\.)/.test(value) && !/(^|\/)\.env\.example$/.test(value)) ||
    /\.(pfx|p12|key|dump|backup)$/.test(value)
  );
}
function checkRepository(root) {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const errors = tracked
    .filter(privateFile)
    .map((file) => "Archivo privado versionado: " + file);
  const examples = [
    ".env",
    ".env.local",
    ".env.production",
    "local-certificate.pfx",
    "local-certificate.p12",
    "local-private.key",
  ];
  let ignored = [];
  try {
    ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
      cwd: root,
      input: examples.join("\n") + "\n.env.example\n",
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  for (const file of examples)
    if (!ignored.includes(file)) errors.push(".gitignore no protege " + file);
  if (ignored.includes(".env.example"))
    errors.push(".env.example debe permanecer versionable.");
  const dockerignore = fs
    .readFileSync(path.join(root, ".dockerignore"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim());
  for (const pattern of [
    ".env",
    ".env.*",
    "*.pfx",
    "*.p12",
    "*.key",
    "**/.env",
    "**/.env.*",
    "**/*.pfx",
    "**/*.p12",
    "**/*.key",
  ]) {
    if (!dockerignore.includes(pattern))
      errors.push(".dockerignore no excluye " + pattern);
  }
  return errors;
}
module.exports = { privateFile, checkRepository };
if (require.main === module) {
  try {
    const errors = checkRepository(path.resolve(__dirname, ".."));
    if (errors.length) {
      errors.forEach((error) => console.error("Repo: " + error));
      process.exitCode = 1;
    } else
      console.log(
        "Repo: archivos privados protegidos en Git/contexto Docker; sin nombres privados versionados. No es un escaneo de contenido o historial.",
      );
  } catch (error) {
    console.error("Repo: " + error.message);
    process.exitCode = 1;
  }
}
