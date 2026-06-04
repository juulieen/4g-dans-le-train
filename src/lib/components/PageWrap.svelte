<script lang="ts">
	let { children } = $props();
</script>

<div class="prose">
	{@render children()}
</div>

<style>
	.prose {
		/* `width: 100%` est NÉCESSAIRE : `main` est un flex colonne et `margin: 0 auto`
		   désactive le `stretch` → sans largeur définie, `.prose` se calerait sur son
		   `max-width` (760px) et déborderait horizontalement sur mobile. `overflow-x: clip`
		   garde-fou (aucun enfant ne doit dépasser ; la frise gère son propre scroll). */
		width: 100%;
		max-width: 760px;
		margin: 0 auto;
		padding: 2rem 1.1rem;
		overflow-x: clip;
		line-height: var(--lh);
	}

	/* --- Typographie partagée (contenu slotté → :global, namespacé sous .prose) --- */
	.prose :global(h1) {
		font-size: var(--fs-xl);
		letter-spacing: -0.01em;
		margin: 0 0 0.6rem;
	}
	.prose :global(h2) {
		font-size: var(--fs-lg);
		margin: 1.7rem 0 0.5rem;
	}
	.prose :global(p) {
		color: var(--text);
	}
	.prose :global(.lede) {
		color: var(--muted);
		font-size: var(--fs-md);
	}
	.prose :global(.muted) {
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	/* --- Fil d'Ariane --- */
	.prose :global(.crumbs) {
		font-size: var(--fs-sm);
		color: var(--muted);
		margin-bottom: 1rem;
	}

	/* --- Bouton d'appel à l'action (glass accent) --- */
	.prose :global(.cta) {
		display: inline-block;
		margin: 1rem 0 2rem;
		padding: 0.75rem 1.3rem;
		min-height: 44px;
		background: var(--accent);
		color: #052e16;
		font-weight: 700;
		border-radius: var(--r-md);
		text-decoration: none;
		box-shadow: var(--shadow-1);
		transition:
			filter 0.15s,
			transform 0.1s;
	}
	.prose :global(.cta:hover) {
		filter: brightness(1.05);
	}
	.prose :global(.cta:active) {
		transform: translateY(1px);
	}

	/* --- Pastilles de liens (inline) --- */
	.prose :global(.pills) {
		list-style: none;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.prose :global(.pills a) {
		display: inline-flex;
		align-items: center;
		padding: 0.5rem 0.9rem;
		min-height: 44px;
		background: color-mix(in srgb, var(--panel) 75%, transparent);
		border: 1px solid var(--border);
		border-radius: 999px;
		text-decoration: none;
		color: var(--text);
		font-size: var(--fs-sm);
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.prose :global(.pills a:hover) {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	/* --- Grille de cartes (liens) --- */
	.prose :global(.cards) {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 0.75rem;
	}
	.prose :global(.cards a) {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.9rem 1rem;
		min-height: 44px;
		background: color-mix(in srgb, var(--panel) 75%, transparent);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		text-decoration: none;
		color: var(--text);
		transition:
			border-color 0.15s,
			transform 0.12s,
			background 0.15s;
	}
	.prose :global(.cards a:hover) {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		transform: translateY(-1px);
	}
	.prose :global(.cards a span) {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.prose :global(.cards.center a) {
		align-items: center;
		text-align: center;
		font-weight: 600;
	}

	/* --- FAQ (details/summary) glass --- */
	.prose :global(details) {
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		padding: 0.4rem 1rem;
		margin-bottom: 0.75rem;
		background: color-mix(in srgb, var(--panel) 75%, transparent);
	}
	.prose :global(summary) {
		cursor: pointer;
		font-weight: 600;
		padding: 0.6rem 0;
		min-height: 44px;
		display: flex;
		align-items: center;
	}
	.prose :global(details p) {
		color: var(--muted);
		margin-top: 0;
	}

	/* --- Ajustements tactiles mobile --- */
	@media (max-width: 760px) {
		/* CTA pleine largeur : plus facile à viser au pouce. */
		.prose :global(.cta) {
			display: block;
			text-align: center;
		}
	}
</style>
