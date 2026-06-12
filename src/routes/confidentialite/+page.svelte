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
		<li>
			Aucune trace GPS continue ré-identifiable — sauf si vous activez explicitement la trace
			capteurs expérimentale ci-dessous, qui fait l'objet d'un consentement séparé.
		</li>
		<li>Aucun cookie publicitaire, aucun tracker tiers.</li>
	</ul>

	<h2>Trace capteurs expérimentale (consentement séparé)</h2>
	<p>
		La case «&nbsp;<strong>Enregistrer les capteurs et partager la trace</strong>&nbsp;» du mode
		mesure est un programme expérimental, <strong>désactivé par défaut</strong>, qui sert à
		rechercher comment localiser les mesures sans GPS (tunnels). En la cochant, vous acceptez qu'à
		la fin de la session une <strong>trace technique du trajet</strong> soit envoyée aux développeurs.
		Elle contient&nbsp;:
	</p>
	<ul>
		<li>
			les <strong>positions GPS précises</strong> (non arrondies) relevées pendant la session — c'est
			l'exception à la règle d'arrondi ci-dessus, et la raison du consentement séparé&nbsp;;
		</li>
		<li>les mesures d'<strong>accéléromètre et de gyroscope</strong> du téléphone&nbsp;;</li>
		<li>
			le <strong>modèle de navigateur</strong> (user-agent) et l'opérateur déclaré — aucun nom,
			aucun identifiant de compte, et <strong>pas</strong> le jeton de session des mesures.
		</li>
	</ul>
	<p>
		Chaque trace porte un identifiant aléatoire indépendant&nbsp;: deux traces d'une même personne
		ne sont pas reliables entre elles. Les traces servent uniquement à l'analyse du projet (open
		source), ne sont jamais publiées telles quelles et peuvent être supprimées sur simple demande
		(issue GitHub, en indiquant la date du trajet). Tant que la case n'est pas cochée, rien de tout
		cela n'est ni enregistré ni envoyé. Après la session, le bouton «&nbsp;Exporter&nbsp;» vous
		permet de télécharger votre propre trace pour voir exactement ce qu'elle contient, et
		«&nbsp;Effacer&nbsp;» la supprime de votre appareil.
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
