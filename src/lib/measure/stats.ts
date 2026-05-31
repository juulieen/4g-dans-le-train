/**
 * Statistiques de qualité réseau dérivées d'une rafale de pings.
 *
 * POURQUOI une rafale plutôt qu'un ping unique : à 300 km/h, un échantillon
 * unique est très bruité — un ping malchanceux fait basculer le verdict. En
 * tirant 3–5 RTT rapprochés on obtient les vrais marqueurs d'une connexion
 * instable en train : la **gigue** (variabilité de la latence) et le **taux de
 * perte** (paquets qui ne répondent pas).
 *
 * Module PUR (aucune dépendance DOM/réseau) → testable sans navigateur, et
 * réutilisable comme source de vérité unique du calcul + du verdict.
 */

export type PingStatus = 'ok' | 'degraded' | 'none';

export interface BurstStats {
	/** RTT minimal des pings réussis, en ms (échecs exclus). null si aucun succès. */
	rttMin: number | null;
	/** RTT médian des pings réussis, en ms. null si aucun succès. */
	rttMedian: number | null;
	/**
	 * Gigue : écart absolu moyen entre RTT consécutifs réussis (ms). C'est la
	 * variabilité de la latence — ce qui fait saccader une visio. null si moins
	 * de 2 succès (impossible de calculer une variation).
	 */
	jitterMs: number | null;
	/** Taux de perte de paquets, 0..1 = échecs / total. */
	loss: number;
	/** Nombre de pings tentés. */
	total: number;
	/** Nombre de pings réussis. */
	ok: number;
}

export interface BurstThresholds {
	/** Au-delà de ce RTT médian, connexion jugée dégradée. */
	degradedRttMs: number;
	/** Au-delà de cette gigue, connexion jugée dégradée (visio/streaming saccadent). */
	degradedJitterMs: number;
	/** Au-delà de ce taux de perte, connexion jugée dégradée (pages qui timeout). */
	degradedLoss: number;
}

/**
 * Seuils par défaut, ancrés sur le RESSENTI utilisateur en train :
 * - 200 ms de gigue : au-delà, visio/streaming saccadent, les appels coupent.
 * - 25 % de perte : pages web qui timeout, ressenti « ça rame / ça coupe » même
 *   si un ping passe de temps en temps.
 * `degradedRttMs` reprend l'ancien seuil unique (1500 ms) pour la continuité.
 * Le verdict `none` n'est PAS un seuil de perte (il serait trompeur avec 4 pings) :
 * c'est l'absence totale de réponse — voir `verdictFromBurst`.
 */
export const DEFAULT_BURST_THRESHOLDS: BurstThresholds = {
	degradedRttMs: 1500,
	degradedJitterMs: 200,
	degradedLoss: 0.25
};

/** Médiane (haute) d'une liste non vide déjà ou non triée. */
function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Calcule les stats d'une rafale à partir des RTT individuels.
 * @param rtts un élément par ping : `number` = succès (RTT ms), `null` = échec/timeout.
 */
export function computeBurstStats(rtts: Array<number | null>): BurstStats {
	const total = rtts.length;
	const successes = rtts.filter((v): v is number => v != null);
	const ok = successes.length;
	const loss = total > 0 ? (total - ok) / total : 1;

	const rttMin = ok > 0 ? Math.min(...successes) : null;
	const rttMedian = ok > 0 ? median(successes) : null;

	// Gigue = moyenne des écarts absolus entre RTT réussis consécutifs.
	let jitterMs: number | null = null;
	if (ok >= 2) {
		let sum = 0;
		for (let i = 1; i < successes.length; i++) {
			sum += Math.abs(successes[i] - successes[i - 1]);
		}
		jitterMs = Math.round(sum / (successes.length - 1));
	}

	return { rttMin, rttMedian, jitterMs, loss, total, ok };
}

/**
 * Dérive un verdict consolidé `ok/degraded/none` à partir des stats de rafale.
 * Renvoie TOUJOURS une valeur de l'enum PingStatus (compatible OutageDetector).
 */
export function verdictFromBurst(
	s: BurstStats,
	t: BurstThresholds = DEFAULT_BURST_THRESHOLDS
): PingStatus {
	// Aucun ping n'a répondu (rafale vide, ou 100 % de perte) → pas de réseau.
	// `rttMedian == null` ⇔ `ok === 0` : un seul test suffit, pas de seuil de perte.
	if (s.ok === 0 || s.rttMedian == null) return 'none';
	if (
		s.loss >= t.degradedLoss ||
		s.rttMedian > t.degradedRttMs ||
		(s.jitterMs != null && s.jitterMs > t.degradedJitterMs)
	) {
		return 'degraded';
	}
	return 'ok';
}
