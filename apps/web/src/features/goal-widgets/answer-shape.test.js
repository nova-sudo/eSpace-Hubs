import test from "node:test";
import assert from "node:assert/strict";

import {
  answerProblem,
  boundPlaceholder,
  contextAnswerKinds,
  normalizeBoundAnswer,
} from "./state-shells/answer-shape.js";

/**
 * The setup form must refuse — with a reason — exactly what the API's
 * executor would refuse, and repair what a person types by habit. The
 * reported failure: a "framework-path" question accepted any text, then
 * every tile fed by it showed `context_answer_rejected`.
 */

const spec = {
  kind: "COMPOSED",
  context: {
    required: true,
    questions: [
      { id: "repo", kind: "repo_select", prompt: "Which repos?" },
      { id: "framework-path", kind: "text", prompt: "Where does the framework live?" },
      { id: "standard", kind: "text", prompt: "What is your quality bar?" },
    ],
  },
  fields: [
    {
      id: "present",
      kind: "checkbox",
      label: "Framework present",
      source: {
        provider: "github",
        query: "repo_file_exists",
        params: { repo: "{{ctx:repo}}", path: "{{ctx:framework-path}}" },
        extract: "exists",
      },
    },
  ],
};
const kinds = contextAnswerKinds(spec);
const pathQ = spec.context.questions[1];
const freeQ = spec.context.questions[2];

test("a bound text question is normalized the way a person types paths", () => {
  assert.equal(normalizeBoundAnswer(pathQ, "/src/framework/", kinds[pathQ.id]), "src/framework");
  assert.equal(normalizeBoundAnswer(pathQ, "./docs/framework.md", kinds[pathQ.id]), "docs/framework.md");
  // Free text is untouched beyond what the form already does.
  assert.equal(normalizeBoundAnswer(freeQ, "  /anything goes ", kinds[freeQ.id]), "  /anything goes ");
});

test("answerProblem names the rule only for what normalization cannot repair", () => {
  assert.equal(answerProblem(pathQ, "/src/framework/", kinds[pathQ.id]), null);
  assert.equal(answerProblem(pathQ, "docs/my framework.md", kinds[pathQ.id]), null);
  assert.match(answerProblem(pathQ, "../framework", kinds[pathQ.id]), /relative to the repository root/);
  assert.match(answerProblem(pathQ, "https://github.com/x/y/blob/main/f.md", kinds[pathQ.id]), /no URL/);
  assert.match(answerProblem(pathQ, "C:\\framework", kinds[pathQ.id]), /relative/);
  // Empty is "unanswered", not a shape problem; free text never has one.
  assert.equal(answerProblem(pathQ, "", kinds[pathQ.id]), null);
  assert.equal(answerProblem(freeQ, "../whatever", kinds[freeQ.id]), null);
});

test("a bound question without a placeholder shows the kind's example", () => {
  assert.equal(boundPlaceholder(pathQ, kinds[pathQ.id]), "docs/framework.md");
  assert.equal(boundPlaceholder({ ...pathQ, placeholder: "src/core" }, kinds[pathQ.id]), "src/core");
  assert.equal(boundPlaceholder(freeQ, kinds[freeQ.id]), "");
});
