// ESLint v9 flat config for backend (TypeScript, Node)
// Rationale: ESLint 9 dropped .eslintrc.* in favor of a flat config.
// This config enables JS recommended rules, TypeScript rules, Prettier, and import order.

// CommonJS since backend/package.json has `"type": "commonjs"`
const js = require('@eslint/js');
const globals = require('globals');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const pluginImport = require('eslint-plugin-import');
// const pluginPrettier = require('eslint-plugin-prettier');

module.exports = [
	// Ignore build artifacts
	{ ignores: ['dist/**', 'node_modules/**'] },

	// Base JS recommended
	{
		...js.configs.recommended,
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: {
				...globals.node,
			},
		},
	},

	// TypeScript rules for .ts/.tsx
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module',
				project: false, // no type-aware lint for speed in MVP
			},
			globals: {
				...globals.node,
			},
		},
		plugins: {
			'@typescript-eslint': tsPlugin,
			import: pluginImport,
			// prettier: pluginPrettier,
		},
		rules: {
			// Start from TS recommended rules
			...tsPlugin.configs.recommended.rules,

			// Prefer the TS-aware unused vars rule
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

			// Keep imports tidy; resolver not required for order
			'import/order': [
				'warn',
				{
					groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index']],
					'newlines-between': 'always',
				},
			],

			// Prettier integration disabled for now to avoid line-ending/tab noise on Windows.
			// 'prettier/prettier': 'error',
		},
	},

];

