# Journal des évolutions

> Ajoute ici une entrée (date + résumé) pour toute évolution fonctionnelle ou de
> contenu notable. Le plus récent en haut. Voir `../CLAUDE.md`.

## 2026-05-31

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
