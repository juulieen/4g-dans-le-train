<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import Icon from '$components/Icon.svelte';
	import { STEPS } from './steps';

	let { open = false, onclose }: { open?: boolean; onclose?: () => void } = $props();

	let index = $state(0);
	let dialogEl: HTMLElement | undefined = $state();
	let trigger: HTMLElement | null = null;

	// Repart du début à chaque ouverture.
	$effect(() => {
		if (open) index = 0;
	});

	// Gestion du focus : on déplace le focus dans la modale à l'ouverture et on le
	// rend au déclencheur à la fermeture (accessibilité clavier / lecteur d'écran).
	$effect(() => {
		if (open && dialogEl) {
			if (!trigger) trigger = document.activeElement as HTMLElement | null;
			dialogEl.focus();
		} else if (!open && trigger) {
			trigger.focus();
			trigger = null;
		}
	});

	const last = $derived(index === STEPS.length - 1);

	function next() {
		if (last) close();
		else index += 1;
	}
	function prev() {
		if (index > 0) index -= 1;
	}
	function close() {
		onclose?.();
	}
	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
		else if (e.key === 'ArrowRight') next();
		else if (e.key === 'ArrowLeft') prev();
		else if (e.key === 'Tab') trapFocus(e);
	}
	// Piège le focus à l'intérieur de la modale (cycle Tab / Shift+Tab).
	function trapFocus(e: KeyboardEvent) {
		if (!dialogEl) return;
		const items = dialogEl.querySelectorAll<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		const focusable = [...items].filter((el) => !el.hasAttribute('disabled'));
		if (!focusable.length) return;
		const first = focusable[0];
		const lastEl = focusable[focusable.length - 1];
		const active = document.activeElement;
		if (e.shiftKey && (active === first || active === dialogEl)) {
			e.preventDefault();
			lastEl.focus();
		} else if (!e.shiftKey && active === lastEl) {
			e.preventDefault();
			first.focus();
		}
	}
</script>

<svelte:window onkeydown={open ? onkeydown : undefined} />

