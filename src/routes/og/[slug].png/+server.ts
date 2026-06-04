/**
 * Vignette sociale (Open Graph / Twitter Card) d'une ligne, générée à la volée.
 *
 * Stratégie « ARCEP → réel progressif » : la carte montre la couverture théorique
 * (frise ARCEP) et superpose un résumé du RÉEL communautaire dès qu'une ligne a assez
 * de mesures — sans rebuild ni redéploiement. Tant qu'il n'y a pas de données, la
 * vignette reste pertinente (ARCEP) + incitation à mesurer.
 *
 * Cache 24 h : en-tête HTTP (crawlers sociaux, Caddy, navigateurs) + mémo en process
 * invalidé chaque jour (le réel se rafraîchit ainsi ~quotidiennement). Le `/og/default.png`
 * sert la carte générique (home, opérateurs, repli).
 */
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { RAIL_LINES } from '$geo/lines';
import { resolveLineFilter } from '$geo/troncon-snap';
import { db } from '$lib/server/db/client';
import { cellAggregates, type CellAggregate } from '$lib/server/db/schema';
import { levelFromKbps, type Level } from '$lib/usage';
import {
	renderDefaultCard,
	renderLineCard,
	type RealSummary,
	type RouteProfile
} from '$lib/server/og/card';
import type { RequestHandler } from './$types';

const DAY_MS = 86_400_000;
/** Mémo en process : slug → PNG du jour (invalidé au changement de jour). */
const memo = new Map<string, { bucket: number; png: ArrayBuffer }>();

/**
 * Charge le profil de trajet d'une ligne depuis le disque.
 *
 * On NE passe PAS par `event.fetch('/data/…')` : en adapter-node (prod), les fichiers
 * statiques sont servis par un middleware AVANT le handler SvelteKit, donc invisibles
 * pour `event.fetch` (qui ne traverse que le routeur de l'app) → la frise disparaîtrait.
 * On lit donc directement le fichier ; on essaie les emplacements dev (`static/`) et
 * prod (`build/client/`, ou `client/` si le cwd est dans `build/`).
 */
async function loadProfile(slug: string): Promise<RouteProfile | null> {
	for (const base of ['static', 'build/client', 'client']) {
		try {
			const raw = await readFile(`${base}/data/route-profiles/${slug}.json`, 'utf8');
			return JSON.parse(raw) as RouteProfile;
		} catch {
			/* essaie l'emplacement suivant */
		}
	}
	return null;
}

/** Niveau « réel » d'une cellule : débit médian si mesuré, sinon taux de réussite. */
function cellLevel(r: CellAggregate): Level {
	if (r.medianDownlink != null) return levelFromKbps(r.medianDownlink);
	// Cf. table produit (docs/PRODUCT.md) : ≥80 % vert, 40–80 % orange, <40 % rouge.
	if (r.successRate >= 0.8) return 'TBC';
	if (r.successRate >= 0.4) return 'CL';
	return 'none';
}

/**
 * Résumé du réel pour une ligne, ou null si trop peu de données (< 3 cellules) ou base
 * indisponible. Miroir du filtrage de `/api/coverage` (gère les tronçons).
 */
async function realSummary(slug: string): Promise<RealSummary | null> {
	const filter = resolveLineFilter(slug);
	if (!filter) return null;
	try {
		let rows: CellAggregate[];
		if (filter.cells) {
			// Tronçon : on filtre par cellules (le slug stocké est le primaire, pas la parente).
			rows = (await db.select().from(cellAggregates)).filter((r) => filter.cells!.has(r.cellId));
		} else {
			rows = await db
				.select()
				.from(cellAggregates)
				.where(eq(cellAggregates.lineSlug, filter.lineSlug));
		}
		const cells = new Set(rows.map((r) => r.cellId)).size;
		if (cells < 3) return null;
		const samples = rows.reduce((a, r) => a + r.samples, 0);
		const len = rows.length || 1;
		const streaming = rows.filter((r) => cellLevel(r) === 'TBC').length / len;
		const none = rows.filter((r) => cellLevel(r) === 'none').length / len;
		return { cells, samples, streamingPct: streaming, nonePct: none };
	} catch {
		return null; // base vide / absente : on dégrade vers ARCEP seul.
	}
}

export const GET: RequestHandler = async ({ params }) => {
	const slug = params.slug;
	const bucket = Math.floor(Date.now() / DAY_MS);
	const headers = {
		'content-type': 'image/png',
		'cache-control': 'public, max-age=86400'
	};

	const cached = memo.get(slug);
	if (cached && cached.bucket === bucket) {
		return new Response(cached.png, { headers });
	}

	let png: ArrayBuffer;
	const line = slug === 'default' ? undefined : RAIL_LINES.find((l) => l.slug === slug);
	if (!line) {
		png = await renderDefaultCard();
	} else {
		const profile = await loadProfile(slug);
		const real = await realSummary(slug);
		png = await renderLineCard({
			from: line.from,
			to: line.to,
			service: line.service,
			profile,
			real
		});
	}

	memo.set(slug, { bucket, png });
	return new Response(png, { headers });
};
