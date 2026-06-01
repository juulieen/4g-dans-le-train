/**
 * Découverte data-driven des « tronçons » = sous-relations ville↔ville absentes
 * des libellés GTFS (ex. Bordeaux↔Toulouse, portion de Paris–Toulouse ;
 * Poitiers↔Bordeaux, portion de Paris–Bordeaux). Pur (aucune I/O) : prend les
 * itinéraires de gares déjà extraits du GTFS (`itinerariesBySlug`) et renvoie des
 * `CommercialLine` avec `segmentOf` à append au référentiel.
 *
 * IDÉE : une gare est « notable » selon sa HUB-NESS = nombre de relations
 * distinctes du référentiel qui la desservent (100 % data). Pour chaque ligne, on
 * réduit son itinéraire à ses gares majeures (hub-ness ≥ seuil) et on émet un
 * tronçon pour CHAQUE paire de gares majeures (adjacentes ET « saute-gare », pour
 * capturer Poitiers↔Bordeaux où Angoulême s'interpose). Chaque couple est
 * canonicalisé en paire NON ORDONNÉE (une seule page bidirectionnelle).
 *
 * GARDE-FOUS DE NOMMAGE (légers, comme `CITY_ALIASES`) : une gare est résolue en
 * « ville » via le vocabulaire des terminus du référentiel, puis une petite table
 * d'alias (gare→ville), puis une liste noire de gares non pertinentes (nœuds TGV
 * sans ville claire). Le résolveur est partagé avec `build-line-index.ts` pour
 * que le découpage retrouve les mêmes villes.
 */
import { slugifyLine, type CommercialLine } from '../../src/lib/geo/lines-base';
import { cityMatches, type Station } from './gtfs';

/** Une ville exploitable comme extrémité de tronçon : slug d'URL + libellé. */
export interface City {
	slug: string;
	name: string;
}

/**
 * Nettoie un libellé de gare GTFS vers un nom de ville lisible (même esprit que
 * `prettyStation` de build-line-stats) : retire parenthèses, « Hall N », les
 * qualificatifs « TGV/Ville/SNCF », « Gare de… », et ramène les gares parisiennes
 * à « Paris ».
 */
