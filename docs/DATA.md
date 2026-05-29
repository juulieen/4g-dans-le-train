# Données sources

Le projet combine deux familles de données ouvertes, importées via des scripts
(`bun run data:*`) et écrites dans `static/data/` (gitignoré, régénérable).

## 1. Tracés ferroviaires — SNCF Open Data

- **Jeu** : « Formes des lignes du RFN » (Réseau Ferré National)
- **URL** : https://ressources.data.sncf.com/explore/dataset/formes-des-lignes-du-rfn/
- **Import** : `bun run data:sncf`
- **Sortie** : `static/data/rail-lines.geojson` (géométries simplifiées + `slug` SEO)

Le script télécharge l'export GeoJSON de l'API Opendatasoft, simplifie les
tracés (Turf, ~50 m de tolérance) et calcule un `slug` par ligne pour les pages
SEO `/ligne/[slug]`.

## 2. Couverture officielle — ARCEP « Mon Réseau Mobile »

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

## Licences

- SNCF Open Data : Licence Ouverte / Open Licence (Etalab).
- ARCEP : Licence Ouverte. Citer la source ARCEP sur les pages affichant ces données.
