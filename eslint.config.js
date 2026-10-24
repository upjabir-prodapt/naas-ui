import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },

  /*
   * Architectural boundary, the same one the hub enforces on src/usecases/:
   * the platform is reached only through @aicoe/aihub-platform's public
   * subpath exports (/shell, /auth, /api, /ui, ...). Its internals are not an
   * API and move between releases without notice.
   */
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@aicoe/aihub-platform/dist/*',
                '@aicoe/aihub-platform/dist/**',
                '@aicoe/aihub-platform/src/*',
                '@aicoe/aihub-platform/src/**',
              ],
              message:
                'Import the platform through its package exports (@aicoe/aihub-platform/<subpath>), not its build output.',
            },
          ],
        },
      ],
    },
  },
])
