# Décisions M0

| Décision | Motif |
| --- | --- |
| FIO REST historique, HTTPS et GET publics | Les cinq listes requises répondent sans compte. Le navigateur consomme une seule ressource contrôlée sur Pages. |
| `/exchange/full` comme source unique des cotations et carnets | Les deux viennent de la même réponse et partagent le même horodatage par couple. |
| Instantané complet et écriture atomique | Une réponse illisible, un catalogue vide ou une référence incohérente bloque la nouvelle publication. |
| Relances limitées et requêtes séquentielles | Une seconde entre endpoints, trois essais maximum sur erreur transitoire, délai croissant et respect de `Retry-After` jusqu’à 60 s. |
| Trois heures pour le statut récent | La collecte vise un intervalle de deux heures. Les dates par cotation servent à signaler le retard en amont indépendamment de la collecte. Une avance de plus de cinq minutes donne une fraîcheur indéterminée. |
| Mode fictif manuel | Une panne est visible et l’utilisateur décide d’ouvrir le scénario fictif. |
| Pages construit par GitHub Actions | Les actualisations de prix arrivent dans les artefacts de publication. Elles ne créent aucun commit planifié. |
| Prépublication M0 sur autorisation de la configuration du dépôt | La variable `PRUN_M0_PREVIEW` autorise les déploiements depuis la branche de travail. La planification GitHub démarre après validation et intégration du workflow à `main`. |

## Décisions M1

| Décision | Motif |
| --- | --- |
| Référence monétaire et taux explicites | Les devises du jeu ont des valeurs distinctes. Les taux fournis par le joueur restent des hypothèses. |
| Simulation immédiate et limite présentées séparément | Seule l’exécution immédiate est bornée par les ordres d’achat observés à destination. |
| Historique de 30 jours complets et fenêtre de fraîcheur par carnet | Un instantané récent peut contenir un carnet ancien ou un historique trop peu fourni pour une analyse. |
| Collecte d’historique bornée et recherche manuelle par paire | Le classement initial reste disponible sur Pages avec un nombre limité de requêtes. |
| Prévisualisation par artefact CI | La branche de travail peut être testée pendant la revue et le site Pages principal continue de servir M0. |
