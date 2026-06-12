/**
 * Persistance IndexedDB de la trace capteurs (UNE trace à la fois).
 *
 * POURQUOI IndexedDB et pas localStorage (contrairement à gapStore/queue) : une
 * session de train dure 1 à 4 h et la trace pèse ~1 Mo/h — le quota localStorage
 * (~5 Mo, déjà partagé avec la file d'envoi) ne tient pas. Les données restent
 * 100 % LOCALES : rien de ce store ne part jamais au serveur (vie privée projet) ;
 * l'utilisateur exporte lui-même le JSON.
 *
 * Modèle simple : une seule trace vivante. `begin()` repart de zéro (la trace
 * précédente, conservée après l'arrêt pour l'export, est alors remplacée) ;
 * `resume()` ré-ouvre la trace existante après un refresh en cours de session.
 * Mêmes conventions que le reste du module : best-effort, échecs silencieux
 * (un trou dans la trace expérimentale ne doit jamais casser la mesure).
 */
import type { ImuWindow } from './motion';
import type { ImuChunk, RawGpsFix, TraceEvent, TraceMeta, TraceBundle } from './exportTrace';

const DB_NAME = '4gdt-trace';
const DB_VERSION = 1;
/** Clé unique du store `meta` (une seule trace vivante). */
const META_KEY = 'current';

/** Enregistrement du store `meta` : métadonnées + compteur d'octets approximatif. */
interface MetaRecord {
	meta: TraceMeta;
	approxBytes: number;
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
			if (!db.objectStoreNames.contains('imu'))
				db.createObjectStore('imu', { autoIncrement: true });
			if (!db.objectStoreNames.contains('windows'))
				db.createObjectStore('windows', { autoIncrement: true });
			if (!db.objectStoreNames.contains('gps'))
				db.createObjectStore('gps', { autoIncrement: true });
			if (!db.objectStoreNames.contains('events'))
				db.createObjectStore('events', { autoIncrement: true });
		};
		req.onsuccess = () => {
			const db = req.result;
			// Si une autre connexion demande une montée de version (schéma futur), on
			// libère la nôtre au lieu de bloquer la migration indéfiniment.
			db.onversionchange = () => db.close();
			resolve(db);
		};
		req.onerror = () => reject(req.error);
	});
}

/** Attend la fin d'une transaction. true si commitée, false sur erreur/abort. */
function txDone(tx: IDBTransaction): Promise<boolean> {
	return new Promise((resolve) => {
		tx.oncomplete = () => resolve(true);
		tx.onerror = () => resolve(false);
		tx.onabort = () => resolve(false);
	});
}

function readAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
	return new Promise((resolve) => {
		try {
			const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
			req.onsuccess = () => resolve((req.result as T[]) ?? []);
			req.onerror = () => resolve([]);
		} catch {
			resolve([]); // db fermée entre-temps : best-effort
		}
	});
}

export class TraceStore {
	private db: IDBDatabase | null = null;
	/** Compteur d'octets approximatif (longueur JSON des écritures), tenu en mémoire
	 *  et persisté dans `meta` à chaque écriture — restauré à la reprise. */
	private approxBytes = 0;
	/** Métadonnées de la trace courante, en cache mémoire : évite un get IndexedDB
	 *  imbriqué dans la transaction d'append (fragile vis-à-vis de l'auto-commit). */
	private metaCache: TraceMeta | null = null;

	static isSupported(): boolean {
		return typeof indexedDB !== 'undefined';
	}

	private async ensureDb(): Promise<IDBDatabase | null> {
		if (!TraceStore.isSupported()) return null;
		if (!this.db) {
			try {
				this.db = await openDb();
			} catch {
				return null; // stockage refusé (navigation privée durcie…) : trace désactivée
			}
		}
		return this.db;
	}

	/**
	 * Démarre une NOUVELLE trace : purge l'éventuelle trace précédente.
	 * Retourne false si la trace n'a pas pu être créée (l'appelant ne doit alors
	 * pas poser de pointeur vers une trace fantôme).
	 */
	async begin(meta: TraceMeta): Promise<boolean> {
		const db = await this.ensureDb();
		if (!db) return false;
		try {
			const tx = db.transaction(['meta', 'imu', 'windows', 'gps', 'events'], 'readwrite');
			for (const name of ['imu', 'windows', 'gps', 'events']) tx.objectStore(name).clear();
			this.approxBytes = JSON.stringify(meta).length;
			tx.objectStore('meta').put(
				{ meta, approxBytes: this.approxBytes } satisfies MetaRecord,
				META_KEY
			);
			const ok = await txDone(tx);
			if (ok) this.metaCache = meta;
			return ok;
		} catch {
			return false;
		}
	}

