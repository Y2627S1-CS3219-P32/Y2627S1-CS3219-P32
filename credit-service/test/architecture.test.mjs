import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API } from "typescript/unstable/sync";
import {
  isImportDeclaration,
  isNamedImports,
  SyntaxKind,
} from "typescript/unstable/ast";

const root = fileURLToPath(new URL("..", import.meta.url));

test("transport, business services, and persistence respect their boundaries", () => {
  const violations = [];
  if (existsSync(join(root, "src/credit")))
    violations.push("src/credit must be replaced by responsibility-based modules");
  for (const legacy of ["http", "events"])
    if (existsSync(join(root, `src/${legacy}`)))
      violations.push(`src/${legacy} must be replaced by explicit handler boundaries`);
  if (existsSync(join(root, "src/services/api.ts")))
    violations.push("services must export business functions without an aggregate API contract");
  const api = new API({ cwd: root });
  try {
    const snapshot = api.updateSnapshot({
      openProjects: [join(root, "tsconfig.json")],
    });
    const project = snapshot.getProject(join(root, "tsconfig.json"));
    assert.ok(project, "credit-service TypeScript project must load");
    for (const file of project.rootFiles) {
      const source = project.program.getSourceFile(file);
      const name = relative(join(root, "src"), file);
      const persistence = /^(repositories|db)\//.test(name);
      const service = name.startsWith("services/");
      for (const node of source.statements.filter(isImportDeclaration)) {
        const specifier = node.moduleSpecifier.text;
        const target = specifier.startsWith(".")
          ? relative(join(root, "src"), resolve(dirname(file), specifier))
          : specifier;
        if (target === "services/api.js")
          violations.push(`${name} imports a service contract; import business functions directly`);
        if (name === "app.ts" && /^(services|repositories|db)\//.test(target))
          violations.push(`app.ts imports ${specifier}; mount HTTP routes instead`);
        if (
          service &&
          (/^(http-handler|event-handler)\//.test(target) || target === "express")
        )
          violations.push(`${name} imports ${specifier}; services must be transport-independent`);
        const imports = node.importClause?.namedBindings;
        if (service && imports && isNamedImports(imports) &&
          imports.elements.some((element) => element.name.text === "UserEvent"))
          violations.push(`${name} imports UserEvent; use account operation inputs`);
        const clause = node.importClause;
        if (clause?.phaseModifier === SyntaxKind.TypeKeyword) continue;
        const bindings = clause?.namedBindings;
        if (
          !clause?.name && bindings && isNamedImports(bindings) &&
          bindings.elements.every((element) => element.isTypeOnly)
        ) continue;
        if (
          !persistence &&
          (/^(drizzle-orm|pg)(\/|$)/.test(target) || target === "db/schema.js")
        )
          violations.push(`${name} imports ${specifier}; SQL belongs in repositories/db`);
        if (/^credit\//.test(target))
          violations.push(`${name} imports legacy ${specifier}; use responsibility-based modules`);
      }
    }
  } finally {
    api.close();
  }
  assert.deepEqual(violations, []);
});
