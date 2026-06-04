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
import { and, eq, ne } from 'drizzle-orm';
import { RAIL_LINES } from '$geo/lines';
import { resolveLineFilter } from '$geo/troncon-snap';
import { WIFI_TRAIN_OPERATOR } from '$lib/operators';
import { db } from '$lib/server/db/client';
import { cellAggregates, type CellAggregate } from '$lib/server/db/schema';
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

/**
 * Résumé du réel pour une ligne, ou null si trop peu de données (< 3 cellules) ou base
 * indisponible. Miroir du filtrage de `/api/coverage` (gère les tronçons ET exclut le
 * Wi-Fi de bord).
 */
async function realSummary(slug: string): Promise<RealSummary | null> {
	const filter = resolveLineFilter(slug);
	if (!filter) return null;
	try {
		// On EXCLUT le Wi-Fi de bord (`wifi-train`) comme toutes les vues de couverture
		// mobile (cf. /api/coverage) : il ne crédite aucun opérateur mobile.
		const notWifi = ne(cellAggregates.operator, WIFI_TRAIN_OPERATOR);
		let rows: CellAggregate[];
		if (filter.cells) {
			// Tronçon : le slug stocké est le primaire (pas la parente) → on filtre par cellules.
			rows = (await db.select().from(cellAggregates).where(notWifi)).filter((r) =>
				filter.cells!.has(r.cellId)
			);
		} else {
			rows = await db
				.select()
				.from(cellAggregates)
				.where(and(eq(cellAggregates.lineSlug, filter.lineSlug), notWifi));
		}
		const cells = new Set(rows.map((r) => r.cellId)).size;
		if (cells < 3) return null;
		const samples = rows.reduce((a, r) => a + r.samples, 0);
		return { cells, samples };
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

	const line = slug === 'default' ? undefined : RAIL_LINES.find((l) => l.slug === slug);
	// Clé de cache BORNÉE : tout slug inconnu retombe sur la carte par défaut sous la clé
	// 'default' (sinon le mémo grossirait sans limite sous des requêtes /og/<aléatoire>.png).
	const cacheKey = line ? slug : 'default';

	const cached = memo.get(cacheKey);
	if (cached && cached.bucket === bucket) {
		return new Response(cached.png, { headers });
	}

	let png: ArrayBuffer;
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

	memo.set(cacheKey, { bucket, png });
	return new Response(png, { headers });
};
