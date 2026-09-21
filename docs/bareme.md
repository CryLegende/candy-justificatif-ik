# Le barème kilométrique

## Ce que couvre le barème

Le barème forfaitaire couvre la dépréciation du véhicule, les frais de réparation et
d'entretien, les pneumatiques, le carburant ou l'électricité, et les primes d'assurance.

Il ne couvre pas les péages, les frais de stationnement et les intérêts d'emprunt pour l'achat
du véhicule. Ces frais se remboursent en plus, sur justificatif.

Facturer en plus une recharge électrique ou un plein de carburant, c'est compter deux fois la
même dépense : l'énergie est déjà dans le barème.

## Trois choses à comprendre avant de lire le code

### 1. Le barème est annuel et progressif

Les coefficients dépendent du kilométrage parcouru **dans l'année, avec ce véhicule**. Il y a
trois tranches : jusqu'à 5 000 km, de 5 001 à 20 000 km, au-delà de 20 000 km.

Conséquence : un trajet n'a pas de montant propre. Son montant est la différence entre
l'indemnité annuelle après le trajet et ce qui a déjà été indemnisé avant lui.

```js
montant = indemniteAnnuelle(cumul + trajet) - montantDejaIndemnise
```

C'est ce que fait `calculerIndemnite`. Le cas qui le rend visible est le franchissement de
tranche : 4 900 km déjà parcourus en 5 CV, puis un trajet de 200 km, donne 99,30 euros et non
127,20 euros, parce que les 100 derniers kilomètres basculent dans la tranche suivante.

C'est aussi pourquoi le taux au kilomètre varie d'un trajet à l'autre. Ce n'est pas une erreur
d'arrondi, c'est la structure du barème.

### 2. La puissance fiscale est écrêtée

Le barème publié s'arrête à 3 CV en bas et à 7 CV en haut. Une 9 CV est indemnisée au tarif
7 CV, une 2 CV au tarif 3 CV. Le code conserve les deux valeurs : `puissanceFiscale` est celle
de la carte grise, `puissanceAppliquee` celle qui a servi au calcul. Le justificatif mentionne
l'écrêtage quand il y en a un, pour que le lecteur ne croie pas à une erreur de saisie.

### 3. Les coefficients électriques sont publiés, pas calculés

Le tableau électrique correspond à une majoration de 20 %, mais l'administration publie ses
propres valeurs arrondies. Appliquer un facteur 1,2 au tableau thermique donne des écarts de
quelques centimes. Le code embarque donc les deux tableaux tels qu'ils sont publiés.

## Mettre à jour le barème

Le barème vit dans `src/bareme.js`, dans la constante `BAREME_2026`. Le mettre à jour, c'est
modifier ce seul objet :

1. Remplacer les coefficients et forfaits des deux tableaux.
2. Mettre `libelle` à jour (il est recopié dans chaque indemnité enregistrée et imprimé sur les
   documents).
3. Avancer `valableJusquAu` et `aVerifierApres`.
4. Relancer `npm test`. Les tests contiennent des montants de référence : ils échoueront, c'est
   leur rôle. Vérifiez chaque montant contre la publication officielle avant de les corriger.

Deux dates, deux effets différents :

- `aVerifierApres` affiche un rappel dans l'interface. Il n'empêche rien. L'arrêté paraît au
  printemps, pas au 1er janvier, et le barème en vigueur reste applicable jusqu'à parution du
  suivant.
- `valableJusquAu` bloque la saisie des déplacements postérieurs. C'est un garde-fou : calculer
  avec des coefficients qui n'ont pas été vérifiés pour la période, c'est produire un montant
  faux avec l'apparence d'un montant juste.

La règle côté employeur est d'appliquer le barème **en vigueur au moment du remboursement**,
c'est-à-dire le dernier publié, pas un barème à venir.

## Utiliser un autre barème

`creerBareme()` accepte n'importe quelle table de même forme : autre millésime, deux-roues,
autre pays. La seule contrainte est que la dernière tranche de chaque puissance aille jusqu'à
`Infinity`, sans quoi un kilométrage élevé ne tomberait dans aucune tranche.

```js
const { creerBareme, calculerIndemnite } = require("indemnites-kilometriques/src/bareme");

const monBareme = creerBareme({
  id: "fr-moto-2026",
  libelle: "Barème deux-roues 2026",
  puissanceFiscaleMin: 1,
  puissanceFiscaleMax: 5,
  thermique: { 1: [{ jusquA: 3000, coefficient: 0.395, forfait: 0 }, /* ... */ ] },
  electrique: { /* ... */ },
});

calculerIndemnite({ distanceKm: 80, puissanceFiscale: 1, bareme: monBareme });
```

## Sources

- Barème kilométrique : https://www.impots.gouv.fr/node/4002
- Bulletin officiel des finances publiques, frais de véhicule : https://bofip.impots.gouv.fr/
