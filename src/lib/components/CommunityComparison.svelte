<script lang="ts">
	/**
	 * Bloc « mesures réelles » des pages SEO. La couche ARCEP (théorique, stable)
	 * est prerendue ; CE bloc charge la couche communautaire (mouvante) côté CLIENT
	 * après hydratation — `fetch /api/coverage?line=…[&operator=…]` — et la compare
	 * à la couverture annoncée. Choix produit : ne pas figer du réel changeant dans
	 * du HTML prerendu (pages obsolètes), tout en restant indexable sur l'ARCEP.
	 */
	import { onMount } from 'svelte';
	import type { OperatorKey } from '$geo/line-stats';
	import { pct } from '$geo/coverage-copy';

	let {
		lineSlug = null,
		operatorKey = null,
		arcepUsable = null,
		subject = 'La couverture annoncée'
	}: {
		/** Restreint la comparaison à une ligne ; null = tout le réseau (page opérateur). */
		lineSlug?: string | null;
		/** Restreint la comparaison à un opérateur (pages croisées / opérateur) ; sinon tous. */
		operatorKey?: OperatorKey | null;
		/** Part « utilisable » (TBC+BC) annoncée par l'ARCEP, pour la comparaison. */
		arcepUsable?: number | null;
		/** Sujet de la phrase de comparaison (« La couverture Free annoncée… »). */
		subject?: string;
	} = $props();

	type State =
		| { status: 'loading' }
		| { status: 'empty' }
		| { status: 'error' }
		| { status: 'ready'; rate: number; samples: number; lastSeen: number };

	let state = $state<State>({ status: 'loading' });

	onMount(async () => {
		try {
			const params = new URLSearchParams();
			if (lineSlug) params.set('line', lineSlug);
			if (operatorKey) params.set('operator', operatorKey);
			const res = await fetch(`/api/coverage?${params}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const fc = (await res.json()) as {
				features?: { properties?: Record<string, number | null> }[];
			};
			let weighted = 0;
			let samples = 0;
			let lastSeen = 0;
			for (const f of fc.features ?? []) {
				const p = f.properties ?? {};
				const n = Number(p.samples ?? 0);
				samples += n;
				weighted += Number(p.successRate ?? 0) * n;
				const ls = Number(p.lastSeen ?? 0);
				if (ls > lastSeen) lastSeen = ls;
			}
			state =
				samples === 0
					? { status: 'empty' }
					: { status: 'ready', rate: weighted / samples, samples, lastSeen };
		} catch {
			state = { status: 'error' };
		}
	});

	/** Fraîcheur lisible de la dernière mesure (le réel est daté, l'ARCEP non). */
	function freshness(tsSeconds: number): string {
		const days = Math.floor(Date.now() / 1000 / 86400 - tsSeconds / 86400);
		if (days <= 0) return "aujourd'hui";
		if (days === 1) return 'hier';
		if (days < 30) return `il y a ${days} jours`;
		const months = Math.floor(days / 30);
		return months <= 1 ? 'il y a 1 mois' : `il y a ${months} mois`;
	}
</script>

<aside class="real" aria-live="polite">
	<h3>Et en vrai&nbsp;? Les mesures des voyageurs</h3>

	{#if state.status === 'loading'}
		<p class="muted">Chargement des mesures de la communauté…</p>
	{:else if state.status === 'empty'}
		<p class="muted">
			Pas encore assez de mesures de voyageurs sur ce trajet. Activez le mode mesure pendant votre
			voyage pour être le premier à révéler la couverture réelle&nbsp;!
		</p>
	{:else if state.status === 'error'}
		<p class="muted">Les mesures communautaires sont momentanément indisponibles.</p>
	{:else}
		<p>
			{#if arcepUsable !== null}
				{subject} sur <strong>{pct(arcepUsable)}</strong> du trajet&nbsp;; les voyageurs constatent
				un réseau qui passe dans <strong>{pct(state.rate)}</strong> des cas
			{:else}
				Les voyageurs constatent un réseau qui passe dans <strong>{pct(state.rate)}</strong> des cas
			{/if}
			<span class="muted"
				>({state.samples.toLocaleString('fr-FR')} mesure{state.samples > 1 ? 's' : ''}, dernière {freshness(
					state.lastSeen
				)}).</span
			>
		</p>
		<p class="muted">
			Ces chiffres viennent des trajets réels mesurés par la communauté&nbsp;: ils se précisent à
			chaque nouvelle contribution.
		</p>
	{/if}
</aside>

<style>
	.real {
		margin: 1.5rem 0;
		padding: 1rem 1.2rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--r-md);
		background: color-mix(in srgb, var(--panel) 70%, transparent);
	}
	.real h3 {
		font-size: var(--fs-md);
		margin: 0 0 0.5rem;
	}
	.real p {
		margin: 0.3rem 0;
	}
	.real .muted {
		color: var(--muted);
		font-size: var(--fs-sm);
	}
</style>
