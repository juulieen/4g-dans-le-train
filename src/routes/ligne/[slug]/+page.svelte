<script lang="ts">
	import { OPERATORS } from '$geo/lines';
	import { OPERATOR_LABEL } from '$lib/usage';
	import { describeOperator, buildVerdict, groupBlackspots, clip } from '$geo/coverage-copy';
	import PageWrap from '$components/PageWrap.svelte';
	import RouteProfile from '$components/RouteProfile.svelte';
	import Verdict from '$components/Verdict.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const line = $derived(data.line);
	const stats = $derived(data.stats);
	const parent = $derived(data.parent);
	const isTroncon = $derived(data.isTroncon);
	const real = $derived(data.real);
	const relationLabel = $derived(isTroncon ? `${line.from} ↔ ${line.to}` : line.name);

	// Verdict (réponse d'abord) + points noirs regroupés par gare ; fraîcheur.
	const verdict = $derived(buildVerdict(line.from, line.to, stats ?? null, real));
	const blackspots = $derived(
		real.blackspots.length
			? groupBlackspots(real.blackspots)
			: (stats?.zonesBlanches.zones ?? []).map((z) => ({
					head: `Après ${z.after} — aucun réseau annoncé`,
					detail: `~${Math.round(z.lengthKm)} km`
				}))
	);
	const freshness = $derived(data.freshness);

	// --- SEO : titres / méta en langage usager, courts (différenciateur en tête) ---
	const title = $derived(`Internet dans le train ${line.from}–${line.to} : ça capte ?`);
	const description = $derived(
		clip(
			verdict.measured
				? `${verdict.lead}${verdict.cuts ? ' ' + verdict.cuts : ''}`
				: `${verdict.lead} Comparez Orange, SFR, Free, Bouygues et les mesures réelles des voyageurs.`,
			158
		)
	);
	const url = $derived(`https://4g-dans-le-train.juulieen.fr/ligne/${line.slug}`);

	// --- FAQ : wifi de bord ET réseau mobile dédoublés (intents distincts) --------
	const faqs = $derived([
		{
			q: `Y a-t-il du wifi à bord du train entre ${line.from} et ${line.to} ?`,
			a: `Selon le train (TGV INOUI…), un wifi de bord gratuit peut exister, mais il est souvent saturé et lent. Pour un vrai débit, comptez surtout sur votre réseau mobile (4G/5G) — voici ce qu'il vaut sur ce trajet.`
		},
		{
			q: `Est-ce que ça capte (4G/5G) dans le train entre ${line.from} et ${line.to} ?`,
			a: `${verdict.lead}${verdict.cuts ? ' ' + verdict.cuts : ''}`
		},
		{
			q: `Quel opérateur capte le mieux entre ${line.from} et ${line.to} ?`,
			a: real.bestOperator
				? `D'après les mesures des voyageurs, ${OPERATOR_LABEL[real.bestOperator as keyof typeof OPERATOR_LABEL] ?? real.bestOperator}. Mais ça dépend des sections — comparez les opérateurs plus bas.`
				: `Ça dépend des sections traversées. Comparez Orange, SFR, Free et Bouygues plus bas.`
		},
		{
			q: `Pourquoi on ne capte pas dans le train ?`,
			a: `Tunnels, zones rurales, carrosserie métallique et grande vitesse coupent le réseau, même là où la couverture est annoncée bonne.`
		}
	]);
	const faqLd = $derived({
		'@context': 'https://schema.org',
		'@type': 'FAQPage',
		mainEntity: faqs.map((f) => ({
			'@type': 'Question',
			name: f.q,
			acceptedAnswer: { '@type': 'Answer', text: f.a }
		}))
	});
	const breadcrumbLd = $derived({
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: [
			{
				'@type': 'ListItem',
				position: 1,
				name: 'Lignes',
				item: 'https://4g-dans-le-train.juulieen.fr/lignes'
			},
			{ '@type': 'ListItem', position: 2, name: relationLabel, item: url }
		]
	});
	const jsonLd = $derived(
		'<script type="application/ld+json">' +
			JSON.stringify([faqLd, breadcrumbLd]).replace(/</g, '\\u003c') +
			'</' +
			'script>'
	);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={url} />
	{#if data.noindex}
		<!-- Tronçon mince (ni stats ARCEP fiables ni réel mesuré suffisant) : exclu de l'index. -->
		<meta name="robots" content="noindex,follow" />
	{/if}
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:type" content="article" />
	<meta property="og:url" content={url} />
	<meta name="twitter:card" content="summary" />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html jsonLd}
