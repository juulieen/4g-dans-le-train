<script lang="ts">
	import { page } from '$app/state';
	import { setContext } from 'svelte';
	import Onboarding from '$components/Onboarding/Onboarding.svelte';
	import Icon from '$components/Icon.svelte';
	import { ORIGIN } from '$lib/site';

	let { children } = $props();

	const nav = [
		{ href: '/', label: 'Carte', icon: 'map' },
		{ href: '/lignes', label: 'Lignes', icon: 'train' },
		{ href: '/operateurs', label: 'Opérateurs', icon: 'signal' },
		{ href: '/faq', label: 'FAQ', icon: 'help' }
	];

	const isMapRoute = $derived(page.url.pathname === '/');

	// --- Partage social (Open Graph / Twitter Card) ---
	// Source UNIQUE de og:image / og:url, calculée depuis la route : les pages
	// `/ligne/<slug>` (et `/ligne/<slug>/<operateur>`) reçoivent la vignette de leur
	// trajet (endpoint `/og/<slug>.png`) ; toute autre page reçoit la carte générique.
	// Les og:title / og:description restent gérés par chaque page (contenu propre).
	const ogImage = $derived.by(() => {
		const m = page.url.pathname.match(/^\/ligne\/([^/]+)/);
		return `${ORIGIN}/og/${m ? m[1] : 'default'}.png`;
	});
	const ogUrl = $derived(`${ORIGIN}${page.url.pathname}`);

	// --- Onboarding : exposé aux pages enfants via le contexte (ré-ouverture ℹ️) ---
	let onboardingOpen = $state(false);
	setContext('ui', {
		openOnboarding: () => (onboardingOpen = true)
	});

	// --- Thème clair / sombre (le script anti-FOUC d'app.html a déjà posé
	// data-theme avant le 1er paint ; on lit cette valeur dès l'init pour éviter
	// un clignotement d'icône à l'hydratation). ---
	let theme = $state<'light' | 'dark'>(
		typeof document !== 'undefined' &&
			document.documentElement.getAttribute('data-theme') === 'light'
			? 'light'
			: 'dark'
	);

	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
		document.documentElement.setAttribute('data-theme', theme);
		try {
			localStorage.setItem('4gdt.theme', theme);
		} catch {
			/* localStorage indisponible : on garde juste l'état en mémoire */
		}
		const meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1220' : '#eef2f7');
	}
</script>

<svelte:head>
	<meta property="og:site_name" content="4G dans le train" />
	<meta property="og:locale" content="fr_FR" />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={ogUrl} />
	<meta property="og:image" content={ogImage} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:image" content={ogImage} />
</svelte:head>

