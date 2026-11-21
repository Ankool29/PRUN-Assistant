# Audit de FIO REST

Contrôle du 21 novembre 2026 entre 16:40 et 16:43 UTC par requêtes HTTPS GET sans en-tête d’authentification. Toutes les routes ci-dessous ont renvoyé HTTP 200 et du JSON. Les comptes indiquent la capture observée. [Documentation FIO REST](https://doc.fnar.net/)

| Route et racine JSON | Observation et champs exploités |
| --- | --- |
| [`/material/allmaterials`](https://rest.fnar.net/material/allmaterials), tableau | 370 objets. `Ticker`, `Name`, `CategoryName` sont des chaînes. `Weight` et `Volume` sont des nombres, parfois fractionnaires. |
| [`/exchange/station`](https://rest.fnar.net/exchange/station), tableau | 6 objets. `ComexCode`, `ComexName`, `Name`, `CurrencyCode` et `CurrencyDecimals` décrivent la bourse. `Name` désigne la station. |
| [`/exchange/full`](https://rest.fnar.net/exchange/full), tableau | 2 214 couples `MaterialTicker`, `ExchangeCode`, avec `Currency` et `Timestamp` ISO. `Price`, `PriceAverage`, `Bid`, `Ask`, `MMBuy`, `MMSell` alimentent les prix. `Supply` et `Demand` sont des quantités entières. `PriceTimeEpochMs` est en millisecondes Unix et peut être nul. |
| [`/building/allbuildings`](https://rest.fnar.net/building/allbuildings), tableau | 88 objets. `Ticker`, `Name`, `AreaCost`, cinq champs de main-d’œuvre de `Pioneers` à `Scientists`, `Expertise` parfois nul. `BuildingCosts` contient `CommodityTicker` et `Amount`. |
| [`/recipes/allrecipes`](https://rest.fnar.net/recipes/allrecipes), tableau | 404 objets. `BuildingTicker`, `StandardRecipeName`, `RecipeName`, `TimeMs` et tableaux `Inputs`, `Outputs` de couples `Ticker`, `Amount`. Trois recettes avaient les deux tableaux vides. |
| [`/exchange/all`](https://rest.fnar.net/exchange/all), tableau | 2 214 résumés sans carnets ni `Timestamp` par cotation. Vérifié pour comparaison. |
| [`/exchange/AL.AI1`](https://rest.fnar.net/exchange/AL.AI1), objet | Même structure détaillée qu’un objet de `/exchange/full`. Vérifié pour comparaison. |

Dans la capture de `/exchange/full`, 536 prix de vente et 770 prix d’achat étaient `null`. Les tableaux `BuyingOrders` et `SellingOrders` comprennent `ItemCost` et `ItemCount`. Des ordres de teneurs de marché avaient `ItemCount: null` (260 achats et 40 ventes). L’application affiche ces quantités comme non indiquées et les prix manquants avec un tiret. Les identifiants d’ordres et de sociétés, les noms des sociétés et les noms des contributeurs sont omis de l’instantané distribué.
