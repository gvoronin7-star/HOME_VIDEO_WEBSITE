import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Targets the React Compiler's stricter effect model — flags the
      // ordinary "fetch on mount" pattern this app uses throughout
      // (useEffect calling an async function that eventually setStates).
      // That pattern is safe without the compiler, and rewriting every
      // data-fetching effect to dodge it is a bigger change than a lint
      // pass warrants.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  prettierConfig,
);
