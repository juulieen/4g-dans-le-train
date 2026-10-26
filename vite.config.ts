import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	// En dev, les tuiles vectorielles (PMTiles Protomaps) n'existent que sur le serveur
	// de prod (asus-1) : on proxifie /tiles/* vers le vhost public. Rien à héberger en local.
	server: {
		proxy: {
			'/tiles': {
				target: 'https://4g-dans-le-train.juulieen.fr',
				changeOrigin: true
			}
		}
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
