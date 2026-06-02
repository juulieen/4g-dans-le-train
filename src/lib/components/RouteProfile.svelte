<script lang="ts">
	import {
		USAGE_TEXT,
		USAGE_SHORT,
		USAGE_OPS,
		rateToLevel,
		type Level,
		type UsageOp
	} from '$lib/usage';

	let {
		slug,
		operator = 'best'
	}: {
		/** Slug commercial de la ligne (ex. `paris-lyon`). */
		slug: string;
		/** Opérateur affiché : `orange|sfr|free|bouygues` ou `best` (meilleur des 4). */
		operator?: string;
	} = $props();

	// --- Modèle de données (static/data/route-profiles/<slug>.json) -----------

	interface ArcepSeg {
		fromKm: number;
		toKm: number;
		orange: Level;
		sfr: Level;
		free: Level;
		bouygues: Level;
		best: Level;
	}
	interface StationP {
		name: string;
		distKm: number;
	}
	interface Profile {
		slug: string;
		name: string;
		from: string;
		to: string;
		lengthKm: number;
		stations: StationP[];
		arcep: ArcepSeg[];
		/** Polyligne simplifiée [lng, lat, distKm] pour situer mesures et coupures. */
		path: [number, number, number][];
	}
	interface RealPoint {
		distKm: number;
		level: Level;
		successRate: number;
		samples: number;
	}
	interface OutageP {
		distKm: number;
		durationS: number;
		lengthM: number;
		count: number;
	}

	/** Échelle horizontale : la frise est scrollable au pouce quand la ligne est longue. */
	const PX_PER_KM = 3.2;
	const MIN_TRACK_PX = 280;

	let profile = $state<Profile | null>(null);
	let loading = $state(true);
	let notFound = $state(false);
	let real = $state<RealPoint[]>([]);
	let outages = $state<OutageP[]>([]);

	const isSpecific = $derived((USAGE_OPS as readonly string[]).includes(operator));
	/** Champ ARCEP lu selon l'opérateur (ou `best` pour « tous »). */
	const arcepField = $derived<UsageOp | 'best'>(isSpecific ? (operator as UsageOp) : 'best');
	/** Opérateur précis à passer aux API réel/coupures (null = tous). */
	const specificOp = $derived(isSpecific ? (operator as UsageOp) : null);

	// `?? s.best` : garde défensive si un champ opérateur manquait dans le JSON
	// (en pratique toujours présent — `writeRouteProfiles` écrit les 4 ops + best).
	const segLevel = (s: ArcepSeg): Level => s[arcepField] ?? s.best;

	// --- Chargement du profil (au changement de ligne) ------------------------

	$effect(() => {
		const s = slug;
		// Garde anti-course : une réponse périmée (slug changé entre-temps) ne doit
		// pas écraser l'état courant. Invalidée par le cleanup de l'effet.
		let cancelled = false;
		loading = true;
		notFound = false;
		profile = null;
		real = [];
		outages = [];
		(async () => {
			try {
				const res = await fetch(`/data/route-profiles/${s}.json`);
				if (cancelled) return;
				if (!res.ok) {
					notFound = true;
				} else {
					const data = (await res.json()) as Profile;
					if (cancelled) return;
					profile = data;
				}
			} catch {
				if (!cancelled) notFound = true;
			} finally {
				if (!cancelled) loading = false;
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	/**
	 * Plus proche distance cumulée sur la polyligne (équirectangulaire approché).
	 * Limite connue : sur une ligne qui se replie (un tronçon parcouru deux fois,
	 * ex. `paris-annecy`), un point peut se projeter sur la mauvaise branche et donc
	 * sur un mauvais km. Impact faible aujourd'hui (peu de mesures réelles, écart
	 * visuel mineur) ; un placement par continuité serait nécessaire pour le lever.
	 */
	function distOf(p: Profile, lng: number, lat: number): number | null {
		let best = Infinity;
		let dist = 0;
		for (const [x, y, d] of p.path) {
			const mLat = (((lat + y) / 2) * Math.PI) / 180;
			const dx = (lng - x) * Math.cos(mLat);
			const dy = lat - y;
			const dd = dx * dx + dy * dy;
			if (dd < best) {
				best = dd;
				dist = d;
			}
		}
		// best en degrés² ; ~5 km ≈ 0.045° → 0.002 en carré. Au-delà : point hors ligne.
		return best <= 0.0025 ? dist : null;
	}

	// --- Chargement des couches réel + coupures (au changement ligne/opérateur) --

	$effect(() => {
		const p = profile;
		const op = specificOp;
		if (!p) return;
		// Réinitialise les couches : au changement d'opérateur (profil inchangé) on ne
		// doit pas laisser s'afficher les mesures de l'opérateur précédent en attendant.
		real = [];
		outages = [];
		// Garde anti-course : si ligne/opérateur changent avant la fin des fetch, on
		// ignore les réponses périmées (drapeau invalidé par le cleanup de l'effet).
		let cancelled = false;
		const qs = `line=${encodeURIComponent(p.slug)}${op ? `&operator=${op}` : ''}`;
		// Les deux couches sont chargées INDÉPENDAMMENT : un échec de /api/coverage ne
		// doit pas empêcher /api/outages (et inversement).
		(async () => {
			try {
				const r = await fetch(`/api/coverage?${qs}`);
				if (!cancelled && r.ok) {
					const fc = await r.json();
					if (!cancelled) {
						const pts: RealPoint[] = [];
						for (const f of fc.features ?? []) {
							const [lng, lat] = f.geometry.coordinates;
							const d = distOf(p, lng, lat);
							if (d === null) continue;
							const rate = Number(f.properties.successRate) || 0;
							pts.push({
								distKm: d,
								level: rateToLevel(rate),
								successRate: rate,
								samples: Number(f.properties.samples) || 0
							});
						}
						pts.sort((a, b) => a.distKm - b.distKm);
						real = pts;
					}
				}
			} catch {
				/* réel indisponible : la frise reste théorique */
			}
		})();
		(async () => {
			try {
				const r = await fetch(`/api/outages?${qs}`);
				if (!cancelled && r.ok) {
					const fc = await r.json();
					if (!cancelled) {
						const os: OutageP[] = [];
						for (const f of fc.features ?? []) {
							const [lng, lat] = f.geometry.coordinates;
							const d = distOf(p, lng, lat);
							if (d === null) continue;
							os.push({
								distKm: d,
								durationS: Number(f.properties.medianDurationS) || 0,
								lengthM: Number(f.properties.medianLengthM) || 0,
								count: Number(f.properties.count) || 0
							});
						}
						os.sort((a, b) => a.distKm - b.distKm);
						outages = os;
					}
				}
			} catch {
				/* coupures indisponibles */
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	// --- Helpers d'affichage --------------------------------------------------

	const pct = (km: number) => (profile && profile.lengthKm > 0 ? (km / profile.lengthKm) * 100 : 0);
	const trackPx = $derived(
		profile ? Math.max(MIN_TRACK_PX, Math.round(profile.lengthKm * PX_PER_KM)) : MIN_TRACK_PX
	);

	const fmtDist = (km: number) => (km >= 1 ? `${km.toFixed(0)} km` : `${Math.round(km * 1000)} m`);
	const fmtDur = (s: number) => (s >= 60 ? `~${Math.round(s / 60)} min` : `~${Math.round(s)} s`);
	const fmtLen = (m: number) =>
		m >= 1000 ? `~${(m / 1000).toFixed(1)} km` : `~${Math.round(m)} m`;

	/** Résumé textuel pour lecteurs d'écran + accessibilité (palette rouge↔vert). */
	const summary = $derived.by(() => {
		const p = profile;
		if (!p) return '';
		const byLevel: Record<Level, number> = { TBC: 0, BC: 0, CL: 0, none: 0 };
		for (const s of p.arcep) byLevel[segLevel(s)] += s.toKm - s.fromKm;
		const total = p.lengthKm || 1;
		const goodPct = Math.round(((byLevel.TBC + byLevel.BC) / total) * 100);
		const whiteKm = Math.round(byLevel.none);
		const whitePart =
			whiteKm > 0
				? ` Environ ${whiteKm} km en zone blanche (rien).`
				: ' Aucune zone blanche notable.';
		return (
			`Profil de couverture ${p.from} vers ${p.to}, ${p.lengthKm} km. ` +
			`Couverture confortable (web ou mieux) sur ${goodPct} % du trajet.${whitePart}` +
			(real.length
				? ` ${real.length} segments mesurés en réel.`
				: ' Pas encore de mesures réelles.')
		);
	});

	/** Libellé accessible de la figure selon l'état (évite un `aria-label=""` au chargement). */
	const figureLabel = $derived(
		loading
			? 'Chargement du profil de trajet…'
			: notFound
				? 'Profil de trajet indisponible pour cette ligne'
				: summary
	);
</script>

<figure class="route-profile glass" role="img" aria-label={figureLabel} aria-busy={loading}>
	<figcaption class="head">
		<strong>Profil du trajet&nbsp;: {profile?.name ?? slug}</strong>
		{#if profile}
			<span class="sub">{profile.from} → {profile.to} · {profile.lengthKm} km</span>
		{/if}
	</figcaption>

	{#if loading}
		<p class="state">Chargement du profil…</p>
	{:else if notFound}
		<p class="state">Profil de trajet indisponible pour cette ligne.</p>
	{:else if profile}
		<div class="legend" aria-hidden="true">
			<span><i class="sw lvl-TBC"></i> {USAGE_SHORT.TBC}</span>
			<span><i class="sw lvl-BC"></i> {USAGE_SHORT.BC}</span>
			<span><i class="sw lvl-CL"></i> {USAGE_SHORT.CL}</span>
			<span><i class="sw lvl-none"></i> {USAGE_SHORT.none}</span>
			<span class="sep"><i class="sw real"></i> Mesuré en vrai</span>
			<span><i class="x">✕</i> Coupure</span>
		</div>

		<!-- tabindex : permet le défilement horizontal au clavier (frise scrollable). -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			class="scroll"
			tabindex="0"
			role="group"
			aria-label="Frise de couverture, défilement horizontal"
		>
			<div class="track" style="width:{trackPx}px">
				<!-- Coupures (au-dessus de la frise) -->
				{#each outages as o, i (i)}
					<div
						class="outage"
						style="left:{pct(o.distKm)}%"
						title="Coupure {fmtDur(o.durationS)} / {fmtLen(o.lengthM)} ({o.count} obs.)"
					>
						✕<small>{fmtDur(o.durationS)}</small>
					</div>
				{/each}

				<!-- Fond théorique ARCEP (pâle, large) -->
				<div class="band arcep">
					{#each profile.arcep as s (s.fromKm)}
						<div
							class="seg lvl-{segLevel(s)}"
							style="left:{pct(s.fromKm)}%;width:{pct(s.toKm - s.fromKm)}%"
							title="{fmtDist(s.fromKm)}–{fmtDist(s.toKm)} : {USAGE_TEXT[segLevel(s)]}"
						></div>
					{/each}
				</div>

				<!-- Mesures réelles (vives, par-dessus — le réel prime) -->
				{#each real as r, i (i)}
					<div
						class="real-tick lvl-{r.level}"
						style="left:{pct(r.distKm)}%"
						title="Mesuré : {Math.round(r.successRate * 100)} % de réussite ({r.samples} mesures)"
					></div>
				{/each}

				<!-- Gares -->
				<div class="stations">
					{#each profile.stations as st, i (i)}
						<div
							class="station"
							class:at-start={i === 0}
							class:at-end={i === profile.stations.length - 1}
							style="left:{pct(st.distKm)}%"
						>
							<span class="stick"></span>
							<span class="slabel"><b>{st.name}</b><em>{fmtDist(st.distKm)}</em></span>
						</div>
					{/each}
				</div>
			</div>
		</div>

		{#if real.length === 0}
			<p class="hint">
				Pas encore de mesures communautaires sur cette ligne : la frise montre la couverture
				<strong>théorique (ARCEP)</strong>. Activez le mode mesure dans le train pour la confronter
				au réel.
			</p>
		{/if}
		<p class="sr-only">{summary}</p>
	{/if}
</figure>

<style>
	.route-profile {
		border-radius: var(--r-lg);
		padding: 0.8rem 0.9rem 0.6rem;
		color: var(--text);
		margin: 1rem 0;
		max-width: 100%;
		box-sizing: border-box;
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 0.6rem;
	}
	.head strong {
		font-size: 0.95rem;
	}
	.head .sub {
		color: var(--muted);
		font-size: 0.8rem;
	}
	.state {
		color: var(--muted);
		font-size: 0.85rem;
		padding: 0.5rem 0;
	}

	/* Légende */
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		font-size: 0.72rem;
		color: var(--muted);
		margin-bottom: 0.7rem;
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.legend .sep {
		border-left: 1px solid var(--glass-border);
		padding-left: 12px;
	}
	.sw {
		display: inline-block;
		width: 16px;
		height: 8px;
		border-radius: 3px;
		flex: none;
	}
	.sw.real {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 2px solid #fff;
	}
	.legend .x {
		color: var(--usage-none);
		font-weight: 700;
		font-style: normal;
	}

	/* Couleurs par niveau (réutilise les tokens thématisés). */
	.lvl-TBC {
		background: var(--usage-tbc);
	}
	.lvl-BC {
		background: var(--usage-bc);
	}
	.lvl-CL {
		background: var(--usage-cl);
	}
	.lvl-none {
		background: var(--usage-none);
	}

	/* Conteneur scrollable (mobile : défilement horizontal au pouce). */
	.scroll {
		overflow-x: auto;
		overflow-y: hidden;
		-webkit-overflow-scrolling: touch;
		padding-bottom: 4px;
		scrollbar-width: thin;
	}
	.scroll:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: var(--r-sm);
	}
	.track {
		position: relative;
		min-width: 100%;
		height: 104px;
	}

	/* Frise ARCEP (fond théorique, légèrement atténué). */
	.band.arcep {
		position: absolute;
		top: 34px;
		left: 0;
		width: 100%;
		height: 18px;
		border-radius: 5px;
		overflow: hidden;
		opacity: 0.72;
	}
	.seg {
		position: absolute;
		top: 0;
		height: 100%;
	}
	/* Zone blanche : hachures en plus du rouge (lisible sans la couleur — daltoniens). */
	.seg.lvl-none {
		background-image: repeating-linear-gradient(
			45deg,
			rgba(0, 0, 0, 0.45) 0 3px,
			transparent 3px 6px
		);
		background-color: var(--usage-none);
	}

	/* Mesures réelles : pastilles vives cerclées de blanc, par-dessus le théorique. */
	.real-tick {
		position: absolute;
		top: 30px;
		width: 9px;
		height: 26px;
		margin-left: -4.5px;
		border-radius: 4px;
		border: 2px solid #fff;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
	}

	/* Coupures. */
	.outage {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		color: var(--usage-none);
		font-weight: 700;
		font-size: 0.8rem;
		line-height: 1;
	}
	.outage small {
		font-size: 0.6rem;
		font-weight: 600;
		white-space: nowrap;
	}

	/* Gares. */
	.stations {
		position: absolute;
		top: 52px;
		left: 0;
		width: 100%;
		height: 52px;
	}
	.station {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	/* Aux extrémités : on ancre le label côté intérieur pour éviter qu'il soit
	   rogné par le bord (et le défilement) de la frise. */
	.station.at-start {
		transform: translateX(0);
		align-items: flex-start;
	}
	.station.at-start .slabel {
		align-items: flex-start;
		text-align: left;
	}
	.station.at-end {
		transform: translateX(-100%);
		align-items: flex-end;
	}
	.station.at-end .slabel {
		align-items: flex-end;
		text-align: right;
	}
	.stick {
		width: 2px;
		height: 12px;
		background: var(--text);
		opacity: 0.5;
	}
	.slabel {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin-top: 2px;
		max-width: 92px;
		text-align: center;
		hyphens: auto;
	}
	.slabel b {
		font-size: 0.66rem;
		font-weight: 600;
		line-height: 1.1;
	}
	.slabel em {
		font-style: normal;
		font-size: 0.6rem;
		color: var(--muted);
	}

	.hint {
		font-size: 0.78rem;
		color: var(--muted);
		margin: 0.6rem 0 0.2rem;
		line-height: 1.45;
	}
	.hint strong {
		color: var(--text);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
