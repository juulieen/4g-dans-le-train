<script lang="ts">
	import { onMount } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	let {
		coverage = null,
		operator = 'inconnu',
		showArcep = true,
		showCommunity = true,
		railLinesUrl = '/data/rail-lines.geojson',
		arcepUrl = '/data/arcep-coverage.geojson'
	}: {
		coverage?: GeoJSON.FeatureCollection | null;
		/** Opérateur sélectionné : filtre la couche ARCEP. */
		operator?: string;
		showArcep?: boolean;
		showCommunity?: boolean;
		railLinesUrl?: string;
		arcepUrl?: string;
	} = $props();

	let mapContainer: HTMLDivElement;
	let map: maplibregl.Map | null = null;
	let loaded = $state(false);
	let hasArcep = $state(false);

	const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

	/** Filtre MapLibre : ne montrer que les cellules ARCEP couvertes pour l'opérateur. */
	function arcepFilter(op: string): maplibregl.FilterSpecification {
		if (op === 'inconnu' || op === 'autre') {
			// pas d'opérateur précis : on montre les cellules couvertes par au moins un.
			return [
				'any',
				['has', 'orange'],
				['has', 'sfr'],
				['has', 'free'],
				['has', 'bouygues']
			] as unknown as maplibregl.FilterSpecification;
		}
		return ['has', op] as unknown as maplibregl.FilterSpecification;
	}

	onMount(() => {
		map = new maplibregl.Map({
			container: mapContainer,
			style: 'https://demotiles.maplibre.org/style.json',
			center: [2.6, 46.6],
			zoom: 5.2,
			attributionControl: { compact: true }
		});

		map.addControl(new maplibregl.NavigationControl());
		map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'top-right');

		map.on('load', async () => {
			if (!map) return;

			// --- Tracés ferroviaires SNCF (couche de fond, si le GeoJSON est présent) ---
			try {
				const res = await fetch(railLinesUrl);
				if (res.ok) {
					map.addSource('rail-lines', { type: 'geojson', data: await res.json() });
					map.addLayer({
						id: 'rail-lines',
						type: 'line',
						source: 'rail-lines',
						paint: {
							'line-color': '#64748b',
							'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 12, 2.5],
							'line-opacity': 0.7
						}
					});
				}
			} catch {
				/* pas de données de lignes encore importées : on ignore */
			}

			// --- Couverture officielle ARCEP (théorique, par opérateur) ---
			try {
				const res = await fetch(arcepUrl);
				if (res.ok) {
					const arcep = (await res.json()) as GeoJSON.FeatureCollection;
					if (arcep.features.length) {
						hasArcep = true;
						map.addSource('arcep', { type: 'geojson', data: arcep });
						map.addLayer({
							id: 'arcep-fill',
							type: 'circle',
							source: 'arcep',
							layout: { visibility: showArcep ? 'visible' : 'none' },
							filter: arcepFilter(operator),
							paint: {
								'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 12, 5],
								// Couleur selon le meilleur niveau ARCEP de l'opérateur sélectionné.
								'circle-color': '#3b82f6',
								'circle-opacity': 0.35
							}
						});
					}
				}
			} catch {
				/* couche ARCEP absente : la carte fonctionne sans */
			}

			// --- Couverture communautaire (cellules H3 colorées par taux de succès) ---
			map.addSource('coverage', { type: 'geojson', data: coverage ?? EMPTY });
			map.addLayer({
				id: 'coverage-fill',
				type: 'circle',
				source: 'coverage',
				layout: { visibility: showCommunity ? 'visible' : 'none' },
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 8],
					'circle-color': [
						'interpolate',
						['linear'],
						['get', 'successRate'],
						0,
						'#ef4444', // rouge : ça ne capte pas
						0.5,
						'#f59e0b', // orange : dégradé
						1,
						'#22c55e' // vert : ça capte
					],
					'circle-stroke-color': '#0b1220',
					'circle-stroke-width': 1,
					'circle-opacity': 0.85
				}
			});

			// Popup au clic sur une cellule communautaire
			map.on('click', 'coverage-fill', (e) => {
				const f = e.features?.[0];
				if (!f || !map) return;
				const p = f.properties as Record<string, unknown>;
				const rate = Math.round(Number(p.successRate) * 100);
				const rtt = p.medianRtt ? `${p.medianRtt} ms` : 'n/a';
				new maplibregl.Popup()
					.setLngLat(e.lngLat)
					.setHTML(
						`<strong>${rate}% de réussite</strong><br>` +
							`Opérateur : ${p.operator ?? 'inconnu'}<br>` +
							`Latence médiane : ${rtt}<br>` +
							`Mesures : ${p.samples ?? 0}`
					)
					.addTo(map);
			});
			map.on('mouseenter', 'coverage-fill', () => {
				if (map) map.getCanvas().style.cursor = 'pointer';
			});
			map.on('mouseleave', 'coverage-fill', () => {
				if (map) map.getCanvas().style.cursor = '';
			});

			loaded = true;
		});

		return () => map?.remove();
	});

	// Rafraîchit la couverture communautaire quand la prop change.
	$effect(() => {
		if (!loaded || !map) return;
		const src = map.getSource('coverage') as maplibregl.GeoJSONSource | undefined;
		src?.setData(coverage ?? EMPTY);
	});

	// Applique le filtre opérateur + la visibilité des couches.
	$effect(() => {
		if (!loaded || !map) return;
		if (map.getLayer('coverage-fill')) {
			map.setLayoutProperty('coverage-fill', 'visibility', showCommunity ? 'visible' : 'none');
		}
		if (map.getLayer('arcep-fill')) {
			map.setLayoutProperty('arcep-fill', 'visibility', showArcep ? 'visible' : 'none');
			map.setFilter('arcep-fill', arcepFilter(operator));
		}
	});
</script>

<div class="map" bind:this={mapContainer}></div>
{#if hasArcep}
	<div class="badge">Fond bleu : couverture théorique ARCEP</div>
{/if}

<style>
	.map {
		width: 100%;
		height: 100%;
		min-height: 60vh;
	}
	.badge {
		position: absolute;
		bottom: 8px;
		left: 8px;
		background: rgba(11, 18, 32, 0.8);
		color: #cbd5e1;
		font-size: 0.72rem;
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		pointer-events: none;
	}
</style>
