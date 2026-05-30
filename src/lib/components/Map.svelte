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

	// Couleurs par usage (niveau ARCEP → ce qu'on peut faire).
	const USAGE_COLORS = {
		TBC: '#22c55e', // vert — streaming vidéo / visio
		BC: '#84cc16', // vert-clair — web, réseaux sociaux
		CL: '#f59e0b', // orange — messages, navigation lente
		none: '#ef4444' // rouge — zone blanche
	};

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

			// --- Tracés ferroviaires (gris neutre, contexte) ---
			try {
				const res = await fetch(railLinesUrl);
				if (res.ok) {
					map.addSource('rail-lines', { type: 'geojson', data: await res.json() });
					map.addLayer({
						id: 'rail-lines',
						type: 'line',
						source: 'rail-lines',
						paint: {
							'line-color': '#475569',
							'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 12, 1.5],
							'line-opacity': 0.5
						}
					});
				}
			} catch {
				/* pas de tracés : on ignore */
			}

			// --- Couverture ARCEP : la VOIE colorée selon l'usage possible (théorique) ---
			try {
				const res = await fetch(arcepLinesUrl);
				if (res.ok) {
					const lines = (await res.json()) as GeoJSON.FeatureCollection;
					if (lines.features.length) {
						hasArcep = true;
						map.addSource('arcep-lines', { type: 'geojson', data: lines });
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
								// Trait large et un peu pâle : c'est le fond « théorique ».
								'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 12, 7],
								'line-opacity': 0.55
							}
						});
					}
				}
			} catch {
				/* couche ARCEP absente : la carte fonctionne sans */
			}

			// --- Mesures communautaires (le RÉEL, vif, par-dessus) ---
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

			// Popup ARCEP : ce qu'on peut faire ici (théorique).
			map.on('click', 'arcep-lines', (e) => {
				const f = e.features?.[0];
				if (!f || !map) return;
				const p = f.properties as Record<string, string>;
				const field = operator === 'inconnu' || operator === 'autre' ? 'best' : operator;
				const lvl = p[field] ?? null;
				new maplibregl.Popup()
					.setLngLat(e.lngLat)
					.setHTML(
						`<strong>Couverture théorique (ARCEP)</strong><br>${usageLabel(lvl)}` +
							`<br><span style="opacity:.7;font-size:.85em">Orange ${badge(p.orange)} · SFR ${badge(p.sfr)} · Free ${badge(p.free)} · Bouygues ${badge(p.bouygues)}</span>`
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
						`<strong>Mesuré par la communauté</strong><br>` +
							`${rate}% de réussite — ${usageFromRate(rate)}<br>` +
							`<span style="opacity:.7;font-size:.85em">Opérateur ${p.operator ?? 'inconnu'} · ${p.samples ?? 0} mesures · latence ${rtt}</span>`
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

			loaded = true;
		});

		return () => map?.remove();
	});

	function usageLabel(lvl: string | null): string {
		switch (lvl) {
			case 'TBC':
				return '🟢 Streaming vidéo, visio';
			case 'BC':
				return '🟡 Web, réseaux sociaux';
			case 'CL':
				return '🟠 Messages, navigation lente';
			default:
				return '🔴 Zone blanche — pas de réseau';
		}
	}
	function usageFromRate(rate: number): string {
		if (rate >= 80) return '🟢 ça capte bien';
		if (rate >= 40) return '🟠 réseau dégradé';
		return '🔴 ça coupe';
	}
	function badge(lvl: string | null | undefined): string {
		return lvl ?? '—';
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
	<div class="legend-overlay">
		<strong>Sur la voie, vous pourrez :</strong>
		<span><i style="background:#22c55e"></i> Streaming vidéo</span>
		<span><i style="background:#84cc16"></i> Web & réseaux sociaux</span>
		<span><i style="background:#f59e0b"></i> Messages seulement</span>
		<span><i style="background:#ef4444"></i> Rien (zone blanche)</span>
		<span class="real"
			><i style="background:#22c55e; border:2px solid #fff"></i> Mesuré en vrai</span
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
		background: rgba(11, 18, 32, 0.85);
		color: #e2e8f0;
		font-size: 0.72rem;
		padding: 0.5rem 0.7rem;
		border-radius: 8px;
		pointer-events: none;
		max-width: 220px;
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
		border-top: 1px solid rgba(255, 255, 255, 0.15);
		padding-top: 3px;
	}
</style>