	/** Ré-ouvre la trace existante (reprise après refresh). null si aucune. */
	async resume(): Promise<TraceMeta | null> {
		const db = await this.ensureDb();
		if (!db) return null;
		try {
			const rec = await new Promise<MetaRecord | null>((resolve) => {
				const req = db.transaction('meta', 'readonly').objectStore('meta').get(META_KEY);
				req.onsuccess = () => resolve((req.result as MetaRecord) ?? null);
				req.onerror = () => resolve(null);
			});
			if (!rec) return null;
			this.approxBytes = rec.approxBytes ?? 0;
			this.metaCache = rec.meta;
			return rec.meta;
		} catch {
			return null;
		}
	}

	/** Met à jour les métadonnées (ex. lineSlug identifié en cours de session). */
	async updateMeta(patch: Partial<TraceMeta>): Promise<void> {
		const db = await this.ensureDb();
		if (!db) return;
		const current = this.metaCache ?? (await this.resume());
		if (!current) return;
		const merged = { ...current, ...patch };
		try {
			const tx = db.transaction('meta', 'readwrite');
			tx.objectStore('meta').put(
				{ meta: merged, approxBytes: this.approxBytes } satisfies MetaRecord,
				META_KEY
			);
			if (await txDone(tx)) this.metaCache = merged;
		} catch {
			/* best-effort */
		}
	}

	/** Ajoute un lot hétérogène en une transaction (flush périodique du recorder). */
	async appendBatch(batch: {
		imu?: ImuChunk[];
		windows?: ImuWindow[];
		gps?: RawGpsFix[];
		events?: TraceEvent[];
	}): Promise<void> {
		const db = await this.ensureDb();
		if (!db) return;
		try {
			const tx = db.transaction(['meta', 'imu', 'windows', 'gps', 'events'], 'readwrite');
			let added = 0;
			for (const c of batch.imu ?? []) {
				tx.objectStore('imu').add(c);
				added += JSON.stringify(c).length;
			}
			for (const w of batch.windows ?? []) {
				tx.objectStore('windows').add(w);
				added += JSON.stringify(w).length;
			}
			for (const g of batch.gps ?? []) {
				tx.objectStore('gps').add(g);
				added += JSON.stringify(g).length;
			}
			for (const e of batch.events ?? []) {
				tx.objectStore('events').add(e);
				added += JSON.stringify(e).length;
			}
			if (added > 0) {
				this.approxBytes += added;
				// Persiste le compteur avec le lot (même transaction) pour la reprise.
				// Écriture directe depuis le cache mémoire : un get imbriqué dont le
				// callback poste un put serait fragile vis-à-vis de l'auto-commit IDB.
				if (this.metaCache) {
					tx.objectStore('meta').put(
						{ meta: this.metaCache, approxBytes: this.approxBytes } satisfies MetaRecord,
						META_KEY
					);
				}
			}
			await txDone(tx);
		} catch {
			/* best-effort */
		}
	}

	/** Taille approximative de la trace (octets JSON cumulés). */
	get sizeBytes(): number {
		return this.approxBytes;
	}

	/** Assemble la trace complète pour l'export. null si aucune trace. */
	async exportBundle(): Promise<TraceBundle | null> {
		const meta = await this.resume();
		const db = await this.ensureDb();
		if (!meta || !db) return null;
		const [imu, windows, gps, events] = await Promise.all([
			readAll<ImuChunk>(db, 'imu'),
			readAll<ImuWindow>(db, 'windows'),
			readAll<RawGpsFix>(db, 'gps'),
			readAll<TraceEvent>(db, 'events')
		]);
		return { meta, imu, windows, gps, events };
	}

	/** Efface entièrement la trace. */
	async clear(): Promise<void> {
		const db = await this.ensureDb();
		if (!db) return;
		try {
			const tx = db.transaction(['meta', 'imu', 'windows', 'gps', 'events'], 'readwrite');
			for (const name of ['meta', 'imu', 'windows', 'gps', 'events']) tx.objectStore(name).clear();
			this.approxBytes = 0;
			this.metaCache = null;
			await txDone(tx);
		} catch {
			/* best-effort */
		}
	}
}