<div class="app" class:map-route={isMapRoute}>
	<header class="glass">
		<a class="brand" href="/">
			<span class="logo"><Icon name="logo" size={26} /></span>
			<span class="title">4G dans le train</span>
		</a>

		<nav class="desktop-nav">
			{#each nav as item (item.href)}
				<a href={item.href} class:active={page.url.pathname === item.href}>{item.label}</a>
			{/each}
		</nav>

		<div class="tools">
			<button
				class="icon-btn"
				onclick={() => (onboardingOpen = true)}
				aria-label="Comment ça marche"
			>
				<Icon name="info" size={19} />
				<span class="tools-label">Comment ça marche</span>
			</button>
			<button class="icon-btn" onclick={toggleTheme} aria-label="Basculer le thème clair/sombre">
				<Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} />
			</button>
			<a
				class="icon-btn gh"
				href="https://github.com/juulieen/4g-dans-le-train"
				target="_blank"
				rel="noopener"
				aria-label="Code source sur GitHub"
			>
				<span aria-hidden="true">★</span>
				<span class="tools-label">GitHub</span>
			</a>
		</div>
	</header>

	<main>
		{@render children()}
	</main>

	{#if !isMapRoute}
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
	{/if}

	<!-- Bottom nav tactile (mobile uniquement) -->
	<nav class="bottom-nav glass" aria-label="Navigation principale">
		{#each nav as item (item.href)}
			<a href={item.href} class:active={page.url.pathname === item.href}>
				<span class="bn-icon"><Icon name={item.icon} /></span>
				<span class="bn-label">{item.label}</span>
			</a>
		{/each}
	</nav>
</div>

<Onboarding open={onboardingOpen} onclose={() => (onboardingOpen = false)} />

<style>
	:global(:root) {
		/* Tokens indépendants du thème */
		--accent: #22c55e;
		--usage-tbc: #22c55e;
		--usage-bc: #84cc16;
		--usage-cl: #f59e0b;
		--usage-none: #ef4444;

		--font-sans: 'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;

		--r-sm: 8px;
		--r-md: 12px;
		--r-lg: 18px;
		--r-xl: 26px;

		--sp-1: 0.25rem;
		--sp-2: 0.5rem;
		--sp-3: 0.75rem;
		--sp-4: 1rem;
		--sp-5: 1.5rem;
		--sp-6: 2rem;

		--fs-xs: 0.72rem;
		--fs-sm: 0.85rem;
		--fs-md: 0.95rem;
		--fs-lg: 1.15rem;
		--fs-xl: 1.6rem;
		--lh: 1.6;

		--glass-blur: 14px;
		--glass-blur-strong: 22px;

		--z-map: 0;
		--z-legend: 5;
		--z-sheet: 30;
		--z-topbar: 40;
		--z-onboarding: 60;

		--navbar-h: 64px;
	}

	/* THÈME SOMBRE (défaut, y compris avant exécution du script anti-FOUC) */
	:global(:root),
	:global(:root[data-theme='dark']) {
		--bg: #0b1220;
		--panel: #131c2e;
		--text: #e2e8f0;
		--muted: #94a3b8;
		--border: #1e293b;
		--link: #34d399;

		--glass-bg: color-mix(in srgb, var(--panel) 70%, transparent);
		--glass-bg-strong: color-mix(in srgb, var(--panel) 90%, transparent);
		--glass-border: color-mix(in srgb, #ffffff 12%, transparent);
		--glass-highlight: color-mix(in srgb, #ffffff 16%, transparent);
		--shadow-1: 0 4px 16px rgba(0, 0, 0, 0.35);
		--shadow-2: 0 14px 44px rgba(0, 0, 0, 0.5);
	}

	/* THÈME CLAIR */
	:global(:root[data-theme='light']) {
		--bg: #eef2f7;
		--panel: #ffffff;
		--text: #0f172a;
		--muted: #475569;
		--border: #dbe3ee;
		--link: #15803d;

		--glass-bg: color-mix(in srgb, #ffffff 62%, transparent);
		--glass-bg-strong: color-mix(in srgb, #ffffff 85%, transparent);
		--glass-border: color-mix(in srgb, #0f172a 10%, transparent);
		--glass-highlight: color-mix(in srgb, #ffffff 70%, transparent);
		--shadow-1: 0 4px 16px rgba(15, 23, 42, 0.1);
		--shadow-2: 0 14px 44px rgba(15, 23, 42, 0.18);
	}

	@font-face {
		font-family: 'Inter Variable';
		font-style: normal;
		font-weight: 100 900;
		font-display: swap;
		src: url('/fonts/inter-variable.woff2') format('woff2');
	}

	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		font-family: var(--font-sans);
		background: var(--bg);
		color: var(--text);
		-webkit-font-smoothing: antialiased;
	}
	:global(a) {
		color: var(--link);
	}

	/* Primitive « liquid glass » réutilisable partout. */
	:global(.glass) {
		background: var(--glass-bg);
		-webkit-backdrop-filter: blur(var(--glass-blur));
		backdrop-filter: blur(var(--glass-blur));
		border: 1px solid var(--glass-border);
		box-shadow:
			var(--shadow-1),
			inset 0 1px 0 var(--glass-highlight);
	}
	@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		:global(.glass) {
			background: var(--glass-bg-strong);
		}
	}
	@media (prefers-reduced-transparency: reduce) {
		:global(.glass) {
			background: var(--panel);
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
		}
	}

	.app {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}

	/* --- Top bar --- */
	header {
		position: sticky;
		top: 0;
		z-index: var(--z-topbar);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: max(0.55rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) 0.55rem
			max(1rem, env(safe-area-inset-left));
		border: none;
		border-bottom: 1px solid var(--glass-border);
		border-radius: 0;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 700;
		text-decoration: none;
		color: var(--text);
		white-space: nowrap;
	}
	.logo {
		display: flex;
		align-items: center;
		color: var(--accent);
	}
	.desktop-nav {
		display: flex;
		gap: 0.25rem;
		align-items: center;
		margin-inline: auto;
	}
	.desktop-nav a {
		padding: 0.4rem 0.8rem;
		border-radius: 999px;
		text-decoration: none;
		color: var(--muted);
		font-size: var(--fs-md);
		transition:
			background 0.18s,
			color 0.18s;
	}
	.desktop-nav a.active,
	.desktop-nav a:hover {
		color: var(--text);
		background: color-mix(in srgb, var(--text) 10%, transparent);
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.icon-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 38px;
		padding: 0.3rem 0.6rem;
		border: 1px solid transparent;
		border-radius: 999px;
		background: transparent;
		color: var(--muted);
		font-size: var(--fs-sm);
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition:
			background 0.18s,
			color 0.18s;
	}
	.icon-btn:hover {
		color: var(--text);
		background: color-mix(in srgb, var(--text) 10%, transparent);
	}
	.icon-btn.gh {
		color: var(--accent);
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	footer {
		padding: 1.25rem 1rem;
		border-top: 1px solid var(--border);
		color: var(--muted);
		font-size: 0.82rem;
		text-align: center;
	}
	footer p {
		margin: 0.25rem 0;
	}

	/* --- Bottom nav (mobile) --- */
	.bottom-nav {
		display: none;
	}

	@media (max-width: 760px) {
		.tools-label {
			display: none;
		}
		.desktop-nav {
			display: none;
		}
		.bottom-nav {
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			z-index: var(--z-topbar);
			display: flex;
			justify-content: space-around;
			align-items: stretch;
			gap: 0.2rem;
			padding: 0.3rem 0.4rem calc(0.3rem + env(safe-area-inset-bottom));
			border: none;
			border-top: 1px solid var(--glass-border);
			border-radius: 0;
		}
		.bottom-nav a {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 2px;
			min-height: 52px;
			padding: 0.2rem;
			border-radius: var(--r-md);
			text-decoration: none;
			color: var(--muted);
			font-size: var(--fs-xs);
		}
		.bottom-nav a.active {
			color: var(--accent);
			background: color-mix(in srgb, var(--accent) 14%, transparent);
		}
		.bn-icon {
			display: flex;
			align-items: center;
			justify-content: center;
		}
		/* Le footer des pages SEO ne doit pas passer sous la bottom nav. */
		.app:not(.map-route) footer {
			padding-bottom: calc(1.25rem + var(--navbar-h) + env(safe-area-inset-bottom));
		}
	}
</style>
