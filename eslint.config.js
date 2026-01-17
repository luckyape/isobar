import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
    // Global ignores
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            '*.config.js',
            '*.config.ts',
            'patches/**',
        ],
    },

    // Base JavaScript rules
    js.configs.recommended,

    // TypeScript rules
    ...tseslint.configs.recommended,

    // React configuration
    {
        files: ['**/*.tsx', '**/*.jsx'],
        plugins: {
            react,
            'react-hooks': reactHooks,
        },
        languageOptions: {
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: {
                ...globals.browser,
            },
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
        rules: {
            // React Hooks rules
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',

            // React rules (JSX runtime - no need to import React)
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off', // Using TypeScript instead

            // Disable some noisy rules for existing codebase
            'react/display-name': 'off',
        },
    },

    // TypeScript/JavaScript files
    {
        files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            // TypeScript-specific relaxations for existing codebase
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/ban-ts-comment': 'off',

            // General code quality
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'prefer-const': 'warn',
            'no-unused-expressions': 'off', // Conflicts with optional chaining
        },
    },

    // Test files
    {
        files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            'no-console': 'off',
        },
    },

    // High-churn closet area: relax noisy rules
    {
        files: [
            'client/src/lib/closet/**/*',
            'client/src/components/closet/**/*',
            'client/src/pages/Closet*.tsx',
            'client/src/hooks/useCloset*.ts'
        ],
        rules: {
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            'react-hooks/exhaustive-deps': 'off',
        },
    }
);
