# 4G dans le train 🚆📶

> Carte communautaire et **open source** de la couverture mobile (4G/5G) le long des
> lignes de train en France. Découvrez où ça capte sur votre trajet — et contribuez
> vos propres mesures.

**🔗 Démo :** https://4g-dans-le-train.juulieen.fr

## Pourquoi ?

Dans le train, on ne sait jamais à l'avance où le réseau va couper. Les cartes
officielles ARCEP donnent la couverture _théorique_, mais la réalité dans un TGV
lancé à 300 km/h est souvent différente. Ce projet croise :

1. **La couverture officielle ARCEP** (théorique, par opérateur) en fond de carte ;
2. **Les mesures réelles** crowdsourcées par les voyageurs, agrégées de façon anonyme.

## Comment ça marche

- **Mode mesure** (sur mobile) : vous activez le mode, l'app garde l'écran allumé
  (Wake Lock), suit votre position GPS et teste la connexion en continu (ping actif).
  Chaque point est arrondi à une cellule géographique (~150 m) avant envoi — **aucune
  donnée personnelle, aucune trace continue ré-identifiable**.
- **Mode carte** : tout le monde visualise la couverture, filtrable par opérateur.

> ℹ️ La mesure se fait **navigateur ouvert, écran allumé** (limite des navigateurs
> web). Une app native pour la mesure en arrière-plan est envisagée en v2.

## Stack technique

| Brique                | Choix                                               |
| --------------------- | --------------------------------------------------- |
| Framework             | SvelteKit + TypeScript (SSR/prerender pour le SEO)  |
| Carte                 | MapLibre GL JS                                      |
| Base de données       | libSQL (moteur Turso), fichier local ou Turso cloud |
| ORM                   | Drizzle                                             |
| Géospatial            | H3 (binning) + Turf.js (snapping aux lignes)        |
| Runtime / déploiement | Bun + Docker + Caddy (HTTPS Let's Encrypt)          |

## Données sources

- **Tracés ferroviaires** : [SNCF Open Data — formes des lignes du RFN](https://ressources.data.sncf.com/explore/dataset/formes-des-lignes-du-rfn/)
- **Couverture officielle** : [ARCEP — Mon Réseau Mobile](https://data.arcep.fr/)

## Démarrage

```bash
bun install
cp .env.example .env
bun run data:sncf      # importe les tracés ferroviaires
bun run data:arcep     # importe la couverture ARCEP
bun run db:migrate     # crée les tables libSQL
bun run dev            # http://localhost:5173
```

## Déploiement

Voir [`docs/DEPLOY.md`](docs/DEPLOY.md) — Docker Compose + Caddy reverse proxy,
sur le modèle d'un serveur auto-hébergé.

## Contribuer

Les contributions sont bienvenues ! Voir [`CONTRIBUTING.md`](CONTRIBUTING.md).
La meilleure façon de contribuer sans coder : **prenez le train et activez le mode mesure** 🚆

## Licence

[MIT](LICENSE)
