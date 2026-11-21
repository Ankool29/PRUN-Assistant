# PRUN Assistant

- L’interface et la documentation sont en français. Conserver les tickers, devises et identifiants FIO.
- Maintenir l’application en lecture seule. Le collecteur emploie uniquement les GET publics déclarés dans `collector/normalize.py`, `collector/history.py` et `collector/navigation.py`. Aucune clé de jeu ni donnée de compte.
- Les jeux de données FIO et fictif ont chacun une source explicite. Conserver les dates d’origine et la distinction entre absence et zéro.
- Valider les changements avec `npm test`, `python -m unittest discover -s tests`, `npm run build` et `npm run test:mobile`.
- Le travail M1 est sur `feature/prun-m1`, à partir de M0 fusionné. Attendre la validation avant toute fusion.
