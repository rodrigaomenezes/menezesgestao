// Lint com as lições do sistema de origem: sem innerHTML, sem setInterval para rotinas, sem globais no front.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const proibidosEmTodoLugar = [
  { selector: "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]", message: "innerHTML é proibido (risco de XSS). Monte a tela com componentes." },
  { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: "insertAdjacentHTML é proibido (risco de XSS)." },
  { selector: "CallExpression[callee.object.name='document'][callee.property.name=/^write(ln)?$/]", message: "document.write é proibido." },
  { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "dangerouslySetInnerHTML é proibido (risco de XSS)." },
  { selector: "CallExpression[callee.name='eval']", message: "eval é proibido." },
];

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "coverage/", "playwright-report/", "test-results/", "web/dev-dist/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-restricted-syntax": ["error", ...proibidosEmTodoLugar],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.ts", "e2e/**/*.ts", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
    rules: {
      "no-restricted-syntax": [
        "error",
        ...proibidosEmTodoLugar,
        {
          selector: "CallExpression[callee.name='setInterval']",
          message: "Rotina periódica vai para a fila de jobs (pg-boss), não setInterval: com duas instâncias ela rodaria duas vezes.",
        },
      ],
    },
  },
  {
    files: ["web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-syntax": [
        "error",
        ...proibidosEmTodoLugar,
        { selector: "AssignmentExpression > MemberExpression[object.name=/^(window|globalThis|self)$/]", message: "Nada de variáveis globais no front." },
      ],
      "no-restricted-globals": ["error", { name: "localStorage", message: "Dados ficam no servidor; use estado do React." }],
    },
  },
);
