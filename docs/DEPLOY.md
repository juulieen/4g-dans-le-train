# Déploiement

Auto-hébergement sur un serveur perso, sur le modèle des autres apps `*.juulieen.fr` :
**Docker Compose** pour l'app + **Caddy** (reverse proxy + HTTPS Let's Encrypt) côté hôte.

## Déploiement continu (automatique) — le cas normal

**Tout push sur `main` déploie automatiquement en prod.** Le workflow
`.github/workflows/deploy.yml` tourne sur un **runner self-hosted** (le serveur) et
exécute, à chaque push sur `main` :

```yaml
- uses: actions/checkout@v4
  with: { clean: false } # CRITIQUE : préserve ./data (base libSQL gitignorée)
- run: docker compose up -d --build # build + (re)démarrage du conteneur
- run: docker compose exec -T 4g-dans-le-train bun run scripts/migrate.ts # migrations APRÈS le build
```

Donc : **merger une PR dans `main` suffit** — le build, le redémarrage **et les
migrations** (additives) sont appliqués sans intervention. Pas besoin de SSH pour une
mise à jour. Suivre l'avancement : `gh run watch` ou l'onglet Actions du dépôt.

> Toute migration doit rester **additive** (colonnes nullables, pas de `DROP`) : elle
> s'applique automatiquement sur la base de prod en place, sans backup préalable.

L'**installation initiale** ci-dessous (Caddy, DNS, runner, premier import de données)
reste manuelle ; les mises à jour suivantes sont automatiques.

## Installation initiale (une fois)

## Prérequis

- Docker + Docker Compose sur le serveur.
- Caddy déjà installé sur l'hôte, gérant les sous-domaines `*.juulieen.fr`.
- Le DNS `4g-dans-le-train.juulieen.fr` pointant vers le serveur.

## 1. Build & run

```bash
git clone https://github.com/juulieen/4g-dans-le-train.git
cd 4g-dans-le-train
docker compose up -d --build
```

L'app écoute en local sur `127.0.0.1:3101` (voir `docker-compose.yml`).

## 2. Migrations de la base

La base libSQL vit dans le bind-mount `./data/local.db` (persiste aux redéploiements).
Appliquer les migrations une fois la première image lancée :

```bash
docker compose exec 4g-dans-le-train bun run scripts/migrate.ts
```

> ⚠️ Comme pour ttt-chrono : ne jamais supprimer le dossier `./data`. Si vous
> utilisez un runner CI avec `actions/checkout`, mettez `clean: false` pour ne
> pas effacer la base gitignorée.

## 3. Reverse proxy Caddy

Ajouter le bloc de `Caddyfile.example` au `Caddyfile` de l'hôte :

```
4g-dans-le-train.juulieen.fr {
    reverse_proxy localhost:3101
}
```

Puis recharger Caddy :

```bash
sudo systemctl reload caddy
```

Le HTTPS est provisionné automatiquement. C'est requis pour la géolocalisation et
le Wake Lock (API disponibles uniquement en contexte sécurisé).

## 4. Données

Avant ou après le premier déploiement, importer les tracés ferroviaires :

```bash
docker compose exec 4g-dans-le-train bun run data:sncf
```

Pour la couche ARCEP, voir [`DATA.md`](DATA.md).

## Mise à jour

**Automatique** : un push (ou un merge de PR) sur `main` déclenche le workflow Deploy
(build + migrations), cf. « Déploiement continu » en tête de document. Rien à lancer
à la main.

En **secours** (runner indisponible), le déploiement manuel équivalent reste :

```bash
git pull
docker compose up -d --build
docker compose exec 4g-dans-le-train bun run scripts/migrate.ts
```

La base reste intacte (bind-mount `./data`).
