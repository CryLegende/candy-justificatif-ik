# Indemnités kilométriques

Saisie, calcul au barème fiscal et justificatifs des indemnités kilométriques, en français.

On donne deux adresses, une date et un véhicule. Le module normalise les adresses, calcule
l'itinéraire routier, applique le barème kilométrique en tenant compte du cumul annuel du
véhicule, et produit un justificatif PDF avec la carte du trajet. En fin d'année, il sort un
récapitulatif par véhicule, en PDF ou en CSV.

Ce module a été construit pour [Candy Bot](https://candybot.fr), où il est utilisé en production
dans l'interface d'administration : il produit les justificatifs de tournée des machines et
alimente la comptabilité. Il est publié ici isolé de cette application, sans rien qui lui soit
propre.

## Ce qu'il fait

- **Adresses** normalisées par la Base Adresse Nationale, avec autocomplétion.
- **Distance** par itinéraire routier (OSRM), aller simple ou aller-retour, modifiable à la main.
- **Barème** officiel voitures, thermique et électrique, avec cumul annuel par véhicule,
  progression par tranches et écrêtage de puissance.
- **Justificatif PDF** avec adresses, distance, carte du trajet, véhicule et mentions légales.
- **Récapitulatif annuel** groupé par véhicule, en PDF ou en CSV pour un tableur.
- **Parc de véhicules**, avec la carte grise conservée une fois et rattachée aux justificatifs.

## Démarrer

```bash
git clone https://github.com/CryLegende/candy-justificatif-ik.git
cd candy-justificatif-ik
docker compose up -d --build
```

Interface sur `http://localhost:3200`. Les données vivent dans `./donnees`.

Sans Docker :

```bash
npm install
npm start
```

## Utiliser un morceau plutôt que le tout

Chaque fichier de `src/` se prend isolément et ne dépend de presque rien. Le calcul du barème,
par exemple, ne dépend de rien du tout :

```js
const { calculerIndemnite } = require("./src/bareme");

calculerIndemnite({
  distanceKm: 120,
  puissanceFiscale: 5,
  distanceKmAnterieure: 4900,   // km déjà indemnisés cette année pour ce véhicule
  montantAnterieur: 3116.4,     // euros déjà indemnisés
});
// { montant: 70.74, tauxUnitaire: 0.5895, distanceAnnuelleKm: 5020, ... }
```

Le détail de chaque module, y compris comment brancher le calcul sur votre propre base de
données ou monter l'API dans une application Express existante, est dans
[docs/bibliotheque.md](docs/bibliotheque.md).

Un exemple exécutable de la chaîne complète :

```bash
node exemples/trajet-complet.js "Place du Capitole, Toulouse" "Place de la Comédie, Montpellier"
```

## Organisation

```
src/bareme.js         barème et calcul du montant, sans aucune dépendance
src/registre.js       cumul annuel par véhicule, stockage JSON atomique
src/geocodage.js      Base Adresse Nationale
src/itineraire.js     OSRM
src/carte.js          assemblage de tuiles OSM (sharp, facultatif)
src/justificatif.js   document HTML du justificatif
src/recapitulatif.js  récapitulatif annuel, HTML et CSV
src/vehicules.js      parc et pièces jointes
src/pdf.js            HTML vers PDF (puppeteer, facultatif)
src/integrations/     exemple d'écriture vers Dolibarr
server/app.js         API HTTP, montable dans une application existante
public/               interface, sans framework ni etape de construction
```

## Documentation

- [Le barème](docs/bareme.md) : comment il fonctionne, et comment le mettre à jour chaque année.
- [API HTTP](docs/api.md) : toutes les routes.
- [Utiliser les modules séparément](docs/bibliotheque.md).
- [Déploiement](docs/deploiement.md) : Docker, variables, accès, sauvegarde, OSRM auto-hébergé.

## Ce qu'il ne fait pas

- Il ne traite que les **voitures**. Les barèmes deux-roues et cyclomoteurs ne sont pas
  embarqués, mais `creerBareme()` accepte n'importe quelle table de même forme.
- Il ne suit pas les trajets par GPS. La distance retenue est celle de l'itinéraire théorique
  entre deux adresses, qui est la méthode attendue pour un justificatif.
- Il ne gère ni péages, ni stationnement, ni intérêts d'emprunt. Ces frais se remboursent en
  plus du barème, sur justificatif.
- Il n'envoie rien à un logiciel de comptabilité. `src/integrations/dolibarr.js` montre comment
  construire la ligne, l'envoi reste à votre charge.

## Barème embarqué

Le barème inclus est celui des voitures pour les revenus 2025 (déclaration 2026), vérifié contre
la publication de l'administration. Il est gelé depuis 2022.

Le nouvel arrêté paraît au printemps, pas au 1er janvier : le barème en vigueur reste applicable
jusqu'à parution du suivant. L'interface affiche un rappel de vérification à partir de mars 2027
et refuse les déplacements postérieurs au 31 décembre 2027 tant que les coefficients n'ont pas
été confirmés. La procédure de mise à jour tient en quatre points, dans
[docs/bareme.md](docs/bareme.md).

Ce dépôt est un outil, pas un conseil fiscal. Les montants qu'il produit restent sous votre
responsabilité.

## Tests

```bash
npm test
```

Vingt tests, sans dépendance de test : barème et montants de référence, cumul annuel,
annulations, échappement HTML, format du CSV.

## Licence

MIT.
