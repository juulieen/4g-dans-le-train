<script lang="ts">
	import { RAIL_LINES } from '$geo/lines';
</script>

<svelte:head>
	<title>Couverture mobile par ligne de train — toutes les lignes SNCF</title>
	<meta
		name="description"
		content="Choisissez votre ligne de train (Paris-Lyon, Paris-Marseille…) pour voir la couverture mobile 4G/5G mesurée par la communauté."
	/>
	<link rel="canonical" href="https://4g-dans-le-train.juulieen.fr/lignes" />
</svelte:head>

<div class="wrap">
	<h1>Couverture mobile par ligne de train</h1>
	<p>Sélectionnez votre trajet pour voir où ça capte (et où ça coupe).</p>
	<ul class="lines">
		{#each RAIL_LINES as line (line.slug)}
			<li>
				<a href="/ligne/{line.slug}">
					<strong>{line.name}</strong>
					<span>{line.service}</span>
				</a>
			</li>
		{/each}
	</ul>
</div>

<style>
	.wrap {
		max-width: 720px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}
	.lines {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 0.75rem;
	}
	.lines a {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.9rem 1rem;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 10px;
		text-decoration: none;
		color: var(--text);
	}
	.lines a:hover {
		border-color: var(--accent);
	}
	.lines span {
		font-size: 0.75rem;
		color: var(--muted);
	}
</style>
