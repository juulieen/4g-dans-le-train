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
- **Mesures communautaires** (le « réel », par-dessus) = un **rendu progressif au
  zoom** plutôt qu'une traînée de pastilles (vite illisible quand un trajet génère
  des centaines de cellules) :
  - **zoom faible/intermédiaire** → un **ruban coloré qui suit la voie** : les
    cellules mesurées d'une ligne sont projetées sur son tracé puis fusionnées en
    segments de même niveau (`GET /api/coverage/segments`, run-length le long du
    `path` des profils de trajet) ;
  - **zoom fort** (z ≥ ~13) → un **quadrillage de cellules hexagonales H3** (les
    vraies cellules ~150 m, construites côté client via `cellToBoundary`), avec
    **fondu croisé** du ruban autour de z 11→13.
  - En vue « tous opérateurs », chaque cellule/segment retient le **pire** taux de
    réussite parmi les opérateurs mesurés (`worstByCell`, `src/lib/coverage-quality.ts`) :
    on met ainsi en avant les **risques de coupure**. Avec un opérateur sélectionné,
    on n'affiche que le sien.

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

**Cliquer sur une voie** ouvre une popup qui, en plus de la couverture théorique
ARCEP, liste les **lignes commerciales qui passent par ce point** avec un lien
vers leur page dédiée `/ligne/{slug}`. Le rattachement point → lignes se fait
côté serveur via `GET /api/lines?lat=&lng=` : la position est convertie en
cellule H3 (rés. 9, comme l'ingestion) puis croisée avec `line-index.json`
(`lineSlugsForCell`), en élargissant anneau par anneau (`gridDisk`) si le clic
tombe à côté du tracé échantillonné. Les lignes sont ordonnées de la plus
spécifique à la plus générale (cf. désambiguïsation des troncs communs).

## Le profil de trajet (frise gare→gare)

La carte répond à « **où** ça capte ? » ; le profil de trajet répond à « **quand,
sur MON trajet** ? » — c'est la lecture **linéaire** qui tient la promesse
d'origine. Pour une ligne donnée (ex. Paris–Lyon), une **frise horizontale** va de
la gare de départ à la gare d'arrivée, colorée par usage le long du parcours :

- **fond théorique (ARCEP)** : bande colorée par segment, un peu pâle ;
- **réel (mesures)** par-dessus, cerclé de blanc — le réel **prime visuellement** ;
- **gares** repérées avec leur **distance cumulée** (« après [gare], sur ~12 km ») ;
- **coupures** marquées (« ✕ ~3 min ») quand des épisodes sont mesurés sur la ligne.

Mêmes couleurs/usages que la carte (source unique `src/lib/usage.ts`). La frise est
**mobile-first** (scrollable au pouce). **Accessibilité** : la palette reposant sur
rouge↔vert, la zone blanche porte aussi des **hachures**, et un résumé textuel
décrit le profil pour les lecteurs d'écran. Le composant
`src/lib/components/RouteProfile.svelte` est partagé entre les pages SEO
`/ligne/[slug]` et l'app carte (sélecteur de ligne). Données : un profil par ligne
généré au build dans `static/data/route-profiles/<slug>.json` (cf. `docs/DATA.md` § 3) ;
réel et coupures chargés à la volée via `/api/coverage?line=` et `/api/outages?line=`.

## Les trajets-tronçons (sous-relations ville↔ville)

Les gens ne cherchent pas que les grandes relations terminus→terminus : ils cherchent
**leur** trajet, souvent une **portion** (« couverture 4G **Poitiers–Bordeaux** en
train »). Or le référentiel ne contient que les relations **nommées dans le GTFS** :
`Bordeaux–Toulouse`, `Poitiers–Bordeaux` n'y figuraient pas (Poitiers n'est qu'une gare
intermédiaire de Paris–Bordeaux). On **génère donc automatiquement des « tronçons »**
depuis les données (cf. `docs/DATA.md` § 2, `scripts/lib/troncons.ts`).

Conventions produit :

