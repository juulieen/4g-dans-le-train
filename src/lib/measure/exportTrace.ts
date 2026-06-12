/**
 * Format d'export des traces capteurs + encodage compact.
 *
 * Le bundle exporté est un unique JSON pensé pour l'analyse hors-ligne (pandas,
 * Observable) : format COLONNAIRE (tableaux parallèles par champ — 2 à 3 fois plus
 * compact qu'une liste d'objets, et chargeable tel quel dans un DataFrame), flux
 * IMU découpé en chunks delta-encodés (timestamps = t0 + cumul des deltas ms).
 * Tous les timestamps sont en epoch ms → la jointure IMU ↔ GPS est triviale.
 */
import type { ImuSample, ImuWindow } from './motion';

/** Fix GPS BRUT (avant le filtre de précision MAX_ACCURACY_M) — il faut les points
 *  imprécis avec leur `accuracy` pour évaluer ce que le filtre jette. */
export interface RawGpsFix {
	t: number;
	lat: number;
	lng: number;
	accuracy: number;
	speedKmh: number | null;
}

/** Jalon de session dans la trace (le trou GPS, lui, se lit dans le flux `gps`). */
export interface TraceEvent {
	type: 'start' | 'stop' | 'resume';
	t: number;
}

export interface TraceMeta {
	id: string;
	startedAt: number;
	/** performance.timeOrigin au démarrage (traçabilité de la conversion en epoch). */
	timeOrigin: number;
	operator: string;
	/** Slug de la ligne, renseigné dès que l'API l'identifie (sinon null). */
	lineSlug: string | null;
	/** Identifie le modèle d'appareil à l'analyse (axes/bruit varient par capteur). */
	userAgent: string;
	imuHz: number;
	accelField: 'accelerationIncludingGravity';
	schemaVersion: 1;
}

/** Chunk IMU colonnaire : timestamps delta-encodés depuis `t0` (ms entiers). */
export interface ImuChunk {
	t0: number;
	dt: number[];
	ax: (number | null)[];
	ay: (number | null)[];
	az: (number | null)[];
	rax: (number | null)[];
	ray: (number | null)[];
	raz: (number | null)[];
}

export interface TraceBundle {
	meta: TraceMeta;
	imu: ImuChunk[];
	windows: ImuWindow[];
	gps: RawGpsFix[];
	events: TraceEvent[];
}

/** Arrondi à 3 décimales : largement sous le bruit des capteurs, JSON bien plus court. */
function round3(v: number | null): number | null {
	return v == null ? null : Math.round(v * 1000) / 1000;
}

/** Encode un lot d'échantillons (chronologiques) en chunk colonnaire compact. */
export function encodeImuChunk(samples: ImuSample[]): ImuChunk {
	const t0 = samples.length > 0 ? Math.round(samples[0].t) : 0;
	let prev = t0;
	const chunk: ImuChunk = { t0, dt: [], ax: [], ay: [], az: [], rax: [], ray: [], raz: [] };
	for (const s of samples) {
		const t = Math.round(s.t);
		chunk.dt.push(t - prev);
		prev = t;
		chunk.ax.push(round3(s.ax));
		chunk.ay.push(round3(s.ay));
		chunk.az.push(round3(s.az));
		chunk.rax.push(round3(s.rax));
		chunk.ray.push(round3(s.ray));
		chunk.raz.push(round3(s.raz));
	}
	return chunk;
}

/** Décode un chunk en échantillons (utilisé par les tests — l'analyse refera pareil). */
export function decodeImuChunk(chunk: ImuChunk): ImuSample[] {
	let t = chunk.t0;
	return chunk.dt.map((dt, i) => {
		t += dt;
		return {
			t,
			ax: chunk.ax[i],
			ay: chunk.ay[i],
			az: chunk.az[i],
			rax: chunk.rax[i],
			ray: chunk.ray[i],
			raz: chunk.raz[i]
		};
	});
}

export function bundleToJson(b: TraceBundle): string {
	return JSON.stringify(b);
}

/** Nom de fichier lisible : trace-<ligne>-<AAAAMMJJ-HHMM>.json (heure locale). */
export function traceFilename(meta: TraceMeta): string {
	const d = new Date(meta.startedAt);
	const p = (n: number) => String(n).padStart(2, '0');
	const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
	return `trace-${meta.lineSlug ?? 'ligne-inconnue'}-${stamp}.json`;
}

/** Déclenche le téléchargement du bundle côté navigateur. */
export function downloadTrace(b: TraceBundle): void {
	const blob = new Blob([bundleToJson(b)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	try {
		const a = document.createElement('a');
		a.href = url;
		a.download = traceFilename(b.meta);
		a.click();
	} finally {
		URL.revokeObjectURL(url);
	}
}
