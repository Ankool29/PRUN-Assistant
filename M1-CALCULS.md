# Scanner commercial M1

## Audit de départ

La [PR #1](https://github.com/Ankool29/PRUN-Assistant/pull/1) était fusionnée au démarrage. La branche M1 part de `origin/main` à `008df38`. Le 21 novembre 2026 à 17:27 UTC, l’[instantané M0 sur Pages](https://ankool29.github.io/PRUN-Assistant/data/fio.json) a répondu HTTP 200. Sa collecte datait de 17:15:40 UTC. Sur 2 214 cotations, 1 152 avaient moins de trois heures et 1 062 étaient plus anciennes.

FIO a répondu HTTP 200 aux deux variantes de l’historique CXPC, avec et sans horodatage de départ. La racine est un tableau d’objets mêlant plusieurs intervalles. M1 retient `Interval = DAY_ONE` et les jours UTC complets. `DateEpochMs` est le début UTC de la bougie en millisecondes. `Open`, `Close`, `High` et `Low` sont des prix unitaires. Dans le premier enregistrement observé de la série AL.AI1, `Traded = 608` et `Volume = 340619` pour une fourchette de 525 à 577 par unité. Le scanner traite donc `Traded` comme la quantité en unités et `Volume` comme le montant échangé dans la devise de la bourse. [Documentation FIO](https://doc.fnar.net/) · [Exemple CXPC](https://rest.fnar.net/exchange/cxpc/AL.AI1/1793500000000)

La collecte par défaut choisit au plus quatre paires par bourse parmi les carnets récents dont la dernière transaction remonte à moins de sept jours. Le classement de sélection utilise le minimum des profondeurs connues des deux côtés et départage les égalités par la date de dernière transaction. L’essai réel a publié 24 séries sans erreur. Certaines séries contiennent peu de journées négociées et sont écartées par le moteur. Une requête à la demande par paire filtrée complète cette couverture. Elle utilise uniquement le GET public du même endpoint via CORS, sans identifiant ni clé. La collecte Pages reste indépendante des erreurs individuelles d’historique.

## M1-A · Arbitrage

Le moteur élimine les carnets et instantanés anciens ou d’âge indéterminé, selon le seuil M0 de trois heures. Une quantité inconnue, nulle ou non entière ne contribue pas à la profondeur. Les prix doivent être finis et strictement positifs. Un côté du carnet est écarté lorsque son meilleur niveau de quantité connue sort de la fourchette de 1/20 à 20 fois le prix moyen FIO, ou le dernier prix si la moyenne manque. Cette règle peut écarter une cotation atypique authentique.

Les prix d’achat sont parcourus de l’offre la moins chère à la plus chère. La revente immédiate commence par la demande la plus chère et descend. Le simulateur apparie les unités à l’intersection des niveaux, y compris les exécutions partielles. Il prend le préfixe entier qui maximise le bénéfice net, sous les contraintes de capital, de quantité et de rendement. La profondeur minimale filtre le plus petit cumul des volumes d’achat et de revente connus. La marge unitaire décroissante permet de s’arrêter quand un résultat admissible existe et que les unités suivantes ne peuvent plus l’améliorer. Pour atteindre la quantité minimale, le moteur peut conserver des unités à marge individuelle nulle ou négative si le trajet complet reste bénéficiaire.

Tous les calculs utilisent la devise de référence. Un taux explicite donne la valeur d’une unité de devise locale en devise de référence. Une devise sans taux est écartée, sauf la devise de référence elle-même qui vaut 1.

| Montant | Calcul |
| --- | --- |
| Achat et revente | Somme du prix unitaire converti × quantité exécutée côté achat ou côté revente |
| Bénéfice brut | Revente − achat |
| Frais | Achat × taux d’achat, puis revente × taux de vente |
| Transport | Montant fixe + quantité × coût par unité |
| Capital mobilisé | Achat + frais d’achat + transport |
| Bénéfice net | Revente − frais de vente − capital mobilisé |
| Rendement | Bénéfice net ÷ capital mobilisé |

Exemple reproductible. Avec cinq unités achetées à 5 et revendues à raison de trois à 9 et deux à 8, le brut vaut 18. Avec 10 % de frais à l’achat et à la vente, et 1 + 0,50 par unité de transport, le capital vaut 31 et le bénéfice net 7,70. L’unité suivante coûterait 7 et n’aurait plus de marge positive après frais et transport.

En mode **Ordre limite futur**, seule la capacité d’achat est simulée sur le carnet. La revente est conditionnée au prix saisi ou à la meilleure offre de vente à destination. La quantité de demande observée sert uniquement au filtre de profondeur et au score. Le bénéfice affiché dépend d’une exécution future. En mode immédiat, prix et volumes observés peuvent changer avant l’arrivée du fret.

## M1-B · Spéculation

- Au moins 14 clôtures valides sur les 30 derniers jours complets et au moins 7 rendements entre jours adjacents. La dernière clôture valide doit dater d’au plus trois jours UTC. Une clôture sans transaction n’alimente pas les prix. Un jour absent reste absent.
- Une observation est écartée si son écart à la médiane dépasse le plus grand de 15 % de la médiane et six écarts absolus médians normalisés (MAD × 1,4826), ou si elle sort de la fourchette de 1/20 à 20 fois la médiane. L’écart-type quotidien est l’écart-type échantillonnal des rendements logarithmiques entre jours adjacents. La tendance donne la variation quotidienne d’une régression des logarithmes des clôtures sur le temps.
- La décote minimale est le maximum de 5 % et de 1,5 fois le MAD normalisé rapporté à la médiane. Le simulateur part des meilleures offres d’achat pour l’utilisateur et ne dépasse pas le prix d’entrée compatible avec cette décote, les frais et le rendement neutre minimal.
- La quantité est bornée par le carnet, le capital, les filtres et le volume quotidien médian. Les jours à volume zéro, quand FIO les publie, comptent dans ce volume. Les scénarios réutilisent les frais de transaction et supposent une revente sur la même bourse.
- Les prix de revente pessimiste, neutre et optimiste correspondent aux quantiles empiriques 20 %, 50 % et 80 % des clôtures valides, interpolés linéairement. Les quantiles fournissent des hypothèses de prix, sans donner de probabilité ni de délai d’exécution.

## Classements et limites

Le classement utilise le bénéfice net, le rendement ou un score de risque de 0 à 100, avec les valeurs faibles en premier pour le risque. En arbitrage, le score ajoute l’âge relatif des cotations (jusqu’à 20 points), la part de profondeur consommée (40), l’ordre limite (30) et le change entre bourses (10). En spéculation, il combine âge (15), part du volume médian (25), volatilité plafonnée à 20 % par jour (25), manque de couverture (15) et perte dans le scénario pessimiste (20). Ce score est une heuristique, sans calibration statistique.

Le moteur emploie les nombres JavaScript et arrondit pour l’affichage. Les frais de 1 % par côté et le transport nul au premier chargement sont des hypothèses modifiables. Chaque ligne utilise le capital indépendamment des autres lignes. Les analyses partagent donc potentiellement le même capital et les mêmes ordres. Les frais fixes atypiques, taxes, disponibilités de fret et délais de transfert du jeu doivent être évalués par le joueur. Le scanner n’envoie aucun ordre ni transaction.

## Reproduction et prévisualisation

```sh
npm ci
python -m collector.collect
python -m collector.history
npm test
python -m unittest discover -s tests
npm run build
npx playwright install --with-deps chromium
npm run test:mobile
npm run preview
```

La CI dépose un artefact `prun-m1-preview` après les tests. Lors d’un push sur la branche M1, elle essaie d’actualiser les deux instantanés avant l’emballage. Pour ouvrir un artefact téléchargé, extraire le dossier puis servir son contenu via `python -m http.server --directory dossier-extrait 8000`. Les fichiers de l’artefact contiennent les instantanés réels de la branche et le scénario fictif intégré. Rafraîchir les instantanés localement avec les commandes ci-dessus pour réactiver l’analyse s’ils dépassent trois heures. La branche M1 ne déploie pas sur l’URL de production.