- **Une page bidirectionnelle** par couple : `Poitiers–Bordeaux` et `Bordeaux–Poitiers`
  = **un seul slug** (alpha), affichée « A ↔ B » (le sens n'a pas de sens en couverture).
- **Frise + stats ARCEP comme toute ligne** : le tronçon est découpé dans l'itinéraire de
  sa ligne parente (`segmentOf`) puis routé/échantillonné normalement.
- **Mesures partagées avec la parente** : un tronçon n'a **pas** de mesures propres — il
  partage la voie de sa parente, qui reste le **slug primaire** des mesures
  (`line-index.json`). Sa page affiche les mesures communautaires de la **portion**
  correspondante de la parente (résolution `troncon-cells.json` → `troncon-snap.ts`).
- **SEO « large + monitoring »** : on publie large (≈ 50 tronçons, curseur
  `TRONCON_MIN_HUB`), mais on **n'indexe que les tronçons riches** (stats ARCEP fiables) ;
  les tronçons minces et les sous-pages opérateur × tronçon sont en `noindex,follow` et
  hors `sitemap.xml`. Le seuil se resserre en re-générant si Google Search Console montre
  de la dilution — désindexer une page faible n'est pas une pénalité mais le remède.

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
- **Cadence stable à 1/s** : un **tick maître** (`controller.ts`, toutes les 1 s)
  pilote toute la mesure → un **ping actif** (petite requête réseau) par seconde,
  quoi qu'il arrive. `watchPosition` (irrégulier selon l'OS) ne sert plus qu'à
  **rafraîchir la position courante** et à refermer les trous GPS ; il ne déclenche
  plus la mesure. On en tire succès/échec + latence (RTT). Méthode cross-navigateur
  (iOS inclus, uniquement `fetch`/`performance.now()`), contrairement à
  `navigator.connection` non fiable. Le type de réseau (4g/5g) est un bonus lu quand
  le navigateur l'expose.
- **Mesure même sans GPS (interpolation « depuis les rails »)** : le même tick 1/s
  prend le relais quand le GPS n'est pas frais — en **tunnel** et au **cold-start**
  (le 1er fix GPS peut mettre des minutes ; on ne reste plus « en attente » sans rien
  mesurer). Ces pings sont **bufferisés sans position**, puis
  placés **a posteriori** le long du tracé de la ligne (`static/data/route-profiles/`,
  primitive `src/lib/geo/interpolate.ts`) :
  - **tunnel** → position **interpolée** entre le dernier fix avant et le premier
    après le trou ;
  - **cold-start** → pings pré-fix **extrapolés en arrière** depuis les deux premiers
    fixes (qui donnent le sens du trajet).
  - **Garde-fous** : on ne place que si entrée **et** sortie collent au tracé (≤ 1 km,
    preuve qu'on n'a pas quitté le train), trou ≤ 5 min, sinon le buffer est **jeté**.
  - **Honnêteté** : ces points portent `measurements.pos_source = 'interpolated'`
    (vs `'gps'`). En l'état ils sont **agrégés comme les mesures GPS** ; la colonne
    permettra de les distinguer visuellement plus tard.
  - Côté acquisition, le **premier fix** réutilise une position récente du téléphone
    (`getCurrentPosition`, `maximumAge` relâché) au lieu de la jeter — décisif au
    redémarrage d'une mesure.
- État dérivé : `ok` (ça capte) / `degraded` (lent) / `none` (ça coupe).
- **Wi-Fi de bord (ne pas polluer la couverture mobile)** : si l'utilisateur reste
  branché sur le **Wi-Fi du train** tout en mesurant, le ping mesure ce Wi-Fi (et son
  backhaul, souvent lent), pas le réseau mobile. On ne doit donc pas le créditer à un
  opérateur. À chaque tick, le controller lit `navigator.connection.type`
  (`isOnWifi()`, `src/lib/measure/netinfo.ts`) ; quand il vaut `'wifi'`, la mesure est
  **taguée `operator = 'wifi-train'`** au lieu de l'opérateur choisi. Cette valeur
  appartient à la **couche mesure uniquement** (constante `WIFI_TRAIN_OPERATOR`,
  `src/lib/operators.ts`) : elle n'entre **pas** dans le référentiel SEO `OPERATORS`
  (`src/lib/geo/lines.ts`) ni dans la couche ARCEP, et elle est **exclue de toutes les
  vues de couverture mobile** directement au niveau des **lectures DB des agrégats**
  (`+page.server.ts`, `/api/coverage`, `/api/coverage/segments`) dès qu'aucun opérateur
  précis n'est demandé — carte « tous opérateurs », **frise de trajet**, etc. — sinon
  un point Wi-Fi (backhaul lent) s'afficherait à tort comme couverture mobile. Côté
  UI : un **rappel statique** invite à
  couper le Wi-Fi (seule parade sur iOS/Firefox, où `connection.type` est absent), plus
  une **bannière** quand le Wi-Fi est effectivement détecté. Pas de lecture de SSID
  (non exposé au navigateur) → zéro impact vie privée.