</svelte:head>

<PageWrap>
	<nav class="crumbs"><a href="/lignes">Lignes</a> › {relationLabel}</nav>
	<h1>Est-ce que ça capte dans le train entre {line.from} et {line.to}&nbsp;?</h1>
	<p class="lede">
		{#if isTroncon}Portion de la ligne
			{#if parent}<a href="/ligne/{parent.slug}">{parent.name}</a>{:else}{line.service}{/if}.
		{/if}
		{#if stats}{Math.round(stats.lengthKm)}&nbsp;km{/if}{#if real.samples > 0}
			·
			{real.samples.toLocaleString('fr-FR')} mesures de voyageurs{/if}
	</p>

	<!-- VERDICT « réponse d'abord » + points noirs. -->
	<Verdict {verdict} {blackspots} from={line.from} to={line.to} {freshness} />

	<a class="cta" href="/">
		{verdict.measured && blackspots.length
			? 'Voir où ça coupe sur la carte →'
			: 'Voir la couverture sur la carte →'}
	</a>

	<!-- FRISE — illustration gare après gare (secondaire). -->
	<section class="profil">
		<h2>Le détail gare après gare</h2>
		<RouteProfile slug={line.slug} />
	</section>

	{#if stats}
		<section>
			<h2>La couverture ARCEP par opérateur sur {line.name}</h2>
			<p class="muted">
				Ces chiffres sont ceux <em>déclarés par les opérateurs</em>, pas mesurés en vrai.
			</p>
			<ul class="ops">
				{#each OPERATORS as o (o.slug)}
					<li>{describeOperator(o.name, stats.arcep[o.key])}</li>
				{/each}
			</ul>
			<p>
				Sur le terrain, tunnels, zones rurales et grande vitesse provoquent des coupures même là où
				la couverture est annoncée bonne — c'est tout l'intérêt des mesures des voyageurs.
			</p>
		</section>
	{/if}

	<section>
		<h2>Comparer les opérateurs sur {line.name}</h2>
		<p>La couverture diffère selon votre opérateur&nbsp;:</p>
		<ul class="pills">
			{#each OPERATORS as o (o.slug)}
				<li><a href="/ligne/{line.slug}/{o.slug}">{o.name} sur {line.name}</a></li>
			{/each}
		</ul>

		<h2>Questions fréquentes</h2>
		{#each faqs as f, i (i)}
			<details>
				<summary>{f.q}</summary>
				<p>{f.a}</p>
			</details>
		{/each}

		<h2>Astuces pour mieux capter entre {line.from} et {line.to}</h2>
		<ul>
			{#if blackspots.length}
				<li>Préchargez vos contenus (musique, vidéos, articles) avant les zones où ça coupe.</li>
			{:else}
				<li>
					Ce trajet semble bien couvert — si vous le prenez, contribuez vos mesures pour le
					confirmer.
				</li>
			{/if}
			<li>Le Wi-Fi de bord peut dépanner sur certains TGV INOUI — mais il rame souvent.</li>
			<li>
				Comparez les opérateurs&nbsp;: la couverture diffère selon Orange, SFR, Free et Bouygues.
			</li>
		</ul>
	</section>
</PageWrap>

<style>
	.ops {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.ops li {
		padding-left: 1rem;
		border-left: 2px solid var(--border);
	}
</style>
