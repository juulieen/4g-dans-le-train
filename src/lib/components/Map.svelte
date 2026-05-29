<script lang="ts">
	import { onMount } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	let {
		coverage = null,
		railLinesUrl = '/data/sncf-lines.geojson'
	}: {
		coverage?: GeoJSON.FeatureCollection | null;
		railLinesUrl?: string;
	} = $props();

	let mapContainer: HTMLDivElement;
	let map: maplibregl.Map | null = null;
	let loaded = $state(false);

	const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

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
					const lines = await res.json();
					map.addSource('rail-lines', { type: 'geojson', data: lines });
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

			// --- Couverture communautaire (hexagones H3 colorés par taux de succès) ---
			map.addSource('coverage', { type: 'geojson', data: coverage ?? EMPTY });
			map.addLayer({
				id: 'coverage-fill',
				type: 'fill',
				source: 'coverage',
				paint: {
					'fill-color': [
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
					'fill-opacity': 0.5
				}
			});
			map.addLayer({
				id: 'coverage-outline',
				type: 'line',
				source: 'coverage',
				paint: { 'line-color': '#1e293b', 'line-width': 0.5, 'line-opacity': 0.3 }
			});

			// Popup au clic sur une cellule
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

	// Met à jour la source de couverture quand la prop change (après chargement)
	$effect(() => {
		if (!loaded || !map) return;
		const src = map.getSource('coverage') as maplibregl.GeoJSONSource | undefined;
		src?.setData(coverage ?? EMPTY);
	});
</script>

<div class="map" bind:this={mapContainer}></div>

<style>
	.map {
		width: 100%;
		height: 100%;
		min-height: 60vh;
	}
</style>
