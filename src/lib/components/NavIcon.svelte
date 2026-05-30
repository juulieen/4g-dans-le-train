<script lang="ts">
	let { name }: { name: string } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.9"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'map'}
		<!-- Carte : épingle de localisation -->
		<path d="M12 21s6-5.1 6-10a6 6 0 0 0-12 0c0 4.9 6 10 6 10z" />
		<circle cx="12" cy="11" r="2.3" />
	{:else if name === 'train'}
		<!-- Lignes : train -->
		<rect x="6" y="3" width="12" height="13" rx="2.5" />
		<line x1="6" y1="11" x2="18" y2="11" />
		<circle cx="9.2" cy="13.6" r="0.6" fill="currentColor" stroke="none" />
		<circle cx="14.8" cy="13.6" r="0.6" fill="currentColor" stroke="none" />
		<path d="M8.5 16l-2 4" />
		<path d="M15.5 16l2 4" />
	{:else if name === 'signal'}
		<!-- Opérateurs : ondes / antenne -->
		<circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
		<path d="M16.2 7.8a6 6 0 0 1 0 8.4" />
		<path d="M7.8 16.2a6 6 0 0 1 0-8.4" />
		<path d="M19 5a9.5 9.5 0 0 1 0 14" />
		<path d="M5 19A9.5 9.5 0 0 1 5 5" />
	{:else if name === 'help'}
		<!-- FAQ : aide -->
		<circle cx="12" cy="12" r="9" />
		<path d="M9.4 9.2a2.7 2.7 0 0 1 5 1.1c0 1.6-2.4 2-2.4 3.4" />
		<circle cx="12" cy="16.8" r="0.65" fill="currentColor" stroke="none" />
	{/if}
</svg>

<style>
	svg {
		width: 24px;
		height: 24px;
		display: block;
	}
</style>
