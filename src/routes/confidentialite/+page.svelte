<script lang="ts">
	import PageWrap from '$components/PageWrap.svelte';
	import { ORIGIN } from '$lib/site';
</script>

<svelte:head>
	<title>Confidentialité — 4G dans le train</title>
	<meta
		name="description"
		content="Politique de confidentialité : quelles données sont collectées par 4G dans le train et comment elles sont anonymisées."
	/>
	<link rel="canonical" href={`${ORIGIN}/confidentialite`} />
</svelte:head>

<PageWrap>
	<h1>Confidentialité &amp; données</h1>

	<p>
		Ce projet est conçu <strong>privacy-first</strong>. La mesure de couverture n'est possible
		qu'avec votre consentement explicite, et les données collectées sont minimales et anonymisées.
	</p>

	<h2>Ce que nous collectons (avec consentement)</h2>
	<ul>
		<li>
			Une <strong>position arrondie</strong> au centre d'une cellule géographique d'environ 150 m (indexation
			H3). La position GPS exacte n'est jamais stockée.
		</li>
		<li>L'<strong>état de la connexion</strong> : ça capte / dégradé / ça coupe.</li>
		<li>La <strong>latence</strong> du test réseau (en ms).</li>
		<li>L'<strong>opérateur</strong> que vous déclarez (optionnel).</li>
		<li>
			Un <strong>jeton de session anonyme</strong> aléatoire (sans lien avec votre identité), pour dédoublonner
			et limiter les abus.
		</li>
	</ul>

	<h2>Ce que nous ne collectons pas</h2>
	<ul>
		<li>Aucune donnée personnelle (nom, e-mail, numéro, identifiant d'appareil).</li>
		<li>Aucune trace GPS continue ré-identifiable.</li>
		<li>Aucun cookie (ni publicitaire, ni de suivi), aucun tracker tiers commercial.</li>
	</ul>

	<h2>Mesure d'audience</h2>
	<p>
		Nous utilisons <strong>Plausible</strong>, un outil de statistiques d'audience
		<strong>auto-hébergé</strong> sur notre propre serveur (<code>plausible.juulieen.fr</code>). Il
		mesure de façon <strong>agrégée et anonyme</strong> le nombre de visites et les pages
		consultées, <strong>sans cookie</strong> et <strong>sans stocker de donnée personnelle</strong>
		(pas d'adresse IP conservée, pas d'identifiant persistant, aucun suivi entre les sites). Aucune donnée
		n'est transmise à un tiers.
	</p>

	<h2>Vos droits</h2>
	<p>
		Vous pouvez désactiver le partage à tout moment depuis la carte (case « partager mes mesures »).
		Comme les mesures sont anonymisées et agrégées dès la réception, elles ne sont pas rattachables
		a posteriori à une personne.
	</p>

	<p class="muted">
		Le code étant open source, vous pouvez vérifier ces affirmations dans le dépôt GitHub.
	</p>
</PageWrap>
