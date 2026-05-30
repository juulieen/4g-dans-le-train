<script lang="ts">
	import { OPERATORS } from '$geo/lines';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const line = $derived(data.line);
	const op = $derived(data.operator);

	const title = $derived(`Couverture ${op.name} sur ${line.name} — réseau mobile dans le train`);
	const description = $derived(
		`Est-ce que ${op.name} capte sur la ligne ${line.name} (${line.service}) ? Carte de la couverture 4G/5G ${op.name} entre ${line.from} et ${line.to}, mesures réelles des voyageurs incluses.`
	);
	const url = $derived(`https://4g-dans-le-train.juulieen.fr/ligne/${line.slug}/${op.slug}`);

	// Autres opérateurs sur la même ligne (maillage interne).
	const others = $derived(OPERATORS.filter((o) => o.slug !== op.slug));

	const jsonLd = $derived(
		'<script type="application/ld+json">' +
			JSON.stringify({
				'@context': 'https://schema.org',
				'@type': 'FAQPage',
				mainEntity: [
					{
						'@type': 'Question',
						name: `Est-ce que ${op.name} capte entre ${line.from} et ${line.to} ?`,
						acceptedAnswer: {
							'@type': 'Answer',
							text: `La couverture ${op.name} sur la ligne ${line.name} varie selon les sections traversées. Consultez la carte interactive pour voir où le réseau ${op.name} passe en 4G/5G et où il coupe entre ${line.from} et ${line.to}.`
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
	<nav class="crumbs">
		<a href="/lignes">Lignes</a> › <a href="/ligne/{line.slug}">{line.name}</a> › {op.name}
	</nav>
	<h1>Couverture {op.name} sur {line.name}</h1>
	<p class="lede">
		Le réseau <strong>{op.name}</strong> sur la ligne <strong>{line.service}</strong>
		{line.from} – {line.to}&nbsp;: où ça capte, où ça coupe. Couverture théorique officielle +
		mesures réelles des voyageurs.
	</p>

	<a class="cta" href="/">Voir la carte interactive →</a>

	<section>
		<h2>{op.name} entre {line.from} et {line.to}</h2>
		<p>
			La qualité du réseau {op.name} dépend des zones traversées par la ligne {line.name}&nbsp;:
			tunnels, zones rurales et passages à grande vitesse provoquent des coupures même là où la
			couverture théorique est bonne. La carte communautaire vous montre les sections réellement
			problématiques.
		</p>

		<h2>Comparer les opérateurs sur {line.name}</h2>
		<ul class="ops">
			{#each others as o (o.slug)}
				<li><a href="/ligne/{line.slug}/{o.slug}">{o.name} sur {line.name}</a></li>
			{/each}
		</ul>

		<p class="links">
			Voir aussi&nbsp;: <a href="/ligne/{line.slug}">toute la couverture sur {line.name}</a> ·
			<a href="/operateur/{op.slug}">couverture {op.name} sur toutes les lignes</a>
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
	.ops {
		list-style: none;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.ops a {
		display: inline-block;
		padding: 0.4rem 0.8rem;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 999px;
		text-decoration: none;
		color: var(--text);
		font-size: 0.85rem;
	}
	.ops a:hover {
		border-color: var(--accent);
	}
	.links {
		font-size: 0.9rem;
		margin-top: 1.5rem;
	}
</style>
