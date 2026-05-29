<script lang="ts">
</script>

<svelte:head>
	<title>Confidentialité — 4G dans le train</title>
	<meta
		name="description"
		content="Politique de confidentialité : quelles données sont collectées par 4G dans le train et comment elles sont anonymisées."
	/>
	<link rel="canonical" href="https://4g-dans-le-train.juulieen.fr/confidentialite" />
</svelte:head>

<div class="wrap">
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
		<li>Aucun cookie publicitaire, aucun tracker tiers.</li>
	</ul>

	<h2>Vos droits</h2>
	<p>
		Vous pouvez désactiver le partage à tout moment depuis la carte (case « partager mes mesures »).
		Comme les mesures sont anonymisées et agrégées dès la réception, elles ne sont pas rattachables
		a posteriori à une personne.
	</p>

	<p class="muted">
		Le code étant open source, vous pouvez vérifier ces affirmations dans le dépôt GitHub.
	</p>
</div>

<style>
	.wrap {
		max-width: 720px;
		margin: 0 auto;
		padding: 2rem 1rem;
		line-height: 1.6;
	}
	h2 {
		font-size: 1.15rem;
		margin-top: 1.5rem;
	}
	.muted {
		color: var(--muted);
		font-size: 0.9rem;
	}
</style>
