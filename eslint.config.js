import eslintJs from '@eslint/js'
import typescript from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import globals from 'globals'

export default [
  // Base TS rules
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2020,
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
    },
    rules: {
      ...eslintJs.configs.recommended.rules,
      ...typescript.configs.recommended.rules,
    },
  },

  // Node JS specific rules
  {
    files: ['**/src/**/*.ts', '**/src/**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Jest specific rules
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    files: ['**/queryable.ts'],
    rules: {
      '@typescript-eslint/ban-types': 'off',
      'no-redeclare': 'off'
    }
  },

  // Ignore build outputs (the build / dist folders of each package, not source folders named build)
  {
    ignores: [
      'packages/*/build/**',
      'packages/*/dist/**',
      'build/**',
      'dist/**',
      '**/node_modules/**'
    ]
  }
]
