# Données sources

Le projet combine plusieurs familles de données ouvertes, importées via des
scripts (`bun run data:*`). Les GeoJSON volumineux vont dans `static/data/`
(gitignoré, régénérable) ; le référentiel des lignes commerciales est un petit
JSON committé dans `src/lib/geo/`.

> **Tout régénérer en une commande : `bun run data:all`** (cf. § Mise à jour).

## 1. Tracés ferroviaires — SNCF Open Data

- **Jeu** : « Formes des lignes du RFN » (Réseau Ferré National)
- **URL** : https://ressources.data.sncf.com/explore/dataset/formes-des-lignes-du-rfn/
- **Import** : `bun run data:sncf`
- **Sortie** : `static/data/rail-lines.geojson` (géométries simplifiées + `slug` SEO)

Le script télécharge l'export GeoJSON de l'API Opendatasoft, simplifie les
tracés (Turf, ~50 m de tolérance) et calcule un `slug` par ligne pour les pages
SEO `/ligne/[slug]`.

## 2. Lignes commerciales — GTFS SNCF

- **Jeux** : « Horaires GTFS » SNCF Open Data (OpenDataSoft), agrégés via le tableau
  `GTFS_SOURCES` (`scripts/lib/gtfs.ts`, mutualisé avec l'index ligne) :
  - TGV INOUI : https://eu.ftp.opendatasoft.com/sncf/gtfs/export_gtfs_voyages.zip
  - Intercités : https://eu.ftp.opendatasoft.com/sncf/gtfs/export-intercites-gtfs-last.zip
- **Import** : `bun run data:lines`
- **Sortie** : `src/lib/geo/commercial-lines.json` (**committé**, ≠ `static/data/`)

`scripts/import-commercial-lines.ts` lit `routes.txt` de chaque GTFS, extrait les relations
commerciales (`route_long_name` → `{ from, to }`), normalise et filtre les libellés non
exploitables (axes régionaux, abréviations…), puis **fusionne** le résultat avec le noyau
curaté `CURATED_LINES` (`src/lib/geo/lines-base.ts`) qui prime pour la qualité SEO. La sortie
alimente `RAIL_LINES`, donc les pages `/ligne/[slug]`, `/lignes`, le `sitemap.xml` et
`/operateur/[slug]`.

Le téléchargement, le parsing CSV et **surtout la dérivation du slug d'une route**
(`parseCommercialRoute`) sont mutualisés dans `scripts/lib/gtfs.ts` : c'est ce qui garantit
que l'index ligne (§ 3) pointe vers exactement les mêmes slugs que ce référentiel.

Le fichier est committé pour que le build/prerender tourne sans rejouer l'import ; il est
à **régénérer + commiter** périodiquement. Pour ajouter une source (ex. TER), ajouter une
entrée dans `GTFS_SOURCES` (URL du GTFS + libellé de service).

## 3. Index ligne — rattachement des mesures (snapping)

- **Source** : les **mêmes GTFS** que § 2 + le réseau RFN de § 1. Aucune nouvelle
  donnée externe.
- **Import** : `bun run data:line-index`
- **Sortie** : `src/lib/geo/line-index.json` (**committé**, exclu de Prettier dans
  `.prettierignore` ; format compact `{ slugs, cells }`, ~1 Mo)

`scripts/build-line-index.ts` construit l'index spatial **cellule H3 (résolution 9) →
ligne(s) commerciale(s)** qui permet de renseigner `lineSlug` à l'ingestion en O(1)
(`Map.get(cellId)`), sans calcul géométrique par requête. Chaîne :

1. **Géométrie de chaque ligne, depuis le GTFS** : `routes.txt` (relation → slug) →
   `trips.txt` (courses) → `stop_times.txt` (arrêts ordonnés) → `stops.txt`
   (coordonnées des gares). On obtient, par ligne, la suite **ordonnée de ses gares**
   (l'itinéraire le plus riche parmi ses courses). C'est la source de données qui relie
   une ligne commerciale à une géométrie — le GTFS ne fournit pas de `shapes.txt`.
2. **Routage sur la voie réelle** : entre deux gares consécutives, on calcule le **plus
   court chemin** sur le réseau RFN « Exploitée » (`rail-lines.geojson`). Le jeu RFN
   n'étant pas nœudé (les jonctions ne partagent pas leurs sommets), on reconstitue la
   connectivité en reliant les sommets distants de moins de `CONNECT_KM` (0,35 km). On
   échantillonne ensuite le tracé routé en cellules H3 res 9. Un corridor « corde droite
   gares-à-gares » a été écarté : il rate les courbes des LGV et attribue des cellules à
   la mauvaise ligne.
3. **Troncs communs** : une cellule routée par plusieurs lignes (ex. sortie de Paris)
   garde **toutes** ses lignes, triées de la plus locale (primaire, stockée dans
   `measurements.lineSlug`) à la plus générale. La liste complète sert aux pages de
   couverture par ligne (à venir).

Couverture actuelle : 42/44 lignes routées, ~36 100 cellules. Lignes sans tracé :
`paris-rennes` et `lyon-marseille` (relations sans course directe dans les feeds
TGV/Intercités). Limite : seules les cellules **sur une voie** reçoivent un slug ;
une mesure dont la cellule n'est sur aucune voie connue est **acceptée sans
`lineSlug`** (jamais rejetée).

## 4. Couverture officielle — ARCEP « Mon Réseau Mobile »

- **Portail** : https://data.arcep.fr/mobile/couvertures_theoriques/ et https://www.data.gouv.fr/datasets/mon-reseau-mobile
- **Contenu** : couverture _théorique_ 2G/3G/4G/5G par opérateur (Orange, SFR, Free, Bouygues),
  publiée en GeoPackage compressé 7z, projection Lambert-93 (RGF93 / EPSG:2154).
- **Import** : `bun run data:arcep` (4G par défaut) ou `ARCEP_TECHNO=5G bun run data:arcep`
- **Sortie** : `static/data/arcep-coverage.geojson`

### Pipeline d'import (100 % JS/Bun, sans GDAL ni 7z système)

`scripts/import-arcep.ts` fait tout, sans dépendance système :

1. **Télécharge** les fichiers `.gpkg.7z` (un par opérateur × techno) depuis
   `data.arcep.fr`.
2. **Décompresse** avec `7zip-min` (binaire embarqué).
3. **Lit** le GeoPackage (= base SQLite) via `bun:sqlite`.
4. **Décode** les géométries WKB (header GeoPackage + `wkx`) et **reprojette**
   Lambert-93 → WGS84 avec `proj4`.
5. **Échantillonne** la couverture sur des cellules H3 (résolution 7, ≈ 1,4 km)
   **le long du corridor ferroviaire** (`rail-lines.geojson`) : pour chaque
   cellule traversée par une voie, on retient le meilleur niveau par opérateur
   (`TBC` > `BC` > `CL`).

La sortie est une FeatureCollection de points H3 (même format que les mesures
communautaires), donc légère (~3 Mo) et directement affichable par MapLibre —
les polygones France entière (≈ 900 Mo décompressés/opérateur) ne sont jamais
servis au navigateur.

**Réglages** (variables d'env) : `ARCEP_TECHNO` (2G/3G/4G/5G), `ARCEP_QUARTER`
(ex. `2025_T4`), `ARCEP_H3_RES` (résolution H3, défaut 7).

> Si le fichier de sortie est absent, la carte fonctionne sans la couche ARCEP
> (mesures communautaires uniquement).

## Stats de couverture par ligne (`data:line-stats`)

- **Jeu** : dérivé, aucune source externe nouvelle.
- **Entrées** : `static/data/arcep-coverage.geojson` (niveaux ARCEP par cellule
  H3 res 7), `static/data/rail-lines.geojson` (RFN) et le GTFS SNCF (gares).
- **Commande** : `bun run data:line-stats`.
- **Sortie** : `src/lib/geo/line-stats.json` (**committé**, lu par
  `src/lib/geo/line-stats.ts`).
- **Pipeline** (`scripts/build-line-stats.ts`) : pour chaque ligne commerciale,
  on reconstitue son tracé réel via le module partagé `scripts/lib/rail-routing.ts`
  (gares GTFS ordonnées → plus court chemin sur le RFN → échantillonnage tous les
  ~0,12 km) — **exactement le même tracé que `data:line-index`**. En chaque point
  on lit le niveau ARCEP (cellule H3 res 7) des 4 opérateurs, puis on agrège :
  répartition `TBC/BC/CL/none` par opérateur **pondérée par la longueur** du
  parcours, répartition du « meilleur des 4 », et **zones blanches** (tronçons
  contigus sans aucune couverture ≥ 3 km, étiquetés par la gare amont — « après
  Mâcon »).

Ces stats alimentent les **pages SEO prerendues** (`/ligne`, `/operateur`,
croisées) en chiffres réels figés au build — zéro coût runtime. La couche
**réelle** (mesures communautaires, mouvante) n'est PAS figée ici : elle est
chargée côté client (`CommunityComparison.svelte` → `/api/coverage?line=…`).

> Dépend de `line-index` (référentiel des lignes) **et** d'`arcep-coverage` : à
> lancer après eux (c'est l'ordre de `data:all`).

## Mise à jour — une seule commande

```bash
bun run data:all
```

`scripts/data-all.ts` enchaîne, dans le bon ordre de dépendances :
`data:sncf` → `data:lines` → `data:line-index` → `data:arcep` → `data:arcep-lines`
→ `data:line-stats` (arrêt au premier échec). On peut aussi rejouer chaque étape
isolément.

**Cadence :**

- **ARCEP** : trimestrielle. À chaque nouvelle publication, bumper la variable
  `ARCEP_QUARTER` (ex. `ARCEP_QUARTER=2026_T1 bun run data:all`).
- **SNCF (tracés + lignes commerciales)** : peu fréquent ; rejouer lors d'un
  changement de réseau ou d'offre commerciale.

Après régénération, **commiter `src/lib/geo/commercial-lines.json`,
`src/lib/geo/line-index.json` et `src/lib/geo/line-stats.json`** (les GeoJSON de
`static/data/` restent gitignorés et sont régénérés au déploiement si besoin).

## Licences

- SNCF Open Data : Licence Ouverte / Open Licence (Etalab).
- ARCEP : Licence Ouverte. Citer la source ARCEP sur les pages affichant ces données.
