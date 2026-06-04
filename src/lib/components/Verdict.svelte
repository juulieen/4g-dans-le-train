<script lang="ts">
	/**
	 * Bloc « réponse d'abord » des pages ligne et ligne × opérateur : le verdict
	 * (teinté selon la tonalité) + la liste des « points noirs » (où ça coupe).
	 * Présentationnel — le verdict et les points noirs sont calculés en amont
	 * (`buildVerdict` / `blackspotLabel`, `coverage-copy.ts`).
	 */
	import type { Verdict } from '$geo/coverage-copy';

	let {
		verdict,
		blackspots,
		from,
		to,
		freshness = null
	}: {
		verdict: Verdict;
		blackspots: { head: string; detail: string }[];
		from: string;
		to: string;
		/** Fraîcheur de la dernière mesure (« il y a 3 jours »), ou null. */
		freshness?: string | null;
	} = $props();
</script>

<section class="verdict tone-{verdict.tone}" aria-label="En bref">
	<p class="lead">{verdict.lead}</p>
	{#if verdict.cuts}<p class="cuts"><span aria-hidden="true">⚠</span> {verdict.cuts}</p>{/if}
	{#if verdict.best}<p class="best">{verdict.best}</p>{/if}
	{#if verdict.gap}<p class="gap">{verdict.gap}</p>{/if}
	<p class="source">
		{verdict.source}{#if freshness}&nbsp;· {freshness}{/if}
	</p>
	{#if !verdict.measured}
		<a class="measure-cta" href="/">
			<span aria-hidden="true">📍</span> Prenez ce train&nbsp;? Mesurez votre connexion en 1 clic →
		</a>
	{/if}
</section>

<!-- Toujours un H2 « Où ça coupe » (capte la requête, même sans coupure). -->
<section>
	<h2>Où ça coupe entre {from} et {to}&nbsp;?</h2>
	{#if blackspots.length}
		<ul class="blackspots">
			{#each blackspots as b, i (i)}
				<li>
					<strong>{b.head}</strong>{#if b.detail}<span class="detail"> {b.detail}</span>{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="all-good">✓ Aucune coupure signalée sur ce trajet — soyez le premier à la mesurer.</p>
	{/if}
</section>

<style>
	/* VERDICT — bloc « réponse d'abord », teinté selon la tonalité. */
	.verdict {
		margin: 0.4rem 0 1.4rem;
		padding: 1.1rem 1.3rem;
		border: 1px solid var(--border);
		border-left: 5px solid var(--tone, var(--accent));
		border-radius: var(--r-md);
		background: color-mix(in srgb, var(--tone, var(--accent)) 8%, var(--panel) 80%);
	}
	.verdict.tone-good {
		--tone: var(--usage-tbc);
	}
	.verdict.tone-mixed {
		--tone: var(--usage-cl);
	}
	.verdict.tone-bad {
		--tone: var(--usage-none);
	}
	.verdict.tone-unknown {
		--tone: var(--muted);
	}
	.verdict .lead {
		font-size: var(--fs-lg);
		font-weight: 600;
		line-height: 1.35;
		margin: 0 0 0.5rem;
	}
	.verdict p {
		margin: 0.3rem 0;
	}
	.verdict .cuts {
		font-weight: 600;
		color: var(--usage-none);
	}
	.verdict .best {
		font-weight: 600;
	}
	.verdict .gap,
	.verdict .source {
		color: var(--muted);
		font-size: var(--fs-sm);
	}
	.verdict .measure-cta {
		display: inline-block;
		margin-top: 0.6rem;
		font-weight: 600;
		color: var(--link);
		text-decoration: none;
	}
	.verdict .measure-cta:hover {
		text-decoration: underline;
	}

	/* POINTS NOIRS */
	.blackspots {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.blackspots li {
		padding: 0.6rem 0.9rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--usage-none);
		border-radius: var(--r-sm);
		background: color-mix(in srgb, var(--panel) 75%, transparent);
		overflow-wrap: anywhere;
	}
	.blackspots .detail {
		color: var(--muted);
		font-size: var(--fs-sm);
	}
	.all-good {
		color: var(--usage-tbc);
		font-weight: 600;
	}
</style>
