import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node, GeoJSON: 'readonly' }
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: { parser: ts.parser }
		},
		rules: {
			// JSON-LD injecté est entièrement construit à partir de constantes internes
			// (référentiel de lignes), jamais d'entrée utilisateur — pas de risque XSS.
			'svelte/no-at-html-tags': 'off'
		}
	},
	{
		ignores: ['.svelte-kit/', 'build/', 'node_modules/', 'static/data/', 'data/', 'drizzle/']
	}
];
