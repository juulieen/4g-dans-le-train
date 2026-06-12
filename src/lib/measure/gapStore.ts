/**
 * Persistance du buffer de trou GPS (pings capturés sans position).
 *
 * POURQUOI : ces pings ne sont recalés sur le tracé qu'à la reprise du GPS. Sans
 * persistance, un refresh de la page (très fréquent sur mobile : onglet déchargé
 * en arrière-plan, rotation, geste malheureux) ou l'arrêt de la session **jette**
 * tout ce qui n'a pas encore été recalé — exactement la donnée des tunnels et des
 * démarrages sans fix. On sauvegarde donc le buffer au fil de l'eau, avec son
 * ancre d'entrée et le slug du tracé, et on le restaure au prochain démarrage.
 *
 * Les garde-fous temporels de l'interpolation (trou ≤ 5 min) bornent naturellement
 * l'utilité d'un buffer restauré : `load` élague ce qui est devenu trop vieux pour
 * être recalé un jour.
 *
 * Storage injectable (par défaut localStorage) → testable sans DOM, comme queue.ts.
 */
import type { GeoSample } from './geolocation';
import type { PingStatus } from './ping';
import type { KeyValueStore } from './queue';

/** Ping bufferisé pendant un trou GPS (position reconstruite plus tard). */
export interface GapPing {
	measuredAt: number;
	status: PingStatus;
	rttMs: number | null;
	netType: string | null;
	/** Connexion en wifi à l'instant du ping (tag `wifi-train` au recalage). */
	onWifi: boolean;
}

/** État d'un trou GPS en cours : ancre d'entrée + pings en attente de recalage. */
export interface GapState {
	/** Dernier fix GPS avant le trou (null en cold-start : aucun fix encore reçu). */
	entry: GeoSample | null;
	pings: GapPing[];
	/** Slug de la ligne courante, pour re-précharger le tracé à la restauration. */
	profileSlug: string | null;
}

const GAP_KEY = '4gdt.gap';

export class GapStore {
	private store: KeyValueStore | null;

	constructor(store?: KeyValueStore) {
		// En SSR / environnement sans storage, le store devient un no-op silencieux.
		this.store = store ?? (typeof localStorage !== 'undefined' ? localStorage : null);
	}

	/** Sauvegarde l'état du trou en cours (écrase la sauvegarde précédente). */
	save(state: GapState): void {
		if (!this.store) return;
		try {
			this.store.setItem(GAP_KEY, JSON.stringify(state));
		} catch {
			/* quota dépassé / storage indisponible : on abandonne silencieusement */
		}
	}

	/**
	 * Restaure l'état persisté, élagué de ce qui est devenu irrécupérable :
	 *  - pings plus vieux que `maxAgeMs` (jamais à moins de `maxAgeMs` d'une ancre
	 *    future → l'interpolation les rejetterait de toute façon) ;
	 *  - ancre d'entrée plus vieille que `maxAgeMs` (l'écart avec toute sortie future
	 *    dépasserait le garde-fou) — les pings restants repartent alors en mode
	 *    cold-start (extrapolés depuis les deux prochains fixes).
	 * Renvoie null s'il ne reste aucun ping utile.
	 */
	load(now: number, maxAgeMs: number): GapState | null {
		if (!this.store) return null;
		try {
			const raw = this.store.getItem(GAP_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as GapState;
			if (!Array.isArray(parsed?.pings)) return null;
			const pings = parsed.pings
				.filter((p) => typeof p?.measuredAt === 'number' && now - p.measuredAt <= maxAgeMs)
				// Buffer persisté avant l'ajout du champ `onWifi` : on ne peut plus conclure
				// a posteriori → false (l'opérateur mobile choisi reste crédité).
				.map((p) => ({ ...p, onWifi: p.onWifi === true }));
			if (pings.length === 0) return null;
			const entry =
				parsed.entry &&
				typeof parsed.entry.timestamp === 'number' &&
				now - parsed.entry.timestamp <= maxAgeMs
					? parsed.entry
					: null;
			return { entry, pings, profileSlug: parsed.profileSlug ?? null };
		} catch {
			return null;
		}
	}

	clear(): void {
		if (!this.store) return;
		try {
			// Repli `setItem("null")` pour un store de test minimal sans removeItem :
			// `load` traite les deux formes (clé absente ou JSON null) comme « vide ».
			if (this.store.removeItem) this.store.removeItem(GAP_KEY);
			else this.store.setItem(GAP_KEY, JSON.stringify(null));
		} catch {
			/* storage indisponible : best-effort */
		}
	}
}
