// .mjs on purpose: package.json has no "type": "module" (the compiled output
// is CommonJS), so a plain .js file here would be parsed as CommonJS by Node
// and reject the `import` syntax below.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    rules: {
      // The codebase reaches for `any` deliberately at a few boundaries —
      // Sequelize association includes, caught errors before narrowing —
      // where a precise type would need more ceremony than it buys.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
