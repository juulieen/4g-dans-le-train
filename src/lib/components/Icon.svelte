<script lang="ts">
	let { name, size = 24 }: { name: string; size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.9"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'map'}
		<path d="M12 21s6-5.1 6-10a6 6 0 0 0-12 0c0 4.9 6 10 6 10z" />
		<circle cx="12" cy="11" r="2.3" />
	{:else if name === 'train'}
		<rect x="6" y="3" width="12" height="13" rx="2.5" />
		<line x1="6" y1="11" x2="18" y2="11" />
		<circle cx="9.2" cy="13.6" r="0.6" fill="currentColor" stroke="none" />
		<circle cx="14.8" cy="13.6" r="0.6" fill="currentColor" stroke="none" />
		<path d="M8.5 16l-2 4" />
		<path d="M15.5 16l2 4" />
	{:else if name === 'signal'}
		<circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
		<path d="M16.2 7.8a6 6 0 0 1 0 8.4" />
		<path d="M7.8 16.2a6 6 0 0 1 0-8.4" />
		<path d="M19 5a9.5 9.5 0 0 1 0 14" />
		<path d="M5 19A9.5 9.5 0 0 1 5 5" />
	{:else if name === 'help'}
		<circle cx="12" cy="12" r="9" />
		<path d="M9.4 9.2a2.7 2.7 0 0 1 5 1.1c0 1.6-2.4 2-2.4 3.4" />
		<circle cx="12" cy="16.8" r="0.65" fill="currentColor" stroke="none" />
	{:else if name === 'info'}
		<circle cx="12" cy="12" r="9" />
		<line x1="12" y1="11" x2="12" y2="16.5" />
		<circle cx="12" cy="7.8" r="0.7" fill="currentColor" stroke="none" />
	{:else if name === 'sun'}
		<circle cx="12" cy="12" r="4" />
		<path
			d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
		/>
	{:else if name === 'moon'}
		<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
	{:else if name === 'lock'}
		<rect x="5" y="11" width="14" height="10" rx="2.5" />
		<path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
		<circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none" />
	{:else if name === 'sparkle'}
		<path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7z" />
		<path d="M18.5 15.5l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z" />
	{:else if name === 'eye-off'}
		<path d="M9.9 4.4A9.6 9.6 0 0 1 12 4.2c5 0 9 4.8 9 7.8a12 12 0 0 1-2.2 3.2" />
		<path d="M6.5 6.6A12.4 12.4 0 0 0 3 12c0 3 4 7.8 9 7.8a9.3 9.3 0 0 0 3.6-.7" />
		<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
		<line x1="3.5" y1="3.5" x2="20.5" y2="20.5" />
	{:else if name === 'layers'}
		<path d="M12 3l9 5-9 5-9-5 9-5z" />
		<path d="M3 13l9 5 9-5" />
	{:else if name === 'logo'}
		<rect x="3.5" y="7.5" width="11" height="11.5" rx="3" />
		<line x1="3.5" y1="13.5" x2="14.5" y2="13.5" />
		<circle cx="7" cy="16" r="0.7" fill="currentColor" stroke="none" />
		<circle cx="11" cy="16" r="0.7" fill="currentColor" stroke="none" />
		<path d="M6.5 19l-1.5 2.5" />
		<path d="M11.5 19l1.5 2.5" />
		<path d="M17.5 6.5a4.5 4.5 0 0 1 0 6" />
		<path d="M20 4a8 8 0 0 1 0 11" />
	{/if}
</svg>

<style>
	svg {
		display: block;
	}
</style>
