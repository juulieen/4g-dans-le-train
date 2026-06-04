<script lang="ts">
	/**
	 * Aperçu de carte STATIQUE et CLIQUABLE, zoomé sur une ligne, posé sur les pages
	 * `/ligne/[slug]`. Réutilise `Map.svelte` (rendu identique : fond CARTO + voie ARCEP
	 * colorée + mesures de la ligne) mais en lui INJECTANT des données légères :
	 *  - la voie ARCEP de CETTE ligne seule, construite depuis son route-profile
	 *    (`arcep[] + path` → `buildArcepLineFeatures`), ~dizaines de Ko au lieu de 4,6 Mo ;
	 *  - les rubans communautaires scopés à la ligne (`lineSlug` → `&line=`).
	 *
	 * Perf : **init paresseuse** (IntersectionObserver) + **import dynamique** de `Map.svelte`
	 * → le chunk MapLibre ne se charge qu'à l'entrée dans le viewport. Le clic ouvre la carte
	 * interactive complète, déjà focalisée sur la ligne (`/?line=<slug>`).
	 */
	import { onMount } from 'svelte';
	import {
		buildArcepLineFeatures,
		pathBounds,
		type ArcepProfileSegment
	} from '$lib/coverage-segments';
	import type { PathPoint } from '$lib/geo/interpolate';
	import type maplibregl from 'maplibre-gl';

	let {
		slug,
		operator = 'inconnu',
		height = '320px'
	}: {
		slug: string;
		/** Opérateur dont colorer la voie (page croisée) ; défaut = meilleur des 4. */
		operator?: string;
		height?: string;
	} = $props();

	/** Sous-ensemble utile du route-profile pour l'aperçu. */
	interface Profile {
		path: PathPoint[];
		arcep: ArcepProfileSegment[];
	}

	let container: HTMLDivElement;
	// Chargé en dynamique (lazy) → le chunk MapLibre n'entre pas dans le bundle des pages ligne.
	let MapView = $state<(typeof import('./Map.svelte'))['default'] | null>(null);
	let arcepData = $state<GeoJSON.FeatureCollection | null>(null);
	let bounds = $state<maplibregl.LngLatBoundsLike | null>(null);
	let failed = $state(false);

	async function load() {
		try {
			const res = await fetch(`/data/route-profiles/${slug}.json`);
			if (!res.ok) throw new Error('profil indisponible');
			const profile = (await res.json()) as Profile;
			if (!profile.path || profile.path.length < 2) throw new Error('tracé vide');
			arcepData = {
				type: 'FeatureCollection',
				features: buildArcepLineFeatures(profile.path, profile.arcep ?? [])
			};
			bounds = pathBounds(profile.path);
			const mod = await import('./Map.svelte');
			MapView = mod.default;
		} catch {
			failed = true; // dégradation : on retombe sur un lien texte vers la carte.
		}
	}

	onMount(() => {
		// Ne monter la carte qu'à l'approche du viewport (préchargement à 200 px).
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					io.disconnect();
					void load();
				}
			},
			{ rootMargin: '200px' }
		);
		io.observe(container);
		return () => io.disconnect();
	});
</script>

<div class="map-preview" class:failed bind:this={container} style="--preview-h:{height}">
	{#if failed}
		<a class="fallback" href={`/?line=${slug}`}>Voir la couverture de la ligne sur la carte →</a>
	{:else}
		{#if MapView && arcepData && bounds}
			<div class="host">
				<MapView
					arcepLinesData={arcepData}
					focusBounds={bounds}
					{operator}
					lineSlug={slug}
					interactive={false}
					showRail={false}
					coverage={null}
				/>
			</div>
		{:else}
			<!-- État initial / sans JS / avant hydratation : fond neutre + lien (prerendu). -->
			<div class="skeleton" aria-hidden="true"></div>
		{/if}
		<!-- Overlay cliquable TOUJOURS présent (donc lien dans le HTML statique, sans JS) ;
		     laisse la bande d'attribution CARTO/OSM en bas cliquable. -->
		<a
			class="overlay"
			href={`/?line=${slug}`}
			aria-label="Ouvrir la carte interactive de cette ligne"
		>
			<span class="pill">Voir en grand →</span>
		</a>
	{/if}
</div>

<style>
	.map-preview {
		position: relative;
		width: 100%;
		height: var(--preview-h);
		border-radius: var(--r-lg);
		overflow: hidden;
		border: 1px solid var(--border);
	}
	.map-preview.failed {
		height: auto;
		border: none;
		overflow: visible;
	}
	.host {
		position: absolute;
		inset: 0;
	}
	/* Le lien couvre la carte SAUF la bande d'attribution (bas) qui doit rester cliquable. */
	.overlay {
		position: absolute;
		inset: 0 0 22px 0;
		display: flex;
		align-items: flex-start;
		justify-content: flex-end;
		padding: 10px;
		z-index: 2;
		text-decoration: none;
		/* Le scroll vertical de la page passe au travers (tap = navigue, swipe = scrolle). */
		touch-action: pan-y;
	}
	.pill {
		background: var(--glass-bg-strong);
		-webkit-backdrop-filter: blur(var(--glass-blur));
		backdrop-filter: blur(var(--glass-blur));
		color: var(--text);
		border: 1px solid var(--glass-border);
		border-radius: 999px;
		padding: 0.35rem 0.7rem;
		font-size: var(--fs-sm);
		font-weight: 600;
		box-shadow: var(--shadow-1);
	}
	.skeleton {
		position: absolute;
		inset: 0;
		background: color-mix(in srgb, var(--text) 6%, transparent);
	}
	.fallback {
		display: inline-block;
		color: var(--link);
		font-weight: 600;
		text-decoration: none;
	}
</style>
