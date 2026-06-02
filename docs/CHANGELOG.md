# Journal des évolutions

> Ajoute ici une entrée (date + résumé) pour toute évolution fonctionnelle ou de
> contenu notable. Le plus récent en haut. Voir `../CLAUDE.md`.

## 2026-06-02

- **Carte — le réel ressort (cerclé de blanc) au-dessus de l'ARCEP** : après la refonte
  en rubans, les mesures se confondaient avec la voie ARCEP (formes/largeurs/couleurs
  proches) → le réel ne primait plus, et l'incitation à contribuer baissait. Le ruban
  « réel » reçoit un **liseré blanc** (casing) et s'épaissit, et les hexagones un
  **contour blanc** : on retrouve la signature « cerclé de blanc = du vécu » des
  anciennes pastilles, en gras au-dessus du théorique. Cerclage **contrasté selon le
  thème** (blanc en sombre / foncé en clair, car le blanc disparaissait sur le fond
  clair positron). L'ARCEP passe **légèrement en retrait** (opacité 0,9→0,8, flou accru) :
  lisible **hors zones mesurées**, volontairement recouvert sous le ruban réel.
- **Carte — lisibilité des mesures : ruban le long de la voie + quadrillage H3** :
  remplacement des **pastilles empilées** (illisibles dès qu'un trajet génère des
  centaines de cellules — ex. Paris-Arcachon : 656 cellules) par un **rendu
  progressif au zoom**. Au zoom faible/intermédiaire, un **ruban coloré suit le
  tracé** (nouvel endpoint `GET /api/coverage/segments` : projection des cellules sur
  le `path` du profil de ligne, fusion run-length par niveau d'usage) ; au zoom fort,
  un **quadrillage de cellules hexagonales H3** (`cellToBoundary` côté client) avec
  fondu croisé. En vue « tous opérateurs », chaque cellule/segment prend le **pire**
  taux parmi les opérateurs (`worstByCell`) → on met en avant les risques de coupure.
  Seuils de classification du réel centralisés dans `src/lib/usage.ts` (`rateToLevel`,
  80/40 → TBC/CL/none), réutilisés par la carte et la frise `RouteProfile`.
  `/api/coverage` (points) reste inchangé.
- **Carte — cliquer sur une voie révèle les lignes qui passent ici** : la popup
  ARCEP (au clic sur une voie colorée) gagne une section « Lignes qui passent ici »
  listant les **lignes commerciales** du référentiel traversant ce point, chacune
  avec un lien vers sa **page dédiée** `/ligne/{slug}`. Nouvel endpoint
  `GET /api/lines?lat=&lng=` : convertit la position en cellule H3 (rés. 9) et la
  croise avec `line-index.json` via `lineSlugsForCell`, en élargissant anneau par
  anneau (`gridDisk` k=0→2) pour rester robuste à un clic légèrement décalé du
  tracé. Affichage plafonné à 6 lignes (les plus spécifiques d'abord) avec un
  résumé « +N autres ».

## 2026-06-01

- **Mesure — débit : maîtrise de la consommation data** : la cadence du test de débit
  passe d'« 1 mesure sur 5 » (≈ une probe de 128 Ko toutes les 5 s, ~90 Mo/h 😬) à un
  **intervalle en temps de 60 s** (~7,5 Mo/h, ÷12). Ajout d'un **plafond dur
  ~20 Mo/session** : au-delà, le débit se met **en pause** (les pings continuent), et
  l'UI affiche les **Mo consommés** par le test en direct. Le statut réseau reste à 1/s
  et indépendant du débit. _Non encore mergé sur `main`._

- **Mesure — débit léger opt-in + cadence stable 1/s (branche `feat/debit-mesure`)** :
  refonte de la boucle de mesure autour d'un **tick maître à 1 s** qui pilote tout
  (un ping/s quoi qu'il arrive) ; `watchPosition` ne sert plus qu'à rafraîchir la
  position et refermer les trous GPS. Ce tick **unifie** le mode normal et le secours
  tunnel/cold-start (interpolation « depuis les rails » conservée). Nouveau **débit
  descendant opt-in** (OFF par défaut) : 1 mesure GPS sur 5, blob incompressible ~128 Ko
  via le nouvel endpoint `GET /api/probe` (aléatoire pré-généré, `no-store`, sans CORS,
  taille bornée), mesuré **en tâche de fond** et **jamais en tunnel**. Le débit est
  **classé sur l'échelle ARCEP** (`levelFromKbps`, seuils 4000/1000/200 kbps) → réel et
  théorique partagent le code couleur. Décision produit : on **abandonne le jitter et la
  rafale** (jugés redondants avec l'agrégation par cellule) — la fiabilité reste portée
  par `successRate` + `medianRtt`. Schéma : `downlink_kbps` (mesures) + `median_downlink`
  (agrégats, exposé par `/api/coverage`), migration additive `0003`. Tests Vitest (débit,
  seuils usage). _Non encore mergé sur `main`._
- **Mesure — capture découplée de la synchro + retour visuel (suite)** : la capture
  d'un point ne dépend plus de l'envoi réseau. Le verrou `busy` ne couvre que le ping
  (plus le `flush`, désormais en tâche de fond), et une position arrivée pendant un ping
  n'est plus perdue (coalescing du dernier échantillon). Côté UI (panneau mesure) :
  un **compteur « N points enregistrés »** qui ne décroît jamais (envoyés + en file +
  bufferisés trou GPS), une **ligne d'état de synchro à hauteur fixe** (fini le « 1 en
  attente » qui clignote et fait sauter l'UI), une **pastille d'activité** qui pulse, et
  un message rassurant hors-ligne (« gardés, envoi au retour du réseau »). Nouveau champ
  `LiveState.buffered`. _Non encore mergé sur `main`._
- **Mesure même sans GPS — interpolation « depuis les rails » (branche
  `worktree-mesure-sans-gps`)** : le mode mesure était piloté par les positions GPS,
  donc **aveugle dès que le GPS décrochait** — tunnels (donnée pourtant la plus utile)
  et surtout **cold-start**, où le 1er fix peut mettre plusieurs minutes pendant
  lesquelles on affichait « en attente » sans rien mesurer alors que le réseau est là.
  Désormais un **tick de secours** (~5 s) pingue quand le GPS n'est pas frais et
  bufferise ces mesures **sans position** ; à la reprise GPS **sur les rails de la même
  ligne** (preuve qu'on n'a pas quitté le train), leur position est reconstruite le long
  du tracé : **interpolée** entre deux fix (tunnel) ou **extrapolée en arrière** depuis
  les deux premiers fix (cold-start). Garde-fous : entrée+sortie ≤ 1 km du tracé, trou
  ≤ 5 min, sinon buffer jeté. Nouvelle primitive pure testée `src/lib/geo/interpolate.ts`
  (`projectOntoPath` / `positionAtDist` / `reconstructAlongPath`), orchestration dans
  `src/lib/measure/controller.ts`. Nouvelle colonne `measurements.pos_source`
  (`gps`/`interpolated`, migration `0002`) — points interpolés agrégés comme les GPS pour
  l'instant, distinction visuelle à venir. Bonus acquisition : le **1er fix réutilise une
  position récente** du téléphone (`geolocation.ts`, `maximumAge` relâché) au lieu de la
  jeter, ce qui tue l'attente au redémarrage. _Non encore mergé sur `main`._
- **Trajets-tronçons générés depuis les données (branche `feat/trajets-troncons`)** :
  des relations très cherchées comme **Bordeaux↔Toulouse** ou **Poitiers↔Bordeaux**
  n'existaient pas, car le référentiel ne contient que les relations terminus→terminus
  nommées dans le GTFS. On **découvre désormais automatiquement** des « tronçons »
  (sous-relations ville↔ville) : `scripts/lib/troncons.ts` mesure la **hub-ness** de
  chaque gare (nb de relations qui la desservent) et émet, pour chaque ligne, un
  tronçon par paire de gares majeures (seuil `TRONCON_MIN_HUB`, défaut 3 ; ~54
  tronçons). Garde-fous de nommage légers (alias gare→ville `saint-pierre-des-corps
→ Tours`…, liste noire de nœuds TGV). Chaque tronçon est **bidirectionnel** (une
  seule page « A ↔ B »), obtient une **frise ARCEP + stats** comme toute ligne, mais
  **partage l'attribution des mesures de sa ligne parente** : `data:line-index` écrit
  `src/lib/geo/troncon-cells.json` (`{ slug: { parent, cells } }`) et les API
  `coverage`/`outages` servent, pour un tronçon, les mesures de la **portion**
  correspondante de la parente (cf. `src/lib/geo/troncon-snap.ts`). Le tronçon **n'entre
  pas** dans `line-index.json` (la parente reste le slug primaire des mesures). SEO :
  stratégie « large + monitoring » — les tronçons **riches** (stats ARCEP fiables) sont
  indexés, les **minces** (sans stats) et toutes les sous-pages opérateur × tronçon
  sont en `noindex,follow` et exclus du `sitemap.xml`. Régénération : `bun run data:all`.

## 2026-05-31

- **Pages SEO remplies de vraies données (branche `feat/seo-data`)** : les pages
  `/ligne`, `/operateur` et croisées n'avaient aucun chiffre. Elles portent
  désormais la **couverture ARCEP réelle par ligne** — pourcentages `TBC/BC/CL/none`
  par opérateur, couverture « au mieux », et **zones blanches nommées
  automatiquement** (« notamment après Vierzon et Châteauroux »). Calcul au build :
  nouveau script `scripts/build-line-stats.ts` (`data:line-stats`) qui **agrège les
  profils de trajet** déjà produits par `data:line-index`
  (`static/data/route-profiles/*.json`, handoff B1) — aucun re-routage, pondéré par
  la longueur → `src/lib/geo/line-stats.json` (committé, lu par
  `src/lib/geo/line-stats.ts`, figé dans le HTML prerendu). `<meta description>` et
  FAQ JSON-LD enrichis d'un chiffre saillant. Les pages `/ligne` et croisées
  montrent la **frise RouteProfile** (B1) pour le réel ; la page `/operateur`
  (sans frise) garde un bloc `CommunityComparison.svelte` hydraté côté client
  (`/api/coverage`, qui expose désormais `lastSeen`). Sitemap et maillage interne
  inchangés. Garde-fou de fiabilité : `import-arcep` n'écrivant que les cellules
  couvertes, une ligne dont le tracé s'écarte du corridor ARCEP (> 20 % « sans
  données ») est exclue plutôt que d'afficher de faux chiffres. _Non encore mergé
  sur `main`._
- **Profil de trajet — frise de couverture gare→gare (branche `feat/profil-trajet`)** :
  nouvelle vue signature qui tient enfin la promesse produit (« sur MON trajet,
  quand pourrai-je regarder une vidéo… ou rien ? »). Composant réutilisable
  `src/lib/components/RouteProfile.svelte` : une **frise horizontale** de la gare
  de départ à la gare d'arrivée, colorée par usage, superposant le **théorique
  (ARCEP)** en fond et le **réel (mesures)** par-dessus (cerclé de blanc, il
  prime), avec **gares + distances cumulées** et marqueurs de **coupures**
  (« ✕ ~3 min »). Intégrée sur les pages SEO `/ligne/[slug]` **et** dans l'app
  carte (sélecteur « Profil d'un trajet »). Accessibilité daltonien : la zone
  blanche porte des **hachures** en plus du rouge + résumé textuel pour lecteurs
  d'écran. Données : `scripts/build-line-index.ts` émet désormais aussi, par
  ligne, `static/data/route-profiles/<slug>.json` (gares ordonnées, segments
  ARCEP en run-length, polyligne simplifiée pour situer mesures/coupures) — il
  réutilise le routage GTFS déjà calculé et lit `arcep-coverage.geojson` (d'où le
  réordonnancement de `data:all`). Couleurs/labels d'usage centralisés dans
  `src/lib/usage.ts` (partagé carte ↔ frise). `/api/coverage` accepte un filtre
  `?line=`. _Non encore mergé sur `main`._
- **Durée des coupures réseau (branche `feat/duree-coupure`)** : on mesure
  désormais les **épisodes de coupure** (`ok → none… → ok`), pas seulement des
  points isolés — la donnée à plus forte valeur produit (« tu perdras le réseau
  ~1 min 40 s après telle gare »). Choix d'archi : on ne stocke **aucun** objet
  « coupure », on persiste l'**instant réel de mesure** (`measured_at`, époch ms,
  nouvelle colonne nullable + index `(session_id, measured_at)`) et on **dérive**
  les épisodes via une brique pure (`src/lib/measure/outage.ts`) réutilisée
  côté client (retour live éphémère « coupure de X » + compteur dans le panneau
  mesure) **et** côté serveur (`src/lib/server/outages.ts` → `GET /api/outages`,
  agrégats GeoJSON par cellule de début × opérateur : durée/longueur médianes,
  ligne dérivée de la cellule). Longueur estimée par distance GPS, repli
  `vitesse × durée` en tunnel. `GET /api/outages` ne renvoie que des agrégats
  (jamais les points bruts/séquences par session). Tests Vitest sur la machine à
  états (9 cas). Migration `0001_dapper_wong.sql`. _Non encore mergé sur `main`._
- **Mode mesure robuste (branche `feat/mesure-robuste`)** : file d'attente
  persistante (`src/lib/measure/queue.ts`) qui conserve les mesures non envoyées
  au lieu de les jeter. Crucial : les zones blanches (où l'envoi échoue) étaient
  perdues — c'est précisément la donnée la plus précieuse. Les mesures sont
  rejouées au retour `online` + toutes les 15 s, file bornée à 500 (FIFO),
  persistée en localStorage. Erreurs GPS distinguées (permission refusée = arrêt,
  tunnel/timeout = transitoire). Compteur « en attente d'envoi » dans l'UI.
  Tests Vitest sur la file (8 cas). Correctif eslint : ignore `.claude/`
  (worktrees imbriqués). _Non encore mergé sur `main`._
- **Rattachement des mesures à leur ligne (snapping, branche `feat/snapping-ligne`)** :
  le champ `lineSlug` était mort (jamais renseigné). Nouvel index spatial
  `cellule H3 → ligne(s)` (`scripts/build-line-index.ts` → `src/lib/geo/line-index.json`,
  committé), construit depuis le GTFS SNCF (suite ordonnée des gares par ligne) et un
  **routage du plus court chemin sur le réseau RFN** entre gares. À l'ingestion
  (`/api/measurements`), chaque mesure reçoit son `lineSlug` en O(1) via
  `src/lib/geo/line-snap.ts`. Décision produit : une mesure hors de toute ligne connue
  est **acceptée sans `lineSlug`** (pas de rejet). `recomputeCell` dérive désormais
  `lineSlug` de la cellule (corrige un bug de propagation `rows[0]`). Helpers GTFS
  mutualisés dans `scripts/lib/gtfs.ts` (slugs garantis identiques au référentiel).
  Couvre 42/44 lignes. Aucun changement de schéma (colonne `line_slug` déjà présente).

## 2026-05-30

- **Pages SEO opérateur** : `/operateurs`, `/operateur/[slug]` (×4) et croisées
  `/ligne/[slug]/[operateur]` (×48), maillage interne, JSON-LD, sitemap, lien
  « Opérateurs » dans la nav. 67 pages prerendues au total.
- **Filtre carte par opérateur** : sélecteur dédié « Afficher la couverture
  de… », distinct du mode mesure ; recolore les voies ARCEP + filtre les
  mesures communautaires.
- **Lisibilité popups** : thème sombre, contenu reformulé en langage usage avec
  pastilles colorées par opérateur.
- **Refonte carte ARCEP** : la voie ferrée est désormais **colorée par usage**
  (streaming / web / messages / zone blanche) au lieu de points bleus peu
  parlants ; nouvelle couche `arcep-lines.geojson` (`scripts/build-arcep-lines.ts`).
- **Déploiement prod** : mise en ligne sur https://4g-dans-le-train.juulieen.fr
  (serveur asus-1, Docker + Caddy, HTTPS Let's Encrypt). Géolocalisation
  autorisée via `Permissions-Policy` côté Caddy. Démarrage rendu résilient sans
  base migrée.
- **Intégration ARCEP** : pipeline d'import 100 % JS/Bun (GeoPackage 7z →
  reprojection → échantillonnage H3 le long des voies), 4 opérateurs en 4G.

## 2026-05-29

- **Création du projet** : MVP SvelteKit + Bun + libSQL + MapLibre. Carte,
  mode mesure PWA (ping + geolocation + Wake Lock, consentement RGPD,
  anonymisation H3), API ping/measurements/coverage, premières pages SEO
  (lignes, FAQ), import des tracés SNCF Open Data. Repo public sous licence MIT.
