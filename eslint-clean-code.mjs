// Clean-code limits (dev-playbook CLEAN-CODE.md §3). Functions 4–20 lines; this repo has no
// React components, so the per-function limit is the strict 20, not 40.
export default {
  files: ["**/*.{js,mjs,cjs,ts}"],
  ignores: ["**/*.test.*", "**/*.spec.*", "tests/**", "e2e/**", "scripts/**"],
  rules: {
    // Files ≤500 lines, hard limit. Target ≤300 (checked by scripts/clean-code-audit).
    "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
    "max-lines-per-function": [
      "error",
      { max: 20, skipBlankLines: true, skipComments: true, IIFEs: true },
    ],
    // Article: max 2 levels of indentation. eslint counts nested blocks; 3 ≈ two levels inside a function body.
    "max-depth": ["error", 3],
    complexity: ["warn", 10],
    "max-params": ["warn", 4],
    "no-nested-ternary": "error",
  },
};
