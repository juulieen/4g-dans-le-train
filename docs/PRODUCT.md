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
- À chaque position GPS, l'app fait une **petite rafale de pings** (4 requêtes HEAD
  rapprochées vers `/api/ping`) plutôt qu'un ping unique : à 300 km/h un échantillon
  isolé est trop bruité (un ping malchanceux fait basculer le verdict). De la rafale
  on tire le **RTT médian**, la **gigue** (variabilité de la latence) et le **taux de
  perte** (paquets sans réponse) — les vrais marqueurs d'une connexion instable en
  train. Méthode cross-navigateur (iOS inclus, uniquement `fetch` + `performance.now()`),
  contrairement à `navigator.connection` non fiable. Le type de réseau (4g/5g) est un
  bonus lu quand le navigateur l'expose. Logique de calcul + verdict isolés dans un
  module pur testable (`src/lib/measure/stats.ts`).
- État dérivé : `ok` (ça capte) / `degraded` (lent) / `none` (ça coupe). Le verdict
  est consolidé à partir de la rafale et **ancré sur le ressenti** : `degraded` si
  RTT médian au-delà de 1500 ms, **ou** gigue au-delà de 200 ms (visio/streaming
  saccadent), **ou** perte au-delà de 25 % (pages qui timeout) ; `none` si perte
  totale. Seuils centralisés et configurables (`DEFAULT_BURST_THRESHOLDS`).
- **Débit léger (opt-in)** : « ça répond au ping » ≠ « ça streame ». Si l'utilisateur
  coche **« Mesurer aussi le débit »** (OFF par défaut — ça consomme sa data mobile),
  l'app télécharge **1 position sur 5** un petit blob incompressible (~128 Ko) via
  `GET /api/probe?size=…` (données aléatoires `crypto.getRandomValues`, `no-store`,
  taille bornée 64–512 Ko serveur) et en déduit un **débit (kbps)**. Le débit est
  traduit en **usage concret** (`src/lib/usage.ts`, source unique partagée avec la
  carte) : streaming ≥ 2000 kbps, web ≥ 500, messages ≥ 100, sinon rien. La mesure
  tourne **en tâche de fond** (hors du chemin bloquant) pour ne jamais retarder la
  rafale ni la détection de coupure ; son résultat est rattaché à l'envoi suivant.
  L'endpoint ne reçoit aucune donnée client (juste `size`), ne logge rien, n'expose
  pas de CORS (appelé en same-origin) et n'a pas de rate-limit par IP (ce serait
  ré-identifiant) — le coût est borné par la taille et un blob pré-généré.
- **Vie privée (non négociable)** : la position est **arrondie au centre de sa
  cellule H3 (~150 m)** AVANT envoi ; aucune donnée personnelle ; session =
  jeton anonyme jetable ; pas de trace continue ré-identifiable. Consentement
  explicite requis avant tout envoi.
- **Agrégation** (`src/lib/server/ingest.ts`) : par cellule H3 × opérateur →
  taux de réussite, latence médiane, **gigue médiane**, **perte médiane**, **débit
  médian**, nombre de mesures. Servi par `GET /api/coverage`. Les médianes
  qualité/débit sont **nullables** : les cellules historiques (ou sans mesure de
  débit) restent valides, la médiane ignore les valeurs absentes.
- **Rattachement à une ligne (snapping)** : à l'ingestion, la cellule H3 de la
  mesure est rattachée à sa **ligne commerciale** via un index pré-calculé
  (`src/lib/geo/line-snap.ts` → `line-index.json`, cf. `docs/DATA.md` § 3). Le
  rattachement se fait **sur la cellule, pas sur la position brute** — cohérent
  avec l'anonymisation. Cela débloque les pages de couverture par ligne et la
  future vue « profil de trajet ».
