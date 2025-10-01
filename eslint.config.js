const eslint = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const vitest = require('eslint-plugin-vitest');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
	eslint.configs.recommended,
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module',
			},
			globals: {
				console: 'readonly',
				process: 'readonly',
				require: 'readonly',
				module: 'readonly',
				__dirname: 'readonly',
				Buffer: 'readonly',
				URLSearchParams: 'readonly',
				fetch: 'readonly',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			...tseslint.configs.recommended.rules,
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-require-imports': 'warn',
			'@typescript-eslint/no-unused-vars': 'warn',
			'@typescript-eslint/no-unnecessary-type-constraint': 'warn',
		},
	},
	{
		files: ['src/**/*.test.ts'],
		plugins: {
			vitest,
		},
		languageOptions: {
			globals: {
				...vitest.environments.env.globals,
			},
		},
		rules: {
			...vitest.configs.recommended.rules,
			'vitest/expect-expect': [
				'warn',
				{
					assertFunctionNames: ['expect', 'expectObservable'],
				},
			],
		},
	},
	prettierConfig,
	{
		ignores: ['dist/', 'node_modules/', 'coverage/', '**/*.config.js', '**/*.config.ts'],
	},
];