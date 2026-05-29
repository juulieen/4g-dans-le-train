<script lang="ts">
	import { page } from '$app/state';

	let { children } = $props();

	const nav = [
		{ href: '/', label: 'Carte' },
		{ href: '/lignes', label: 'Lignes' },
		{ href: '/faq', label: 'FAQ' }
	];
</script>

<div class="app">
	<header>
		<a class="brand" href="/">
			<span class="logo">🚆📶</span>
			<span class="title">4G dans le train</span>
		</a>
		<nav>
			{#each nav as item (item.href)}
				<a href={item.href} class:active={page.url.pathname === item.href}>{item.label}</a>
			{/each}
			<a
				class="gh"
				href="https://github.com/juulieen/4g-dans-le-train"
				target="_blank"
				rel="noopener">GitHub ★</a
			>
		</nav>
	</header>

	<main>
		{@render children()}
	</main>

	<footer>
		<p>
			Données : <a href="https://ressources.data.sncf.com" target="_blank" rel="noopener"
				>SNCF Open Data</a
			>
			· <a href="https://data.arcep.fr" target="_blank" rel="noopener">ARCEP</a> · contributions communautaires
			anonymes.
		</p>
		<p>
			<a href="/confidentialite">Confidentialité</a> · Projet open source
			<a href="https://github.com/juulieen/4g-dans-le-train" target="_blank" rel="noopener"
				>sous licence MIT</a
			>
		</p>
	</footer>
</div>

<style>
	:global(:root) {
		--bg: #0b1220;
		--panel: #131c2e;
		--accent: #22c55e;
		--text: #e2e8f0;
		--muted: #94a3b8;
		--border: #1e293b;
	}
	:global(body) {
		margin: 0;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
		background: var(--bg);
		color: var(--text);
	}
	:global(a) {
		color: var(--accent);
	}
	.app {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem 1rem;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
		flex-wrap: wrap;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 700;
		text-decoration: none;
		color: var(--text);
	}
	.logo {
		font-size: 1.3rem;
	}
	nav {
		display: flex;
		gap: 0.25rem;
		align-items: center;
		flex-wrap: wrap;
	}
	nav a {
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		text-decoration: none;
		color: var(--muted);
		font-size: 0.92rem;
	}
	nav a.active,
	nav a:hover {
		color: var(--text);
		background: #1e293b;
	}
	nav a.gh {
		color: var(--accent);
	}
	main {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	footer {
		padding: 1rem;
		border-top: 1px solid var(--border);
		color: var(--muted);
		font-size: 0.82rem;
		text-align: center;
	}
	footer p {
		margin: 0.25rem 0;
	}
</style>
