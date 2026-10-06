import tseslint from 'typescript-eslint'

/**
 * Only the rules that catch async mistakes. The server went from synchronous SQLite to
 * asynchronous Postgres; a forgotten `await` is the bug that type checking alone can miss.
 */
export default tseslint.config({
  files: ['src/server/**/*.ts', 'api/**/*.ts'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { project: './tsconfig.node.json', tsconfigRootDir: import.meta.dirname }
  },
  plugins: { '@typescript-eslint': tseslint.plugin },
  rules: {
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/require-await': 'off',
    '@typescript-eslint/return-await': ['error', 'in-try-catch']
  }
})
