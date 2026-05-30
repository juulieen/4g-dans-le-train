<script lang="ts">
	import { onDestroy, getContext } from 'svelte';
	import Map from '$components/Map.svelte';
	import Icon from '$components/Icon.svelte';
	import HintChip from '$components/Onboarding/HintChip.svelte';
	import { MeasurementController, type LiveState, type Operator } from '$measure/controller';
	import {
		hasConsent,
		grantConsent,
		revokeConsent,
		hasOnboarded,
		markOnboarded
	} from '$measure/session';
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
	let showArcep = $state(true);
	let showCommunity = $state(true);
	// Filtre d'AFFICHAGE de la carte (distinct de l'opérateur du mode mesure).
	let viewOperator = $state<string>('inconnu');
	let live = $state<LiveState | null>(null);
	// État local initialisé une fois avec la couverture SSR, puis rafraîchi
	// localement après chaque mesure (refreshCoverage) — lecture initiale voulue.
	// svelte-ignore state_referenced_locally
	let coverage = $state(data.coverage);

	// Couverture communautaire filtrée selon l'opérateur d'affichage choisi.
	const filteredCoverage = $derived.by(() => {
		if (viewOperator === 'inconnu') return coverage;
		return {
			type: 'FeatureCollection' as const,
			features: coverage.features.filter(
				(f) => (f.properties as Record<string, unknown>)?.operator === viewOperator
			)
		};
	});

	let controller: MeasurementController | null = null;

	$effect(() => {
		consent = hasConsent();
	});

	function ensureController(): MeasurementController {
		if (!controller) {
			controller = new MeasurementController({
				operator,
				onState: (s) => (live = s)
			});
		}
		controller.setOperator(operator);
		return controller;
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

	// --- Présentation : bottom-sheet + onboarding (aucune logique métier) ---
	const ui = getContext<{ openOnboarding: () => void }>('ui');

	let sheetExpanded = $state(false);
	let showHint = $state(false);

	// --- Bottom-sheet : glisser pour ouvrir/fermer (mobile) ---
	const PEEK = 188; // doit correspondre à --peek dans le CSS
	let sheetEl: HTMLElement | undefined = $state();
	let dragging = $state(false);
	let dragTranslate = $state(0);
	let dragStartY = 0;
	let dragStartTranslate = 0;
	let dragMoved = 0;
	let suppressClick = false;

	function collapsedPx(): number {
		return sheetEl ? sheetEl.offsetHeight - PEEK : 0;
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
		<Map coverage={filteredCoverage} operator={viewOperator} {showArcep} {showCommunity} />
		<button class="info-fab glass" onclick={openOnboarding} aria-label="Comment ça marche">
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

				<button class="cta" class:running={live?.running} onclick={toggleMeasure}>
					{live?.running ? 'Arrêter la mesure' : 'Démarrer la mesure'}
				</button>

				{#if live?.error}
					<p class="error">{live.error}</p>
				{/if}

				{#if live?.running}
					<div class="live">
						<div class="big {live.status}">{statusLabel[live.status] ?? live.status}</div>
						<dl>
							<div>
								<dt>Latence</dt>
								<dd>{live.rttMs != null ? `${live.rttMs} ms` : '—'}</dd>
							</div>
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
								<dt>Mesures envoyées</dt>
								<dd>{live.sent}</dd>
							</div>
							<div>
								<dt>Écran maintenu</dt>
								<dd>{live.wakeLockActive ? 'oui' : 'non'}</dd>
							</div>
						</dl>
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
