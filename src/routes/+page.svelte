<script lang="ts">
	import { onDestroy, getContext } from 'svelte';
	import Map from '$components/Map.svelte';
	import Icon from '$components/Icon.svelte';
	import RouteProfile from '$components/RouteProfile.svelte';
	import HintChip from '$components/Onboarding/HintChip.svelte';
	import { RAIL_LINES } from '$geo/lines';
	import { MeasurementController, type LiveState, type Operator } from '$measure/controller';
	import {
		hasConsent,
		grantConsent,
		revokeConsent,
		hasOnboarded,
		markOnboarded,
		getThroughputOptIn,
		setThroughputOptIn
	} from '$measure/session';
	import { levelFromKbps, USAGE_TEXT, USAGE_COLORS } from '$lib/usage';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const OPERATORS: { value: Operator; label: string }[] = [
		{ value: 'orange', label: 'Orange' },
		{ value: 'sfr', label: 'SFR' },
		{ value: 'free', label: 'Free' },
		{ value: 'bouygues', label: 'Bouygues' },
		{ value: 'autre', label: 'Autre' },
		{ value: 'inconnu', label: 'Je ne sais pas' }
	];

	let operator = $state<Operator>('inconnu');
	let consent = $state(false);
	// Opt-in débit (OFF par défaut ; consomme la data mobile de l'utilisateur).
	let measureThroughput = $state(false);
	let showArcep = $state(true);
	let showCommunity = $state(true);
	// Filtre d'AFFICHAGE de la carte (distinct de l'opérateur du mode mesure).
	let viewOperator = $state<string>('inconnu');
	// Ligne sélectionnée pour afficher son « profil de trajet » (frise). Vide = aucune.
	let selectedLine = $state<string>('');
	const sortedLines = [...RAIL_LINES].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
	let live = $state<LiveState | null>(null);
	// État local initialisé une fois avec la couverture SSR, puis rafraîchi
	// localement après chaque mesure (refreshCoverage) — lecture initiale voulue.
	// svelte-ignore state_referenced_locally
	let coverage = $state(data.coverage);

	let controller: MeasurementController | null = null;

	$effect(() => {
		consent = hasConsent();
		measureThroughput = getThroughputOptIn();
	});

	function ensureController(): MeasurementController {
		if (!controller) {
			controller = new MeasurementController({
				operator,
				onState: (s) => (live = s),
				measureThroughput
			});
		}
		controller.setOperator(operator);
		controller.setMeasureThroughput(measureThroughput);
		return controller;
	}

	function toggleThroughput() {
		measureThroughput = !measureThroughput;
		setThroughputOptIn(measureThroughput);
		controller?.setMeasureThroughput(measureThroughput);
	}

	async function toggleMeasure() {
		const c = ensureController();
		if (live?.running) {
			await c.stop();
			await refreshCoverage();
		} else {
			if (!consent) {
				grantConsent();
				consent = true;
			}
			await c.start();
		}
	}

	function toggleConsent() {
		if (consent) {
			revokeConsent();
			consent = false;
		} else {
			grantConsent();
			consent = true;
		}
	}

	async function refreshCoverage() {
		try {
			const res = await fetch('/api/coverage');
			if (res.ok) coverage = await res.json();
		} catch {
			/* ignore */
		}
	}

	onDestroy(() => {
		void controller?.stop();
	});

	const statusLabel: Record<string, string> = {
		idle: 'En attente',
		ok: 'Ça capte ✅',
		degraded: 'Réseau dégradé ⚠️',
		none: 'Pas de réseau ❌'
	};

	// Total « points enregistrés » : envoyés + en file (hors-ligne) + bufferisés (trou
	// GPS). Ne décroît jamais → compteur rassurant qui monte en continu, même hors
	// réseau et sous un tunnel. Évite aussi le clignotement de l'ancien « 1 en attente ».
	const captured = $derived((live?.sent ?? 0) + (live?.queued ?? 0) + (live?.buffered ?? 0));

	// Ligne d'état de synchro, toujours rendue (hauteur réservée → pas de saut d'UI).
	// Le texte change selon l'état ; le but est de rassurer : rien n'est perdu.
	const syncInfo = $derived.by(() => {
		if (!live?.running) return { cls: 'idle', text: '' };
		const b = live.buffered ?? 0;
		if (b > 0)
			return {
				cls: 'buffering',
				text: `📍 ${b} point${b > 1 ? 's' : ''} capturé${b > 1 ? 's' : ''} sans GPS — position recalée au retour du signal`
			};
		if (live.queued > 0)
			return {
				cls: 'pending',
				text: `⏳ ${live.queued} point${live.queued > 1 ? 's' : ''} gardé${live.queued > 1 ? 's' : ''} hors-ligne — envoi au retour du réseau`
			};
		return { cls: 'synced', text: '✓ Tout est synchronisé' };
	});

	/** Durée lisible : « 25 s », « 1 min 40 s », « 3 min ». */
	function formatDuree(s: number): string {
		const sec = Math.round(s);
		if (sec < 60) return `${sec} s`;
		const min = Math.floor(sec / 60);
		const reste = sec % 60;
		return reste ? `${min} min ${reste} s` : `${min} min`;
	}

	/** Longueur lisible : « 300 m », « 1,2 km ». */
	function formatLongueur(m: number): string {
		return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
	}

	// --- Présentation : bottom-sheet + onboarding (aucune logique métier) ---
	const ui = getContext<{ openOnboarding: () => void }>('ui');

	let sheetExpanded = $state(false);
	let showHint = $state(false);

	// --- Bottom-sheet : glisser pour ouvrir/fermer (mobile) ---
	let sheetEl: HTMLElement | undefined = $state();
	let dragging = $state(false);
	let dragTranslate = $state(0);
	let dragStartY = 0;
	let dragStartTranslate = 0;
	let dragMoved = 0;
	let suppressClick = false;

	function collapsedPx(): number {
		if (!sheetEl) return 0;
		// Source unique de vérité = la variable CSS --peek (définie plus bas).
		const peek = parseFloat(getComputedStyle(sheetEl).getPropertyValue('--peek')) || 188;
		return sheetEl.offsetHeight - peek;
	}
	function onHandleDown(e: PointerEvent) {
		if (window.innerWidth > 760) return; // drag mobile uniquement
		dragging = true;
		dragMoved = 0;
		dragStartY = e.clientY;
		dragStartTranslate = sheetExpanded ? 0 : collapsedPx();
		dragTranslate = dragStartTranslate;
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
			/* capture indisponible : le drag reste fonctionnel sans */
		}
	}
	function onHandleMove(e: PointerEvent) {
		if (!dragging) return;
		const dy = e.clientY - dragStartY;
		dragMoved = Math.max(dragMoved, Math.abs(dy));
		dragTranslate = Math.min(Math.max(dragStartTranslate + dy, 0), collapsedPx());
	}
	function onHandleUp() {
		if (!dragging) return;
		dragging = false;
		if (dragMoved < 6) return; // tap : on laisse le clic basculer
		suppressClick = true; // c'était un glissement : on neutralise le clic suivant
		sheetExpanded = dragTranslate < collapsedPx() / 2;
	}
	function onHandleClick() {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		sheetExpanded = !sheetExpanded;
	}

	// Lecture seule : on n'écrit jamais la persistance ici (sinon la 1re visite
	// serait « consommée » sans avoir rien montré).
	$effect(() => {
		if (!hasOnboarded()) showHint = true;
	});

	function dismissHint() {
		showHint = false;
		markOnboarded();
	}
	function openOnboarding() {
		if (showHint) dismissHint();
		ui?.openOnboarding();
	}
	function onMapInteract() {
		// Premier geste sur la carte = l'utilisateur sait naviguer : on retire l'invite.
		if (showHint) dismissHint();
	}
