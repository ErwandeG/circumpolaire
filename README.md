# Circumpolaire

Application Windows pour prÃ©parer des photos circumpolaires en ville.
Cahier des charges : document Â« Cahier des charges â€” Appli circumpolaire Â».

## Commandes

| Commande | Effet |
| --- | --- |
| `npm install` | Installe les dÃ©pendances et tÃ©lÃ©charge Electron |
| `npm run dev` | Lance l'appli en dÃ©veloppement (rechargement automatique) |
| `npm start` | Construit puis lance l'appli |
| `npm test` | Tests automatiques |
| `npm run typecheck` | VÃ©rification des types TypeScript |

## Catalogue d'Ã©toiles

`src/renderer/src/data/stars.json` contient les 2 000 Ã©toiles les plus brillantes, extraites de la
[base HYG v4.1](https://github.com/astronexus/HYG-Database) (licence CC BY-SA 4.0). Pour le rÃ©gÃ©nÃ©rer :

```
node scripts/build-stars.mjs <chemin vers hygdata_v41.csv>
```

## Organisation

```
src/main/                 processus principal Electron (fenÃªtre)
src/renderer/index.html   page de l'appli
src/renderer/src/
  domain/                 logique pure, testÃ©e sans interface
  services/               accÃ¨s externes (IGN) et stockage local
  domain/astro/           fenÃªtre de nuit, Lune, ciel (astronomy-engine)
  domain/geo/             Lambert 93, emprises de bÃ¢timents
  domain/terrain.ts       surface 3D Ã  partir du MNS/MNT LiDAR HD
  data/                   catalogue d'Ã©toiles
  ui/                     carte, recherche, calendrier
  ui/sky/                 vue du ciel (three.js)
scripts/                  gÃ©nÃ©ration du catalogue
```

## Licence

Code sous licence [MIT](LICENSE). DonnÃ©es tierces, sous leur propre licence :

- catalogue d'Ã©toiles `src/renderer/src/data/stars.json` : base HYG v4.1, licence CC BY-SA 4.0 ;
- fond de carte, adresses, LiDAR HD et BD TOPO : IGN, chargÃ©s en ligne depuis la GÃ©oplateforme (licence Etalab 2.0).

## Avancement

- [x] Jalon 1 : socle, carte et lieu
- [x] Jalon 2 : calendrier lunaire (tests contre les Ã©phÃ©mÃ©rides IMCCE, tolÃ©rance 2 min)
- [x] Jalon 3 : ciel Ã  hauteur d'homme (sans bÃ¢timents)
- [x] Jalon 4 : bÃ¢timents, arbres et relief (LiDAR HD, BD TOPO en repli)
- [ ] Jalon 5 : finitions
