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

- **Portail** : https://data.arcep.fr/ et https://www.data.gouv.fr/datasets/mon-reseau-mobile
- **Contenu** : couverture _théorique_ 2G/3G/4G/5G par opérateur (Orange, SFR, Free, Bouygues)
- **Import** : `ARCEP_GEOJSON_URL="<url>" bun run data:arcep`
- **Sortie** : `static/data/arcep-coverage.geojson`

### Obtenir un GeoJSON exploitable

Les fichiers ARCEP sont publiés par opérateur et par technologie, souvent en
Shapefile/MapInfo et volumineux. Procédure recommandée :

1. Télécharger les couches voulues depuis data.arcep.fr (ex. 4G par opérateur).
2. Convertir/filtrer en GeoJSON avec [`ogr2ogr`](https://gdal.org/) (GDAL) :
   ```bash
   ogr2ogr -f GeoJSON -t_srs EPSG:4326 -simplify 0.0005 \
     arcep-4g-orange.geojson source_arcep.shp
   ```
3. (Optionnel) Fusionner les opérateurs et tagger chaque feature avec
   `operator` + `techno`.
4. Héberger le GeoJSON résultant et passer son URL via `ARCEP_GEOJSON_URL`,
   ou le déposer directement dans `static/data/arcep-coverage.geojson`.

> Sans `ARCEP_GEOJSON_URL`, le script écrit un placeholder vide pour ne pas
> bloquer le build ; la carte fonctionne alors uniquement avec les mesures
> communautaires.

## Licences

- SNCF Open Data : Licence Ouverte / Open Licence (Etalab).
- ARCEP : Licence Ouverte. Citer la source ARCEP sur les pages affichant ces données.