</script>

<svelte:head>
	<title>4G dans le train — carte de la couverture mobile sur les lignes SNCF</title>
	<meta
		name="description"
		content="Carte communautaire de la couverture mobile (4G/5G) dans le train en France. Voyez où ça capte sur votre trajet SNCF et contribuez vos mesures."
	/>
	<link rel="canonical" href="https://4g-dans-le-train.juulieen.fr/" />
	<meta property="og:title" content="4G dans le train — couverture mobile sur les lignes SNCF" />
	<meta
		property="og:description"
		content="Voyez où ça capte (et où ça coupe) sur votre trajet en train. Données communautaires + ARCEP."
	/>
	<meta property="og:type" content="website" />
</svelte:head>

<section class="layout">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="map-wrap" onpointerdown={onMapInteract}>
		<Map {coverage} operator={viewOperator} {showArcep} {showCommunity} />
		<button
			class="info-fab glass"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={openOnboarding}
			aria-label="Comment ça marche"
		>
			<Icon name="info" size={20} />
		</button>
	</div>

	{#if showHint}
		<HintChip onopen={openOnboarding} ondismiss={dismissHint} />
	{/if}

	<div
		class="sheet glass"
		class:expanded={sheetExpanded}
		class:dragging
		bind:this={sheetEl}
		style={dragging ? `transform: translateY(${dragTranslate}px)` : ''}
	>
		<button
			class="sheet-handle"
			onpointerdown={onHandleDown}
			onpointermove={onHandleMove}
			onpointerup={onHandleUp}
			onpointercancel={onHandleUp}
			onclick={onHandleClick}
			aria-label={sheetExpanded ? 'Réduire le panneau' : 'Ouvrir le panneau'}
			aria-expanded={sheetExpanded}
		>
			<span class="grip" aria-hidden="true"></span>
		</button>

		<aside class="panel">
			<h1>Où ça capte dans le train&nbsp;?</h1>
			<p class="lede">
				Carte communautaire de la couverture mobile le long des lignes SNCF.
				{#if data.cells > 0}
					<strong>{data.cells}</strong> zones mesurées.
				{:else}
					Soyez le premier à contribuer&nbsp;!
				{/if}
			</p>

			<label class="view-op" for="view-operator">
				Afficher la couverture de&nbsp;:
				<select id="view-operator" name="view-operator" bind:value={viewOperator}>
					<option value="inconnu">Tous les opérateurs</option>
					<option value="orange">Orange</option>
					<option value="sfr">SFR</option>
					<option value="free">Free</option>
					<option value="bouygues">Bouygues</option>
				</select>
			</label>

			<p class="explain">
				La <strong>voie est colorée</strong> selon ce que vous pourrez y faire (couverture théorique
				des opérateurs). Les <strong>pastilles cerclées de blanc</strong> sont les mesures réelles des
				voyageurs&nbsp;: là, c'est du vécu, pas de la théorie.
			</p>

			<div class="layers">
				<label>
					<input type="checkbox" name="show-arcep" bind:checked={showArcep} />
					Couverture théorique (voie colorée)
				</label>
				<label>
					<input type="checkbox" name="show-community" bind:checked={showCommunity} />
					Mesures réelles des voyageurs
				</label>
			</div>

			<label class="view-op" for="profile-line">
				Profil d'un trajet&nbsp;:
				<select id="profile-line" name="profile-line" bind:value={selectedLine}>
					<option value="">Choisir une ligne…</option>
					{#each sortedLines as l (l.slug)}
						<option value={l.slug}>{l.name}</option>
					{/each}
				</select>
			</label>
			{#if selectedLine}
				<RouteProfile slug={selectedLine} operator={viewOperator} />
			{/if}

			<div class="measure">
				<h2 class="measure-title">Mode mesure <Icon name="map" size={18} /></h2>
				<p class="hint">
					Sur mobile, dans le train&nbsp;: gardez cette page ouverte (l'écran reste allumé) et on
					mesure votre connexion en continu, de façon <strong>anonyme</strong>.
				</p>

				<label class="field" for="operator">
					Votre opérateur
					<select id="operator" name="operator" bind:value={operator} disabled={live?.running}>
						{#each OPERATORS as op (op.value)}
							<option value={op.value}>{op.label}</option>
						{/each}
					</select>
				</label>

				<label class="throughput-opt">
					<input
						type="checkbox"
						name="measure-throughput"
						checked={measureThroughput}
						onchange={toggleThroughput}
						disabled={live?.running}
					/>
					Mesurer aussi le débit
					<span class="data-warn">(~7,5 Mo/h, plafonné à 20 Mo)</span>
				</label>
				{#if measureThroughput && live?.running}
					<p class="data-used">
						Données du test de débit : <strong
							>{((live.dataUsedBytes ?? 0) / 1024 / 1024).toFixed(1)} Mo</strong
						>{#if live.throughputCapped}
							· plafond atteint, débit en pause{/if}
					</p>
				{/if}

				<button class="cta" class:running={live?.running} onclick={toggleMeasure}>
					{live?.running ? 'Arrêter la mesure' : 'Démarrer la mesure'}
				</button>

				{#if live?.error}
					<p class="error">{live.error}</p>
				{/if}

				{#if live?.running}
					<div class="live">
						<div class="big {live.status}">
							<span class="rec" aria-hidden="true"></span>
							{statusLabel[live.status] ?? live.status}
						</div>

						<div class="captured" aria-live="polite">
							<span class="count">{captured}</span>
							<span class="unit"
								>point{captured > 1 ? 's' : ''} enregistré{captured > 1 ? 's' : ''}</span
							>
						</div>
						<!-- Toujours rendue (hauteur réservée) → pas de saut de mise en page. -->
						<p class="sync {syncInfo.cls}">{syncInfo.text}</p>

						<dl>
							<div>
								<dt>Latence</dt>
								<dd>{live.rttMs != null ? `${live.rttMs} ms` : '—'}</dd>
							</div>
							{#if measureThroughput}
								<div>
									<dt>Débit</dt>
									<dd>
										{#if live.downlinkKbps != null}
											{(live.downlinkKbps / 1000).toFixed(1)} Mb/s
											<span
												class="usage-tag"
												style="color:{USAGE_COLORS[levelFromKbps(live.downlinkKbps)]}"
												>· {USAGE_TEXT[levelFromKbps(live.downlinkKbps)]}</span
											>
										{:else}
											—
										{/if}
									</dd>
								</div>
							{/if}
							<div>
								<dt>Vitesse</dt>
								<dd>{live.speedKmh != null ? `${Math.round(live.speedKmh)} km/h` : '—'}</dd>
							</div>
							<div>
								<dt>Précision GPS</dt>
								<dd>{live.accuracy != null ? `${Math.round(live.accuracy)} m` : '—'}</dd>
							</div>
							<div>
								<dt>Type réseau</dt>
								<dd>{live.netType ?? 'n/a'}</dd>
							</div>
							<div>
								<dt>Coupures</dt>
								<dd>{live.outages}</dd>
							</div>
							<div>
								<dt>Écran maintenu</dt>
								<dd>{live.wakeLockActive ? 'oui' : 'non'}</dd>
							</div>
						</dl>
						{#if live.lastOutage}
							<p class="queued-note">
								Dernière coupure : <strong>{formatDuree(live.lastOutage.durationS)}</strong
								>{#if live.lastOutage.lengthM > 0}
									· {formatLongueur(live.lastOutage.lengthM)}{/if}.
							</p>
						{/if}
					</div>
				{/if}

				<label class="consent">
					<input type="checkbox" name="consent" checked={consent} onchange={toggleConsent} />
					J'accepte de partager mes mesures anonymisées (position arrondie à ~150&nbsp;m, aucune donnée
					personnelle). <a href="/confidentialite">En savoir plus</a>
				</label>
			</div>
		</aside>
	</div>
</section>

<style>
	.layout {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.map-wrap {
		position: absolute;
		inset: 0;
		z-index: var(--z-map);
	}

	/* Bouton « Comment ça marche » flottant sur la carte (top-left : les contrôles
	   MapLibre zoom/géoloc sont en top-right). */
	.info-fab {
		position: absolute;
		top: 10px;
		left: 10px;
		z-index: var(--z-legend);
		width: 38px;
		height: 38px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		font-size: 1.05rem;
		cursor: pointer;
		padding: 0;
	}

	/* --- Bottom-sheet (mobile-first) --- */
	.sheet {
		position: absolute;
		left: 0;
		right: 0;
		bottom: var(--navbar-h);
		z-index: var(--z-sheet);
		height: min(82dvh, 640px);
		display: flex;
		flex-direction: column;
		border-radius: var(--r-xl) var(--r-xl) 0 0;
		--peek: 188px;
		transform: translateY(calc(100% - var(--peek)));
		transition: transform 0.36s cubic-bezier(0.32, 0.72, 0, 1);
	}
	.sheet.expanded {
		transform: translateY(0);
	}
	.sheet.dragging {
		transition: none;
	}
	.sheet-handle {
		flex: none;
		display: flex;
		justify-content: center;
		align-items: center;
		height: 26px;
		border: none;
		background: transparent;
		cursor: pointer;
		touch-action: none;
	}
	.grip {
		width: 42px;
		height: 5px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--text) 28%, transparent);
	}
	.panel {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 1.25rem 1.25rem;
		-webkit-overflow-scrolling: touch;
	}

	h1 {
		font-size: var(--fs-xl);
		margin: 0 0 0.4rem;
		letter-spacing: -0.01em;
	}
	h2 {
		font-size: var(--fs-lg);
		margin: 0 0 0.5rem;
	}
	.measure-title {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.measure-title :global(svg) {
		color: var(--accent);
	}
	.lede {
		color: var(--muted);
		margin-top: 0;
		font-size: var(--fs-md);
	}
	.view-op {
		display: block;
		font-size: var(--fs-sm);
		color: var(--text);
		font-weight: 600;
		margin-bottom: 0.75rem;
	}
	.view-op select {
		display: block;
		width: 100%;
		margin-top: 0.3rem;
		padding: 0.6rem;
		background: color-mix(in srgb, var(--panel) 60%, transparent);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		font-weight: 400;
		font-family: inherit;
	}
	.explain {
		font-size: 0.82rem;
		color: var(--muted);
		line-height: 1.5;
		margin: 0 0 0.75rem;
	}
	.layers {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: var(--muted);
		margin-bottom: 1rem;
	}
	.layers label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		min-height: 32px;
	}
	.measure {
		border-top: 1px solid var(--border);
		padding-top: 1rem;
	}
	.hint {
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.field {
		display: block;
		font-size: var(--fs-sm);
		color: var(--muted);
		margin-bottom: 0.75rem;
	}
	select {
		display: block;
		width: 100%;
		margin-top: 0.25rem;
		padding: 0.6rem;
		background: color-mix(in srgb, var(--panel) 60%, transparent);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		font-family: inherit;
	}
	.cta {
		width: 100%;
		padding: 0.85rem;
		font-size: 1rem;
		font-weight: 700;
		border: none;
		border-radius: var(--r-md);
		background: var(--accent);
		color: #052e16;
		cursor: pointer;
		min-height: 48px;
		transition:
			filter 0.15s,
			transform 0.1s;
	}
	.cta:hover {
		filter: brightness(1.05);
	}
	.cta:active {
		transform: scale(0.99);
	}
	.cta.running {
		background: var(--usage-none);
		color: #fff;
	}
	.error {
		color: #fca5a5;
		font-size: var(--fs-sm);
	}
	.queued-note {
		color: var(--muted);
		font-size: 0.78rem;
		margin: 0.5rem 0 0;
	}
	.live {
		margin-top: 1rem;
	}
	.big {
		font-size: 1.2rem;
		font-weight: 700;
		text-align: center;
		padding: 0.6rem;
		border-radius: var(--r-md);
		background: color-mix(in srgb, var(--panel) 60%, transparent);
	}
	.big.ok {
		color: var(--usage-tbc);
	}
	.big.degraded {
		color: var(--usage-cl);
	}
	.big.none {
		color: var(--usage-none);
	}
	.big {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}
	/* Pastille « enregistrement en cours » qui pulse — repère visuel d'activité. */
	.rec {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: currentColor;
		animation: rec-pulse 1.4s ease-in-out infinite;
	}
	@keyframes rec-pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.35;
			transform: scale(0.7);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.rec {
			animation: none;
		}
	}
	/* Compteur héro : « N points enregistrés ». Ne décroît jamais → rassurant. */
	.captured {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.4rem;
		margin-top: 0.6rem;
	}
	.captured .count {
		font-size: 2rem;
		font-weight: 800;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.captured .unit {
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	/* Ligne d'état de synchro : hauteur réservée pour éviter tout saut de mise en page. */
	.sync {
		min-height: 1.4em;
		margin: 0.35rem 0 0;
		text-align: center;
		font-size: 0.78rem;
		color: var(--muted);
		transition: color 0.2s;
	}
	.sync.synced {
		color: var(--usage-tbc);
	}
	.sync.buffering {
		color: var(--usage-cl);
	}
	dl {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
		margin: 0.75rem 0 0;
	}
	dl div {
		background: color-mix(in srgb, var(--panel) 60%, transparent);
		border-radius: var(--r-sm);
		padding: 0.45rem 0.6rem;
	}
	dt {
		font-size: 0.7rem;
		color: var(--muted);
	}
	dd {
		margin: 0;
		font-weight: 600;
	}
	.consent {
		display: block;
		margin-top: 1rem;
		font-size: 0.78rem;
		color: var(--muted);
		line-height: 1.4;
	}
	.throughput-opt {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		color: var(--muted);
		margin-bottom: 0.75rem;
		cursor: pointer;
		min-height: 32px;
	}
	.data-warn {
		font-size: 0.72rem;
		opacity: 0.8;
	}
	.data-used {
		font-size: 0.72rem;
		color: var(--muted);
		margin: -0.4rem 0 0.75rem;
	}
	.usage-tag {
		font-size: 0.7rem;
		font-weight: 400;
	}

	/* --- Desktop : panneau latéral glass (pas de sheet) --- */
	@media (min-width: 761px) {
		.layout {
			display: grid;
			grid-template-columns: 1fr min(380px, 38%);
			overflow: visible;
		}
		.map-wrap {
			position: relative;
			inset: auto;
		}
		.sheet {
			position: relative;
			inset: auto;
			bottom: auto;
			height: auto;
			transform: none;
			border-radius: 0;
			border: none;
			border-left: 1px solid var(--glass-border);
			box-shadow: none;
		}
		.sheet-handle {
			display: none;
		}
		.panel {
			padding: 1.25rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet {
			transition: none;
		}
		.cta {
			transition: none;
		}
	}
</style>
