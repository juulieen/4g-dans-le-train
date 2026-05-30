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

- **Jeu** : « Horaires des TGV (GTFS) » — SNCF Open Data (OpenDataSoft).
- **URL** : https://eu.ftp.opendatasoft.com/sncf/gtfs/export_gtfs_voyages.zip
- **Import** : `bun run data:lines`
- **Sortie** : `src/lib/geo/commercial-lines.json` (**committé**, ≠ `static/data/`)

`scripts/import-commercial-lines.ts` lit `routes.txt` du GTFS, extrait les relations
commerciales (`route_long_name` → `{ from, to }`), normalise et filtre les libellés non
exploitables (axes régionaux, abréviations…), puis **fusionne** le résultat avec le noyau
curaté `CURATED_LINES` (`src/lib/geo/lines.ts`) qui prime pour la qualité SEO. La sortie
alimente `RAIL_LINES`, donc les pages `/ligne/[slug]`, `/lignes`, le `sitemap.xml` et
`/operateur/[slug]`.

Le fichier est committé pour que le build/prerender tourne sans rejouer l'import ; il est
à **régénérer + commiter** périodiquement. Pour élargir (Intercités, TER), ajouter une
entrée dans le tableau `SOURCES` du script (URL du GTFS concerné).

## 3. Couverture officielle — ARCEP « Mon Réseau Mobile »

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

## Mise à jour — une seule commande

```bash
bun run data:all
```

`scripts/data-all.ts` enchaîne, dans le bon ordre de dépendances :
`data:sncf` → `data:lines` → `data:arcep` → `data:arcep-lines` (arrêt au premier
échec). On peut aussi rejouer chaque étape isolément.

**Cadence :**

- **ARCEP** : trimestrielle. À chaque nouvelle publication, bumper la variable
  `ARCEP_QUARTER` (ex. `ARCEP_QUARTER=2026_T1 bun run data:all`).
- **SNCF (tracés + lignes commerciales)** : peu fréquent ; rejouer lors d'un
  changement de réseau ou d'offre commerciale.

Après régénération, **commiter `src/lib/geo/commercial-lines.json`** (les GeoJSON de
`static/data/` restent gitignorés et sont régénérés au déploiement si besoin).

## Licences

- SNCF Open Data : Licence Ouverte / Open Licence (Etalab).
- ARCEP : Licence Ouverte. Citer la source ARCEP sur les pages affichant ces données.
