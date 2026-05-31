<script lang="ts">
	import { onMount } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { USAGE_COLORS, usageLabel } from '$lib/usage';

	let {
		coverage = null,
		operator = 'inconnu',
		showArcep = true,
		showCommunity = true,
		railLinesUrl = '/data/rail-lines.geojson',
		arcepLinesUrl = '/data/arcep-lines.geojson'
	}: {
		coverage?: GeoJSON.FeatureCollection | null;
		/** Opérateur sélectionné : recolore les voies ARCEP. */
		operator?: string;
		showArcep?: boolean;
		showCommunity?: boolean;
		railLinesUrl?: string;
		arcepLinesUrl?: string;
	} = $props();

	let mapContainer: HTMLDivElement;
	let map: maplibregl.Map | null = null;
	let loaded = $state(false);
	let hasArcep = $state(false);

	const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

	// Données géo mises en cache (fetch une seule fois ; ré-utilisées après un
	// changement de fond de carte qui réinitialise les couches).
	let railData: GeoJSON.FeatureCollection | null = null;
	let arcepData: GeoJSON.FeatureCollection | null = null;
	// On ne retente pas un fetch déjà tenté (évite de marteler l'endpoint à
	// chaque bascule de thème si la 1re requête a échoué).
	let railTried = false;
	let arcepTried = false;

	/**
	 * Fond de carte sobre, gratuit et sans clé API (raster CARTO), accordé au thème :
	 * dark-matter en sombre, positron en clair. Attribution OSM + CARTO incluse.
	 */
	function basemapStyle(theme: 'light' | 'dark'): maplibregl.StyleSpecification {
		const base = theme === 'light' ? 'light_all' : 'dark_all';
		return {
			version: 8,
			sources: {
				carto: {
					type: 'raster',
					tiles: ['a', 'b', 'c', 'd'].map(
						(s) => `https://${s}.basemaps.cartocdn.com/${base}/{z}/{x}/{y}.png`
					),
					tileSize: 256,
					attribution: '© OpenStreetMap, © CARTO'
				}
			},
			layers: [{ id: 'carto', type: 'raster', source: 'carto' }]
		} satisfies maplibregl.StyleSpecification;
	}

	function currentTheme(): 'light' | 'dark' {
		return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
	}

	/**
	 * Expression MapLibre : couleur d'un segment de voie selon le niveau ARCEP de
	 * l'opérateur sélectionné (ou du meilleur des 4 si aucun opérateur précis).
	 * Un segment sans propriété de niveau = zone blanche (rouge).
	 */
	function arcepColor(op: string): maplibregl.ExpressionSpecification {
		const field = op === 'inconnu' || op === 'autre' ? 'best' : op;
		return [
			'match',
			['coalesce', ['get', field], 'none'],
			'TBC',
			USAGE_COLORS.TBC,
			'BC',
			USAGE_COLORS.BC,
			'CL',
			USAGE_COLORS.CL,
			USAGE_COLORS.none // défaut = zone blanche
		] as unknown as maplibregl.ExpressionSpecification;
	}

	async function ensureData() {
		if (!railData && !railTried) {
			railTried = true;
			try {
				const res = await fetch(railLinesUrl);
				if (res.ok) railData = (await res.json()) as GeoJSON.FeatureCollection;
			} catch {
				/* pas de tracés : on ignore */
			}
		}
		if (!arcepData && !arcepTried) {
			arcepTried = true;
			try {
				const res = await fetch(arcepLinesUrl);
				if (res.ok) arcepData = (await res.json()) as GeoJSON.FeatureCollection;
			} catch {
				/* couche ARCEP absente : la carte fonctionne sans */
			}
		}
	}

	/**
	 * (Ré)ajoute les couches métier par-dessus le fond. Idempotent : on saute ce
	 * qui existe déjà. Appelé au premier chargement et après chaque setStyle.
	 */
	async function addOverlays() {
		if (!map) return;
		await ensureData();
		if (!map) return;

		// Tracés ferroviaires (contexte discret).
		if (railData && !map.getSource('rail-lines')) {
			map.addSource('rail-lines', { type: 'geojson', data: railData });
			map.addLayer({
				id: 'rail-lines',
				type: 'line',
				source: 'rail-lines',
				paint: {
					'line-color': '#64748b',
					'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 12, 1.5],
					'line-opacity': 0.35
				}
			});
		}

		// Couverture ARCEP : la VOIE colorée selon l'usage possible (théorique).
		if (arcepData?.features.length) {
			hasArcep = true;
			if (!map.getSource('arcep-lines')) {
				map.addSource('arcep-lines', { type: 'geojson', data: arcepData });
				map.addLayer({
					id: 'arcep-lines',
					type: 'line',
					source: 'arcep-lines',
					layout: {
						visibility: showArcep ? 'visible' : 'none',
						'line-cap': 'round',
						'line-join': 'round'
					},
					paint: {
						'line-color': arcepColor(operator),
						'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 8],
						'line-opacity': 0.9,
						'line-blur': 0.4
					}
				});
			}
		}

		// Mesures communautaires (le RÉEL, vif, par-dessus).
		if (!map.getSource('coverage')) {
			map.addSource('coverage', { type: 'geojson', data: coverage ?? EMPTY });
			map.addLayer({
				id: 'coverage-fill',
				type: 'circle',
				source: 'coverage',
				layout: { visibility: showCommunity ? 'visible' : 'none' },
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4, 12, 9],
					'circle-color': [
						'interpolate',
						['linear'],
						['get', 'successRate'],
						0,
						'#ef4444',
						0.5,
						'#f59e0b',
						1,
						'#22c55e'
					],
					'circle-stroke-color': '#ffffff',
					'circle-stroke-width': 2,
					'circle-opacity': 0.95
				}
			});
		}
	}

	onMount(() => {
		map = new maplibregl.Map({
			container: mapContainer,
			style: basemapStyle(currentTheme()),
			center: [2.6, 46.6],
			zoom: 5.2,
			attributionControl: { compact: true }
		});

		map.addControl(new maplibregl.NavigationControl());
		map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'top-right');

		map.on('load', async () => {
			if (!map) return;
			await addOverlays();
			bindInteractions();
			loaded = true;
		});

		// Bascule de thème : on échange le fond et on ré-ajoute les couches.
		// `setStyle` repart d'un style vierge ; `styledata` (après parsing du
		// nouveau style) est le moment fiable pour ré-ajouter nos sources/couches.
		// addOverlays est idempotent (gardes getSource) → pas de doublon.
		const observer = new MutationObserver(() => {
			if (!map) return;
			map.setStyle(basemapStyle(currentTheme()));
			map.once('styledata', () => {
				void addOverlays();
			});
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme']
		});

		return () => {
			observer.disconnect();
			map?.remove();
		};
	});

	/** Handlers de clic/curseur (liés une fois ; persistent à travers setStyle). */
	function bindInteractions() {
		if (!map) return;

		// Popup ARCEP : ce qu'on peut faire ici (théorique).
		map.on('click', 'arcep-lines', (e) => {
			const f = e.features?.[0];
			if (!f || !map) return;
			const p = f.properties as Record<string, string>;
			const field = operator === 'inconnu' || operator === 'autre' ? 'best' : operator;
			const lvl = p[field] ?? null;
			const opLine = [
				['Orange', p.orange],
				['SFR', p.sfr],
				['Free', p.free],
				['Bouygues', p.bouygues]
			]
				.map(([name, l]) => `${name} ${dot(l)}`)
				.join(' · ');
			new maplibregl.Popup()
				.setLngLat(e.lngLat)
				.setHTML(
					`<strong>Couverture théorique (ARCEP)</strong>` +
						`<div style="margin:.35em 0">${usageLabel(lvl)}</div>` +
						`<div style="font-size:.82em;color:var(--muted)">${opLine}</div>`
				)
				.addTo(map);
		});

		// Popup mesure communautaire : la réalité mesurée.
		map.on('click', 'coverage-fill', (e) => {
			const f = e.features?.[0];
			if (!f || !map) return;
			const p = f.properties as Record<string, unknown>;
			const rate = Math.round(Number(p.successRate) * 100);
			const rtt = p.medianRtt ? `${p.medianRtt} ms` : 'n/a';
			new maplibregl.Popup()
				.setLngLat(e.lngLat)
				.setHTML(
					`<strong>Mesuré par la communauté</strong>` +
						`<div style="margin:.35em 0">${usageFromRate(rate)} — ${rate}% de réussite</div>` +
						`<div style="font-size:.82em;color:var(--muted)">Opérateur ${p.operator ?? 'inconnu'} · ${p.samples ?? 0} mesures · latence ${rtt}</div>`
				)
				.addTo(map);
		});

		for (const layer of ['arcep-lines', 'coverage-fill']) {
			map.on('mouseenter', layer, () => {
				if (map) map.getCanvas().style.cursor = 'pointer';
			});
			map.on('mouseleave', layer, () => {
				if (map) map.getCanvas().style.cursor = '';
			});
		}
	}

	function usageFromRate(rate: number): string {
		if (rate >= 80) return '🟢 ça capte bien';
		if (rate >= 40) return '🟠 réseau dégradé';
		return '🔴 ça coupe';
	}
	/** Pastille emoji par niveau ARCEP, pour les badges opérateurs des popups. */
	function dot(lvl: string | null | undefined): string {
		switch (lvl) {
			case 'TBC':
				return '🟢';
			case 'BC':
				return '🟡';
			case 'CL':
				return '🟠';
			default:
				return '🔴';
		}
	}

	// Rafraîchit la couverture communautaire quand la prop change.
	$effect(() => {
		if (!loaded || !map) return;
		const src = map.getSource('coverage') as maplibregl.GeoJSONSource | undefined;
		src?.setData(coverage ?? EMPTY);
	});

	// Visibilité des couches + recoloration ARCEP selon l'opérateur.
	$effect(() => {
		if (!loaded || !map) return;
		if (map.getLayer('coverage-fill')) {
			map.setLayoutProperty('coverage-fill', 'visibility', showCommunity ? 'visible' : 'none');
		}
		if (map.getLayer('arcep-lines')) {
			map.setLayoutProperty('arcep-lines', 'visibility', showArcep ? 'visible' : 'none');
			map.setPaintProperty('arcep-lines', 'line-color', arcepColor(operator));
		}
	});
