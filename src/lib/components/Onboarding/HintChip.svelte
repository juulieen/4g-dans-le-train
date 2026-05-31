<script lang="ts">
	import { fly } from 'svelte/transition';

	let {
		onopen,
		ondismiss
	}: {
		/** L'utilisateur veut découvrir : ouvre l'onboarding. */
		onopen?: () => void;
		/** L'utilisateur ferme l'invite (croix). */
		ondismiss?: () => void;
	} = $props();
</script>

<div class="chip-wrap" transition:fly={{ y: -16, duration: 260 }}>
	<button class="chip glass" onclick={() => onopen?.()}>
		<span class="wave" aria-hidden="true">👋</span>
		<span class="label">Première fois&nbsp;? Voir comment lire la carte</span>
		<span class="arrow" aria-hidden="true">→</span>
	</button>
	<button class="x" onclick={() => ondismiss?.()} aria-label="Fermer l’invite">✕</button>
</div>

<style>
	.chip-wrap {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		top: 0.7rem;
		z-index: var(--z-legend);
		display: flex;
		align-items: stretch;
		gap: 0.3rem;
		max-width: calc(100% - 1.2rem);
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0.85rem;
		border-radius: 999px;
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 600;
		cursor: pointer;
		box-shadow: var(--shadow-2);
		text-align: left;
	}
	.label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.wave {
		font-size: 1.05rem;
		flex: none;
	}
	.arrow {
		color: var(--accent);
		font-weight: 700;
		flex: none;
	}
	.x {
		flex: none;
		width: 2.1rem;
		border: 1px solid var(--glass-border);
		border-radius: 999px;
		background: var(--glass-bg-strong);
		-webkit-backdrop-filter: blur(var(--glass-blur));
		backdrop-filter: blur(var(--glass-blur));
		color: var(--muted);
		font-size: 0.8rem;
		cursor: pointer;
	}
	.x:hover {
		color: var(--text);
	}
</style>
