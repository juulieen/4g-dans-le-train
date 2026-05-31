# Journal des évolutions

> Ajoute ici une entrée (date + résumé) pour toute évolution fonctionnelle ou de
> contenu notable. Le plus récent en haut. Voir `../CLAUDE.md`.

## 2026-05-31

- **Mesure riche : jitter, perte de paquets & débit (branche `feat/qualite-mesure`)** :
  le ping unique par position est remplacé par une **petite rafale** (4 HEAD
  rapprochés) dont on tire **RTT médian + gigue + taux de perte** — robuste au bruit
  d'un échantillon isolé à 300 km/h. Le verdict `ok/degraded/none` est consolidé et
  **ancré sur le ressenti** (gigue > 200 ms ou perte > 25 % → `degraded`), seuils
  centralisés/configurables. Calcul isolé dans un module pur (`src/lib/measure/stats.ts`).
  Nouveau **débit léger opt-in** (OFF par défaut, consomme la data) : 1 position sur 5,
  téléchargement d'un blob incompressible ~128 Ko via le nouvel endpoint
  `GET /api/probe` (aléatoire, `no-store`, taille bornée 64–512 Ko, aucune donnée
  client), traduit en **usage concret** (streaming/web/messages/rien) par un util
  partagé `src/lib/usage.ts` (centralise `USAGE_COLORS`, dé-duplique `Map.svelte`).
  Nouveaux champs nullables `jitter_ms`, `loss`, `downlink_kbps` (mesures) + médianes
  `median_jitter`, `median_loss`, `median_downlink` (`cell_aggregates`, exposées par
  `/api/coverage`) ; payload, file hors-ligne et validation Zod étendus ;
  rétro-compat totale (champs optionnels, anciens items de file acceptés). UI : toggle
  débit + lignes Gigue/Perte/Débit dans le panneau mesure (style sobre). Tests Vitest
  (stats 13 cas, usage 5, débit 4). Migration `0002_complete_maelstrom.sql` (additive).
  Suite à la revue : mesure de débit déplacée **hors du verrou de mesure** (tâche de
  fond, ne décime plus les échantillons GPS en zone blanche), **timeout de ping de
  rafale ramené à 2,5 s** (borne la fenêtre bloquante), et verdict `none` clarifié
  (absence totale de réponse, plus de pseudo-seuil de perte). _Non encore mergé sur `main`._
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
