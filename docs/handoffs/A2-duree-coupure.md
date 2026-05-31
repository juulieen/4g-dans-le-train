# Handoff A2 — Mesurer la durée des coupures réseau

## Lancement (worktree dédié, basé sur `feat/mesure-robuste`)

⚠️ A2 modifie le **mode mesure** (`controller.ts`, `ping.ts`), exactement les
fichiers de la branche `feat/mesure-robuste` (file d'attente hors-ligne) **non
encore mergée**. Pour éviter un conflit, **pars de cette branche**, pas de `main` :

```bash
cd /home/julien/devs/4g-dans-le-train
git worktree add .claude/worktrees/a2-coupure -b feat/duree-coupure feat/mesure-robuste
# donner le PROMPT ci-dessous à un agent, cwd = .claude/worktrees/a2-coupure
```

(Si `feat/mesure-robuste` a déjà été mergée sur `main` entre-temps, pars de
`main` à la place.)

---

## PROMPT POUR L'AGENT

Tu travailles sur **« 4G dans le train »** (SvelteKit + Svelte 5 + TS, MapLibre,
libSQL/Drizzle, Bun) : carte communautaire de la couverture mobile dans le train.
Tu es dans le worktree `.claude/worktrees/a2-coupure` sur `feat/duree-coupure`
(basée sur `feat/mesure-robuste`).

**Avant tout** : lis `CLAUDE.md`, `docs/PRODUCT.md`, et le code du mode mesure
dans `src/lib/measure/` (surtout `controller.ts`, `ping.ts`, `queue.ts`).

### L'opportunité

La proposition de valeur du projet (`docs/PRODUCT.md`) est : « sur mon trajet, à
quel moment je pourrai regarder une vidéo… ou rien ? ». La phrase qui fait mouche
serait **« tu perdras le réseau pendant 3 minutes après telle gare »**. Or
aujourd'hui on ne capte que des points indépendants `ok`/`degraded`/`none`
(`controller.ts` → `handleSample` → `ping`), sans notion de **durée** ni de
**longueur** d'une coupure. On sait « il y a une zone rouge » mais pas « ça coupe
2 min ». C'est la donnée à plus forte valeur produit, et elle alimente
directement la vue « profil de trajet » (handoff B1).

### Ta mission

Détecter et mesurer les **épisodes de coupure** : une transition `ok/degraded →
none → ok/degraded`. Pour chaque épisode, enregistrer sa **durée** (secondes) et
idéalement sa **longueur** (mètres parcourus pendant la coupure, via les
positions GPS + vitesse) et **où il commence/finit** (cellules H3, déjà
anonymisées).

### Approche recommandée

1. **Détection côté client** (`controller.ts`). Suivre l'état réseau dans le
   temps : quand on passe à `none`, mémoriser l'instant + la position de début ;
   quand on revient à `ok/degraded`, clore l'épisode et calculer
   `durationS = now - start`, `lengthM` (distance cumulée GPS pendant l'épisode),
   et les cellules de début/fin. Attention aux cas limites : coupure en cours
   quand l'utilisateur arrête le mode (clore proprement), `none` isolé d'un seul
   sample (épisode très court — garder, c'est informatif), perte du GPS pendant
   la coupure (tunnel : la position peut figer — gère l'absence de points).

2. **Persistance / envoi.** Décide du modèle avec discernement :
   - Option simple : un nouvel attribut sur les mesures existantes (peu adapté,
     un épisode ≠ un point).
   - Option recommandée : un **nouvel endpoint** `POST /api/outages` + une table
     `outages` (Drizzle) : `cellStart`, `cellEnd`, `operator`, `durationS`,
     `lengthM`, `lineSlug?`, `sessionId`, `createdAt`. Agréger par tronçon pour
     l'affichage (durée médiane d'une coupure récurrente à un endroit donné).
   - **Réutilise la file d'attente hors-ligne** de `queue.ts` (déjà là sur cette
     branche) : un épisode de coupure se termine souvent… en zone blanche
     justement, donc son envoi doit être différé/rejoué comme les mesures.
     ⚠️ C'est LE point d'intégration délicat — un épisode se clôt quand le réseau
     revient, donc l'envoi peut réussir tout de suite, mais conçois-le pour
     passer aussi par la file si besoin.

3. **Vie privée.** Mêmes règles : positions arrondies aux cellules H3, aucune
   donnée perso, session anonyme. Un épisode = (cellule début, cellule fin,
   durée) — pas de trace fine.

4. **UI minimale** (`src/routes/+page.svelte`, section mode mesure). Afficher
   pendant la session un compteur « coupures détectées » et, à la fin d'une
   coupure, un retour (« coupure de 1 min 40 s »). Reste sobre côté style : la
   refonte UI « liquid glass » est gérée par un autre agent en parallèle — ne
   fais pas de gros restyling, juste l'info fonctionnelle.

### Contraintes

- Stack Bun / Svelte 5 runes / TS strict. `bun run check|lint|build|test`,
  `bun run db:migrate` / `db:generate` pour toute nouvelle table.
- Garder l'interface publique de `MeasurementController` rétro-compatible autant
  que possible (l'UI l'instancie dans `+page.svelte`).
- **Tests Vitest** sur la machine à états des épisodes (séquences de statuts →
  épisodes attendus : durée, fusion, cas isolés, coupure non terminée). Logique
  pure et injectable, testable sans DOM (voir `queue.test.ts`).
- API : validation Zod (voir `measurements/+server.ts`), rate-limit, anti-abus.

### Définition de « terminé »

- Les épisodes de coupure sont détectés, mesurés (durée + longueur), persistés et
  agrégeables par tronçon, avec gestion hors-ligne.
- UI : retour minimal pendant la mesure.
- `check` + `lint` + `build` + `test` verts. `docs/CHANGELOG.md` et
  `docs/PRODUCT.md` (section captation) mis à jour. Migration Drizzle fournie si
  nouvelle table.
- Pas de merge `main`, pas de déploiement. Récap final pour revue.

Pose des questions à Julien sur : modèle de données (table dédiée vs autre),
seuil de durée minimale d'un épisode à conserver, et articulation avec la file
hors-ligne.
