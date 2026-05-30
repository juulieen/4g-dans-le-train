<script lang="ts">
	import { OPERATORS } from '$geo/lines';
	import PageWrap from '$components/PageWrap.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const line = $derived(data.line);

	const title = $derived(`Couverture mobile 4G/5G — ligne ${line.name} (${line.service})`);
	const description = $derived(
		`Où ça capte sur la ligne ${line.name} ? Carte communautaire de la couverture mobile 4G/5G dans le train entre ${line.from} et ${line.to}.`
	);
	const url = $derived(`https://4g-dans-le-train.juulieen.fr/ligne/${line.slug}`);

	const faqLd = $derived({
		'@context': 'https://schema.org',
		'@type': 'FAQPage',
		mainEntity: [
			{
				'@type': 'Question',
				name: `Est-ce que ça capte dans le train entre ${line.from} et ${line.to} ?`,
				acceptedAnswer: {
					'@type': 'Answer',
					text: `La couverture mobile sur la ligne ${line.name} varie selon l'opérateur et les zones traversées. Consultez la carte communautaire pour voir les sections où le réseau 4G/5G passe ou coupe.`
				}
			}
		]
	});

	// Balise JSON-LD assemblée par concaténation pour ne pas fermer le <script> hôte.
	const jsonLd = $derived(
		'<script type="application/ld+json">' + JSON.stringify(faqLd) + '</' + 'script>'
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
	<nav class="crumbs"><a href="/lignes">Lignes</a> › {line.name}</nav>
	<h1>Couverture mobile dans le train&nbsp;: {line.name}</h1>
	<p class="lede">
		Ligne <strong>{line.service}</strong> entre {line.from} et {line.to}. Découvrez où la 4G/5G
		passe (ou coupe) grâce aux mesures de la communauté.
	</p>

	<a class="cta" href="/">Voir la carte interactive →</a>

	<section>
		<h2>Comment est mesurée la couverture&nbsp;?</h2>
		<p>
			Les voyageurs activent le mode mesure sur leur téléphone pendant le trajet. L'application
			teste la connexion en continu et enregistre, de façon anonyme, où ça capte. Plus il y a de
			contributeurs sur la ligne {line.name}, plus la carte est précise.
		</p>
		<h2>La couverture sur {line.name} par opérateur</h2>
		<p>La couverture diffère selon votre opérateur. Voyez le détail&nbsp;:</p>
		<ul class="pills">
			{#each OPERATORS as o (o.slug)}
				<li><a href="/ligne/{line.slug}/{o.slug}">{o.name} sur {line.name}</a></li>
			{/each}
		</ul>

		<h2>Astuces pour mieux capter entre {line.from} et {line.to}</h2>
		<ul>
			<li>Préchargez vos contenus (musique, vidéos, articles) avant les zones blanches connues.</li>
			<li>Le Wi-Fi de bord peut prendre le relais sur certains TGV INOUI.</li>
			<li>
				Comparez les opérateurs&nbsp;: la couverture diffère selon Orange, SFR, Free et Bouygues.
			</li>
		</ul>
	</section>
</PageWrap>
