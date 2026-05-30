<script lang="ts">
	import PageWrap from '$components/PageWrap.svelte';

	const faqs = [
		{
			q: 'Pourquoi ça capte mal dans le TGV ?',
			a: 'Un TGV lancé à 300 km/h change de cellule réseau très vite, traverse des tunnels et des zones rurales peu couvertes, et la carrosserie métallique atténue le signal. Résultat : des coupures fréquentes même là où la couverture théorique est bonne.'
		},
		{
			q: 'Comment avoir internet dans le train ?',
			a: 'Utilisez votre forfait mobile (4G/5G) quand le réseau passe, le Wi-Fi de bord sur certains TGV INOUI, et préchargez vos contenus avant les zones blanches. Cette carte vous aide à anticiper où ça coupe.'
		},
		{
			q: 'Quelles données collectez-vous ?',
			a: "Uniquement, et avec votre consentement : une position arrondie à environ 150 m (cellule H3), l'état de la connexion (ça capte / dégradé / ça coupe), la latence, l'opérateur que vous déclarez. Aucune donnée personnelle, aucune trace continue ré-identifiable."
		},
		{
			q: 'Est-ce que ça marche sur iPhone ?',
			a: "Oui. La mesure repose sur un test de connexion actif (ping), qui fonctionne sur tous les navigateurs, iOS compris. L'app garde l'écran allumé pendant la mesure car la géolocalisation s'arrête quand l'écran s'éteint."
		},
		{
			q: 'Le projet est-il open source ?',
			a: 'Oui, entièrement, sous licence MIT. Le code est sur GitHub et les contributions (code comme mesures terrain) sont les bienvenues.'
		}
	];

	const faqLd = {
		'@context': 'https://schema.org',
		'@type': 'FAQPage',
		mainEntity: faqs.map((f) => ({
			'@type': 'Question',
			name: f.q,
			acceptedAnswer: { '@type': 'Answer', text: f.a }
		}))
	};

	// Balise JSON-LD assemblée par concaténation pour ne pas fermer le <script> hôte.
	const jsonLd = '<script type="application/ld+json">' + JSON.stringify(faqLd) + '</' + 'script>';
</script>

<svelte:head>
	<title>FAQ — couverture mobile et internet dans le train</title>
	<meta
		name="description"
		content="Pourquoi ça capte mal dans le TGV ? Comment avoir internet dans le train ? Réponses et conseils sur la couverture mobile 4G/5G en train."
	/>
	<link rel="canonical" href="https://4g-dans-le-train.juulieen.fr/faq" />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html jsonLd}
</svelte:head>

<PageWrap>
	<h1>Questions fréquentes</h1>
	{#each faqs as f (f.q)}
		<details>
			<summary>{f.q}</summary>
			<p>{f.a}</p>
		</details>
	{/each}
</PageWrap>
