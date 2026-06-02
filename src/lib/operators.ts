/**
 * Opérateur synthétique : mesure faite sur le **Wi-Fi de bord** du train (détecté
 * via `navigator.connection.type`, cf. `src/lib/measure/controller.ts`). On ne
 * crédite alors aucun opérateur mobile, pour ne pas fausser la couverture.
 *
 * Cette valeur appartient à la **couche mesure uniquement** : elle n'entre PAS dans
 * le référentiel SEO `OPERATORS` (`src/lib/geo/lines.ts`) ni dans la couche ARCEP, et
 * elle est **exclue de toutes les vues de couverture mobile** (lectures DB des
 * agrégats : `+page.server.ts`, `/api/coverage`, `/api/coverage/segments`).
 *
 * Constante partagée client/serveur pour éviter qu'un littéral `'wifi-train'` mal
 * orthographié passe inaperçu dans un filtre d'exclusion.
 */
export const WIFI_TRAIN_OPERATOR = 'wifi-train' as const;