- **Débit léger (opt-in)** : « ça répond au ping » ≠ « ça streame ». Si l'utilisateur
  coche **« Mesurer aussi le débit »** (OFF par défaut — ça consomme sa data mobile),
  l'app télécharge **toutes les 60 s** un petit blob incompressible (~128 Ko) via
  `GET /api/probe?size=…` (aléatoire pré-généré, `no-store`, taille bornée 64–512 Ko,
  pas de CORS, aucune donnée client) et en déduit un **débit (kbps)**. Le débit est
  **classé sur la même échelle ARCEP** que la couverture théorique (`src/lib/usage.ts`,
  `levelFromKbps`) : ≥ 4000 → TBC, ≥ 1000 → BC, ≥ 200 → CL, sinon none. Ainsi le réel
  mesuré et le théorique se lisent **au même code couleur** → l'écart se voit d'un
  coup d'œil. La mesure tourne **en tâche de fond** (jamais bloquante) et **jamais en
  tunnel/interpolation** (pas de réseau, data gaspillée).
  - **Maîtrise de la data (l'utilisateur paie son forfait)** : cadence en **temps**
    (1/min, pas « 1 tick sur N ») → **~7,5 Mo/h** ; **plafond dur ~20 Mo/session**
    au-delà duquel le débit se met **en pause** (les pings, eux, continuent). L'UI
    affiche les **Mo consommés** par le test en direct. Le statut réseau (ok/dégradé/
    coupure) reste à 1/s et ne dépend pas du débit.
- **Vie privée (non négociable)** : la position est **arrondie au centre de sa
  cellule H3 (~150 m)** AVANT envoi ; aucune donnée personnelle ; session =
  jeton anonyme jetable ; pas de trace continue ré-identifiable. Consentement
  explicite requis avant tout envoi.
- **Agrégation** (`src/lib/server/ingest.ts`) : par cellule H3 × opérateur →
  taux de réussite, latence médiane, **débit médian** (nullable : seulement si des
  mesures de débit existent), nombre de mesures. Servi par `GET /api/coverage`.
- **Rubans le long de la voie** (`GET /api/coverage/segments`) : pour la carte (zoom
  faible/moyen), les cellules d'une ligne sont projetées sur le tracé de son profil et
  fusionnées en segments de même niveau (`src/lib/coverage-segments.ts`, logique pure
  testée). En vue « tous opérateurs », chaque cellule prend le **pire** taux
  (`worstByCell`, `src/lib/coverage-quality.ts`).
  - **Perf (full-scan)** : en vue globale, l'endpoint lit **toute** la table
    `cell_aggregates` à chaque requête (pas d'agrégat pré-calculé), atténué par le
    cache HTTP 60 s et la mémoïsation des profils. Borné et rapide au volume actuel
    (~10-50 ms), mais le coût croît avec le volume de mesures. Si ça devient lent :
    pré-calculer les rubans (façon `route-profiles`) ou matérialiser une table de
    segments recalculée à l'ingestion.
  - **Limite connue (lignes repliées)** : la projection retient l'abscisse de plus
    petit écart, sans contrainte de continuité → sur une ligne parcourue deux fois
    (aller-retour, troncs communs), une cellule peut se placer sur la mauvaise branche
    et « faire sauter » un segment. Même limite que `RouteProfile.distOf` ; impact
    faible au volume actuel.
- **Rattachement à une ligne (snapping)** : à l'ingestion, la cellule H3 de la
  mesure est rattachée à sa **ligne commerciale** via un index pré-calculé
  (`src/lib/geo/line-snap.ts` → `line-index.json`, cf. `docs/DATA.md` § 3). Le
  rattachement se fait **sur la cellule, pas sur la position brute** — cohérent
  avec l'anonymisation. C'est ce qui alimente les pages de couverture par ligne et
  la **vue « profil de trajet »** (cf. § Le profil de trajet).
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
- **Contenu des pages SEO — théorique figé, réel hydraté** : ces pages portent de
  **vraies données ARCEP** par ligne (chiffres + zones blanches nommées),
  agrégées au build depuis les profils de trajet dans `src/lib/geo/line-stats.json`
  (script `data:line-stats`, cf. `docs/DATA.md`) et **figées dans le HTML prerendu**
  — indexables, zéro coût runtime. La couche **réelle** (mesures communautaires)
  étant **mouvante** et souvent clairsemée, on ne la fige PAS : les pages `/ligne`
  et croisées affichent la **frise `RouteProfile`** (réel par-dessus le théorique),
  et la page `/operateur` (sans frise) un bloc « Et en vrai ? »
  (`CommunityComparison.svelte`) chargé **côté client** (`/api/coverage`), qui
  dégrade proprement sans mesures. C'est l'incarnation de l'ADN du projet :
  l'**écart** entre couverture annoncée et constatée.
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
