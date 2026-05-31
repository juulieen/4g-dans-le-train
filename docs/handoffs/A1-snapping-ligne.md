# Handoff A1 — Rattacher chaque mesure à sa ligne ferroviaire (snapping)

## Lancement (worktree dédié)

```bash
cd /home/julien/devs/4g-dans-le-train
git worktree add .claude/worktrees/a1-snapping -b feat/snapping-ligne
# donner le PROMPT ci-dessous à un agent, cwd = .claude/worktrees/a1-snapping
```

Pars de `main`. Aucune dépendance à une autre branche. C'est le **socle** qui
débloque B1 et B2 (côté réel).

---

## PROMPT POUR L'AGENT

Tu travailles sur **« 4G dans le train »** (web-app SvelteKit + Svelte 5 + TS,
carte MapLibre, base libSQL/Drizzle, runtime Bun) : une carte communautaire de la
couverture mobile le long des lignes de train françaises. Tu es dans le worktree
`.claude/worktrees/a1-snapping` sur la branche `feat/snapping-ligne`.

**Avant tout** : lis `CLAUDE.md` et `docs/PRODUCT.md` pour le contexte produit.

### Le problème

Le champ `lineSlug` est **mort** : il existe dans le schéma
(`src/lib/server/db/schema.ts`, tables `measurements` et `cell_aggregates`), il
est lu à l'agrégation (`src/lib/server/ingest.ts` → `recomputeCell` lit
`rows[0].lineSlug`) et exposé par l'API (`src/routes/api/coverage/+server.ts`),
**mais rien ne l'écrit jamais**. `src/routes/api/measurements/+server.ts` insère
les mesures sans calculer à quelle ligne elles appartiennent. Résultat :
`lineSlug` vaut toujours `null`, et **aucune donnée n'est rattachable à une
ligne** — ce qui bloque les pages SEO par ligne et la future vue « profil de
trajet ».

### Ta mission

Rattacher chaque mesure entrante à la **ligne ferroviaire commerciale** la plus
proche (parmi le référentiel `RAIL_LINES` de `src/lib/geo/lines.ts`), si elle est
suffisamment près d'une voie, et renseigner `lineSlug`. Aussi : **filtrer les
points aberrants** (trop loin de toute voie = probablement pas dans un train).

### Approche recommandée

1. **Données géométriques par ligne.** Le référentiel `RAIL_LINES`
   (`src/lib/geo/lines.ts`) donne 12 lignes commerciales (slug, villes), mais
   **pas leur tracé géométrique**. Le tracé brut est dans
   `static/data/rail-lines.geojson` (réseau RFN complet, ~1,7 Mo, libellés
   techniques peu exploitables tels quels).
   - Option recommandée : générer, via un script `scripts/build-line-index.ts`,
     un **index cellule H3 (résolution 9, ~200 m) → slug(s) de ligne(s)
     commerciale(s)** couvrant chaque ligne de `RAIL_LINES`. Pour tracer
     géométriquement une ligne commerciale (ex. Paris–Lyon) à partir du RFN, le
     plus simple et robuste est de définir le trajet par ses **gares/points de
     passage** (lat/lng) puis de prendre le plus court chemin le long du réseau,
     ou — plus pragmatique pour commencer — d'utiliser un corridor : échantillonne
     les voies RFN proches du segment gares-à-gares. **Discute du compromis** :
     un mapping simple « cellule → slug » suffit pour A1 (on n'a pas besoin de
     l'ordre des points ici, juste de l'appartenance).
   - ⚠️ Un autre agent travaille sur `feat/lignes-commerciales-gtfs` (worktree
     `plus-de-lignes-train`) pour enrichir les lignes via **données GTFS**
     (horaires/tracés officiels SNCF). Si sa branche apporte des tracés
     commerciaux propres, **réutilise-les** plutôt que de réinventer. Regarde
     l'état de cette branche (`git log feat/lignes-commerciales-gtfs --oneline`)
     avant de coder l'extraction géométrique ; coordonne-toi (ou conçois A1 pour
     consommer facilement ce qu'elle produira).

2. **Snapping à l'ingestion.** Dans `src/routes/api/measurements/+server.ts`,
   après le `snapToCell` existant, déduire `lineSlug` via
   l'index (`Map.get(cellId)` → O(1), pas de calcul Turf par requête). Si la
   cellule n'est rattachée à aucune ligne **et** que le point est à plus d'un
   seuil (~300–500 m) de toute voie, considérer la mesure comme **hors-train** :
   soit la rejeter (4xx), soit l'accepter sans `lineSlug` — **propose le
   comportement** et documente-le. Conserver la rétro-compat de l'API.

3. **Index spatial pour le filtre de distance.** Pour décider « à plus de X m
   d'une voie », pré-calcule une structure légère (l'ensemble des cellules H3
   couvertes par le réseau RFN existe déjà dans la logique de
   `scripts/build-arcep-lines.ts` / `import-arcep.ts` — réutilise le pattern
   `railCells`). `@turf/turf` et `h3-js` sont déjà des dépendances.

4. **Agrégation par ligne.** Une fois `lineSlug` renseigné, vérifie que
   `recomputeCell` et `/api/coverage` le propagent correctement (c'est déjà
   prévu). Bonus utile pour B2/B1 : un petit helper serveur qui renvoie un
   **résumé agrégé par ligne** (taux de réussite global, nb de mesures, par
   opérateur) — mais garde-le optionnel si le temps manque.

### Contraintes

- Stack : SvelteKit 2 / Svelte 5 runes / TS strict / Bun. Commandes :
  `bun run dev|build|check|lint|format|test`, `bun run db:migrate`.
- **Vie privée non négociable** : on ne stocke jamais la position exacte, déjà
  arrondie à la cellule H3 (~150 m). Le snapping se fait sur la cellule, pas sur
  le point brut — cohérent avec l'anonymisation.
- Ne casse pas l'API existante ni le schéma (si tu ajoutes une colonne, fournis
  une migration Drizzle via `bun run db:generate` + documente).
- **Tests Vitest** sur la logique de snapping (cellule connue → bon slug ; point
  loin de toute voie → pas de slug / rejet). Pattern : voir
  `src/lib/measure/queue.test.ts` (storage/logique injectable, testable sans DOM).

### Définition de « terminé »

- Les nouvelles mesures arrivent avec un `lineSlug` correct quand elles sont sur
  une ligne du référentiel ; les points manifestement hors-train sont filtrés.
- Un script reproductible génère l'index ligne (documenté dans `docs/DATA.md`).
- `check` + `lint` + `build` + `test` verts. Entrée ajoutée à `docs/CHANGELOG.md`,
  `docs/PRODUCT.md` mis à jour (section captation / décisions).
- Pas de merge sur `main`, pas de déploiement. Récap final pour revue.

Pose des questions à Julien si le compromis géométrique (comment tracer une
ligne commerciale à partir du RFN, seuil de distance, rejet vs acceptation sans
slug) est ambigu.
