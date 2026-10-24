import tseslint from "typescript-eslint";
import cleanCode from "./eslint-clean-code.mjs";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "web-ext-artifacts/**", "coverage/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  cleanCode,
);
