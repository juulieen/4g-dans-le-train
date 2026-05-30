# Journal des évolutions

> Ajoute ici une entrée (date + résumé) pour toute évolution fonctionnelle ou de
> contenu notable. Le plus récent en haut. Voir `../CLAUDE.md`.

## 2026-05-31

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
  Couvre 51/54 lignes. Aucun changement de schéma (colonne `line_slug` déjà présente).

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
