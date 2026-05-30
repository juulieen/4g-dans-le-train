# Contexte produit — 4G dans le train

> Source de vérité du « pourquoi » et du « comment » du projet. À lire en début
> de tâche, à mettre à jour à chaque évolution produit (voir `../CLAUDE.md`).

## Le problème

Dans le train, on ne sait pas à l'avance où le réseau mobile va passer ou
couper. Les cartes officielles donnent une couverture _théorique_ ; la réalité
dans un TGV lancé à 300 km/h (tunnels, zones rurales, carrosserie métallique)
est souvent différente. Personne ne couvrait spécifiquement la niche
**train + ligne ferroviaire + crowdsourcing**.

## La proposition de valeur

Une carte qui répond à : **« sur mon trajet, à quel moment je pourrai regarder
une vidéo, faire une recherche, juste envoyer un message… ou rien du tout ? »**

Elle croise deux sources, et **leur distinction est le cœur du projet** :

1. **Couverture ARCEP (théorique)** — ce que les opérateurs _annoncent_.
2. **Mesures communautaires (réel)** — ce que les voyageurs _constatent_.

Tout l'intérêt est de **révéler les écarts** entre la promesse et le vécu. Donc
**le réel prime visuellement sur le théorique**.

## Représentation sur la carte

- **Couverture ARCEP** = le **tracé de la voie ferrée coloré** selon l'usage
  possible (fond « théorique », trait large et un peu pâle).
- **Mesures communautaires** = **pastilles vives cerclées de blanc** posées
  par-dessus (le « réel »).

Code couleur **par usage** (et non par jargon technique) :

| Couleur                 | Usage concret              | Niveau ARCEP     | Taux de réussite mesuré |
| ----------------------- | -------------------------- | ---------------- | ----------------------- |
| 🟢 vert `#22c55e`       | Streaming vidéo, visio     | TBC (très bonne) | ≥ 80 %                  |
| 🟢 vert-clair `#84cc16` | Web, réseaux sociaux       | BC (bonne)       | —                       |
| 🟠 orange `#f59e0b`     | Messages, navigation lente | CL (limitée)     | 40–80 %                 |
| 🔴 rouge `#ef4444`      | Zone blanche, rien         | aucune           | < 40 %                  |

Un **filtre d'affichage** par opérateur (Tous / Orange / SFR / Free / Bouygues)
recolore les voies ARCEP **et** filtre les mesures communautaires. Il est
**distinct** du sélecteur « Votre opérateur » du mode mesure.

## Comment sont calculées les données ARCEP (théorique)

- **Source** : Open Data ARCEP, « Cartes de couverture théorique » (jeu « Mon
  Réseau Mobile »), par opérateur et par technologie, en GeoPackage compressé
  7z, projection Lambert-93. Voir `DATA.md`.
- **Pipeline** (`scripts/import-arcep.ts`, 100 % JS/Bun, sans GDAL/7z système) :
  télécharge les `.gpkg.7z` → décompresse → lit le GeoPackage (SQLite) →
  décode le WKB + reprojette Lambert-93 → WGS84 → **échantillonne sur cellules
  H3 (résolution 7, ≈ 1,4 km) le long du corridor ferroviaire** → retient le
  meilleur niveau par opérateur. Sortie : `static/data/arcep-coverage.geojson`.
- **Voies colorées** (`scripts/build-arcep-lines.ts`) : croise les tracés SNCF
  avec ces cellules pour produire `static/data/arcep-lines.geojson` (segments
  de voie portant le niveau par opérateur + `best`). C'est ce que la carte
  affiche. Niveaux : `TBC` > `BC` > `CL`.
- **Nature** : c'est une _prévision officielle_, pas une garantie de débit réel.

## Comment sont calculées les mesures communautaires (les nôtres)

- L'utilisateur active le **mode mesure** sur son téléphone (page ouverte,
  écran maintenu via Wake Lock).
- À chaque position GPS, l'app fait un **ping actif** (petite requête réseau) →
  succès/échec + latence (RTT). Méthode cross-navigateur (iOS inclus), contrairement
  à `navigator.connection` non fiable. Le type de réseau (4g/5g) est un bonus
  lu quand le navigateur l'expose.
- État dérivé : `ok` (ça capte) / `degraded` (lent) / `none` (ça coupe).
- **Vie privée (non négociable)** : la position est **arrondie au centre de sa
  cellule H3 (~150 m)** AVANT envoi ; aucune donnée personnelle ; session =
  jeton anonyme jetable ; pas de trace continue ré-identifiable. Consentement
  explicite requis avant tout envoi.
- **Agrégation** (`src/lib/server/ingest.ts`) : par cellule H3 × opérateur →
  taux de réussite, latence médiane, nombre de mesures. Servi par
  `GET /api/coverage`.

## Décisions & conventions produit

- **Nom & SEO** : `4g-dans-le-train` choisi sur données d'autocomplétion Google
  (« 4g dans le train » est recherché ; « réseau dans le train » est confondu
  avec le réseau ferroviaire). Le SEO repose sur des **pages programmatiques** :
  `/ligne/[slug]`, `/operateur/[slug]`, croisées `/ligne/[slug]/[operateur]`,
  - FAQ, sitemap, JSON-LD. Référentiel curaté dans `src/lib/geo/lines.ts`.
- **Périmètre** : France (réseau SNCF) d'abord ; architecture extensible.
- **H3 résolutions** : mesures communautaires en **res 9** (~200 m, précis) ;
  couche ARCEP en **res 7** (~1,4 km, suffisant pour un fond théorique et léger).
- **Données versionnées** : `rail-lines.geojson` et `arcep-lines.geojson` sont
  commités (déploiement clé en main, pas de re-téléchargement des ~500 Mo ARCEP).

## État actuel

MVP **déployé et fonctionnel** en production. Mode mesure validé en réel, couche
ARCEP intégrée (4 opérateurs, 4G), pages SEO en ligne, sitemap soumis à indexer.

Chantiers connus / à venir : refonte UI « liquid glass » mobile-first + onboarding
(voir `../HANDOFF-ui-refonte.md` si présent) ; couche 5G ; extension hors France.
