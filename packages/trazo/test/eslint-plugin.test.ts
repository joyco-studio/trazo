import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";

import plugin from "../src/eslint/index.js";

// Wire RuleTester's lifecycle hooks to vitest so `ruleTester.run` registers
// real test cases in this file.
RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const IMPORT = 'import { flow, git, seq, block, parseFlow } from "@joycostudio/trazo";\n';

// ── flow: binding-awareness is exercised most thoroughly here ─────────────────

ruleTester.run("valid-flow-dsl", plugin.rules["valid-flow-dsl"], {
  valid: [
    // Well-formed flow through a direct import.
    { code: `${IMPORT}flow\`flow LR\nA --> B\`;` },
    // A `flow` tag that was never imported from trazo — not ours, ignore it.
    { code: "flow`end`;" },
    // A `flow` tag imported from an unrelated package — ignore it.
    { code: 'import { flow } from "other-lib";\nflow`end`;' },
    // Interpolated template — the final string is unknown statically, skip it.
    { code: `${IMPORT}const x = 1;\nflow\`end \${x}\`;` },
    // parseFlow with a well-formed string argument.
    { code: `${IMPORT}parseFlow("flow LR\\nA --> B");` },
    // A local that SHADOWS the import is not the trazo tag — no false positive.
    { code: `${IMPORT}function render(flow) {\n  return flow\`end\`;\n}` },
    { code: `${IMPORT}function render() {\n  const flow = String.raw;\n  return flow\`end\`;\n}` },
  ],
  invalid: [
    // Malformed flow in a tagged template.
    { code: `${IMPORT}flow\`end\`;`, errors: 1 },
    // Aliased import still resolves to the trazo `flow` export.
    { code: 'import { flow as f } from "@joycostudio/trazo";\nf`end`;', errors: 1 },
    // Namespace import member access resolves too.
    { code: 'import * as t from "@joycostudio/trazo";\nt.flow`end`;', errors: 1 },
    // Malformed flow passed to parseFlow().
    { code: `${IMPORT}parseFlow("end");`, errors: 1 },
    // Namespace parser call.
    { code: 'import * as t from "@joycostudio/trazo";\nt.parseFlow("end");', errors: 1 },
    // Computed namespace access resolves to the same export as dot access.
    { code: 'import * as t from "@joycostudio/trazo";\nt["parseFlow"]("end");', errors: 1 },
    { code: 'import * as t from "@joycostudio/trazo";\nt["flow"]`end`;', errors: 1 },
    // A custom module specifier via rule options.
    {
      code: 'import { flow } from "#trazo";\nflow`end`;',
      options: [{ modules: ["#trazo"] }],
      errors: 1,
    },
  ],
});

// ── git / sequence / block: prove the new-DSL coverage extension ──────────────

ruleTester.run("valid-git-dsl", plugin.rules["valid-git-dsl"], {
  valid: [{ code: `${IMPORT}git\`commit : init\`;` }],
  invalid: [{ code: `${IMPORT}git\`checkout ghost\`;`, errors: 1 }],
});

ruleTester.run("valid-sequence-dsl", plugin.rules["valid-sequence-dsl"], {
  valid: [{ code: `${IMPORT}seq\`participant A\nA ->> B : hi\`;` }],
  invalid: [{ code: `${IMPORT}seq\`@@@\`;`, errors: 1 }],
});

ruleTester.run("valid-block-dsl", plugin.rules["valid-block-dsl"], {
  valid: [{ code: `${IMPORT}block\`columns 2\nA["x"]\`;` }],
  invalid: [{ code: `${IMPORT}block\`@@@\`;`, errors: 1 }],
});
