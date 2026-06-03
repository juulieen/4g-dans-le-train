# Spec — Refonte de la page ligne (`/ligne/[slug]`)

> Statut : **spec de travail** (pas encore implémentée). Objectif : rendre la page
> `/ligne/[slug]` à la fois **utile** (réponse en 2 s) et **bonne pour le SEO**, en
> accord avec le projet (théorie ARCEP vs réel communautaire). À replier dans
> `PRODUCT.md` une fois livrée. Voir l'idéation et l'exploration Google Suggest qui la
> motivent.

## 1. Objectif & principe directeur

La page sert **deux choses qui veulent la même** : répondre vite au visiteur ET ranker.
Principe unique : **« la réponse d'abord, le détail ensuite, l'action à la fin »**.

Ordre de la page (haut → bas) :

1. Fil d'Ariane + **H1** (langage usager)
2. **Verdict** (TL;DR, 2–3 phrases) ← le cœur de la refonte
3. **Points noirs** (liste des zones à problème, nommées par gare)
4. **Théorie ↔ réel** (1 phrase : ce qu'on annonce vs ce que les voyageurs constatent)
5. **Frise** (`RouteProfile`) — reléguée, illustration, éventuellement repliable
6. **Par opérateur** (table/section, mots-clés opérateur)
7. **FAQ** (questions réelles, JSON-LD)
8. **Astuces** + **CTA mesurer**

## 2. Virage vocabulaire (règle transverse)

**Titres, H1, verdict, points noirs, FAQ** → langage des gens. **Corps/détail technique**
→ vocabulaire précis conservé.

| On dit (visible, SEO)                          | Au lieu de (jargon)       |
| ---------------------------------------------- | ------------------------- |
| internet / connexion / réseau dans le train    | couverture mobile         |
| ça capte / ça coupe                            | couverture / zone blanche |
| se connecter, avoir du réseau                  | disponibilité réseau      |
| regarder une vidéo / naviguer / envoyer un SMS | TBC / BC / CL             |

On **garde** « 4G/5G », « ARCEP », « Orange/SFR/Free/Bouygues », « zone blanche » dans le
corps explicatif et les sections détaillées (crédibilité + mots-clés secondaires).

**Angle wifi de bord** (intent n°1 du Suggest : « wifi tgv inoui ne marche pas ») : on
n'est PAS le portail wifi de bord ; on mesure le **réseau mobile** du voyageur. Message à
exploiter : _« Le wifi du train rame ou coupe ? Voici où votre réseau mobile (4G/5G) prend
le relais sur ce trajet. »_ (cohérent avec la détection `wifi-train` existante.)

### Gabarits `<title>` / `<meta>` / `<h1>`

- `title` : `Internet dans le train {from}–{to} — où ça capte, où ça coupe`
- `h1` : `Y a-t-il du réseau dans le train entre {from} et {to} ?`
  (tronçon : `… entre {from} et {to} (portion de {parent}) ?`)
- `meta description` : reprend le **verdict** tronqué (~150 car.), p. ex.
  `Sur {from}–{to} : ça capte bien sur {good}% du trajet, {N} zone(s) où ça coupe (après {gare}…). Mesuré par les voyageurs + couverture annoncée.`
- Anciens libellés « Couverture mobile 4G/5G… » → migrés. Conserver les **mots-clés 4G/5G**
  dans le corps, pas dans le H1.

## 3. Le Verdict (bloc TL;DR)

### Emplacement / forme

Juste sous le H1, encadré léger, 2–3 phrases, **gros chiffre saillant**. Lisible en un
écran mobile. Pas de jargon.

### Données sources

- **Théorique** : `LineStats` (déjà au build, `line-stats.ts`) → `best` (LevelDist au
  mieux des opérateurs), `zonesBlanches`, `lengthKm`.
- **Réel** : **instantané prérendu** (cf. §7) → `goodPct` mesuré (pondéré mesures),
  `bestOperator`, `samples`, `lastSeen`, liste de coupures (gare/durée/longueur).

### Logique

- `goodVerb` = verbe d'usage du **niveau dominant** (longueur) : `TBC`→« regarder une
  vidéo », `BC`→« naviguer tranquillement », `CL`→« envoyer un message », `none`→« rien ».
- `goodPct` = part « confortable » = `(TBC+BC)/total`.
- Si **le réel couvre assez le trajet** (critère de **couverture spatiale**, cf. ci-dessous —
  PAS un total de mesures sur la ligne) → verdict basé sur le **réel**, avec mention « d'après
  les voyageurs ». Sinon → verdict **annoncé (ARCEP)**, réel montré comme complément partiel,
  et invitation à mesurer.

### Gabarits de phrases

**Avec réel suffisant :**

> D'après les voyageurs, **entre {from} et {to} ça capte bien sur ~{goodPct} %** du trajet
> (de quoi {goodVerb}). **{N} zone(s) où ça coupe**, notamment **après {gare1}**.
> Au mieux : **{bestOperator}**.
> _{si écart} L'opérateur annonce {arcepGood} % ; en vrai c'est plutôt {realGood} %._

**Sans réel (ARCEP seul) :**

> **Entre {from} et {to}, le réseau est annoncé bon sur ~{arcepGood} %** du trajet
> (couverture théorique ARCEP). {phrase zones blanches}. **Pas encore de mesures de
> voyageurs** ici — activez le mode mesure pour être le premier.

**Tronçon** : idem, en rappelant « portion de {parent} » et que les mesures sont partagées
avec la ligne parente.

### Critère « réel suffisant » — par **couverture spatiale** (pas par total de mesures)

Une ligne peut cumuler beaucoup de pings tous au même endroit (près d'une gare) tout en
restant aveugle sur le reste. On juge donc sur la **répartition le long du trajet** :

- **Cellule fiable** = une cellule H3 (rés. 9, comme l'ingestion) de la ligne avec
  `samples ≥ MIN_SAMPLES_CELL` (défaut **3**) — en dessous, trop peu pour conclure.
- **Couverture** = part du trajet observée par des cellules fiables :
  `coveragePct = coverageKm / lengthKm`, où `coverageKm` = longueur de la ligne couverte
  par les segments réels fiables (projection déjà faite par `/api/coverage/segments`).
- **Réel suffisant** (verdict basé réel) si **`coveragePct ≥ SEUIL_COVERAGE`** (défaut
  **50 %**) **ET** `nFiables ≥ MIN_CELLS` (défaut **8**, garde-fou des lignes courtes).
- **Sinon** → réel « **partiel** » : verdict en tête sur l'**ARCEP**, et on montre le réel
  scopé (« sur la portion mesurée (~{coveragePct} %), les voyageurs constatent… ») +
  invite à mesurer. Jamais présenter un réel partiel comme la vérité du trajet entier.

Tous les seuils sont **paramétrables** (constantes du script de snapshot).

- `goodPct` arrondi entier, borné [0, 100] (réutiliser `pct()` de `coverage-copy.ts`).

## 4. Points noirs (liste des zones à problème)

### Définition

Les endroits où **ça coupe ou ça rame**, **nommés par la gare précédente** (« après {gare} »)
— c'est la longue traîne SEO (chaque gare = une requête potentielle) ET la vraie question
utilisateur (« où ça va galérer ? »).

### Sources & priorité

Pour chaque zone problématique on **préfère le réel**, sinon le théorique :

1. **Réel — coupures mesurées** (`/api/outages` → instantané) : `medianDurationS`,
   `medianLengthM`, position → gare précédente.
2. **Réel — zones « rien » mesurées** (segments `none` de `/api/coverage/segments`) si pas
   d'épisode de coupure associé.
3. **Théorique — zones blanches ARCEP** (`stats.zonesBlanches.zones[]`, déjà calculé avec
   `after` = gare) en repli/complément, labellisé « annoncé ».

### Sélection / tri / format

- **Filtre** : coupures `medianDurationS ≥ 20 s` (sinon bruit, cf. exploration frise) ;
  zones blanches ARCEP `lengthKm ≥ ~2 km`.
- **Fusion** : épisodes à moins de **~4 km** = une seule entrée (garder la pire durée).
- **Tri** : par **gravité** (durée puis longueur).
- **Plafond** : **5 à 7** entrées, avec « +N autres » si dépassement.
- **Nommage gare** : projeter la position sur le profil (`distOf`/`positionAtDist`) →
  retenir la **gare précédente** (« après {gare} »). Helper à factoriser avec
  `whiteZoneStations`.

### Gabarit d'item

- Réel coupure : **`Après {gare} — ça coupe ~{dur}`** _(sur ~{len})_
- Réel zone rien : **`Après {gare} — pas de réseau`** _(~{km} km)_
- Théorique : **`Après {gare} — zone blanche annoncée`** _(~{km} km)_

### Cas vide

Aucune zone → message positif : _« Bonne nouvelle : aucune zone à problème connue sur
{from}–{to}. »_ (et invite à mesurer si réel absent).

### Accessibilité

Vraie liste `<ul>` ; ne pas reposer sur la couleur seule (icône/texte « ça coupe »).

## 5. Théorie ↔ réel (1 phrase)

Sous les points noirs, une phrase qui **incarne le différenciateur** :

> **L'ARCEP annonce {arcepGood} % de bonne couverture ; les voyageurs en constatent
> {realGood} %** ({samples} mesures, dernière {fraîcheur}).

Si pas de réel : on n'affiche pas la comparaison, juste l'invite à contribuer.

## 6. FAQ (cible « Autres questions posées »)

Questions issues du Suggest (gabarits, à décliner par ligne) — alimentent le **JSON-LD
FAQPage** déjà présent :

1. **Y a-t-il du wifi / internet dans le train entre {from} et {to} ?**
   → clarifier : wifi de bord (selon le train) vs **votre réseau mobile** ; donner le verdict.
2. **Comment avoir internet dans le train entre {from} et {to} ?**
   → préchargez, comparez les opérateurs, voici où ça capte.
3. **Quel opérateur capte le mieux entre {from} et {to} ?** → `{bestOperator}` + nuance réel.
4. **Pourquoi on ne capte pas dans le train ?** → tunnels, vitesse, carrosserie, zones rurales.

Réponses **factuelles** (chiffres de la ligne) → contenu unique = bon SEO.

## 7. Données & calcul (SSR, base vive)

### Ce qui existe déjà (build-time, indexable)

- `line-stats.json` (ARCEP par ligne : `best`, `arcep[op]`, `zonesBlanches`, `lengthKm`).
- `route-profiles/<slug>.json` (gares + path + arcep segments).
- Helpers texte : `coverage-copy.ts`.

### Le réel : calculé en **SSR** (décision d'archi — pas de prérendu, pas de cron)

Le `Dockerfile` prérend au **build de l'image**, qui n'a **pas accès à la base** (montée
seulement au runtime). Plutôt qu'un cron nocturne « régénère un instantané committé →
rebuild → redeploy », on rend **ces pages en SSR** : le verdict est calculé **côté serveur
depuis la base vive à chaque requête** → **toujours frais ET indexable** (Google rend le
HTML SSR), zéro pièce mobile. Court `cache-control` (5 min) pour amortir le SSR.

Forme calculée (type `LineReal`, jamais stockée) :

```jsonc
{
	"samples": 7673, // total pings (info, PAS le critère de suffisance)
	"nFiables": 142, // cellules H3 fiables (samples ≥ MIN_SAMPLES_CELL)
	"coveragePct": 63, // part du trajet couverte par des cellules fiables
	"sufficient": true, // coveragePct ≥ SEUIL_COVERAGE ET nFiables ≥ MIN_CELLS
	"lastSeen": 1780300000,
	"goodPct": 78, // (TBC+BC) pondéré mesures, sur la portion mesurée
	"bestOperator": "orange",
	"blackspots": [
		{ "afterStation": "Angoulême", "durationS": 120, "lengthM": 4800, "source": "measured" }
	]
}
```

**Honnêteté** : `sufficient === false` ⇒ on n'affiche pas le réel comme vérité du trajet,
on garde le verdict **ARCEP** en tête et on montre le réel **scopé à la portion mesurée** +
invite à mesurer.

### ✅ Implémenté (socle données, 2026-06-03)

- Module **pur** `src/lib/geo/line-real.ts` (`computeLineReal`) + tests `line-real.test.ts`.
- Helper serveur `src/lib/server/line-real.ts` (`loadLineReal(fetch, slug)`) : lit
  `cell_aggregates` + dérive les coupures (`aggregateOutages`, durées incluses) + calcule.
- Page **SSR** : `src/routes/ligne/[slug]/+page.server.ts` (`prerender = false`) → expose
  `data.real`, court `cache-control`. Le sous-arbre `[operateur]` reste prérendu.
- Helper de nommage de gare `src/lib/geo/station-name.ts` (factorisé avec `build-line-stats`).
- **Reste** : l'UI de la page (rendu du verdict + points noirs, virage vocabulaire §2–6).

## 8. SEO — récap

- `title`/`h1`/`meta` en langage usager (§2), corps riche en 4G/5G/opérateurs.
- Headings = questions (`<h2>` « Où ça coupe entre X et Y ? », « Quel opérateur… »).
- Contenu **unique** par ligne (verdict + points noirs nommés) = anti-« pages coquilles ».
- **JSON-LD FAQPage** (déjà là) enrichi des Q réelles.
- Maillage interne conservé (opérateurs, tronçons, ligne parente).
- Indexation tronçons inchangée (`noindex,follow` pour les minces).
- **Fraîcheur** affichée (« mesuré pour la dernière fois {date} ») = signal + confiance.

## 9. Hors périmètre (plus tard)

- Scrollytelling « visite du trajet » (mode optionnel, quand données plus riches).
- Page **pilier** « comment avoir internet dans le train » (head term) drainant vers les
  pages lignes.
- Multi-opérateur riche (aujourd'hui ~1 opérateur mesuré en prod).

## 10. Critères d'acceptation

- [ ] H1/title/meta en langage usager, sans « couverture mobile 4G » en tête.
- [ ] Verdict présent, ≤ 3 phrases, gros chiffre, basé réel si **couverture suffisante**
      (`coveragePct ≥ SEUIL_COVERAGE` ET `nFiables ≥ MIN_CELLS`), sinon ARCEP + réel scopé.
- [ ] Liste « points noirs » nommés par gare, triés gravité, plafonnés, cas vide géré.
- [ ] Phrase théorie↔réel quand réel dispo.
- [ ] FAQ enrichie + JSON-LD valide.
- [ ] Verdict/points **prérendus** (lisibles sans JS) via l'instantané réel.
- [ ] Honnêteté quand peu de mesures.
- [ ] `bun run check && lint && build` verts ; rendu vérifié desktop + mobile.
