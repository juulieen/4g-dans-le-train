<script lang="ts">
	import { onMount } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { cellToBoundary } from 'h3-js';
	import { USAGE_COLORS, usageLabel, rateToLevel } from '$lib/usage';
	import { worstByCell, type CellRate } from '$lib/coverage-quality';

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
	// Derniers segments « réel » récupérés : conservés pour ré-alimenter la source après
	// un setStyle (bascule de thème), qui repart d'un style vierge et ne re-déclenche pas
	// le $effect de fetch (lui ne dépend que de coverage/operator, pas du thème).
	let lastSegments: GeoJSON.FeatureCollection = EMPTY;

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

	/** Opérateur précis sélectionné (sinon vue « tous » → agrégation « pire »). */
	function isSpecificOp(op: string): boolean {
		return op !== 'inconnu' && op !== 'autre';
	}

	/**
	 * Expression MapLibre : couleur d'une mesure communautaire selon le niveau d'usage
	 * `quality` (3 paliers du réel : TBC/CL/none). Partagée par le ruban (segments) et
	 * le quadrillage H3.
	 */
	function communityColor(): maplibregl.ExpressionSpecification {
		return [
			'match',
			['get', 'quality'],
			'TBC',
			USAGE_COLORS.TBC,
			'CL',
			USAGE_COLORS.CL,
			USAGE_COLORS.none // défaut = ça coupe
		] as unknown as maplibregl.ExpressionSpecification;
	}

	// Couleurs du « cerclage » du réel, contrastées avec le fond de carte (les
	// expressions MapLibre ne peuvent pas lire les variables CSS thématisées).
	const REAL_EDGE_DARK = '#ffffff'; // sur basemap sombre
	const REAL_EDGE_LIGHT = '#0f172a'; // sur basemap clair (positron)

	/**
	 * Couleur du « cerclage » du réel (liseré du ruban, contour des hexagones) : doit
	 * CONTRASTER avec le fond de carte (sinon le liseré blanc disparaît sur le basemap
	 * clair). Recalculée à chaque bascule de thème, qui passe par setStyle → addOverlays
	 * (recrée les couches).
	 */
	function realEdgeColor(): string {
		return currentTheme() === 'light' ? REAL_EDGE_LIGHT : REAL_EDGE_DARK;
	}

	/**
	 * Quadrillage H3 (zoom fort) construit côté client à partir des points `/api/coverage` :
	 * chaque cellule mesurée devient un hexagone (`cellToBoundary`) colorié par son niveau.
	 * En vue « tous opérateurs », on retient le PIRE taux par cellule (`worstByCell`).
	 */
	function buildHexFC(fc: GeoJSON.FeatureCollection | null, op: string): GeoJSON.FeatureCollection {
		if (!fc) return EMPTY;
		const rows: CellRate[] = fc.features.map((f) => {
			const p = f.properties as Record<string, unknown>;
			const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
			return {
				cellId: String(p.cellId),
				operator: String(p.operator),
				successRate: Number(p.successRate),
				samples: Number(p.samples ?? 0),
				lat,
				lng
			};
		});
		const cells = isSpecificOp(op)
			? rows
					.filter((r) => r.operator === op)
					.map((r) => ({
						cellId: r.cellId,
						rate: r.successRate,
						samples: r.samples,
						operator: r.operator
					}))
			: [...worstByCell(rows).values()].map((c) => ({
					cellId: c.cellId,
					rate: c.rate,
					samples: c.samples,
					operator: c.operator
				}));
		const features: GeoJSON.Feature[] = cells.map((c) => {
			// cellToBoundary renvoie [[lat, lng], …] ; GeoJSON veut [lng, lat] + anneau fermé.
			const ring = cellToBoundary(c.cellId).map(([lat, lng]) => [lng, lat] as [number, number]);
			ring.push(ring[0]);
			return {
				type: 'Feature',
				geometry: { type: 'Polygon', coordinates: [ring] },
				properties: {
					quality: rateToLevel(c.rate),
					rate: Math.round(c.rate * 100),
					samples: c.samples,
					operator: c.operator
				}
			};
		});
		return { type: 'FeatureCollection', features };
	}

	/** Récupère les segments « réel » le long des voies pour l'opérateur courant. */
	async function fetchSegments(op: string): Promise<GeoJSON.FeatureCollection> {
		const qs = isSpecificOp(op) ? `?operator=${encodeURIComponent(op)}` : '';
		try {
			const res = await fetch(`/api/coverage/segments${qs}`);
			if (res.ok) return (await res.json()) as GeoJSON.FeatureCollection;
		} catch {
			/* segments indisponibles : la carte reste utilisable (quadrillage au zoom) */
		}
		return EMPTY;
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
						// Légèrement en retrait (le réel prime), mais toujours bien lisible.
						'line-opacity': 0.8,
						'line-blur': 0.6
					}
				});
			}
		}

		// Mesures communautaires (le RÉEL, vif, par-dessus) — rendu progressif au zoom :
		//   • zoom faible/moyen → RUBAN coloré le long de la voie (lisible, suit le rail) ;
		//   • zoom fort → QUADRILLAGE H3 (les vraies cellules ~174 m, honnête sur la granularité).
		// Fondu croisé entre les deux autour du zoom 11→13.
		const vis = showCommunity ? 'visible' : 'none';
		// Le ruban « réel » se distingue de la voie ARCEP par un LISERÉ BLANC (casing) :
		// reprend la signature « cerclé de blanc = vrai » des anciennes pastilles, fait
		// flotter le réel au-dessus du théorique. Le fondu (opacité) accompagne la bascule
		// vers le quadrillage H3 au zoom fort (13).
		const segFade: maplibregl.ExpressionSpecification = [
			'interpolate',
			['linear'],
			['zoom'],
			5,
			0.95,
			11,
			0.95,
			13,
			0
		];
		if (!map.getSource('community-segments')) {
			map.addSource('community-segments', { type: 'geojson', data: lastSegments });
			// 1) Liseré blanc (dessous, plus large) — la « bordure » du ruban.
			map.addLayer({
				id: 'community-segments-casing',
				type: 'line',
				source: 'community-segments',
				layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
				paint: {
					'line-color': realEdgeColor(),
					'line-width': ['interpolate', ['linear'], ['zoom'], 5, 7, 11, 12],
					'line-opacity': segFade
				}
			});
			// 2) Cœur coloré (dessus, plus étroit) — l'usage mesuré.
			map.addLayer({
				id: 'community-segments',
				type: 'line',
				source: 'community-segments',
				layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
				paint: {
					'line-color': communityColor(),
					'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 11, 8],
					'line-opacity': segFade
				}
			});
		}
		if (!map.getSource('community-hex')) {
			map.addSource('community-hex', { type: 'geojson', data: buildHexFC(coverage, operator) });
			map.addLayer({
				id: 'community-hex-fill',
				type: 'fill',
				source: 'community-hex',
				layout: { visibility: vis },
				paint: {
					'fill-color': communityColor(),
					'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.5]
				}
			});
			map.addLayer({
				id: 'community-hex-outline',
				type: 'line',
				source: 'community-hex',
				layout: { visibility: vis },
				paint: {
					// Contour contrasté (blanc en sombre, foncé en clair) : même signature
					// « réel = cerclé » que le ruban, visible sur les deux fonds de carte.
					'line-color': realEdgeColor(),
					'line-width': 1.5,
					'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.95]
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
		// `{ diff: false }` force un style VIERGE (pas de diff) : nos couches métier sont
		// donc toujours supprimées puis recréées par `addOverlays` — garantit que le
		// cerclage du réel (`realEdgeColor()`) reprend bien la couleur du nouveau thème.
		// `styledata` (après parsing du nouveau style) est le moment fiable pour ré-ajouter.
		// addOverlays est idempotent (gardes getSource) → pas de doublon.
		const observer = new MutationObserver(() => {
			if (!map) return;
			map.setStyle(basemapStyle(currentTheme()), { diff: false });
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

		// Popup ARCEP : ce qu'on peut faire ici (théorique) + lignes qui passent ici.
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
			const baseHtml =
				`<strong>Couverture théorique (ARCEP)</strong>` +
				`<div style="margin:.35em 0">${usageLabel(lvl)}</div>` +
				`<div style="font-size:.82em;color:var(--muted)">${opLine}</div>`;
			const popup = new maplibregl.Popup().setLngLat(e.lngLat).setHTML(baseHtml).addTo(map);

			// Quelles lignes commerciales passent ici ? Rattachement par cellule H3
			// côté serveur (line-index.json), ajouté à la popup quand la réponse
			// arrive (si la popup est toujours ouverte).
			void fetchLinesAt(e.lngLat.lat, e.lngLat.lng).then((lines) => {
				if (!popup.isOpen()) return;
				popup.setHTML(baseHtml + linesSection(lines));
			});
		});

		// Popup mesure communautaire — RUBAN (tronçon mesuré, zoom faible/moyen). Branché
		// sur le cœur coloré ET le liseré (casing) : le liseré déborde de ~2px et partage
		// la même source, donc un clic sur sa frange ouvre bien la même popup.
		const segmentPopup = (e: maplibregl.MapLayerMouseEvent) => {
			const f = e.features?.[0];
			if (!f || !map) return;
			const p = f.properties as Record<string, unknown>;
			new maplibregl.Popup()
				.setLngLat(e.lngLat)
				.setHTML(
					`<strong>Tronçon mesuré par la communauté</strong>` +
						`<div style="margin:.35em 0">${usageLabel(String(p.quality))}</div>` +
						`<div style="font-size:.82em;color:var(--muted)">${opLabel(p.operator)} · ${p.samples ?? 0} mesures</div>`
				)
				.addTo(map);
		};
		map.on('click', 'community-segments', segmentPopup);
		map.on('click', 'community-segments-casing', segmentPopup);

		// Popup mesure communautaire — CELLULE H3 (zoom fort).
		map.on('click', 'community-hex-fill', (e) => {
			const f = e.features?.[0];
			if (!f || !map) return;
			const p = f.properties as Record<string, unknown>;
			new maplibregl.Popup()
				.setLngLat(e.lngLat)
				.setHTML(
					`<strong>Cellule mesurée (~150 m)</strong>` +
						`<div style="margin:.35em 0">${usageLabel(String(p.quality))} — ${p.rate ?? 0}% de réussite</div>` +
						`<div style="font-size:.82em;color:var(--muted)">${opLabel(p.operator)} · ${p.samples ?? 0} mesures</div>`
				)
				.addTo(map);
		});

		for (const layer of [
			'arcep-lines',
			'community-segments',
			'community-segments-casing',
			'community-hex-fill'
		]) {
			map.on('mouseenter', layer, () => {
				if (map) map.getCanvas().style.cursor = 'pointer';
			});
			map.on('mouseleave', layer, () => {
				if (map) map.getCanvas().style.cursor = '';
			});
		}
	}

	/**
	 * Libellé opérateur d'une popup « réel » : en vue « tous », la valeur est le PIRE
	 * opérateur du segment/cellule → on le dit explicitement pour ne pas laisser croire
	 * que seul cet opérateur est concerné.
	 */
	function opLabel(op: unknown): string {
		const name = op ?? 'inconnu';
		return isSpecificOp(operator) ? `Opérateur ${name}` : `Pire opérateur mesuré : ${name}`;
	}

	type LineHit = { slug: string; name: string; service: string };

	/** Lignes commerciales passant par une position cliquée (via /api/lines). */
	async function fetchLinesAt(lat: number, lng: number): Promise<LineHit[]> {
		try {
			const res = await fetch(`/api/lines?lat=${lat}&lng=${lng}`);
			if (!res.ok) return [];
			const data = (await res.json()) as { lines?: LineHit[] };
			return data.lines ?? [];
		} catch {
			return [];
		}
	}

	/** Section « Lignes qui passent ici » de la popup ARCEP (liens vers /ligne/…). */
	function linesSection(lines: LineHit[]): string {
		if (!lines.length) return '';
		// Sur un nœud (gare), une cellule peut porter beaucoup de lignes : on en
		// montre les plus pertinentes (les premières = les plus spécifiques) et on
		// résume le reste.
		const MAX = 6;
		const shown = lines.slice(0, MAX);
		const rest = lines.length - shown.length;
		const items = shown
			.map(
				(l) =>
					`<a href="/ligne/${l.slug}" style="display:block;color:var(--text);text-decoration:none">` +
					`<strong style="font-weight:600">${l.name}</strong>` +
					`<span style="color:var(--muted);font-size:.82em"> · ${l.service}</span></a>`
			)
			.join('');
		const more =
			rest > 0
				? `<div style="font-size:.82em;color:var(--muted)">+${rest} autre${rest > 1 ? 's' : ''}</div>`
				: '';
		return (
			`<div style="margin-top:.5em;padding-top:.4em;border-top:1px solid var(--glass-border)">` +
			`<div style="font-size:.82em;color:var(--muted);margin-bottom:.25em">Lignes qui passent ici</div>` +
			`<div style="display:flex;flex-direction:column;gap:.2em">${items}${more}</div></div>`
		);
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

	// Rafraîchit les mesures communautaires quand la couverture ou l'opérateur change :
	//   • quadrillage H3 → reconstruit côté client depuis les points ;
	//   • ruban → re-fetch des segments (filtré/agrégé côté serveur).
	$effect(() => {
		if (!loaded || !map) return;
		// Lecture explicite pour que l'effet se redéclenche sur ces deux dépendances.
		const cov = coverage;
		const op = operator;
		const hexSrc = map.getSource('community-hex') as maplibregl.GeoJSONSource | undefined;
		hexSrc?.setData(buildHexFC(cov, op));

		// Garde anti-course : une réponse périmée (opérateur changé) ne doit pas écraser.
		let cancelled = false;
		void fetchSegments(op).then((fc) => {
			if (cancelled || !map) return;
			lastSegments = fc;
			const segSrc = map.getSource('community-segments') as maplibregl.GeoJSONSource | undefined;
			segSrc?.setData(fc);
		});
		return () => {
			cancelled = true;
		};
	});

	// Visibilité des couches + recoloration ARCEP selon l'opérateur.
	$effect(() => {
		if (!loaded || !map) return;
		const vis = showCommunity ? 'visible' : 'none';
		for (const id of [
			'community-segments-casing',
			'community-segments',
			'community-hex-fill',
			'community-hex-outline'
		]) {
			if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
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
			><i style="background:var(--usage-tbc)"></i> Mesuré en vrai (ruban &amp; cellules, mêmes couleurs)</span
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
		width: 18px;
		height: 7px;
		border-radius: 4px;
		/* Bordure contrastée selon le thème (comme le cerclage du ruban sur la carte). */
		border: 1.5px solid var(--text);
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
