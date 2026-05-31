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

## 3. Index ligne + profils de trajet — snapping & frise

- **Source** : les **mêmes GTFS** que § 2 + le réseau RFN de § 1 + la couverture
  ARCEP de § 4 (`arcep-coverage.geojson`, pour le fond théorique des profils).
- **Import** : `bun run data:line-index`
- **Sorties** :
  - `src/lib/geo/line-index.json` (**committé**, exclu de Prettier dans
    `.prettierignore` ; format compact `{ slugs, cells }`, ~1 Mo) — le snapping ;
  - `static/data/route-profiles/<slug>.json` (un par ligne, ~1,2 Mo au total ;
    `static/data/` est déjà gitignoré de Prettier) — les **profils de trajet**.

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

### Profils de trajet (frise « profil de trajet », `route-profiles/<slug>.json`)

Le même routage ordonné (étapes 1–2 ci-dessus) alimente, **sans second calcul**,
un profil par ligne pour la frise gare→gare (`src/lib/components/RouteProfile.svelte`).
Pour chaque ligne, on échantillonne le tracé routé et on produit :

- `stations` : gares **ordonnées** + distance cumulée depuis le départ (gares à
  plus de 3 km du tracé écartées). Le sens est aligné sur `from → to` du
  référentiel (on inverse l'itinéraire GTFS au besoin) ;
- `arcep` : niveau de couverture par opérateur le long du parcours, en **run-length**
  (fusion des points consécutifs de mêmes niveaux), via la cellule H3 **res 7** de
  `arcep-coverage.geojson` — d'où la dépendance à § 4, et le placement de `data:arcep`
  **avant** `data:line-index` dans `data:all` ;
- `path` : polyligne simplifiée `[lng, lat, distKm]` (~1 pt/km) qui permet au
  composant de situer les **mesures réelles** (`/api/coverage?line=`) et les
  **coupures** (`/api/outages?line=`) sur l'axe distance, sans embarquer de map de
  cellules.

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
- **Entrées** : les **profils de trajet** `static/data/route-profiles/*.json`
  produits par `data:line-index` (§ 3) — chacun porte le tracé routé découpé en
  segments ARCEP run-length `{ fromKm, toKm, orange, sfr, free, bouygues, best }`
  et les gares ordonnées `{ name, distKm }`.
- **Commande** : `bun run data:line-stats`.
- **Sortie** : `src/lib/geo/line-stats.json` (**committé**, lu par
  `src/lib/geo/line-stats.ts`).
- **Pipeline** (`scripts/build-line-stats.ts`) : **aucun re-routage** — on lit les
  segments ARCEP de chaque profil et on agrège, **pondéré par la longueur** :
  répartition `TBC/BC/CL/none` par opérateur et « au mieux » (`best`), et **zones
  blanches** (segments `best === 'none'` contigus, fusionnés si séparés par < 3 km
  de couvert, ≥ 3 km, nommés par la gare amont — « après Mâcon »). Types d'usage
  partagés via `src/lib/usage.ts`.
- **Fiabilité** : `import-arcep` n'écrit que les cellules _couvertes_, donc un
  segment `none` vaut « vraie zone blanche » **ou** « hors du corridor qu'ARCEP a
  échantillonné ». Tant que le tracé suit la voie indexée, l'absence ≈ zone
  blanche réelle ; mais quand une ligne a trop peu de gares GTFS, le tracé s'écarte
  et gonfle le « sans réseau ». Garde-fou : si la part « sans données » d'une ligne
  dépasse **20 %**, son overlay est jugé non fiable et la ligne est **exclue** de
  `line-stats.json` (sa page retombe sur le contenu générique).

Ces stats alimentent les **pages SEO prerendues** en chiffres réels figés au
build — zéro coût runtime. Le **réel** (mesures communautaires, mouvant) n'est PAS
figé ici : les pages `/ligne` et croisées affichent la frise `RouteProfile` (§ 3),
la page `/operateur` un bloc `CommunityComparison.svelte` (→ `/api/coverage`).

> Dépend des **profils de trajet** : à lancer après `data:line-index` (c'est la
> fin de l'ordre de `data:all`).

## Mise à jour — une seule commande

```bash
bun run data:all
```

`scripts/data-all.ts` enchaîne, dans le bon ordre de dépendances :
`data:sncf` → `data:lines` → `data:arcep` → `data:line-index` → `data:arcep-lines`
→ `data:line-stats` (arrêt au premier échec). On peut aussi rejouer chaque étape
isolément. Note : `data:arcep` passe **avant** `data:line-index` car ce dernier lit
`arcep-coverage.geojson` pour générer les profils de trajet (§ 3) ; `data:line-stats`
clôt la chaîne car il agrège ces profils.

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
