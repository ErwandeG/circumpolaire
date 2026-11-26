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
| `npm run dist` | Compile l'exécutable Windows dans `dist/` : installateur et version portable |

## Catalogue d'étoiles

`src/renderer/src/data/stars.json` contient les 15 000 étoiles les plus brillantes (l'appli en affiche
de 1 000 à 15 000), extraites de la [base HYG v4.1](https://github.com/astronexus/HYG-Database)
(licence CC BY-SA 4.0). Pour le régénérer :

```
node scripts/build-stars.mjs <chemin vers hygdata_v41.csv>
```

## Organisation

```
src/main/                 processus principal Electron (fenêtre)
src/renderer/index.html   page de l'appli
src/renderer/src/
  domain/                 logique pure, testée sans interface
  domain/astro/           fenêtre de nuit, Lune, phases, ciel (astronomy-engine)
  domain/geo/             Lambert 93, emprises de bâtiments, repère local
  domain/terrain.ts       surface 3D à partir du MNS/MNT LiDAR HD
  services/               accès externes (IGN) et stockage local
  data/                   catalogue d'étoiles
  ui/                     carte, recherche, calendrier
  ui/sky/                 vue du ciel (three.js), mini-carte, déplacement au clavier
scripts/                  génération du catalogue
```

## Licence

Code sous licence [MIT](LICENSE). Données tierces, sous leur propre licence :

- catalogue d'étoiles `src/renderer/src/data/stars.json` : base HYG v4.1, licence CC BY-SA 4.0 ;
- fond de carte, adresses, LiDAR HD et BD TOPO : IGN, chargés en ligne depuis la Géoplateforme (licence Etalab 2.0).

## Avancement

- [x] Jalon 1 : socle, carte et lieu
- [x] Jalon 2 : calendrier lunaire (tests contre les éphémérides IMCCE, tolérance 2 min)
- [x] Jalon 3 : ciel à hauteur d'homme
- [x] Jalon 4 : bâtiments, arbres et relief (LiDAR HD, BD TOPO en repli)
- [ ] Jalon 5 : finitions
