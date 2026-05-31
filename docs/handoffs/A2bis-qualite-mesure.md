# Handoff A2bis — Mesure riche : jitter, perte de paquets & débit

> Complément du handoff `A2-duree-coupure.md` (déjà lancé). A2 d'origine avait
> 3 volets : (1) durée de coupure — couvert ailleurs ; (2) jitter/perte ;
> (3) débit léger. **Ce handoff couvre les volets (2) et (3).**

## Lancement (worktree dédié)

⚠️ Ce chantier modifie le **mode mesure** (`ping.ts`, `controller.ts`,
`schema.ts`) — mêmes fichiers que `feat/mesure-robuste` (file hors-ligne) et que
`feat/duree-coupure` (durée de coupure). Pour limiter les conflits, **pars de la
branche la plus avancée du mode mesure** disponible au moment du lancement :

```bash
cd /home/julien/devs/4g-dans-le-train
# Idéalement, partir de feat/duree-coupure si elle existe déjà (elle inclut
# feat/mesure-robuste). Sinon de feat/mesure-robuste. Sinon de main.
git worktree add .claude/worktrees/a2bis-qualite -b feat/qualite-mesure feat/duree-coupure
# (remplace feat/duree-coupure par la branche de base réellement disponible)
# donner le PROMPT ci-dessous à un agent, cwd = .claude/worktrees/a2bis-qualite
```

Vérifie d'abord : `git branch -a` et `git log <branche> --oneline` pour choisir la
meilleure base et savoir ce qui est déjà fait.

---

## PROMPT POUR L'AGENT

Tu travailles sur **« 4G dans le train »** (SvelteKit + Svelte 5 + TS, MapLibre,
libSQL/Drizzle, Bun) : carte communautaire de couverture mobile dans le train.
Tu es dans le worktree `.claude/worktrees/a2bis-qualite` sur `feat/qualite-mesure`.

**Avant tout** : lis `CLAUDE.md`, `docs/PRODUCT.md`, et le mode mesure dans
`src/lib/measure/` (surtout `ping.ts`, `controller.ts`, `queue.ts`). Vérifie ce
qui existe déjà sur ta branche de base (file d'attente hors-ligne ? détection des
coupures ?) via `git log` — **ne refais pas** ce qui y est et **compose** avec.

### Le problème

La mesure de connectivité actuelle est trop pauvre et trop bruitée :

1. **Un seul ping HEAD** par position (`ping.ts` → `ping()` fait un unique
   `fetch` HEAD et classe `ok/degraded/none` sur **un seul** RTT, seuil fixe à
   `DEGRADED_RTT_MS = 1500`). À 300 km/h, un échantillon unique est très bruité :
   un ping malchanceux fait basculer le verdict. On n'a ni **jitter** (variabilité
   de la latence) ni **taux de perte** (paquets qui ne répondent pas), qui sont
   les vrais marqueurs d'une connexion instable en train.
2. **Pas de débit.** « Ça répond au ping » ≠ « ça streame ». Un 4G saturé en gare
   répond au HEAD mais ne charge pas une vidéo. Sans un proxy de **débit**, on ne
   peut pas vraiment tenir la promesse usage (streaming/web/messages) à partir du
   réel — on ne fait que la déduire grossièrement.

### Ta mission

Enrichir la mesure avec **jitter + perte de paquets** (volet 2) et un **débit
léger** (volet 3), de façon cross-navigateur (iOS inclus, donc uniquement du
`fetch` — pas d'API non supportée), économe en données et respectueuse de la vie
privée.

### Approche recommandée

**Volet 2 — Jitter & perte (`ping.ts`, `controller.ts`)**
- Remplacer le HEAD unique par une **petite rafale** (ex. 3–5 requêtes
  rapprochées vers `/api/ping`). En tirer : `rttMin`, `rttMedian`, `jitter`
  (écart-type ou max-min des RTT), `loss` (échecs / total).
- Affiner le verdict `ok/degraded/none` à partir de ces stats plutôt que d'un RTT
  unique (ex. perte élevée ou jitter fort → `degraded` même si le RTT médian est
  bas). Documente les seuils choisis et garde-les configurables.
- Coût data négligeable (HEAD), mais évite de saturer : la rafale doit rester
  courte et ne pas se chevaucher avec la suivante (le garde `busy` existe déjà
  dans `controller.ts`).

**Volet 3 — Débit léger (`controller.ts` + nouvel endpoint)**
- Nouvel endpoint `GET /api/probe?size=<octets>` renvoyant un blob de taille
  connue (incompressible, `cache-control: no-store`), ou réutiliser un asset
  statique de taille connue. Mesurer le temps de téléchargement → **kbps**.
- **Coûteux en données mobiles** : donc **parcimonieux et maîtrisé** — par ex.
  une mesure de débit toutes les N positions seulement, taille adaptée (petit
  blob ~50–100 ko), et idéalement **opt-in** ou désactivable (l'utilisateur dans
  le train paie sa data). Expose clairement ce choix dans l'UI (case « mesurer
  aussi le débit (consomme un peu de données) »).
- Traduire le débit en usage concret cohérent avec la palette du projet
  (streaming / web / messages / rien) — vois `USAGE_COLORS` et les libellés dans
  `src/lib/components/Map.svelte`.

**Persistance & schéma**
- Ajouter les nouveaux champs (`jitter`, `loss`, `downlinkKbps`…) au payload, à
  la validation Zod (`src/routes/api/measurements/+server.ts`), au schéma Drizzle
  (`src/lib/server/db/schema.ts`) et à l'agrégation (`src/lib/server/ingest.ts` —
  médianes par cellule). Fournir une **migration** (`bun run db:generate`).
- Réutiliser la **file d'attente hors-ligne** (`queue.ts`) si elle est présente
  sur ta branche de base : les nouveaux champs doivent transiter par la file
  comme le reste.

### Contraintes

- Stack Bun / Svelte 5 runes / TS strict. `bun run check|lint|build|test`,
  `bun run db:migrate`/`db:generate`.
- **Cross-navigateur** : uniquement `fetch`/`performance.now()` (pas d'API
  réseau non standard ; `navigator.connection` reste un bonus best-effort déjà
  géré dans `netinfo.ts`).
- **Vie privée** : aucune donnée perso ; positions arrondies H3 (~150 m) ; le
  débit ne doit pas servir à fingerprinter. Consentement déjà géré
  (`session.ts`).
- **Données mobiles** : le débit consomme la data de l'utilisateur — sois
  explicite, parcimonieux, et rends-le désactivable.
- Garde `MeasurementController` rétro-compatible (instancié dans `+page.svelte`).
  Style sobre (refonte UI gérée ailleurs) — ajoute juste l'info/le toggle
  fonctionnel.
- **Tests Vitest** sur le calcul stats (RTT list → jitter/loss/verdict) et la
  conversion débit→usage. Logique pure, testable sans DOM (cf. `queue.test.ts`).

### Définition de « terminé »

- Chaque mesure porte jitter + perte ; un verdict plus robuste qu'avec un ping
  unique ; un débit léger optionnel converti en usage concret.
- Schéma migré, API validée, agrégation à jour, hors-ligne pris en compte.
- `check` + `lint` + `build` + `test` verts. `docs/CHANGELOG.md` et
  `docs/PRODUCT.md` (section captation) mis à jour.
- Pas de merge `main`, pas de déploiement. Récap final pour revue.

Pose des questions à Julien sur : les seuils du verdict, la fréquence/taille du
test de débit, et opt-in vs activé par défaut pour le débit.
