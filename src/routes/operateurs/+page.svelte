<script lang="ts">
	import { OPERATORS } from '$geo/lines';
</script>

<svelte:head>
	<title>Couverture mobile dans le train par opérateur — Orange, SFR, Free, Bouygues</title>
	<meta
		name="description"
		content="Comparez la couverture mobile dans le train selon votre opérateur : Orange, SFR, Free, Bouygues. Carte 4G/5G le long des lignes SNCF."
	/>
	<link rel="canonical" href="https://4g-dans-le-train.juulieen.fr/operateurs" />
</svelte:head>

<div class="wrap">
	<h1>Couverture dans le train par opérateur</h1>
	<p>Quel opérateur capte le mieux sur votre trajet&nbsp;? Comparez la couverture mobile.</p>
	<ul class="ops">
		{#each OPERATORS as o (o.slug)}
			<li><a href="/operateur/{o.slug}">{o.name}</a></li>
		{/each}
	</ul>
</div>

<style>
	.wrap {
		max-width: 720px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}
	.ops {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 0.75rem;
	}
	.ops a {
		display: block;
		padding: 1rem;
		text-align: center;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 10px;
		text-decoration: none;
		color: var(--text);
		font-weight: 600;
	}
	.ops a:hover {
		border-color: var(--accent);
	}
</style>
