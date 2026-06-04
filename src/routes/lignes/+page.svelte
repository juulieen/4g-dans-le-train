<script lang="ts">
	import { RAIL_LINES } from '$geo/lines';
	import PageWrap from '$components/PageWrap.svelte';
	import { ORIGIN } from '$lib/site';
</script>

<svelte:head>
	<title>Couverture mobile par ligne de train — toutes les lignes SNCF</title>
	<meta
		name="description"
		content="Choisissez votre ligne de train (Paris-Lyon, Paris-Marseille…) pour voir la couverture mobile 4G/5G mesurée par la communauté."
	/>
	<link rel="canonical" href={`${ORIGIN}/lignes`} />
</svelte:head>

<PageWrap>
	<h1>Couverture mobile par ligne de train</h1>
	<p class="lede">Sélectionnez votre trajet pour voir où ça capte (et où ça coupe).</p>
	<ul class="cards">
		{#each RAIL_LINES as line (line.slug)}
			<li>
				<a href="/ligne/{line.slug}">
					<strong>{line.name}</strong>
					<span>{line.service}</span>
				</a>
			</li>
		{/each}
	</ul>
</PageWrap>
