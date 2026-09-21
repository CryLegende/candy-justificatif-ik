# Utiliser les modules séparément

Chaque fichier de `src/` est autonome et se prend isolément. Les dépendances entre eux se
résument à ceci :

```
bareme.js        aucune dépendance
geocodage.js     aucune dépendance
itineraire.js    geocodage.js
carte.js         geocodage.js (pour le fetch avec délai), sharp (optionnel)
justificatif.js  aucune dépendance
recapitulatif.js justificatif.js (pour l'échappement et le formatage)
registre.js      bareme.js
vehicules.js     registre.js (pour l'écriture atomique et le format d'immatriculation)
pdf.js           puppeteer (optionnel)
```

`sharp` et `puppeteer` sont des dépendances optionnelles. Sans elles, le justificatif sort sans
carte et en HTML au lieu de PDF ; rien d'autre ne change.

## Calculer un montant, et rien d'autre

```js
const { calculerIndemnite } = require("indemnites-kilometriques/src/bareme");

calculerIndemnite({
  distanceKm: 120,
  puissanceFiscale: 5,
  distanceKmAnterieure: 4900,   // km déjà indemnisés cette année, ce véhicule
  montantAnterieur: 3116.4,     // euros déjà indemnisés
});
// { montant: 70.74, tauxUnitaire: 0.5895, distanceAnnuelleKm: 5020, ... }
```

Les deux valeurs d'antériorité viennent de vos données. Si vous les laissez à zéro, vous
calculez un premier trajet de l'année, ce qui surévalue tous les suivants.

## Brancher le calcul sur votre propre base de données

`preparerIndemnite` est pure : elle prend un tableau d'entrées et n'écrit rien. Vos lignes
doivent porter `cleVehicule`, `annee`, `puissanceFiscale`, `electrique`, `distanceKm`, `montant`
et, si vous gérez les annulations, `annuleLe`.

```js
const { preparerIndemnite, normaliserImmatriculation } = require("indemnites-kilometriques/src/registre");

const entrees = (await db.query("select * from indemnites")).rows.map((l) => ({
  cleVehicule: normaliserImmatriculation(l.immatriculation),
  annee: l.annee,
  puissanceFiscale: l.puissance_fiscale,
  electrique: l.electrique,
  distanceKm: Number(l.distance_km),
  montant: Number(l.montant),
  annuleLe: l.annule_le,
}));

const calcul = preparerIndemnite(entrees, {
  date: "2026-09-20",
  immatriculation: "AA-123-BB",
  puissanceFiscale: 5,
  distanceKm: 84.2,
});
```

`normaliserImmatriculation` est la fonction qui fait la clé de cumul : elle retire tirets et
espaces et passe en majuscules. `AA-123-BB` et `aa 123 bb` sont le même véhicule.

## Géocoder et calculer une distance

```js
const { creerItineraire } = require("indemnites-kilometriques/src/itineraire");

const trajet = await creerItineraire({ urlOsrm: "http://osrm.interne:5000" })
  .resoudre({ depart: "Gare de Lyon, Paris", arrivee: "Gare Part-Dieu, Lyon", allerRetour: false });

trajet.distanceKm;   // 465.4
trajet.dureeMinutes; // 296
trajet.geometrie;    // [[lon, lat], ...] pour tracer une carte
```

L'autocomplétion se prend à part, avec `creerGeocodeur().rechercher("...")`.

## Produire un document sans serveur

```js
const { construireHtmlJustificatif } = require("indemnites-kilometriques/src/justificatif");
const { htmlVersPdf, fermerNavigateur } = require("indemnites-kilometriques/src/pdf");

const html = construireHtmlJustificatif({ /* voir exemples/trajet-complet.js */ });
await fs.promises.writeFile("justificatif.pdf", await htmlVersPdf(html));
await fermerNavigateur(); // sinon Chromium reste en mémoire
```

`htmlVersPdf` accepte n'importe quel HTML : rien ne vous oblige à passer par nos gabarits.

## Monter l'API dans une application Express existante

```js
const express = require("express");
const { creerRouteur } = require("indemnites-kilometriques/server/app");

const app = express();
app.use("/frais-kilometriques", monAuthentification, creerRouteur({
  dossierDonnees: "/var/lib/mon-app/ik",
  entreprise: "Exemple SARL",
}));
```

Le routeur pose son propre `express.json()` avec une limite de 16 Mo, parce qu'une carte grise
photographiée passe en base64 dans le corps de la requête.

Si votre application a déjà une authentification, montez le routeur derrière, et laissez
`jeton` vide : deux contrôles d'accès superposés se contredisent tôt ou tard.

## Comptabilité : la ligne Dolibarr

`src/integrations/dolibarr.js` construit la ligne de note de frais correspondant à une
indemnité. Il n'est importé par rien d'autre : c'est un exemple à copier ou à adapter.

```js
const { construireLigneNoteDeFrais, construireCommentaire } = require("indemnites-kilometriques/src/integrations/dolibarr");

const ligne = construireLigneNoteDeFrais(indemnite, { commentaire: construireCommentaire(entree) });
// { fk_c_type_fees: 4, fk_c_exp_tax_cat: 6, qty: 84.2, value_unit: 0.636, vatrate: 0, ... }
```

Dolibarr multiplie quantité par prix unitaire. On envoie donc la distance et le taux du trajet,
pas le montant total. Vérifiez les identifiants de catégorie fiscale sur votre instance : ce
sont ceux des données de référence livrées par défaut, pas une norme.
