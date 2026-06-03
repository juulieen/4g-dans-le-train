import { error } from '@sveltejs/kit';
import { RAIL_LINES } from '$geo/lines';
import { lineStats } from '$geo/line-stats';
import { freshnessLabel } from '$geo/coverage-copy';
import { loadLineReal } from '$lib/server/line-real';
import type { PageServerLoad } from './$types';

/**
 * Page ligne — rendue en **SSR** (et non prérendue) : le « verdict » + les « points
 * noirs » sont calculés côté serveur depuis la base VIVE à chaque requête, donc
 * **toujours frais et indexables**, sans prérendu nocturne ni instantané committé
 * (cf. docs/spec-page-ligne.md). Court `cache-control` : le réel bouge lentement, le
 * cache CDN/navigateur encaisse l'essentiel du trafic.
 *
 * Le sous-arbre `[operateur]` reste prérendu (sa propre page). Les stats ARCEP, elles,
 * restent figées au build (`line-stats.json`).
 */
export const prerender = false;

export const load: PageServerLoad = async ({ params, fetch, setHeaders }) => {
	const line = RAIL_LINES.find((l) => l.slug === params.slug);
	if (!line) throw error(404, 'Ligne inconnue');

	const stats = lineStats(line.slug) ?? null;
	// Un tronçon (`segmentOf`) est une sous-relation d'une ligne parente, présentée
	// comme une page bidirectionnelle unique. On référence la parente (lien + portion).
	const parent = line.segmentOf
		? (RAIL_LINES.find((l) => l.slug === line.segmentOf) ?? null)
		: null;
	// Instantané du réel (couverture + verdict + points noirs), calculé live.
	const real = await loadLineReal(fetch, line.slug);

	// Stratégie SEO « large + monitoring » : on INDEXE les tronçons riches (stats ARCEP
	// fiables OU mesures réelles suffisantes) et on met en `noindex` les tronçons minces
	// (coquilles) — réglable via GSC.
	const noindex = Boolean(line.segmentOf) && !stats && !real.sufficient;

	// Fraîcheur calculée CÔTÉ SERVEUR (évite un décalage d'hydratation avec Date.now client).
	const freshness = freshnessLabel(real.lastSeen, Date.now() / 1000);

	// Le réel bouge lentement → court cache (CDN/navigateur) pour amortir le SSR.
	setHeaders({ 'cache-control': 'public, max-age=300' });

	return { line, stats, parent, isTroncon: Boolean(line.segmentOf), noindex, real, freshness };
};