- **Épisodes de coupure (durée des coupures)** : la donnée à plus forte valeur
  produit n'est pas le point isolé `none`, mais la **durée** d'une coupure
  (« tu perdras le réseau ~1 min 40 s après telle gare »). Un épisode est une
  transition `ok|degraded → none … → ok|degraded`.
  - **On ne stocke jamais un objet « coupure ».** L'épisode est toujours
    **dérivé** des mesures `none` consécutives d'une session. Source unique de
    vérité = les mesures brutes. La seule donnée persistée en plus est l'**instant
    réel de mesure** (`measurements.measured_at`, époch ms) : `created_at` est
    l'instant d'_insertion_ serveur, faussé par le rejeu hors-ligne (une mesure de
    tunnel arrive bien après sa capture), donc inutilisable pour la chronologie.
  - **Une brique pure, deux contextes** (`src/lib/measure/outage.ts`) : la même
    logique de détection tourne (1) **côté client** pendant la mesure → retour
    éphémère « coupure de X » + compteur (rien n'est persisté en plus) ; (2)
    **côté serveur à la lecture** (`src/lib/server/outages.ts`) sur les mesures
    brutes groupées par session → **agrégats seulement**.
  - **Longueur d'une coupure** : distance GPS parcourue, avec repli
    `vitesse × durée` (vitesse pendant la coupure, sinon la dernière connue juste
    avant — le GPS d'un tunnel ne donne souvent plus de vitesse). ⚠️ Côté serveur, les
    positions stockées sont des **centres de cellule H3** (anonymisées), donc le
    chemin y est quantifié au pas de cellule : la longueur serveur **repose
    surtout sur le repli vitesse×durée**. La distance GPS fine n'est exacte qu'en
    live (où le client a la position brute).
  - **Trou de mesure / app quittée** : une même `session_id` survit entre trajets.
    Au-delà de **5 min** sans échantillon, l'épisode en cours est clos comme **non
    terminé** (on ne sait pas quand le réseau est revenu). Les épisodes non
    terminés (trou, ou arrêt en zone blanche) sont **exclus des agrégats serveur**
    pour ne pas biaiser la durée médiane.
  - **Vie privée** : `GET /api/outages` ne renvoie **que des agrégats** (durée et
    longueur médianes par cellule de début × opérateur, ligne dérivée de la
    cellule) — jamais les points bruts ni les séquences par session. On affiche
    une cellule même avec une seule coupure observée : la session n'identifie
    personne (jeton anonyme jetable), pas de risque de ré-identification.
  - **Perf** : dérivation à la lecture (scan + reconstruction). Suffisant au
    volume actuel ; si ça devient lent, matérialiser une table d'agrégats
    recalculée à l'ingestion (façon `cell_aggregates`).

## Décisions & conventions produit

- **Nom & SEO** : `4g-dans-le-train` choisi sur données d'autocomplétion Google
  (« 4g dans le train » est recherché ; « réseau dans le train » est confondu
  avec le réseau ferroviaire). Le SEO repose sur des **pages programmatiques** :
  `/ligne/[slug]`, `/operateur/[slug]`, croisées `/ligne/[slug]/[operateur]`,
  - FAQ, sitemap, JSON-LD. Référentiel curaté dans `src/lib/geo/lines.ts`.
- **Périmètre** : France (réseau SNCF) d'abord ; architecture extensible.
- **Snapping ligne — décisions** : (1) une mesure hors de toute ligne connue est
  **acceptée sans `lineSlug`**, jamais rejetée (on ne perd aucune donnée ; le filtre
  anti-aberrant est reporté). (2) Une cellule de **tronc commun** appartient à
  plusieurs lignes ; `measurements.lineSlug` ne stocke que la **ligne primaire** (la
  plus locale), la liste complète restant dans l'index pour la couverture par ligne.
  (3) La géométrie des lignes vient du **GTFS (gares ordonnées) + routage sur le RFN**,
  pas d'une saisie manuelle ni d'une corde droite (cf. `docs/DATA.md` § 3).
- **H3 résolutions** : mesures communautaires en **res 9** (~200 m, précis) ;
  couche ARCEP en **res 7** (~1,4 km, suffisant pour un fond théorique et léger).
- **Données versionnées** : `rail-lines.geojson` et `arcep-lines.geojson` sont
  commités (déploiement clé en main, pas de re-téléchargement des ~500 Mo ARCEP).

## État actuel

MVP **déployé et fonctionnel** en production. Mode mesure validé en réel, couche
ARCEP intégrée (4 opérateurs, 4G), pages SEO en ligne, sitemap soumis à indexer.

Chantiers connus / à venir : refonte UI « liquid glass » mobile-first + onboarding
(voir `../HANDOFF-ui-refonte.md` si présent) ; couche 5G ; extension hors France.
