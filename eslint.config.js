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
			'svelte/no-at-html-tags': 'off',
			// Nouvelle règle recommandée d'eslint-plugin-svelte 3 : exige `resolve()` ($app/paths)
			// sur chaque `href` interne. Le site est servi à la racine (pas de `paths.base`), donc
			// sans effet ici, et la sémantique de `resolve` change en SvelteKit 3 (chemins sans
			// `/` initial) : on n'exempte que les liens, à revoir lors de la migration Kit 3.
			// `goto`/`pushState`/`replaceState` restent contrôlés.
			'svelte/no-navigation-without-resolve': ['error', { ignoreLinks: true }]
		}
	},
	{
		// `.claude/` peut contenir des worktrees imbriqués (autres branches) avec
		// leur propre build généré : on ne les lint pas.
		ignores: [
			'.svelte-kit/',
			'build/',
			'node_modules/',
			'static/data/',
			'data/',
			'drizzle/',
			'.claude/'
		]
	}
];
