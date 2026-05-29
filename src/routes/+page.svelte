<script lang="ts">
	import { onDestroy } from 'svelte';
	import Map from '$components/Map.svelte';
	import { MeasurementController, type LiveState, type Operator } from '$measure/controller';
	import { hasConsent, grantConsent, revokeConsent } from '$measure/session';
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
	let live = $state<LiveState | null>(null);
	// État local initialisé une fois avec la couverture SSR, puis rafraîchi
	// localement après chaque mesure (refreshCoverage) — lecture initiale voulue.
	// svelte-ignore state_referenced_locally
	let coverage = $state(data.coverage);

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
	<div class="map-wrap">
		<Map {coverage} />
	</div>

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

		<div class="legend">
			<span><i style="background:#22c55e"></i> Ça capte</span>
			<span><i style="background:#f59e0b"></i> Dégradé</span>
			<span><i style="background:#ef4444"></i> Ça coupe</span>
		</div>

		<div class="measure">
			<h2>Mode mesure 📍</h2>
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
</section>

<style>
	.layout {
		display: grid;
		grid-template-columns: 1fr min(380px, 38%);
		flex: 1;
		min-height: calc(100vh - 120px);
	}
	.map-wrap {
		position: relative;
		min-height: 50vh;
	}
	.panel {
		padding: 1.25rem;
		background: var(--panel);
		border-left: 1px solid var(--border);
		overflow-y: auto;
	}
	h1 {
		font-size: 1.4rem;
		margin: 0 0 0.5rem;
	}
	h2 {
		font-size: 1.05rem;
		margin: 0 0 0.5rem;
	}
	.lede {
		color: var(--muted);
		margin-top: 0;
	}
	.legend {
		display: flex;
		gap: 0.9rem;
		flex-wrap: wrap;
		font-size: 0.8rem;
		color: var(--muted);
		margin-bottom: 1rem;
	}
	.legend i {
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 3px;
		margin-right: 4px;
		vertical-align: middle;
	}
	.measure {
		border-top: 1px solid var(--border);
		padding-top: 1rem;
	}
	.hint {
		font-size: 0.85rem;
		color: var(--muted);
	}
	.field {
		display: block;
		font-size: 0.85rem;
		color: var(--muted);
		margin-bottom: 0.75rem;
	}
	select {
		display: block;
		width: 100%;
		margin-top: 0.25rem;
		padding: 0.5rem;
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.cta {
		width: 100%;
		padding: 0.8rem;
		font-size: 1rem;
		font-weight: 700;
		border: none;
		border-radius: 10px;
		background: var(--accent);
		color: #052e16;
		cursor: pointer;
	}
	.cta.running {
		background: #ef4444;
		color: #fff;
	}
	.error {
		color: #fca5a5;
		font-size: 0.85rem;
	}
	.live {
		margin-top: 1rem;
	}
	.big {
		font-size: 1.2rem;
		font-weight: 700;
		text-align: center;
		padding: 0.6rem;
		border-radius: 10px;
		background: var(--bg);
	}
	.big.ok {
		color: #22c55e;
	}
	.big.degraded {
		color: #f59e0b;
	}
	.big.none {
		color: #ef4444;
	}
	dl {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
		margin: 0.75rem 0 0;
	}
	dl div {
		background: var(--bg);
		border-radius: 8px;
		padding: 0.4rem 0.6rem;
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
	@media (max-width: 760px) {
		.layout {
			grid-template-columns: 1fr;
		}
		.map-wrap {
			min-height: 55vh;
		}
	}
</style>
