# Handoffs — chantiers « fondations data »

Ce dossier contient des **prompts de handoff autonomes** : chacun se donne tel
quel à un nouvel agent, dans **son propre worktree** (travail parallèle isolé).

## Pourquoi des worktrees (et pas juste des branches)

Plusieurs agents travaillent en parallèle sur ce projet. Une branche seule
partage le même répertoire de travail → les agents se marchent dessus. Un
**worktree** donne à chaque agent **son propre répertoire physique + sa branche**,
tout en partageant le même dépôt git. Convention du projet : worktrees rangés
dans `.claude/worktrees/<nom>`.

### Créer un worktree pour un handoff

```bash
cd /home/julien/devs/4g-dans-le-train
git worktree add .claude/worktrees/<nom-court> -b <nom-branche>
# ex. pour A1 :
git worktree add .claude/worktrees/a1-snapping -b feat/snapping-ligne
```

Puis lance un agent en lui donnant le contenu du fichier de handoff **et** en
précisant son répertoire de travail : `.claude/worktrees/<nom-court>`.

### Worktrees déjà actifs (ne pas perturber)

- `.claude/worktrees/feat+ui-liquid-glass` → refonte UI liquid glass (en cours)
- `.claude/worktrees/plus-de-lignes-train` → `feat/lignes-commerciales-gtfs`
  (ajout de lignes commerciales via GTFS — **recoupe A1/B1**, voir notes)
- Repo principal → `feat/mesure-robuste` (file d'attente hors-ligne, **recoupe A2**)

## Ordre recommandé (priorité : fondations data)

```
A1 (snapping ligne) ──┬──► B2 (pages SEO + données)
   SOCLE              └──► B1 (profil de trajet)  ◄── A2 (durée de coupure)
```

1. **A1 — Snapping mesure ↔ ligne** (`A1-snapping-ligne.md`) — SOCLE, à faire
   en premier. Isolé côté serveur/données, aucun conflit.
2. **A2 — Durée de coupure** (`A2-duree-coupure.md`) — peut démarrer en
   parallèle d'A1. ⚠️ Touche le mode mesure → **dépend de `feat/mesure-robuste`**
   (partir de cette branche, voir le fichier).
2bis. **A2bis — Mesure riche : jitter, perte & débit** (`A2bis-qualite-mesure.md`)
   — les 2 autres volets d'A2 (au-delà de la durée de coupure). ⚠️ Touche les
   mêmes fichiers du mode mesure que A2 et `feat/mesure-robuste` → partir de la
   branche mode-mesure la plus avancée (voir le fichier) pour éviter les conflits.
3. **B2 — Pages SEO avec vraies données** (`B2-pages-seo-data.md`) — la partie
   ARCEP ne dépend de rien ; la partie « réel » dépend d'A1.
4. **B1 — Profil de trajet** (`B1-profil-trajet.md`) — dépend d'A1 (et A2 pour
   les durées). ⚠️ Touche l'UI → coordonner avec la refonte liquid glass.

## Règles communes à tous les handoffs

- Lire `CLAUDE.md` + `docs/PRODUCT.md` avant de commencer ; **mettre à jour
  `docs/CHANGELOG.md`** (et `PRODUCT.md` si une décision change).
- `bun run check && bun run lint && bun run build` doivent rester verts ;
  ajouter des tests Vitest quand c'est de la logique pure.
- Tester le rendu navigateur via un **sous-agent** Chrome.
- **Ne pas merger sur `main` ni déployer** sans validation de Julien.
- Commits clairs et atomiques. En fin de tâche : récap pour revue.
