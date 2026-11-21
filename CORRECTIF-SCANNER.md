# Correctif du scanner · fraîcheur, devises et écarts bruts

## Reproduction

Audit du 21 novembre 2026. L’instantané effectivement servi par la prévisualisation indiquait `collectedAt = 2026-11-21T19:31:24+00:00`. Il contenait 369 matériaux cotés sur chacune des six bourses, soit 2 214 carnets et 11 070 comparaisons orientées. Empreinte SHA-256 du fichier téléchargé `001ebab9b4582555845da64fa33fae8fc3fa07659af72528601d7bcc755235b8`. L’adresse ci-dessous sert le dernier instantané et son contenu évolue. [Instantané publié](https://ankool29.github.io/PRUN-Assistant/preview/m1/data/fio.json)

Le code M1.2, exécuté sur cet instantané à **20:29:44,760 UTC** en mode **Toutes les bourses**, référence **AIC** et taux vides, reproduit exactement **7 208 exclusions de fraîcheur**, **3 862 exclusions de change** et **0 comparaison commerciale**. Cette horloge de rejeu reproduit les compteurs communiqués. Elle ne constitue pas une mesure de l’heure du téléphone. À l’heure du téléchargement, le même scénario donnait 7 304 et 3 766, car des carnets avaient franchi le seuil de trois heures. [Code M1.2 utilisé pour le rejeu](https://github.com/Ankool29/PRUN-Assistant/blob/5c60f88e7b1dd4af43bf4dcda4f1d64a52bccbd9/src/scanner/arbitrage.ts)

Le premier motif était choisi dans l’ordre achat puis revente. Un taux absent sur le côté achat pouvait masquer l’ancienneté du côté revente. Après vérification des **deux** dates en premier, **8 320** comparaisons sont effectivement écartées pour ancienneté à l’heure de rejeu.

## Horodatages et devises

- Les **2 214** valeurs `Timestamp` de la capture directe FIO utilisent `Z`. Les **2 214** dates `observedAt` de l’instantané déployé utilisent `+00:00` avec des millisecondes. Aucun de ces deux ensembles ne contient de date absente ou invalide. La capture directe a 369 valeurs `PriceTimeEpochMs` nulles. Ce dernier champ est la date de transaction, distincte de l’observation du carnet. [Carnets FIO](https://rest.fnar.net/exchange/full)
- Au rejeu, **897 carnets** de l’instantané sont récents et **1 317** ont plus de trois heures. La date de collecte de l’instantané est contrôlée séparément. Le seuil de trois heures reste en vigueur. Une date future de plus de cinq minutes est indéterminée. Le collecteur et le navigateur contrôlent le calendrier et le fuseau, y compris les décalages horaires et les fractions de seconde. Une date de carnet absente, invalide ou sans fuseau conserve ce statut sur le carnet concerné. La collecte et la dernière transaction ne servent jamais à la remplacer.
- Le change est nécessaire pour exprimer un prix dans une autre devise. Une paire CIS–CIS ou NCC–NCC est directement comparable dans sa devise locale. Avec un capital AIC et sans taux, cette marge locale peut être montrée, mais elle ne peut pas être engagée avec le budget AIC. Le bouton **Évaluer en CIS/NCC** ouvre le calcul dans la devise native avec son propre budget. Le budget d’une autre devise n’est pas repris.
- L’OpenAPI public FIO audité ne présente aucune route FX. La source proposée est **APEX FX** pour la matrice et **FXOB** pour les ordres ouverts. Les taux saisis représentent la valeur d’une unité de la devise locale dans la devise de référence. Ils sont mémorisés par référence et par source dans le navigateur. Ce sont des hypothèses de conversion. L’application ne déduit ni réciproque ni parité depuis d’autres marchés. Un taux invalide affecte uniquement les paires qui en dépendent. [Documentation FIO](https://doc.fnar.net/) · [Guide officiel du change](https://handbook.apex.prosperousuniverse.com/tutorials/legacy-tutorials/foreign-exchange/)

| Bourse | Code | Devise |
| --- | --- | --- |
| Antares | AI1 | AIC |
| Benten | CI1 | CIS |
| Arclight | CI2 | CIS |
| Hortus | IC1 | ICA |
| Moria | NC1 | NCC |
| Hubur | NC2 | NCC |

## Résultats du correctif sur le même instantané

Mode global, vente immédiate, capital de simulation 100 000 dans la référence choisie, frais de marché de 1 % par côté, 1 à 1 000 unités, liquidité minimale de 1, rendement minimal de 0 %, transport et taux de change vides.

| Étape | Capital AIC | Capital CIS | Capital NCC |
| --- | ---: | ---: | ---: |
| Paires dans le périmètre | 11 070 | 11 070 | 11 070 |
| Deux carnets récents | 2 750 | 2 750 | 2 750 |
| Prix, quantités et liquidité exploitables | 2 329 | 2 329 | 2 329 |
| Paires comparables dans une même devise | 149 | 149 | 149 |
| Comparaisons soumises au calcul commercial | 0 | 61 | 88 |
| Marges positives après frais de marché, avant transport | 0 | 6 | 9 |
| Bénéfices nets disponibles | 0 | 0 | 0 |

Le correctif affiche **9 985 vues brutes**, dont **15 pistes positives en devise locale** sur carnets récents, avant contrôle du capital et du transport. Les écarts peuvent être négatifs. Les deux prix en devises d’origine restent affichés lorsqu’il manque un taux. Une différence monétaire entre deux devises n’est affichée que si elle est convertible. Les prix indicatifs et les dates anciennes sont signalés. Les cas sans transport connu conservent leur marge avant transport et un net indéterminé. Ces résultats dépendent de l’âge des carnets et des réglages et sont susceptibles de changer avec le prochain instantané.

## Vérification

Les tests couvrent les dates FIO UTC et avec décalage, les dates manquantes ou invalides, la frontière des trois heures, la fraîcheur des deux côtés avant change, la comparaison en devise native malgré un capital dans une autre devise, la saisie persistante des taux et l’absence de bénéfice net sans conversion ou transport.

Pour rejouer sur un fichier FIO effectivement téléchargé, passer son chemin et une heure d’audit UTC. Cette commande utilise le vrai code du scanner.

```sh
node --input-type=module - instantane.json 2026-11-21T20:29:44.760Z <<'JS'
import { readFileSync } from 'node:fs'
import { analyzeArbitrage } from './src/scanner/arbitrage.ts'
const data = JSON.parse(readFileSync(process.argv[2], 'utf8'))
for (const currency of ['AIC', 'CIS', 'NCC']) {
  const result = analyzeArbitrage(data.markets, {
    currency, rates: {}, capital: 100_000, buyFee: 0.01, sellFee: 0.01,
    minQuantity: 1, maxQuantity: 1000, minReturn: 0, minLiquidity: 1,
  }, {
    now: Date.parse(process.argv[3]), demo: false, mode: 'immediate', from: '', to: '', target: null,
    departure: { parking: 'AI1', transport: { emptyFixed: null, loadedFixed: null, loadedUnit: null } },
  })
  console.log(currency, result.stages, result.diagnostics, result.localCandidates)
}
JS
```

[Prévisualisation Android](https://ankool29.github.io/PRUN-Assistant/preview/m1/#scanner)