</script>

<div class="map" bind:this={mapContainer}></div>
{#if hasArcep}
	<div class="legend-overlay glass">
		<strong>Sur la voie, vous pourrez :</strong>
		<span><i style="background:var(--usage-tbc)"></i> Streaming vidéo</span>
		<span><i style="background:var(--usage-bc)"></i> Web & réseaux sociaux</span>
		<span><i style="background:var(--usage-cl)"></i> Messages seulement</span>
		<span><i style="background:var(--usage-none)"></i> Rien (zone blanche)</span>
		<span class="real"
			><i style="background:var(--usage-tbc); border:2px solid #fff"></i> Mesuré en vrai</span
		>
	</div>
{/if}

<style>
	.map {
		width: 100%;
		height: 100%;
		min-height: 60vh;
	}
	.legend-overlay {
		position: absolute;
		bottom: 8px;
		left: 8px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--text);
		font-size: 0.72rem;
		padding: 0.5rem 0.7rem;
		border-radius: var(--r-md);
		pointer-events: none;
		max-width: 220px;
	}
	/* Sur mobile, la légende remonte en haut-gauche (sinon cachée par le bottom-sheet). */
	@media (max-width: 760px) {
		.legend-overlay {
			top: 56px;
			bottom: auto;
		}
	}
	.legend-overlay strong {
		font-size: 0.75rem;
		margin-bottom: 2px;
	}
	.legend-overlay span {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.legend-overlay i {
		display: inline-block;
		width: 16px;
		height: 5px;
		border-radius: 3px;
		flex: none;
	}
	.legend-overlay .real i {
		width: 12px;
		height: 12px;
		border-radius: 50%;
	}
	.legend-overlay .real {
		margin-top: 2px;
		border-top: 1px solid var(--glass-border);
		padding-top: 3px;
	}

	/* Popups MapLibre (injectées hors du composant → :global) : look glass lisible.
	   Contenu quasi-opaque (lisibilité du texte sur la carte) + pointe opaque. */
	:global(.maplibregl-popup-content) {
		background: var(--glass-bg-strong);
		-webkit-backdrop-filter: blur(var(--glass-blur));
		backdrop-filter: blur(var(--glass-blur));
		color: var(--text);
		border: 1px solid var(--glass-border);
		border-radius: var(--r-md);
		padding: 0.7rem 0.9rem;
		font-size: 0.9rem;
		line-height: 1.45;
		box-shadow: var(--shadow-2);
		max-width: 240px;
	}
	:global(.maplibregl-popup-content strong) {
		color: var(--text);
		font-size: 0.95rem;
	}
	/* La pointe de la bulle prend la couleur (opaque) du panneau. */
	:global(.maplibregl-popup-anchor-top .maplibregl-popup-tip) {
		border-bottom-color: var(--panel);
	}
	:global(.maplibregl-popup-anchor-bottom .maplibregl-popup-tip) {
		border-top-color: var(--panel);
	}
	:global(.maplibregl-popup-anchor-left .maplibregl-popup-tip) {
		border-right-color: var(--panel);
	}
	:global(.maplibregl-popup-anchor-right .maplibregl-popup-tip) {
		border-left-color: var(--panel);
	}
	:global(.maplibregl-popup-close-button) {
		color: var(--muted);
		font-size: 1.1rem;
		padding: 0 0.3rem;
	}
	:global(.maplibregl-popup-close-button:hover) {
		background: transparent;
		color: var(--text);
	}
	@media (prefers-reduced-transparency: reduce) {
		:global(.maplibregl-popup-content) {
			background: var(--panel);
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}
	}
</style>
