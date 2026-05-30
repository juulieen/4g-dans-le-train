<script lang="ts">
	import { RAIL_LINES } from '$geo/lines';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const op = $derived(data.operator);

	const title = $derived(`Couverture ${op.name} dans le train — carte 4G/5G sur les lignes SNCF`);
	const description = $derived(
		`Où capte ${op.name} dans le train en France ? Carte de la couverture mobile 4G/5G ${op.name} le long des lignes SNCF, croisée avec les mesures réelles des voyageurs.`
	);
	const url = $derived(`https://4g-dans-le-train.juulieen.fr/operateur/${op.slug}`);

	const jsonLd = $derived(
		'<script type="application/ld+json">' +
			JSON.stringify({
				'@context': 'https://schema.org',
				'@type': 'FAQPage',
				mainEntity: [
					{
						'@type': 'Question',
						name: `Est-ce que ${op.name} capte bien dans le train ?`,
						acceptedAnswer: {
							'@type': 'Answer',
							text: `La couverture ${op.name} dans le train dépend de la ligne empruntée. Consultez la carte pour voir, ligne par ligne, où le réseau ${op.name} passe en 4G/5G et où il coupe.`
						}
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

<article class="wrap">
	<nav class="crumbs"><a href="/">Accueil</a> › Opérateur {op.name}</nav>
	<h1>Couverture {op.name} dans le train</h1>
	<p class="lede">
		Découvrez où le réseau <strong>{op.name}</strong> capte (et où il coupe) le long des lignes de train
		françaises&nbsp;: couverture théorique officielle croisée avec les mesures réelles des voyageurs.
	</p>

	<a class="cta" href="/">Voir la carte interactive →</a>

	<section>
		<h2>La couverture {op.name} ligne par ligne</h2>
		<ul class="lines">
			{#each RAIL_LINES as line (line.slug)}
				<li>
					<a href="/ligne/{line.slug}/{op.slug}">{op.name} sur {line.name}</a>
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
</article>

<style>
	.wrap {
		max-width: 720px;
		margin: 0 auto;
		padding: 2rem 1rem;
		line-height: 1.6;
	}
	.crumbs {
		font-size: 0.8rem;
		color: var(--muted);
		margin-bottom: 1rem;
	}
	h1 {
		font-size: 1.6rem;
	}
	.lede {
		color: var(--muted);
	}
	.cta {
		display: inline-block;
		margin: 1rem 0 2rem;
		padding: 0.7rem 1.2rem;
		background: var(--accent);
		color: #052e16;
		font-weight: 700;
		border-radius: 10px;
		text-decoration: none;
	}
	h2 {
		font-size: 1.15rem;
		margin-top: 1.5rem;
	}
	.lines {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 0.5rem;
	}
	.lines a {
		display: block;
		padding: 0.6rem 0.8rem;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		text-decoration: none;
		color: var(--text);
		font-size: 0.9rem;
	}
	.lines a:hover {
		border-color: var(--accent);
	}
</style>