{#if open}
	<div class="scrim" transition:fade={{ duration: 200 }}>
		<button class="backdrop" onclick={close} aria-label="Fermer"></button>
		<div
			class="dialog glass"
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-label="Comment ça marche"
			bind:this={dialogEl}
			transition:scale={{ duration: 260, start: 0.94, opacity: 0 }}
		>
			<button class="close" onclick={close} aria-label="Fermer">✕</button>

			<div class="viewport">
				<div class="track" style="transform: translateX(-{index * 100}%)">
					{#each STEPS as step (step.title)}
						<section class="slide" aria-hidden={STEPS[index] !== step}>
							<div class="icon" aria-hidden="true"><Icon name={step.icon} size={44} /></div>
							<h2>{step.title}</h2>

							{#if step.visual === 'route'}
								<div class="viz route" aria-hidden="true">
									<span class="city">Paris</span>
									<span class="dots">
										<i style="background:var(--usage-tbc)"></i>
										<i style="background:var(--usage-tbc)"></i>
										<i style="background:var(--usage-cl)"></i>
										<i style="background:var(--usage-tbc)"></i>
										<i style="background:var(--usage-none)"></i>
										<i style="background:var(--usage-bc)"></i>
										<i style="background:var(--usage-tbc)"></i>
									</span>
									<span class="city">Lyon</span>
								</div>
							{:else if step.visual === 'legend'}
								<div class="viz legend" aria-hidden="true">
									<span><b class="line" style="background:var(--usage-tbc)"></b> Vidéo, visio</span>
									<span
										><b class="line" style="background:var(--usage-bc)"></b> Web, réseaux sociaux</span
									>
									<span
										><b class="line" style="background:var(--usage-cl)"></b> Messages seulement</span
									>
									<span><b class="line" style="background:var(--usage-none)"></b> Zone blanche</span
									>
									<span class="measured"
										><b class="dot" style="background:var(--usage-tbc)"></b> Mesuré en vrai</span
									>
								</div>
							{:else if step.visual === 'privacy'}
								<div class="viz privacy" aria-hidden="true">
									<span
										><Icon name="map" size={18} />
										<small>position arrondie ~150&nbsp;m</small></span
									>
									<span><Icon name="eye-off" size={18} /> <small>aucune donnée perso</small></span>
									<span><Icon name="layers" size={18} /> <small>agrégé par zone</small></span>
								</div>
							{/if}

							<div class="body">
								{#each step.body as p (p)}
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									<p>{@html p}</p>
								{/each}
							</div>
						</section>
					{/each}
				</div>
			</div>

			<div class="dots-nav" aria-hidden="true">
				{#each STEPS as step, i (step.title)}
					<button
						class="dot-btn"
						class:active={i === index}
						onclick={() => (index = i)}
						aria-label={`Étape ${i + 1}`}
					></button>
				{/each}
			</div>

			<div class="actions">
				{#if index > 0}
					<button class="ghost" onclick={prev}>Précédent</button>
				{:else}
					<button class="ghost" onclick={close}>Passer</button>
				{/if}
				<button class="primary" onclick={next}>
					{last ? 'C’est parti' : 'Suivant'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: var(--z-onboarding);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: max(1rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom));
		background: color-mix(in srgb, var(--bg) 55%, transparent);
		-webkit-backdrop-filter: blur(4px);
		backdrop-filter: blur(4px);
	}
	.backdrop {
		position: absolute;
		inset: 0;
		border: none;
		padding: 0;
		margin: 0;
		background: transparent;
		cursor: pointer;
	}
	.dialog {
		position: relative;
		z-index: 1;
		width: min(440px, 100%);
		max-height: 100%;
		border-radius: var(--r-xl);
		padding: 1.6rem 1.3rem 1.1rem;
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow-2);
	}
	.close {
		position: absolute;
		top: 0.6rem;
		right: 0.6rem;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: 50%;
		background: color-mix(in srgb, var(--text) 8%, transparent);
		color: var(--muted);
		font-size: 0.9rem;
		cursor: pointer;
		line-height: 1;
	}
	.close:hover {
		color: var(--text);
	}
	.viewport {
		overflow: hidden;
	}
	.track {
		display: flex;
		transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
	}
	.slide {
		flex: 0 0 100%;
		min-width: 0;
		text-align: center;
		padding: 0.4rem 0.2rem 0;
	}
	.icon {
		display: flex;
		justify-content: center;
		margin-top: 0.4rem;
		color: var(--accent);
	}
	h2 {
		font-size: var(--fs-lg);
		margin: 0.7rem 0 0.4rem;
		color: var(--text);
	}
	.body {
		color: var(--muted);
		font-size: var(--fs-sm);
		line-height: 1.55;
	}
	.body :global(p) {
		margin: 0.5rem 0;
	}
	.body :global(strong) {
		color: var(--text);
	}

	/* Schémas illustratifs */
	.viz {
		margin: 0.8rem auto 0.2rem;
		padding: 0.7rem 0.8rem;
		border-radius: var(--r-md);
		background: color-mix(in srgb, var(--panel) 60%, transparent);
		border: 1px solid var(--glass-border);
	}
	.route {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: center;
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text);
	}
	.route .dots {
		display: inline-flex;
		gap: 4px;
	}
	.route .dots i {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		display: inline-block;
	}
	.legend {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--fs-xs);
		color: var(--text);
		text-align: left;
		width: fit-content;
	}
	.legend span {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.legend .line {
		width: 20px;
		height: 5px;
		border-radius: 3px;
		display: inline-block;
		flex: none;
	}
	.legend .dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		display: inline-block;
		border: 2px solid #fff;
		flex: none;
	}
	.legend .measured {
		margin-top: 3px;
		padding-top: 5px;
		border-top: 1px solid var(--glass-border);
	}
	.privacy {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: var(--fs-sm);
		color: var(--text);
		width: fit-content;
		margin-inline: auto;
		text-align: left;
	}
	.privacy span {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.privacy :global(svg) {
		color: var(--accent);
		flex: none;
	}
	.privacy small {
		color: var(--muted);
	}

	.dots-nav {
		display: flex;
		justify-content: center;
		gap: 7px;
		margin: 1rem 0 0.9rem;
	}
	.dot-btn {
		width: 8px;
		height: 8px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: color-mix(in srgb, var(--text) 22%, transparent);
		cursor: pointer;
		transition:
			background 0.2s,
			width 0.2s;
	}
	.dot-btn.active {
		background: var(--accent);
		width: 20px;
		border-radius: 4px;
	}

	.actions {
		display: flex;
		gap: 0.6rem;
	}
	.actions button {
		flex: 1;
		min-height: 44px;
		border-radius: var(--r-md);
		font-size: var(--fs-md);
		font-weight: 600;
		cursor: pointer;
	}
	.ghost {
		background: color-mix(in srgb, var(--text) 8%, transparent);
		color: var(--text);
		border: 1px solid var(--glass-border);
	}
	.primary {
		background: var(--accent);
		color: #052e16;
		border: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.track {
			transition: none;
		}
	}
</style>
