<script lang="ts">
	import { OPERATORS } from '$geo/lines';
	import PageWrap from '$components/PageWrap.svelte';
	import { ORIGIN } from '$lib/site';
</script>

<svelte:head>
	<title>Couverture mobile dans le train par opérateur — Orange, SFR, Free, Bouygues</title>
	<meta
		name="description"
		content="Comparez la couverture mobile dans le train selon votre opérateur : Orange, SFR, Free, Bouygues. Carte 4G/5G le long des lignes SNCF."
	/>
	<link rel="canonical" href={`${ORIGIN}/operateurs`} />
</svelte:head>

<PageWrap>
	<h1>Couverture dans le train par opérateur</h1>
	<p class="lede">
		Quel opérateur capte le mieux sur votre trajet&nbsp;? Comparez la couverture mobile.
	</p>
	<ul class="cards center">
		{#each OPERATORS as o (o.slug)}
			<li><a href="/operateur/{o.slug}">{o.name}</a></li>
		{/each}
	</ul>
</PageWrap>
