<script lang="ts">
	import { onMount, onDestroy, getContext } from 'svelte';
	import Map from '$components/Map.svelte';
	import Icon from '$components/Icon.svelte';
	import RouteProfile from '$components/RouteProfile.svelte';
	import HintChip from '$components/Onboarding/HintChip.svelte';
	import { RAIL_LINES } from '$geo/lines';
	import {
		MeasurementController,
		type LiveState,
		type Operator,
		type SessionPoint
	} from '$measure/controller';
	import {
		hasConsent,
		grantConsent,
		revokeConsent,
		hasOnboarded,
		markOnboarded,
		getThroughputOptIn,
		setThroughputOptIn,
		wasMeasuringRecently,
		getSavedOperator,
		setSavedOperator
	} from '$measure/session';
	import { levelFromKbps, USAGE_TEXT, USAGE_COLORS, OPERATOR_LABEL, USAGE_OPS } from '$lib/usage';
	import { pluralS } from '$lib/plural';
	import { buildQrSvg } from '$lib/qr';
	import { ORIGIN } from '$lib/site';
	import { pathBounds } from '$lib/coverage-segments';
	import { page } from '$app/state';
	import type maplibregl from 'maplibre-gl';
	import type { PageData } from './$types';

	// URL encodée dans le QR « mesure depuis ton téléphone » (affiché sur desktop).
	const qrSvg = buildQrSvg(ORIGIN);

	let { data }: { data: PageData } = $props();

	// Opérateurs du mode mesure : les 4 opérateurs ARCEP (libellés partagés via
	// OPERATOR_LABEL) + deux choix propres à la mesure (« Autre » / « Je ne sais pas »).
	const OPERATORS: { value: Operator; label: string }[] = [
		...USAGE_OPS.map((value) => ({ value, label: OPERATOR_LABEL[value] })),
		{ value: 'autre', label: 'Autre' },
		{ value: 'inconnu', label: 'Je ne sais pas' }
	];

	// Opérateur restauré depuis le storage (survit au refresh — indispensable à la
	// reprise auto, sinon une session reprise enverrait « inconnu »). En SSR, le
	// helper renvoie null → 'inconnu' ; l'hydratation rétablit la valeur sauvée.
	const savedOperator = getSavedOperator();
	let operator = $state<Operator>(
		OPERATORS.some((o) => o.value === savedOperator) ? (savedOperator as Operator) : 'inconnu'
	);
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

	// Deep-link `/?line=<slug>` (depuis l'aperçu des pages ligne) : on cadre la carte sur la
	// ligne et on pré-sélectionne sa frise. La carte démarre en vue nationale puis se recadre
	// dès que la bbox (route-profile) arrive — bref flash accepté (cf. PRODUCT.md § Aperçu carte).
	let focusBounds = $state<maplibregl.LngLatBoundsLike | null>(null);
	$effect(() => {
		const slug = page.url.searchParams.get('line');
		if (!slug) {
			focusBounds = null; // navigation (SPA) vers `/` sans `?line=` → on dé-cadre.
			return;
		}
		if (sortedLines.some((l) => l.slug === slug)) selectedLine = slug;
		let cancelled = false;
		void (async () => {
			try {
				const res = await fetch(`/data/route-profiles/${slug}.json`);
				if (!res.ok) return;
				const profile = (await res.json()) as { path?: [number, number, number][] };
				if (!cancelled && profile.path && profile.path.length >= 2) {
					focusBounds = pathBounds(profile.path);
				}
			} catch {
				/* pas de profil : on garde la vue nationale */
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	// --- Partage du trajet sélectionné (Web Share + repli presse-papier). ---
	// La vignette sociale (`/og/<slug>.png`) fait l'accroche visuelle au moment du
	// partage du lien `/ligne/<slug>`.
	let shareMsg = $state('');
	async function shareLine() {
		const l = sortedLines.find((x) => x.slug === selectedLine);
		if (!l) return;
		const url = `${ORIGIN}/ligne/${l.slug}`;
		const shareData = {
			title: `Couverture mobile — ${l.name}`,
			text: `Où ça capte dans le train sur ${l.from} ↔ ${l.to} ?`,
			url
		};
		try {
			if (navigator.share) {
				await navigator.share(shareData);
			} else {
				await navigator.clipboard.writeText(url);
				shareMsg = 'Lien copié !';
				setTimeout(() => (shareMsg = ''), 2500);
			}
		} catch {
			/* partage annulé par l'utilisateur : on ignore silencieusement */
		}
	}
	let live = $state<LiveState | null>(null);
	// État local initialisé une fois avec la couverture SSR, puis rafraîchi
	// localement après chaque mesure (refreshCoverage) — lecture initiale voulue.
	// svelte-ignore state_referenced_locally
	let coverage = $state(data.coverage);

	let controller: MeasurementController | null = null;

	// --- Sillage de session (carte) : points 100 % locaux et éphémères -----------
	// Jusqu'à plusieurs milliers de points à 1/s : tableau simple hors réactivité
	// profonde ($state.raw), la carte est notifiée par réaffectation (setData ~1 Hz).
	const MAX_TRAIL_POINTS = 7_200; // ~2 h à 1 point/s
	let trailFeatures: GeoJSON.Feature[] = [];
	let trail = $state.raw<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });
	// Reçoit les points EN LOT (1 par tick en mode normal, ~320 d'un coup à la sortie
	// d'un tunnel) → une seule réaffectation de `trail` (donc un seul setData) par lot.
	function pushTrailPoints(points: SessionPoint[]) {
		for (const p of points) {
			trailFeatures.push({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
				properties: { status: p.status, posSource: p.posSource }
			});
		}
		if (trailFeatures.length > MAX_TRAIL_POINTS) {
			trailFeatures.splice(0, trailFeatures.length - MAX_TRAIL_POINTS);
		}
		trail = { type: 'FeatureCollection', features: trailFeatures };
	}
	function resetTrail() {
		trailFeatures = [];
		trail = { type: 'FeatureCollection', features: trailFeatures };
	}

	// Marqueur « vous êtes ici » : position GPS courante + statut réseau du moment.
	const livePos = $derived(
		live?.running && live.lat != null && live.lng != null
			? { lat: live.lat, lng: live.lng, status: live.status }
			: null
	);

	$effect(() => {
		consent = hasConsent();
		measureThroughput = getThroughputOptIn();
	});

	// Persiste le choix d'opérateur à chaque changement (premier passage : réécrit la
	// valeur qui vient d'être restaurée du storage — idempotent).
	$effect(() => {
		setSavedOperator(operator);
	});

	// Reprise auto après un refresh : si une mesure tournait il y a moins de 2 min
	// (heartbeat rafraîchi à chaque tick, effacé à l'arrêt volontaire), la page a
	// rechargé en cours de mesure (onglet déchargé, rotation, refresh accidentel) →
	// on redémarre sans intervention. Le buffer de trou GPS et la file d'envoi sont
	// eux aussi persistés : rien n'est perdu.
	onMount(() => {
		if (hasConsent() && wasMeasuringRecently()) {
			consent = true;
			// Lu directement (l'$effect ci-dessus n'a pas forcément encore tourné).
			measureThroughput = getThroughputOptIn();
			void ensureController().start();
		}
	});

	function ensureController(): MeasurementController {
		if (!controller) {
			controller = new MeasurementController({
				operator,
				onState: (s) => (live = s),
				onPoints: pushTrailPoints,
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
			// Fin de session : on rouvre le panneau (bilan, réglages) — sinon l'utilisateur
			// reste face à une carte avec une sheet repliée devenue muette.
			sheetExpanded = true;
		} else {
			if (!consent) {
				grantConsent();
				consent = true;
			}
			// Nouvelle session : sillage remis à zéro, et la carte passe au premier plan
			// (sheet repliée en mini-HUD) — c'est elle le tableau de bord du trajet.
			resetTrail();
			sheetExpanded = false;
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
				text: `📍 ${b} point${pluralS(b)} capturé${pluralS(b)} sans GPS — position recalée au retour du signal`
			};
		if (live.queued > 0)
			return {
				cls: 'pending',
				text: `⏳ ${live.queued} point${pluralS(live.queued)} gardé${pluralS(live.queued)} hors-ligne — envoi au retour du réseau`
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

	// Âge de la dernière mesure de débit (« il y a 40 s ») : un instantané d'1 min
	// d'âge ne doit pas se faire passer pour du temps réel. Recalculé à chaque tick
	// (l'objet `live` change toutes les secondes). Garde SSR : Date.now() côté serveur
	// divergerait de l'hydratation si ce derived sortait un jour du {#if live?.running}.
	const downlinkAge = $derived.by(() => {
		if (typeof window === 'undefined') return '';
		if (!live?.downlinkAt) return '';
		const s = Math.max(0, Math.round((Date.now() - live.downlinkAt) / 1000));
		return s < 5 ? "à l'instant" : `il y a ${formatDuree(s)}`;
	});

	/** Sparkline des débits de la session : polyline en viewBox 60×16. */
	function sparkPoints(hist: number[]): string {
		const recent = hist.slice(-30);
		const max = Math.max(...recent, 1);
		const n = Math.max(recent.length - 1, 1);
		return recent
			.map((v, i) => `${((i / n) * 60).toFixed(1)},${(15 - (v / max) * 13).toFixed(1)}`)
			.join(' ');
	}

	/** Pastille du ticker des derniers envois. */
	const STATUS_DOT: Record<string, string> = { ok: '✅', degraded: '⚠️', none: '❌' };

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
	<link rel="canonical" href={`${ORIGIN}/`} />
	<meta property="og:title" content="4G dans le train — couverture mobile sur les lignes SNCF" />
	<meta
		property="og:description"
		content="Voyez où ça capte (et où ça coupe) sur votre trajet en train. Données communautaires + ARCEP."
	/>
</svelte:head>

<section class="layout">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="map-wrap" onpointerdown={onMapInteract}>
		<Map
			{coverage}
			operator={viewOperator}
			{showArcep}
			{showCommunity}
			{focusBounds}
			{livePos}
			{trail}
		/>
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
			{#if live?.running}
				<!-- Mini-HUD du mode mesure : visible dans la zone « peek » de la sheet repliée
				     et collant en haut du panneau ouvert. Le détail reste plus bas (section mesure). -->
				<!-- aria-live sur le SEUL libellé de statut (change aux transitions), jamais sur
				     le conteneur : compteur, chrono et synchro changent chaque seconde et
				     spammeraient les lecteurs d'écran. -->
				<div class="hud">
					<div class="hud-status {live.status}">
						<span class="rec" aria-hidden="true"></span>
						<span class="hud-label" aria-live="polite"
							>{statusLabel[live.status] ?? live.status}</span
						>
						{#if live.currentOutage}
							<span class="since" aria-hidden="true"
								>· depuis {formatDuree(live.currentOutage.sinceS)}</span
							>
						{/if}
						<button class="hud-stop" onclick={toggleMeasure}>Arrêter</button>
					</div>
					<p class="hud-row">
						<strong>{captured}</strong>&nbsp;point{pluralS(captured)}
						{#if measureThroughput}
							{#if live.downlinkKbps != null}
								· {(live.downlinkKbps / 1000).toFixed(1)} Mb/s
								<span class="hud-age"
									>{live.throughputMeasuring ? '(mesure…)' : `(${downlinkAge})`}</span
								>
							{:else if live.throughputMeasuring}
								· débit&nbsp;: mesure…
							{/if}
						{/if}
					</p>
					<p class="hud-sync {syncInfo.cls}">{syncInfo.text}</p>
				</div>
			{/if}
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
					{#each USAGE_OPS as op (op)}
						<option value={op}>{OPERATOR_LABEL[op]}</option>
					{/each}
				</select>
			</label>

			<p class="explain">
				La <strong>voie est colorée</strong> selon ce que vous pourrez y faire (couverture théorique
				des opérateurs). Les <strong>rubans le long de la voie</strong> (et les cellules au fort zoom)
				sont les mesures réelles des voyageurs&nbsp;: là, c'est du vécu, pas de la théorie.
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
				<div class="share-row">
					<button type="button" class="share-btn" onclick={shareLine}>
						Partager ce trajet&nbsp;<span aria-hidden="true">↗</span>
					</button>
					{#if shareMsg}<span class="share-msg" role="status">{shareMsg}</span>{/if}
				</div>
			{/if}

			<div class="measure">
				<h2 class="measure-title">Mode mesure <Icon name="map" size={18} /></h2>
				<p class="hint">
					Sur mobile, dans le train&nbsp;: gardez cette page ouverte (l'écran reste allumé) et on
					mesure votre connexion en continu, de façon <strong>anonyme</strong>.
				</p>

				<!-- Desktop uniquement (CSS) : sur ordinateur le GPS est trop imprécis, on
				     invite à mesurer depuis le téléphone via ce QR code. -->
				<div class="qr-desktop">
					<!-- eslint-disable-next-line svelte/no-at-html-tags : SVG généré localement, pas d'entrée utilisateur -->
					{@html qrSvg}
					<p class="qr-label">
						Sur ordinateur, le GPS est trop imprécis. <strong>Scannez</strong> pour mesurer depuis votre
						téléphone.
					</p>
				</div>

				<label class="field" for="operator">
					Votre opérateur
					<select id="operator" name="operator" bind:value={operator} disabled={live?.running}>
						{#each OPERATORS as op (op.value)}
							<option value={op.value}>{op.label}</option>
						{/each}
					</select>
				</label>

				<p class="hint wifi-hint">
					Pour mesurer votre réseau mobile, <strong>désactivez le Wi-Fi</strong> (y compris le Wi-Fi du
					train)&nbsp;: sinon la mesure est enregistrée comme «&nbsp;Wi-Fi de bord&nbsp;», pas comme couverture
					opérateur.
				</p>

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

				{#if live?.running && live.onWifi}
					<p class="warn" role="alert">
						Vous semblez connecté en <strong>Wi-Fi</strong> (Wi-Fi du train&nbsp;?)&nbsp;: cette mesure
						est enregistrée comme «&nbsp;Wi-Fi de bord&nbsp;», pas comme couverture mobile. Coupez le
						Wi-Fi pour mesurer votre 4G/5G.
					</p>
				{/if}

				{#if live?.running}
					<div class="live">
						<!-- Le statut, le compteur et la synchro vivent dans le mini-HUD en tête de
						     panneau (visible sheet repliée) ; ici, le détail seulement. -->
						{#if live.gpsStale}
							<p class="warn" aria-live="polite">
								<strong>En attente d'une position GPS précise…</strong> La mesure continue&nbsp;: si le
								GPS finit par accrocher, vos données seront enregistrées.
							</p>
						{/if}

						<dl>
							<div>
								<dt>Latence</dt>
								<dd>{live.rttMs != null ? `${live.rttMs} ms` : '—'}</dd>
							</div>
							{#if measureThroughput}
								<div class="debit-cell">
									<dt>Débit</dt>
									<dd>
										{#if live.downlinkKbps != null}
											{(live.downlinkKbps / 1000).toFixed(1)} Mb/s
											<span
												class="usage-tag"
												style="color:{USAGE_COLORS[levelFromKbps(live.downlinkKbps)]}"
												>· {USAGE_TEXT[levelFromKbps(live.downlinkKbps)]}</span
											>
											<span class="dd-age"
												>{live.throughputMeasuring ? 'mesure en cours…' : downlinkAge}</span
											>
										{:else if live.throughputMeasuring}
											<span class="dd-age">mesure en cours…</span>
										{:else}
											—
										{/if}
										{#if live.downlinkHistory.length > 1}
											<svg
												class="spark"
												viewBox="0 0 60 16"
												preserveAspectRatio="none"
												aria-hidden="true"
											>
												<polyline
													points={sparkPoints(live.downlinkHistory)}
													fill="none"
													stroke="currentColor"
													stroke-width="1.5"
												/>
											</svg>
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

						{#if live.lastSamples.length > 0}
							<!-- Transparence : ce qui part réellement au serveur (du plus récent au plus ancien). -->
							<details class="ticker">
								<summary>Derniers points envoyés</summary>
								<ul>
									{#each [...live.lastSamples].reverse() as s (s.measuredAt)}
										<li>
											<span class="tick-time"
												>{new Date(s.measuredAt).toLocaleTimeString('fr-FR')}</span
											>
											{STATUS_DOT[s.status] ?? '·'}
											{s.rttMs != null ? `${s.rttMs} ms` : '—'}
											{#if s.downlinkKbps != null}
												· {(s.downlinkKbps / 1000).toFixed(1)} Mb/s{/if}
											{#if s.posSource === 'interpolated'}
												· <em>recalé (tunnel)</em>{/if}
										</li>
									{/each}
								</ul>
							</details>
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
	/* Avertissement (ambre) : informatif, moins critique qu'une erreur. Classe partagée
	   par le rappel Wi-Fi de bord et l'attente de position GPS précise (gpsStale). */
	.warn {
		margin: 0.5rem 0 0;
		padding: 0.5rem 0.7rem;
		border-radius: var(--r-sm);
		background: rgba(251, 191, 36, 0.12);
		border: 1px solid rgba(251, 191, 36, 0.35);
		color: #fbbf24;
		font-size: var(--fs-sm);
		line-height: 1.4;
	}
	.warn strong {
		color: #fcd34d;
	}
	/* Rappel statique sous le select opérateur (couvre iOS où le Wi-Fi est indétectable). */
	.wifi-hint {
		margin: -0.25rem 0 0.75rem;
	}
	/* QR « mesure depuis ton téléphone » : masqué par défaut (mobile-first),
	   affiché uniquement sur desktop (cf. @media min-width: 761px). */
	.qr-desktop {
		display: none;
	}
	.qr-desktop :global(svg) {
		width: 132px;
		height: 132px;
		background: #fff;
		padding: 7px;
		border-radius: var(--r-sm);
	}
	.qr-label {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
		text-align: center;
		max-width: 22ch;
	}
	.queued-note {
		color: var(--muted);
		font-size: 0.78rem;
		margin: 0.5rem 0 0;
	}
	.live {
		margin-top: 1rem;
	}

	/* --- Mini-HUD du mode mesure (tête de panneau, visible sheet repliée) --- */
	.hud {
		position: sticky;
		top: 0;
		z-index: 2;
		margin: 0 -0.25rem 0.75rem;
		padding: 0.6rem 0.75rem;
		border-radius: var(--r-md);
		background: color-mix(in srgb, var(--panel) 82%, transparent);
		border: 1px solid var(--border);
	}
	.hud-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.05rem;
		font-weight: 700;
	}
	.hud-status.ok {
		color: var(--usage-tbc);
	}
	.hud-status.degraded {
		color: var(--usage-cl);
	}
	.hud-status.none {
		color: var(--usage-none);
	}
	/* Chrono de la coupure en cours — chiffres tabulaires pour éviter le tremblement. */
	.since {
		font-size: 0.85rem;
		font-weight: 600;
		opacity: 0.85;
		font-variant-numeric: tabular-nums;
	}
	.hud-stop {
		margin-left: auto;
		padding: 0.3rem 0.7rem;
		font-size: 0.78rem;
		font-weight: 700;
		border: none;
		border-radius: 999px;
		background: var(--usage-none);
		color: #fff;
		cursor: pointer;
	}
	.hud-row {
		margin: 0.35rem 0 0;
		font-size: 0.85rem;
		color: var(--text);
	}
	.hud-row strong {
		font-size: 1.05rem;
		font-variant-numeric: tabular-nums;
	}
	.hud-age {
		color: var(--muted);
		font-size: 0.75rem;
	}
	/* Ligne d'état de synchro : hauteur réservée pour éviter tout saut de mise en page. */
	.hud-sync {
		min-height: 1.3em;
		margin: 0.2rem 0 0;
		font-size: 0.74rem;
		color: var(--muted);
		transition: color 0.2s;
	}
	.hud-sync.synced {
		color: var(--usage-tbc);
	}
	.hud-sync.buffering {
		color: var(--usage-cl);
	}

	/* Pastille « enregistrement en cours » qui pulse — repère visuel d'activité. */
	.rec {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: currentColor;
		animation: rec-pulse 1.4s ease-in-out infinite;
		flex: none;
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

	/* Âge de la mesure de débit + sparkline de la session. */
	.dd-age {
		display: block;
		color: var(--muted);
		font-size: 0.7rem;
		font-weight: 400;
	}
	.spark {
		display: block;
		width: 100%;
		height: 16px;
		margin-top: 0.25rem;
		color: var(--accent);
		opacity: 0.8;
	}

	/* Ticker « derniers points envoyés » (transparence sur ce qui part au serveur). */
	.ticker {
		margin-top: 0.6rem;
		font-size: 0.78rem;
		color: var(--muted);
	}
	.ticker summary {
		cursor: pointer;
		font-weight: 600;
	}
	.ticker ul {
		list-style: none;
		margin: 0.35rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-variant-numeric: tabular-nums;
	}
	.tick-time {
		color: var(--text);
		font-weight: 600;
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
		.qr-desktop {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: var(--sp-2);
			margin: 0.25rem 0 1rem;
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

	/* --- Partage du trajet sélectionné --- */
	.share-row {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		margin-top: var(--sp-3);
	}
	.share-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.5rem 0.9rem;
		border: 1px solid var(--glass-border);
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 16%, transparent);
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 600;
		cursor: pointer;
		transition: background 0.18s;
	}
	.share-btn:hover {
		background: color-mix(in srgb, var(--accent) 26%, transparent);
	}
	.share-msg {
		font-size: var(--fs-sm);
		color: var(--link);
	}
</style>