function cleanStationName(name: string): string {
	const s = name
		.replace(/\s*\([^)]*\)\s*/g, ' ')
		.replace(/\s+Hall\s+\d.*$/i, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (/^Paris\b/.test(s)) return 'Paris';
	return s
		.replace(/\s+(TGV|Ville|SNCF)\b/gi, '')
		.replace(/\bGare\s+(de|du|des|d')\s+/gi, '')
		.replace(/\s+Gare\b/gi, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Alias gare→ville : quand le libellé de la gare diffère du nom de la ville
 * (gares TGV excentrées). Clé = slug du libellé NETTOYÉ. Permet de regrouper la
 * hub-ness et de produire des slugs/URL propres.
 */
const STATION_ALIASES: Record<string, City> = {
	'saint-pierre-des-corps': { slug: 'tours', name: 'Tours' },
	'les-aubrais': { slug: 'orleans', name: 'Orléans' },
	'les-aubrais-orleans': { slug: 'orleans', name: 'Orléans' },
	'angers-saint-laud': { slug: 'angers', name: 'Angers' },
	'limoges-benedictins': { slug: 'limoges', name: 'Limoges' },
	'montauban-bourbon': { slug: 'montauban', name: 'Montauban' },
	'macon-loche': { slug: 'macon', name: 'Mâcon' }
};

/**
 * Gares à NE PAS utiliser comme extrémité de tronçon : nœuds TGV sans ville
 * claire (ou non pertinents en SEO « ville→ville »). Clé = slug du libellé nettoyé.
 */
const STATION_BLACKLIST = new Set([
	'massy',
	'massy-tgv',
	'massy-palaiseau',
	'champagne-ardenne',
	'meuse',
	'lorraine',
	'aeroport-charles-de-gaulle',
	'marne-la-vallee-chessy'
]);

/**
 * Construit un résolveur gare→ville à partir du vocabulaire des terminus du
 * référentiel (parentLines) + alias + liste noire. Renvoie `null` si la gare
 * n'est pas une ville exploitable (liste noire). PARTAGÉ avec build-line-index
 * pour garantir un découpage cohérent avec la découverte.
 */
export function makeCityResolver(
	parentLines: CommercialLine[]
): (stationName: string) => City | null {
	// Vocabulaire des villes connues = terminus from/to des lignes du référentiel,
	// avec leur libellé soigné (déduplication par slug).
	const known = new Map<string, City>();
	for (const l of parentLines) {
		for (const c of [
			{ slug: slugifyLine(l.from), name: l.from },
			{ slug: slugifyLine(l.to), name: l.to }
		]) {
			if (c.slug && !known.has(c.slug)) known.set(c.slug, c);
		}
	}
	const knownList = [...known.values()];

	return (stationName: string): City | null => {
		const pretty = cleanStationName(stationName);
		const ps = slugifyLine(pretty);
		if (!ps) return null;
		// 1) ville du référentiel (gare = « Bordeaux Saint-Jean » → ville « Bordeaux »)
		for (const c of knownList) if (cityMatches(ps, c.slug)) return c;
		// 2) alias explicite (gare excentrée → ville)
		if (STATION_ALIASES[ps]) return STATION_ALIASES[ps];
		// 3) liste noire (nœud sans ville claire)
		if (STATION_BLACKLIST.has(ps)) return null;
		// 4) repli : le libellé nettoyé fait office de ville (Poitiers, Angoulême…)
		return { slug: ps, name: pretty };
	};
}

/** Itinéraire d'une ligne réduit à sa suite ORDONNÉE de villes (déduplication). */
function citiesOfItinerary(stops: Station[], cityOf: (n: string) => City | null): City[] {
	const out: City[] = [];
	for (const s of stops) {
		const c = cityOf(s.name);
		if (!c) continue;
		if (out.length && out[out.length - 1].slug === c.slug) continue; // dédup consécutifs
		out.push(c);
	}
	return out;
}

/** Un tronçon découvert + ses signaux (pour journaliser/calibrer le seuil). */
export interface TronconDiscovery {
	line: CommercialLine & { segmentOf: string };
	hubFrom: number;
	hubTo: number;
	parents: string[];
}

/**
 * Découvre les tronçons depuis les itinéraires GTFS. `minHub` = seuil de
 * hub-ness (curseur de largeur). Un tronçon est émis pour chaque paire de villes
 * majeures d'une ligne, canonicalisée (slug alpha), en excluant les relations
 * déjà complètes du référentiel.
 */
export function discoverTroncons(
	itineraries: Map<string, Station[]>,
	parentLines: CommercialLine[],
	opts: { minHub: number }
): TronconDiscovery[] {
	const cityOf = makeCityResolver(parentLines);
	const metaBySlug = new Map(parentLines.map((l) => [l.slug, l]));

	// Suite de villes par ligne parente (dans l'ordre de l'itinéraire).
	const citiesByParent = new Map<string, City[]>();
	for (const [slug, stops] of itineraries)
		citiesByParent.set(slug, citiesOfItinerary(stops, cityOf));

	// Hub-ness : nombre de lignes parentes distinctes desservant chaque ville.
	const hub = new Map<string, number>();
	for (const cities of citiesByParent.values()) {
		const seen = new Set<string>();
		for (const c of cities) {
			if (seen.has(c.slug)) continue;
			seen.add(c.slug);
			hub.set(c.slug, (hub.get(c.slug) ?? 0) + 1);
		}
	}

	// Couples déjà couverts par une relation complète (slug brut + couple alpha).
	const existing = new Set<string>();
	for (const l of parentLines) {
		existing.add(l.slug);
		existing.add(canonicalSlug(slugifyLine(l.from), slugifyLine(l.to)));
	}

	// Émission : toute paire de villes majeures (adjacentes ET saute-gare).
	const found = new Map<string, TronconDiscovery>();
	for (const [parentSlug, cities] of citiesByParent) {
		const majors = cities.filter((c) => (hub.get(c.slug) ?? 0) >= opts.minHub);
		const parentService = metaBySlug.get(parentSlug)?.service ?? 'TGV INOUI';
		for (let i = 0; i < majors.length; i++) {
			for (let j = i + 1; j < majors.length; j++) {
				const from = majors[i];
				const to = majors[j];
				if (from.slug === to.slug) continue;
				const slug = canonicalSlug(from.slug, to.slug);
				if (existing.has(slug)) continue;
				const prev = found.get(slug);
				if (prev) {
					if (!prev.parents.includes(parentSlug)) prev.parents.push(parentSlug);
					continue;
				}
				found.set(slug, {
					line: {
						slug,
						name: `${from.name} – ${to.name}`,
						service: parentService,
						from: from.name,
						to: to.name,
						segmentOf: parentSlug
					},
					hubFrom: hub.get(from.slug) ?? 0,
					hubTo: hub.get(to.slug) ?? 0,
					parents: [parentSlug]
				});
			}
		}
	}

	return [...found.values()].sort((a, b) => a.line.slug.localeCompare(b.line.slug, 'fr'));
}

/** Slug canonique d'un couple non ordonné de villes (tri alpha des deux slugs). */
function canonicalSlug(a: string, b: string): string {
	return [a, b].sort().join('-');
}
