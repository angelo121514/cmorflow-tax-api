const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  validateRepository,
  gitDiff,
  repoPath,
  relevantChange,
} = require("../../scripts/check-sdd-traceability.cjs");
const {
  privateFile,
  checkRepository,
} = require("../../scripts/check-repository.cjs");

const FENCE = String.fromCharCode(96).repeat(3);
const RECORD = "docs/spec/changes/0001-example.md";
function write(root, file, value) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    typeof value === "string" ? value : JSON.stringify(value),
  );
}
function record(data) {
  return (
    "# Cambio verificable\n\n" +
    "## Problema y resultado esperado\n\nEl integrador necesita un resultado reproducible con aislamiento entre tenants.\n\n" +
    "## Especificación y decisiones\n\nLa regla F-01 define el resultado observable que debe conservarse.\n\n" +
    "## Criterios de aceptación\n\n- [ ] La consulta devuelve un resultado estable para el tenant autenticado.\n\n" +
    "## Pruebas y trazabilidad\n\nSe ejecutan pruebas que verifican el criterio observado.\n\n" +
    FENCE +
    "sdd\n" +
    JSON.stringify(data, null, 2) +
    "\n" +
    FENCE +
    "\n\n" +
    "## Riesgos y responsables\n\nBackend revisa compatibilidad y recuperación antes de integrar el cambio.\n"
  );
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmor-sdd-test-"));
  t.after(() => {
    // Check the absolute temp target before recursive cleanup on Windows.
    if (
      path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith("cmor-sdd-test-")
    )
      throw new Error("Unsafe cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  });
  const data = {
    features: ["F-01"],
    specs: ["docs/spec/FEATURES.md"],
    code: ["src/app.ts"],
    tests: ["src/app.spec.ts"],
    removed: [],
  };
  write(root, "src/app.ts", "export const result = 1;");
  write(root, "src/app.spec.ts", "// fixture test reference");
  write(root, "docs/spec/FEATURES.md", "# Features\n\n## F-01 — Emitir\n");
  write(
    root,
    "docs/spec/TRACEABILITY.md",
    "| Feature | Spec | Código | API | Base de datos | Tests |\n|---|---|---|---|---|---|\n| Emitir | [FEATURES F-01](FEATURES.md) | [app](../../src/app.ts) | GET /example | requests | [test](../../src/app.spec.ts) |\n",
  );
  write(
    root,
    "docs/spec/SPEC_INDEX.md",
    "| Feature | Especificación | API | Tablas | Código principal | Tests identificados |\n|---|---|---|---|---|---|\n| F-01 | [FEATURES F-01](FEATURES.md) | GET /example | requests | [app](../../src/app.ts) | [test](../../src/app.spec.ts) |\n",
  );
  write(
    root,
    "docs/spec/TECHNICAL_DEBT.md",
    "| Área | Hallazgo | Evidencia | Estado | Responsable | Motivo/pendiente |\n|---|---|---|---|---|---|\n| Tax | Aprobación | Decisión registrada | Bloqueado | Tributario | Obtener evidencia vigente |\n",
  );
  write(root, "docs/spec/CHANGE_TEMPLATE.md", record(data));
  write(root, RECORD, record(data));
  const openapi = {
    paths: {
      "/example": {
        get: {
          description: "Consulta pública de ejemplo",
          security: [],
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Result" },
                },
              },
            },
            400: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiErrorResponse" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Result: { type: "object", properties: { result: { type: "number" } } },
        ApiErrorResponse: {
          type: "object",
          properties: { message: { type: "string" } },
        },
      },
    },
  };
  write(root, "ohbs-openapi.json", openapi);
  return { root, data, openapi };
}
function hasError(result, pattern) {
  assert.ok(
    result.errors.some((message) => pattern.test(message)),
    result.errors.join("\n"),
  );
}
test("accepts a source change covered by a changed specification with existing references", (t) => {
  const { root } = fixture(t);
  const result = validateRepository(root, {
    changed: ["src/app.ts", RECORD],
    deleted: [],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.checkedDiff, true);
});
test("rejects source changes when an old unchanged record is the only documentation", (t) => {
  const { root } = fixture(t);
  hasError(
    validateRepository(root, { changed: ["src/app.ts"], deleted: [] }),
    /sin ficha SDD/,
  );
});
test("rejects a record that omits another changed source file", (t) => {
  const { root } = fixture(t);
  write(root, "src/other.ts", "export const other = 2;");
  hasError(
    validateRepository(root, {
      changed: ["src/other.ts", RECORD],
      deleted: [],
    }),
    /Cambio sin trazabilidad.*other/,
  );
});
test("rejects a test reference that does not exist", (t) => {
  const { root, data } = fixture(t);
  data.tests = ["src/missing.spec.ts"];
  write(root, RECORD, record(data));
  hasError(validateRepository(root), /archivo inexistente.*missing/);
});
test("rejects broken links in the current feature matrix", (t) => {
  const { root } = fixture(t);
  const file = path.join(root, "docs/spec/TRACEABILITY.md");
  fs.writeFileSync(
    file,
    fs.readFileSync(file, "utf8").replace("app.spec.ts", "deleted.spec.ts"),
  );
  hasError(validateRepository(root), /archivo inexistente.*deleted/);
});
test("rejects unknown features in change metadata", (t) => {
  const { root, data } = fixture(t);
  data.features = ["F-99"];
  write(root, RECORD, record(data));
  hasError(validateRepository(root), /feature desconocida F-99/);
});
test("requires a concrete reason for changes that do not need tests", (t) => {
  const { root, data } = fixture(t);
  data.tests = [];
  write(root, RECORD, record(data));
  hasError(validateRepository(root), /testExemption/);
  data.testExemption =
    "Sólo se corrige un comentario; el comportamiento ejecutable no cambia.";
  write(root, RECORD, record(data));
  assert.deepEqual(validateRepository(root).errors, []);
});
test("allows editorial documentation changes without a changed SDD record", (t) => {
  const { root } = fixture(t);
  assert.deepEqual(
    validateRepository(root, { changed: ["README.md"], deleted: [] }).errors,
    [],
  );
});
test("requires traceability for private file guards and runtime configuration", () => {
  for (const file of [
    ".gitignore",
    ".dockerignore",
    ".nvmrc",
    "render.yaml",
    "package-lock.json",
  ])
    assert.equal(relevantChange(file), true);
  assert.equal(relevantChange("docs/README.md"), false);
});
test("accepts a declared deletion and rejects fabricated deletions", (t) => {
  const { root, data } = fixture(t);
  data.removed = ["src/old.ts"];
  write(root, RECORD, record(data));
  assert.deepEqual(
    validateRepository(root, {
      changed: ["src/old.ts", RECORD],
      deleted: ["src/old.ts"],
    }).errors,
    [],
  );
  hasError(
    validateRepository(root, { changed: [RECORD], deleted: [] }),
    /removed no es una eliminación/,
  );
});
test("rejects generic OpenAPI responses and unresolved references", (t) => {
  const { root, openapi } = fixture(t);
  openapi.components.schemas.Result = {
    type: "object",
    additionalProperties: true,
  };
  write(root, "ohbs-openapi.json", openapi);
  hasError(validateRepository(root), /objeto genérico/);
  delete openapi.components.schemas.Result;
  write(root, "ohbs-openapi.json", openapi);
  hasError(validateRepository(root), /referencia inexistente/);
});
test("rejects an operation without explicit security", (t) => {
  const { root, openapi } = fixture(t);
  delete openapi.paths["/example"].get.security;
  write(root, "ohbs-openapi.json", openapi);
  hasError(validateRepository(root), /falta security/);
});
test("rejects malformed metadata instead of crashing", (t) => {
  const { root, data } = fixture(t);
  data.code = "src/app.ts";
  write(root, RECORD, record(data));
  hasError(
    validateRepository(root, { changed: [RECORD, "src/app.ts"], deleted: [] }),
    /deben ser listas/,
  );
});
test("validates ownership and state in every technical debt table", (t) => {
  const { root } = fixture(t);
  fs.appendFileSync(
    path.join(root, "docs/spec/TECHNICAL_DEBT.md"),
    "\n## Seguimiento\n\n| Área | Hallazgo | Evidencia | Estado | Responsable | Motivo/pendiente |\n|---|---|---|---|---|---|\n| DB | Riesgo nuevo | Lock no suficiente | Pendiente | | Preparar una corrección |\n",
  );
  hasError(validateRepository(root), /Deuda: fila.*incompleta/);
});
test("prevents references that escape the repository", () => {
  const root = path.resolve(os.tmpdir(), "cmor-sdd-path-root");
  assert.throws(
    () => repoPath(root, "../private.txt"),
    /fuera del repositorio/,
  );
  assert.throws(
    () => repoPath(root, "https://example.com/test.spec.ts"),
    /inválida/,
  );
});
test("includes tracked edits and new files when checking the worktree", (t) => {
  const { root } = fixture(t);
  execFileSync("git", ["init"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["add", "."], { cwd: root, stdio: "pipe" });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=SDD Test",
      "-c",
      "user.email=sdd@example.invalid",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd: root, stdio: "pipe" },
  );
  write(root, "src/app.ts", "export const result = 2;");
  write(root, "scripts/new.cjs", "module.exports = 1;");
  const result = gitDiff(root, "HEAD", true);
  assert.ok(result.changed.includes("src/app.ts"));
  assert.ok(result.changed.includes("scripts/new.cjs"));
});
test("flags private filenames while allowing examples and public trust certificates", () => {
  for (const file of [
    ".env",
    ".env.local",
    "certs/tenant.pfx",
    "certs/private.key",
  ])
    assert.equal(privateFile(file), true);
  for (const file of [
    ".env.example",
    "certs/supabase-root-ca.crt",
    "src/main.ts",
  ])
    assert.equal(privateFile(file), false);
});
test("checks Git ignore behavior and detects a forcibly tracked environment file", (t) => {
  const { root } = fixture(t);
  execFileSync("git", ["init"], { cwd: root, stdio: "pipe" });
  write(
    root,
    ".gitignore",
    ".env\n.env.*\n!.env.example\n*.pfx\n*.p12\n*.key\n",
  );
  write(
    root,
    ".dockerignore",
    ".env\n.env.*\n*.pfx\n*.p12\n*.key\n**/.env\n**/.env.*\n**/*.pfx\n**/*.p12\n**/*.key\n",
  );
  assert.deepEqual(checkRepository(root), []);
  const dockerFile = path.join(root, ".dockerignore");
  const protectedDocker = fs.readFileSync(dockerFile, "utf8");
  fs.writeFileSync(dockerFile, protectedDocker.replace("**/*.key\n", ""));
  assert.ok(
    checkRepository(root).some((message) => message.includes("**/*.key")),
  );
  fs.writeFileSync(dockerFile, protectedDocker);
  write(root, ".env.local", "SYNTHETIC=fixture");
  execFileSync("git", ["add", "-f", ".env.local"], {
    cwd: root,
    stdio: "pipe",
  });
  assert.ok(
    checkRepository(root).some((message) =>
      message.includes("Archivo privado versionado: .env.local"),
    ),
  );
});
