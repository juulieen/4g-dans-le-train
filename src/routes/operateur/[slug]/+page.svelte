<script lang="ts">
	import { pct } from '$geo/coverage-copy';
	import PageWrap from '$components/PageWrap.svelte';
	import CommunityComparison from '$components/CommunityComparison.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const op = $derived(data.operator);
	const lines = $derived(data.lines);
	const avgUsable = $derived(data.avgUsable);

	const title = $derived(`Couverture ${op.name} dans le train — carte 4G/5G sur les lignes SNCF`);
	const description = $derived(
		avgUsable !== null
			? `${op.name} est annoncé en couverture 4G/5G sur ${pct(avgUsable)} des grandes lignes SNCF en moyenne. Carte croisée avec les mesures réelles des voyageurs.`
			: `Où capte ${op.name} dans le train en France ? Carte de la couverture mobile 4G/5G ${op.name} le long des lignes SNCF, croisée avec les mesures réelles des voyageurs.`
	);
	const url = $derived(`https://4g-dans-le-train.juulieen.fr/operateur/${op.slug}`);

	const faqAnswer = $derived(
		avgUsable !== null
			? `${op.name} est annoncé en couverture 4G/5G sur ${pct(avgUsable)} des grandes lignes SNCF en moyenne (couverture théorique ARCEP, pondérée par la longueur). La qualité réelle dépend de la ligne empruntée : consultez la carte pour voir, ligne par ligne, où le réseau ${op.name} passe et où il coupe.`
			: `La couverture ${op.name} dans le train dépend de la ligne empruntée. Consultez la carte pour voir, ligne par ligne, où le réseau ${op.name} passe en 4G/5G et où il coupe.`
	);

	const jsonLd = $derived(
		'<script type="application/ld+json">' +
			JSON.stringify({
				'@context': 'https://schema.org',
				'@type': 'FAQPage',
				mainEntity: [
					{
						'@type': 'Question',
						name: `Est-ce que ${op.name} capte bien dans le train ?`,
						acceptedAnswer: { '@type': 'Answer', text: faqAnswer }
					}
				]
			}) +
			'</' +
			'script>'
	);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={url} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html jsonLd}
</svelte:head>

<PageWrap>
	<nav class="crumbs"><a href="/">Accueil</a> › Opérateur {op.name}</nav>
	<h1>Couverture {op.name} dans le train</h1>
	<p class="lede">
		Découvrez où le réseau <strong>{op.name}</strong> capte (et où il coupe) le long des lignes de train
		françaises&nbsp;: couverture théorique officielle croisée avec les mesures réelles des voyageurs.
	</p>

	<a class="cta" href="/">Voir la carte interactive →</a>

	<section>
		{#if avgUsable !== null}
			<h2>La couverture {op.name} annoncée, en bref</h2>
			<p>
				Sur l'ensemble des grandes lignes, {op.name} est annoncé en couverture 4G utilisable (bonne ou
				très bonne) sur <strong>{pct(avgUsable)}</strong> du trajet en moyenne (couverture théorique ARCEP,
				pondérée par la longueur des lignes).
			</p>
			<CommunityComparison
				operatorKey={op.key}
				arcepUsable={avgUsable}
				subject={`${op.name} est annoncé en couverture`}
			/>
		{/if}

		<h2>La couverture {op.name} ligne par ligne</h2>
		<ul class="cards">
			{#each lines as { line, dist } (line.slug)}
				<li>
					<a href="/ligne/{line.slug}/{op.slug}">
						{op.name} sur {line.name}
						{#if dist}
							<span>{pct(dist.TBC + dist.BC)} de couverture annoncée</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>

		<h2>Comment est mesurée la couverture {op.name} ?</h2>
		<p>
			Deux sources sont croisées&nbsp;: la couverture <em>théorique</em> publiée par l'ARCEP (le
			régulateur télécom), et les mesures <em>réelles</em> faites par les voyageurs depuis leur
			téléphone pendant le trajet. Là où des gens ont mesuré, c'est la réalité qui prime — ce qui
			permet de repérer les écarts entre la couverture annoncée par {op.name} et le vécu dans le train.
		</p>

		<h2>Comparer avec les autres opérateurs</h2>
		<p>
			La couverture varie d'un opérateur à l'autre selon les zones. Comparez aussi&nbsp;:
			<a href="/operateur/orange">Orange</a>, <a href="/operateur/sfr">SFR</a>,
			<a href="/operateur/free">Free</a>, <a href="/operateur/bouygues">Bouygues</a>.
		</p>
	</section>
</PageWrap>
