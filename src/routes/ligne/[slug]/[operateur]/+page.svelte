<script lang="ts">
	import { OPERATORS } from '$geo/lines';
	import {
		describeOperator,
		describeWhiteZones,
		buildVerdict,
		buildBlackspots,
		clip,
		elideQue,
		pct
	} from '$geo/coverage-copy';
	import PageWrap from '$components/PageWrap.svelte';
	import RouteProfile from '$components/RouteProfile.svelte';
	import Verdict from '$components/Verdict.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const line = $derived(data.line);
	const op = $derived(data.operator);
	const stats = $derived(data.stats);
	const real = $derived(data.real);
	/** Répartition ARCEP de cet opérateur sur la ligne (null si pas de tracé fiable). */
	const dist = $derived(data.dist);

	// Verdict + points noirs POUR CET OPÉRATEUR (réel filtré sur l'opérateur, SSR).
	const verdict = $derived(
		buildVerdict(line.from, line.to, stats ?? null, real, {
			operatorName: op.name,
			arcepDist: dist ?? undefined
		})
	);
	const blackspots = $derived(buildBlackspots(real, stats ?? null));
	const freshness = $derived(data.freshness);

	// Autres opérateurs sur la même ligne (maillage interne).
	const others = $derived(OPERATORS.filter((o) => o.slug !== op.slug));

	const title = $derived(`${op.name} dans le train ${line.from}–${line.to} : ça capte ?`);
	const description = $derived(
		clip(`${verdict.lead}${verdict.cuts ? ' ' + verdict.cuts : ''}`, 158)
	);
	const url = $derived(`https://4g-dans-le-train.juulieen.fr/ligne/${line.slug}/${op.slug}`);

	// FAQ propre à l'opérateur (factuel ARCEP de l'opérateur → contenu différencié).
	const faqs = $derived([
		{
			q: `Est-ce ${elideQue(op.name)} capte dans le train entre ${line.from} et ${line.to} ?`,
			a: `${verdict.lead}${verdict.cuts ? ' ' + verdict.cuts : ''} Le wifi de bord peut dépanner, mais c'est votre réseau mobile ${op.name} (4G/5G) qui compte le plus.`
		},
		{
			q: `Pourquoi ${op.name} ne capte pas partout entre ${line.from} et ${line.to} ?`,
			a: dist
				? [
						describeOperator(op.name, dist),
						stats ? describeWhiteZones(stats) : '',
						'Sur le terrain, tunnels, zones rurales et grande vitesse provoquent des coupures.'
					]
						.filter(Boolean)
						.join(' ')
				: `Tunnels, zones rurales, carrosserie métallique et grande vitesse coupent le réseau ${op.name}, même là où il est annoncé bon.`
		},
		{
			q: `${op.name} ou un autre opérateur pour le train ${line.from}–${line.to} ?`,
			a: `Ça dépend des sections. Comparez ${others.map((o) => o.name).join(', ')} pour ce trajet — les liens sont plus bas.`
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
			{
				'@type': 'ListItem',
				position: 2,
				name: line.name,
				item: `https://4g-dans-le-train.juulieen.fr/ligne/${line.slug}`
			},
			{ '@type': 'ListItem', position: 3, name: op.name, item: url }
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
	<nav class="crumbs">
		<a href="/lignes">Lignes</a> › <a href="/ligne/{line.slug}">{line.name}</a> › {op.name}
	</nav>
	<h1>Est-ce {elideQue(op.name)} capte dans le train entre {line.from} et {line.to}&nbsp;?</h1>
	<p class="lede">
		Le réseau <strong>{op.name}</strong> sur la ligne {line.service}
		{line.from} – {line.to}{#if real.samples > 0}&nbsp;·
			{real.samples.toLocaleString('fr-FR')} mesures{/if}.
	</p>

	<!-- VERDICT (cet opérateur) + points noirs. -->
	<Verdict {verdict} {blackspots} from={line.from} to={line.to} {freshness} />

	<a class="cta" href="/">
		{verdict.measured && blackspots.length
			? `Voir où ${op.name} coupe sur la carte →`
			: `Voir la couverture ${op.name} sur la carte →`}
	</a>

	<section class="profil">
		<h2>Le détail {op.name} gare après gare</h2>
		<RouteProfile slug={line.slug} operator={op.key} />
	</section>

	<section>
		<h2>La couverture {op.name} annoncée (ARCEP)</h2>
		{#if dist && stats}
			<p class="muted">
				Ces chiffres sont ceux <em>déclarés</em> par l'opérateur, pas mesurés en vrai.
			</p>
			<p>
				{describeOperator(op.name, dist)}
				{#if describeWhiteZones(stats)}{describeWhiteZones(stats)}{/if}
			</p>
			<p class="muted">
				Répartition annoncée&nbsp;: {pct(dist.TBC)} très bonne, {pct(dist.BC)} bonne, {pct(dist.CL)} limitée,
				{pct(dist.none)} sans réseau.
			</p>
		{:else}
			<p>
				La qualité du réseau {op.name} dépend des zones traversées par la ligne {line.name}&nbsp;:
				tunnels, zones rurales et grande vitesse provoquent des coupures.
			</p>
		{/if}

		<h2>Comparer les opérateurs sur {line.name}</h2>
		<ul class="pills">
			{#each others as o (o.slug)}
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

		<p class="links">
			Voir aussi&nbsp;: <a href="/ligne/{line.slug}">tout le réseau sur {line.name}</a> ·
			<a href="/operateur/{op.slug}">couverture {op.name} sur toutes les lignes</a>
		</p>
	</section>
</PageWrap>
