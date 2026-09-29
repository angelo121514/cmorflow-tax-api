const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CHANGE_DIR = "docs/spec/changes";
const FENCE = String.fromCharCode(96).repeat(3);
const SECTIONS = [
  "Problema y resultado esperado",
  "Especificación y decisiones",
  "Criterios de aceptación",
  "Pruebas y trazabilidad",
  "Riesgos y responsables",
];
const TEST_PATH = /(\.spec\.ts|\.e2e-spec\.ts|\.test\.cjs)$/;

function repoPath(root, ref) {
  if (
    typeof ref !== "string" ||
    !ref ||
    /[\\#?*]/.test(ref) ||
    path.isAbsolute(ref) ||
    /^[a-z]+:/i.test(ref)
  )
    throw new Error("Referencia inválida: " + String(ref));
  const absolute = path.resolve(root, ref);
  if (!absolute.startsWith(root + path.sep))
    throw new Error("Referencia fuera del repositorio: " + ref);
  return absolute;
}
function relevantChange(file) {
  return (
    /^(src|test|scripts)\//.test(file) ||
    /^\.github\/workflows\//.test(file) ||
    /^(package(-lock)?\.json|Dockerfile|docker-compose\.yml|render\.yaml|tsconfig.*\.json|start-.*\.js|\.env\.example|\.gitignore|\.dockerignore|\.nvmrc|ohbs-openapi\.json)$/.test(
      file,
    )
  );
}
function tableRows(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("|"));
  if (start < 0) return [];
  const rows = [];
  for (const line of lines.slice(start)) {
    if (!line.startsWith("|")) break;
    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}
function validateRepository(root, diff) {
  root = path.resolve(root);
  const errors = [];
  const fail = (message) => errors.push(message);
  const read = (file) => {
    try {
      return fs.readFileSync(repoPath(root, file), "utf8");
    } catch {
      fail("No se puede leer " + file);
      return "";
    }
  };
  const featureIds = [
    ...read("docs/spec/FEATURES.md").matchAll(/^##\s+(F-\d+)/gm),
  ].map((m) => m[1]);
  const known = new Set(featureIds);
  if (!featureIds.length || known.size !== featureIds.length)
    fail("FEATURES.md debe declarar IDs únicos F-xx.");
  const checkRef = (ref, label, removed = new Set()) => {
    try {
      const absolute = repoPath(root, ref);
      if (
        (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) &&
        !removed.has(ref)
      )
        fail(label + ": archivo inexistente " + ref);
    } catch (error) {
      fail(label + ": " + error.message);
    }
  };
  function checkTable(file, codeCol) {
    const rows = tableRows(read(file));
    if (
      rows[0]?.length !== 6 ||
      !["Tests", "Tests identificados"].includes(rows[0]?.[5])
    )
      fail(file + ": matriz debe tener seis columnas y pruebas.");
    const found = new Set();
    for (const [i, row] of rows.slice(2).entries()) {
      const label = file + ": fila " + (i + 3);
      if (row.length !== 6 || row.some((cell) => !cell)) {
        fail(label + ": columna vacía o inválida.");
        continue;
      }
      const ids = [...row[1].matchAll(/\bF-\d+\b/g)].map((m) => m[0]);
      if (!ids.length) fail(label + ": falta ID de feature.");
      for (const id of ids) {
        if (!known.has(id)) fail(label + ": feature desconocida " + id);
        found.add(id);
      }
      for (const col of [1, codeCol, 5]) {
        const refs = [...row[col].matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(
          (m) => m[1],
        );
        if (
          !refs.length &&
          !(col === 5 && /^Brecha:\s*\S[\s\S]{20,}/.test(row[col]))
        )
          fail(label + ": faltan enlaces verificables en columna " + (col + 1));
        for (const ref of refs) {
          if (/^[a-z]+:/i.test(ref)) {
            fail(label + ": enlace externo en trazabilidad " + ref);
            continue;
          }
          const [filename] = ref.split("#");
          const relative = path
            .relative(root, path.resolve(root, path.dirname(file), filename))
            .replace(/\\/g, "/");
          checkRef(relative, label);
          if (col === 1 && !/^docs\/spec\/.*\.md$/.test(relative))
            fail(label + ": spec inválida " + ref);
          if (col === 5 && !TEST_PATH.test(relative))
            fail(label + ": no es un archivo de prueba " + ref);
        }
      }
    }
    for (const id of known) if (!found.has(id)) fail(file + ": falta " + id);
    return rows.length - 2;
  }
  const traceRows = checkTable("docs/spec/TRACEABILITY.md", 2);
  checkTable("docs/spec/SPEC_INDEX.md", 4);
  const template = read("docs/spec/CHANGE_TEMPLATE.md");
  for (const section of SECTIONS)
    if (!template.includes("## " + section))
      fail("Plantilla: falta sección " + section);
  if (!template.includes(FENCE + "sdd"))
    fail("Plantilla: falta bloque de referencias sdd.");
  const debtTables = read("docs/spec/TECHNICAL_DEBT.md")
    .split(/\r?\n[ \t]*\r?\n/)
    .map(tableRows)
    .filter((rows) => rows.length);
  if (!debtTables.length) fail("Deuda: falta matriz de seguimiento.");
  for (const debt of debtTables) {
    if (
      debt[0]?.length !== 6 ||
      !["Estado", "Responsable", "Motivo/pendiente"].every((field) =>
        debt[0]?.includes(field),
      )
    )
      fail("Deuda: faltan estado, responsable y motivo.");
    debt.slice(2).forEach((row, i) => {
      if (row.length !== 6 || row.some((cell) => !cell))
        fail("Deuda: fila " + (i + 3) + " incompleta.");
    });
  }

  const records = [];
  const dir = path.join(root, CHANGE_DIR);
  if (fs.existsSync(dir))
    for (const name of fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".md"))) {
      const file = CHANGE_DIR + "/" + name;
      const text = read(file);
      try {
        const blocks = [
          ...text.matchAll(
            new RegExp(FENCE + "sdd\\s*\\r?\\n([\\s\\S]*?)" + FENCE, "g"),
          ),
        ];
        if (blocks.length !== 1)
          throw new Error("se exige un único bloque JSON sdd.");
        const data = JSON.parse(blocks[0][1]);
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw new Error("metadata SDD inválida.");
        records.push({ file, text, data });
      } catch (error) {
        fail(file + ": " + error.message);
      }
    }
  // Deletions recorded by later changes preserve valid historical references.
  const removed = new Set(
    records.flatMap(({ data }) =>
      Array.isArray(data.removed) ? data.removed : [],
    ),
  );
  for (const { file, text, data } of records) {
    const arraysValid = ["features", "specs", "code", "tests"].every(
      (field) =>
        Array.isArray(data[field]) &&
        data[field].every((value) => typeof value === "string"),
    );
    if (
      !arraysValid ||
      (data.removed !== undefined &&
        (!Array.isArray(data.removed) ||
          data.removed.some((ref) => typeof ref !== "string")))
    ) {
      fail(file + ": features/specs/code/tests/removed deben ser listas.");
      continue;
    }
    if (!data.features.length || !data.specs.length)
      fail(file + ": features y specs no pueden estar vacíos.");
    for (const id of data.features)
      if (!known.has(id)) fail(file + ": feature desconocida " + id);
    for (const ref of [...data.code, ...data.tests])
      checkRef(ref, file, removed);
    for (const ref of data.specs) {
      checkRef(ref, file);
      if (!/^docs\/spec\/.*\.md$/.test(ref))
        fail(file + ": spec inválida " + ref);
    }
    for (const ref of data.removed || []) {
      try {
        repoPath(root, ref);
      } catch (error) {
        fail(file + ": " + error.message);
      }
    }
    for (const ref of data.tests)
      if (!TEST_PATH.test(ref)) fail(file + ": no es un test " + ref);
    if (
      !data.tests.length &&
      (typeof data.testExemption !== "string" ||
        data.testExemption.trim().length < 20)
    )
      fail(file + ": indicar pruebas o testExemption con motivo concreto.");
    for (const section of SECTIONS) {
      const lines = text.split(/\r?\n/);
      const start = lines.indexOf("## " + section);
      const next = lines.findIndex(
        (line, i) => i > start && line.startsWith("## "),
      );
      const body =
        start < 0
          ? ""
          : lines
              .slice(start + 1, next < 0 ? undefined : next)
              .join("\n")
              .trim();
      if (body.length < 20 || /<[^>]+>/.test(body))
        fail(file + ": sección incompleta " + section);
    }
    if (!/- \[[ xX]\] .{15,}/.test(text))
      fail(file + ": faltan criterios de aceptación observables.");
  }

  let openapi;
  try {
    openapi = JSON.parse(read("ohbs-openapi.json"));
  } catch {
    fail("OpenAPI no es JSON válido.");
  }
  if (openapi) {
    function visit(node) {
      if (!node || typeof node !== "object") return;
      if (node.$ref) {
        let target = openapi;
        if (!node.$ref.startsWith("#/"))
          fail("OpenAPI: referencia externa no verificada " + node.$ref);
        else {
          for (const part of node.$ref.slice(2).split("/"))
            target = target?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
          if (!target) fail("OpenAPI: referencia inexistente " + node.$ref);
        }
      }
      Object.values(node).forEach(visit);
    }
    visit(openapi);
    const schemas = openapi.components?.schemas || {};
    for (const [route, item] of Object.entries(openapi.paths || {}))
      for (const [method, op] of Object.entries(item)) {
        if (
          ![
            "get",
            "post",
            "put",
            "patch",
            "delete",
            "head",
            "options",
          ].includes(method)
        )
          continue;
        const label = method.toUpperCase() + " " + route;
        if (!Array.isArray(op.security))
          fail(label + ": falta security ([] para público).");
        else
          for (const requirement of op.security)
            for (const scheme of Object.keys(requirement))
              if (!openapi.components?.securitySchemes?.[scheme])
                fail(label + ": scheme desconocido " + scheme);
        if (!op.description) fail(label + ": falta descripción.");
        const responses = op.responses || {};
        const success = Object.entries(responses).filter(([status]) =>
          /^2\d\d$/.test(status),
        );
        if (!success.length) fail(label + ": falta respuesta exitosa.");
        for (const [, response] of success) {
          if (
            !Object.values(response.content || {}).some((media) => media.schema)
          )
            fail(label + ": falta schema exitoso.");
          for (const media of Object.values(response.content || {})) {
            const schema = media.schema?.$ref
              ? schemas[media.schema.$ref.split("/").pop()]
              : media.schema;
            if (
              schema?.type === "object" &&
              !Object.keys(schema.properties || {}).length
            )
              fail(label + ": respuesta es objeto genérico sin campos.");
          }
        }
        if (!Object.keys(responses).some((status) => /^[45]\d\d$/.test(status)))
          fail(label + ": faltan errores documentados.");
        if (op["x-required-permissions"]?.length && !op.security?.length)
          fail(label + ": permiso marcado público.");
        if (
          op.parameters?.some(
            (p) => p.name === "Idempotency-Key" && p.schema?.format === "uuid",
          )
        )
          fail(label + ": exige UUID para Idempotency-Key.");
      }
    if (!schemas.ApiErrorResponse) fail("OpenAPI no incluye ApiErrorResponse.");
  }

  if (diff) {
    const changed = new Set(diff.changed);
    const current = records.filter(({ file }) => changed.has(file));
    const relevant = diff.changed.filter(relevantChange);
    if (relevant.length && !current.length)
      fail(
        "Cambios relevantes sin ficha SDD nueva o actualizada en " + CHANGE_DIR,
      );
    const declared = new Set(
      current.flatMap(({ data }) => [
        ...(Array.isArray(data.code) ? data.code : []),
        ...(Array.isArray(data.tests) ? data.tests : []),
        ...(Array.isArray(data.removed) ? data.removed : []),
      ]),
    );
    for (const file of relevant)
      if (!declared.has(file))
        fail("Cambio sin trazabilidad en ficha SDD: " + file);
    for (const { file, data } of current)
      for (const ref of Array.isArray(data.removed) ? data.removed : [])
        if (!(diff.deleted || []).includes(ref))
          fail(file + ": removed no es una eliminación del diff: " + ref);
  }
  return {
    errors,
    features: known.size,
    traceRows,
    changes: records.length,
    checkedDiff: Boolean(diff),
  };
}

function gitDiff(root, base, worktree) {
  const git = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" })
      .split("\0")
      .filter(Boolean);
  if (/^0+$/.test(base))
    return {
      changed: git(["ls-tree", "-r", "--name-only", "-z", "HEAD"]),
      deleted: [],
    };
  execFileSync(
    "git",
    ["rev-parse", "--verify", "--end-of-options", base + "^{commit}"],
    { cwd: root, stdio: "pipe" },
  );
  const comparison = worktree ? [base] : [base, "HEAD"];
  const changed = git([
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    ...comparison,
    "--",
  ]);
  const deleted = git([
    "diff",
    "--name-only",
    "--no-renames",
    "--diff-filter=D",
    "-z",
    ...comparison,
    "--",
  ]);
  if (worktree)
    changed.push(...git(["ls-files", "--others", "--exclude-standard", "-z"]));
  return { changed: [...new Set(changed)], deleted };
}
function main() {
  const root = path.resolve(__dirname, "..");
  const args = process.argv.slice(2);
  const worktree = args.includes("--worktree");
  const index = args.indexOf("--base-ref");
  if (index >= 0 && !args[index + 1])
    throw new Error("--base-ref requiere un commit/ref.");
  const base =
    index >= 0
      ? args[index + 1]
      : process.env.SDD_BASE_REF || (worktree ? "HEAD" : undefined);
  if (process.env.CI && !base)
    throw new Error("CI requiere SDD_BASE_REF para comprobar el diff.");
  const result = validateRepository(
    root,
    base ? gitDiff(root, base, worktree) : undefined,
  );
  if (result.errors.length) {
    result.errors.forEach((e) => console.error("SDD: " + e));
    process.exitCode = 1;
    return;
  }
  console.log(
    "SDD: " +
      result.features +
      " features, " +
      result.traceRows +
      " filas con referencias reales y " +
      result.changes +
      " fichas válidas.",
  );
  console.log(
    result.checkedDiff
      ? "Diff verificado: todos los cambios relevantes están declarados."
      : "Validación estructural; use --base-ref <ref> --worktree para revisar cambios locales.",
  );
}
module.exports = { validateRepository, gitDiff, relevantChange, repoPath };
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("SDD: " + error.message);
    process.exitCode = 1;
  }
}
