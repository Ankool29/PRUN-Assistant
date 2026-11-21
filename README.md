# PRUN Assistant

Application de consultation en français pour Prosperous Universe. Le tableau de bord présente les bourses et l’état des données. Les vues Marchés, Matériaux et Production donnent accès aux prix, carnets d’ordres, ressources, bâtiments et recettes. Le Scanner commercial propose des simulations d’arbitrage et des scénarios fondés sur les historiques de prix.

## Installation locale

Prérequis. Node.js 22.18 ou ultérieur (24 en CI), npm et Python 3.12.

```sh
npm ci
npm run dev
```

Le dépôt contient un instantané FIO réel utilisable dès le premier lancement. Pour mettre à jour les données du scanner, exécuter `python -m collector.collect` puis `python -m collector.history` à la racine. Le bouton **Actualiser** recharge l’instantané hébergé. Le bouton **Démo** affiche le jeu de données fictif avec un bandeau persistant.

## Tests

```sh
npm test
python -m unittest discover -s tests
npm run build
npx playwright install --with-deps chromium
npm run test:mobile
```

Les tests d’interface utilisent le build sous `/PRUN-Assistant/`, en portrait et paysage avec navigation tactile simulée. Un Chromium local peut être sélectionné avec `PRUN_CHROMIUM_EXECUTABLE`.

## GitHub Pages

Choisir **Settings → Pages → Build and deployment → Source → GitHub Actions**. Le workflow compile et teste les PR et les modifications poussées sur `feature/prun-m0`, `feature/prun-m1` ou `main`. Sur `main`, il collecte aussi les données FIO et déploie après succès. La planification vise une collecte toutes les deux heures à la minute 23 UTC dès que le workflow est intégré à la branche principale.

Pour publier le jalon depuis `feature/prun-m0` avant la fusion, définir la variable Actions `PRUN_M0_PREVIEW=true`, autoriser cette branche dans l’environnement `github-pages`, puis pousser la branche. Après validation, retirer cette variable et limiter l’environnement de publication à `main`. Le workflow utilise uniquement les permissions natives de GitHub Actions pour publier Pages. Aucune configuration de secret FIO n’est requise.

## Limites

- Les cotations FIO proviennent de contributions communautaires. Une collecte récente peut contenir des observations anciennes. L’âge de la cotation s’affiche sur chaque ligne, et le détail expose aussi la date de dernière transaction.
- Les dates sont en UTC. Les données FIO dépassant trois heures portent la mention **anciennes**. Une panne du collecteur laisse le dernier déploiement disponible avec sa date d’origine.
- Les carnets reflètent les ordres publics observés par FIO. Les prix et quantités absents demeurent indisponibles. Chaque prix est exprimé dans la devise de sa bourse.
- Le débit par heure découle des extrants et de la durée de la recette. Il s’agit du débit nominal, avant bonus, main-d’œuvre effective et conditions planétaires.
- Les libellés propres au jeu proviennent de FIO, qui transmet notamment des noms anglais. L’interface est indépendante du jeu et fonctionne en lecture seule.
- GitHub peut retarder sa planification. Sur un dépôt public inactif, GitHub peut également suspendre les déclenchements planifiés.

Voir [l’audit FIO](FIO-AUDIT.md), [l’architecture](ARCHITECTURE.md), [les décisions](DECISIONS.md) et [la feuille de route](ROADMAP.md).

Voir le [rapport M1](M1-CALCULS.md) pour les formules, les limites des scénarios et la prévisualisation du build CI.

Voir le [rapport M1.2 sur la navigation](M1.2-NAVIGATION.md) pour les exclusions, les relevés SFC et les prix FIO du carburant.

L’onglet **Circuits multidevises** compare la conservation des devises, la clôture en devise initiale et la conversion monétaire directe à partir de relevés FXOB. [Mode d’emploi et calculs M1.3](M1.3-CHANGE.md)

Le [rapport du correctif du scanner](CORRECTIF-SCANNER.md) détaille la reproduction, la fraîcheur et les écarts consultables sans change.

[Rejeu FIO et catégories du correctif M1.3.1](M1.3.1-CIRCUITS.md)
