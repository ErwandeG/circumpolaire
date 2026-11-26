# Circumpolaire

Application Windows pour préparer des photos circumpolaires en ville.
Cahier des charges : document « Cahier des charges — Appli circumpolaire ».

## Commandes

| Commande | Effet |
| --- | --- |
| `npm install` | Installe les dépendances et télécharge Electron |
| `npm run dev` | Lance l'appli en développement (rechargement automatique) |
| `npm start` | Construit puis lance l'appli |
| `npm test` | Tests automatiques |
| `npm run typecheck` | Vérification des types TypeScript |

## Organisation

```
src/main/                 processus principal Electron (fenêtre)
src/renderer/index.html   page de l'appli
src/renderer/src/
  domain/                 logique pure, testée sans interface
  services/               accès externes (IGN) et stockage local
  ui/                     carte et recherche
```

## Avancement

- [x] Jalon 1 : socle, carte et lieu
- [ ] Jalon 2 : calendrier lunaire
- [ ] Jalon 3 : ciel à hauteur d'homme
- [ ] Jalon 4 : bâtiments, arbres et relief (LiDAR HD)
- [ ] Jalon 5 : finitions
