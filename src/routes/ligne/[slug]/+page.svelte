<script lang="ts">
	import { OPERATORS } from '$geo/lines';
	import {
		describeOperator,
		describeWhiteZones,
		bestTbcPct,
		lineMetaDescription
	} from '$geo/coverage-copy';
	import PageWrap from '$components/PageWrap.svelte';
	import RouteProfile from '$components/RouteProfile.svelte';
	import MapPreview from '$components/MapPreview.svelte';
	import { ORIGIN } from '$lib/site';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const line = $derived(data.line);
	const stats = $derived(data.stats);
	const parent = $derived(data.parent);
	const isTroncon = $derived(data.isTroncon);
	// Un tronçon est bidirectionnel : on l'affiche « A ↔ B » (une seule page pour
	// les deux sens), une ligne classique garde son libellé « A – B ».
	const relationLabel = $derived(isTroncon ? `${line.from} ↔ ${line.to}` : line.name);

	const title = $derived(
		isTroncon
			? `Couverture mobile 4G/5G dans le train — ${line.from} ↔ ${line.to}`
			: `Couverture mobile 4G/5G — ligne ${line.name} (${line.service})`
	);
	const description = $derived(
		lineMetaDescription(line.name, line.from, line.to, stats ?? undefined)
	);
	const url = $derived(`${ORIGIN}/ligne/${line.slug}`);

	// Réponse FAQ enrichie des vrais chiffres ARCEP quand ils existent.
	const faqAnswer = $derived(
		stats
			? `Sur la ligne ${line.name}, la 4G est annoncée excellente sur ${bestTbcPct(stats)} du parcours (couverture théorique ARCEP, au mieux des opérateurs). ${
					describeWhiteZones(stats) || 'Aucune zone blanche majeure n’est connue.'
				} Consultez la carte communautaire pour comparer avec les mesures réelles des voyageurs.`
			: `La couverture mobile sur la ligne ${line.name} varie selon l'opérateur et les zones traversées. Consultez la carte communautaire pour voir les sections où le réseau 4G/5G passe ou coupe.`
	);

	const faqLd = $derived({
		'@context': 'https://schema.org',
		'@type': 'FAQPage',
		mainEntity: [
			{
				'@type': 'Question',
				name: `Est-ce que ça capte dans le train entre ${line.from} et ${line.to} ?`,
				acceptedAnswer: { '@type': 'Answer', text: faqAnswer }
			}
		]
	});

	// Balise JSON-LD assemblée par concaténation pour ne pas fermer le <script> hôte ;
	// `<` échappé dans les données par sécurité (défensif, données build-time).
	const jsonLd = $derived(
		'<script type="application/ld+json">' +
			JSON.stringify(faqLd).replace(/</g, '\\u003c') +
			'</' +
			'script>'
	);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={url} />
	{#if data.noindex}
		<!-- Tronçon mince (sans stats ARCEP fiables) : exclu de l'index, liens suivis. -->
		<meta name="robots" content="noindex,follow" />
	{/if}
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html jsonLd}
</svelte:head>

<PageWrap>
	<nav class="crumbs"><a href="/lignes">Lignes</a> › {relationLabel}</nav>
	<h1>Couverture mobile dans le train&nbsp;: {relationLabel}</h1>
	{#if isTroncon}
		<p class="lede">
			Trajet <strong>{line.from} ↔ {line.to}</strong> (dans les deux sens), portion de la ligne
			{#if parent}<a href="/ligne/{parent.slug}">{parent.name}</a>{:else}{line.service}{/if}.
			Découvrez où la 4G/5G passe (ou coupe) grâce aux mesures de la communauté.
		</p>
	{:else}
		<p class="lede">
			Ligne <strong>{line.service}</strong> entre {line.from} et {line.to}. Découvrez où la 4G/5G
			passe (ou coupe) grâce aux mesures de la communauté.
		</p>
	{/if}

	<section class="profil">
		<h2>Le profil de votre trajet, gare après gare</h2>
		<p>
			De {line.from} à {line.to}, voici où vous pourrez regarder une vidéo, naviguer, juste envoyer
			un message… ou rien du tout. Le fond montre la couverture théorique (ARCEP)&nbsp;; les
			pastilles cerclées de blanc, ce qui a été mesuré en vrai.
		</p>
		<RouteProfile slug={line.slug} />
	</section>

	<section class="apercu-carte">
		<h2>Où passe la ligne {isTroncon ? `${line.from} ↔ ${line.to}` : line.name}</h2>
		<p>Le tracé de {line.from} à {line.to}, coloré par la couverture mobile attendue.</p>
		<MapPreview slug={line.slug} />
	</section>

	<section>
		{#if stats}
			<h2>La couverture annoncée sur {line.name}</h2>
			<p>
				D'après la couverture théorique publiée par l'ARCEP, le réseau 4G est annoncé excellent sur
				<strong>{bestTbcPct(stats)}</strong> du parcours {line.from}–{line.to} (au mieux des quatre opérateurs),
				sur {Math.round(stats.lengthKm)}&nbsp;km de voie.
				{#if describeWhiteZones(stats)}
					{describeWhiteZones(stats)}
				{:else}
					Aucune zone blanche majeure n'est connue le long du trajet.
				{/if}
			</p>

			<h2>Le détail par opérateur sur {line.name}</h2>
			<ul class="ops">
				{#each OPERATORS as o (o.slug)}
					<li>{describeOperator(o.name, stats.arcep[o.key])}</li>
				{/each}
			</ul>
		{:else}
			<h2>Comment est mesurée la couverture&nbsp;?</h2>
			<p>
				Les voyageurs activent le mode mesure sur leur téléphone pendant le trajet. L'application
				teste la connexion en continu et enregistre, de façon anonyme, où ça capte. Plus il y a de
				contributeurs sur la ligne {line.name}, plus la carte est précise.
			</p>
		{/if}

		<h2>Comparer les opérateurs sur {line.name}</h2>
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
