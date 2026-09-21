// Barème kilométrique forfaitaire et calcul du montant d'une indemnité.
//
// Ce fichier ne fait ni réseau ni disque. Il ne dépend de rien. C'est volontaire : le barème est
// la seule partie du module qui engage sur le plan fiscal, elle doit rester lisible et testable
// sans monter quoi que ce soit.
//
// Deux règles portent tout le reste :
//
//  1. Le barème est ANNUEL et PROGRESSIF. Les coefficients dépendent du kilométrage parcouru
//     dans l'année avec le véhicule. Un trajet ne vaut donc pas un montant fixe : il vaut la
//     différence entre l'indemnité annuelle après le trajet et celle déjà indemnisée avant. Cette
//     mécanique s'appelle ici le calcul marginal, et c'est elle qui donne le bon total quand un
//     trajet fait franchir une tranche.
//
//  2. La puissance fiscale est écrêtée à l'intervalle [3 CV ; 7 CV]. Le barème publié ne
//     descend pas sous 3 CV et ne monte pas au-dessus de 7 CV : une 9 CV est indemnisée au tarif
//     7 CV. La puissance réelle reste conservée dans le résultat, pour l'afficher au justificatif.

/**
 * Barème officiel français, voitures, applicable aux revenus 2025 (déclaration 2026).
 *
 * Les coefficients du tableau « véhicules électriques » sont ceux publiés par l'administration,
 * déjà majorés de 20 %. Ils ne sont pas obtenus en multipliant le tableau thermique par 1,2 :
 * l'administration publie des valeurs arrondies, et repartir du tableau thermique produit des
 * écarts de quelques centimes.
 *
 * Structure d'une tranche : montant = distance * coefficient + forfait.
 */
const BAREME_2026 = Object.freeze({
  id: "fr-voiture-2026",
  libelle: "Barème kilométrique 2026 (revenus 2025)",
  source: "https://www.impots.gouv.fr/node/4002",
  // Date de déplacement au-delà de laquelle le module refuse de calculer, tant que les
  // coefficients du barème suivant n'ont pas été vérifiés et écrits ici.
  valableJusquAu: "2027-12-31",
  // Date à partir de laquelle l'arrêté suivant est attendu. Sert à afficher un rappel, pas à
  // bloquer. L'arrêté paraît au printemps, jamais au 1er janvier : le barème en vigueur reste
  // applicable jusqu'à parution du suivant.
  aVerifierApres: "2027-03-01",
  puissanceFiscaleMin: 3,
  puissanceFiscaleMax: 7,
  thermique: {
    3: [
      { jusquA: 5000, coefficient: 0.529, forfait: 0 },
      { jusquA: 20000, coefficient: 0.316, forfait: 1065 },
      { jusquA: Infinity, coefficient: 0.37, forfait: 0 },
    ],
    4: [
      { jusquA: 5000, coefficient: 0.606, forfait: 0 },
      { jusquA: 20000, coefficient: 0.34, forfait: 1330 },
      { jusquA: Infinity, coefficient: 0.407, forfait: 0 },
    ],
    5: [
      { jusquA: 5000, coefficient: 0.636, forfait: 0 },
      { jusquA: 20000, coefficient: 0.357, forfait: 1395 },
      { jusquA: Infinity, coefficient: 0.427, forfait: 0 },
    ],
    6: [
      { jusquA: 5000, coefficient: 0.665, forfait: 0 },
      { jusquA: 20000, coefficient: 0.374, forfait: 1457 },
      { jusquA: Infinity, coefficient: 0.447, forfait: 0 },
    ],
    7: [
      { jusquA: 5000, coefficient: 0.697, forfait: 0 },
      { jusquA: 20000, coefficient: 0.394, forfait: 1515 },
      { jusquA: Infinity, coefficient: 0.47, forfait: 0 },
    ],
  },
  electrique: {
    3: [
      { jusquA: 5000, coefficient: 0.635, forfait: 0 },
      { jusquA: 20000, coefficient: 0.379, forfait: 1278 },
      { jusquA: Infinity, coefficient: 0.444, forfait: 0 },
    ],
    4: [
      { jusquA: 5000, coefficient: 0.727, forfait: 0 },
      { jusquA: 20000, coefficient: 0.408, forfait: 1596 },
      { jusquA: Infinity, coefficient: 0.488, forfait: 0 },
    ],
    5: [
      { jusquA: 5000, coefficient: 0.763, forfait: 0 },
      { jusquA: 20000, coefficient: 0.428, forfait: 1674 },
      { jusquA: Infinity, coefficient: 0.512, forfait: 0 },
    ],
    6: [
      { jusquA: 5000, coefficient: 0.798, forfait: 0 },
      { jusquA: 20000, coefficient: 0.449, forfait: 1748 },
      { jusquA: Infinity, coefficient: 0.536, forfait: 0 },
    ],
    7: [
      { jusquA: 5000, coefficient: 0.836, forfait: 0 },
      { jusquA: 20000, coefficient: 0.473, forfait: 1818 },
      { jusquA: Infinity, coefficient: 0.564, forfait: 0 },
    ],
  },
});

/** Barème retenu quand l'appelant n'en fournit pas. */
const BAREME_PAR_DEFAUT = BAREME_2026;

function arrondirEuros(valeur) {
  return Math.round((Number(valeur) + Number.EPSILON) * 100) / 100;
}

function arrondirTaux(valeur) {
  // Le taux unitaire sert de prix unitaire dans un logiciel comptable : 8 décimales pour que
  // taux * distance retombe au centime près sur le montant calculé ici.
  return Math.round(Number(valeur) * 100000000) / 100000000;
}

/**
 * Vérifie la forme d'un barème personnalisé. Utile si vous branchez un autre millésime, un autre
 * type de véhicule (deux-roues) ou un autre pays : la seule contrainte est la structure.
 */
function creerBareme(definition) {
  const bareme = { ...BAREME_PAR_DEFAUT, ...definition };
  for (const energie of ["thermique", "electrique"]) {
    const table = bareme[energie];
    if (!table || typeof table !== "object") {
      throw new Error(`Barème invalide : table "${energie}" absente`);
    }
    for (const [puissance, tranches] of Object.entries(table)) {
      if (!Array.isArray(tranches) || !tranches.length) {
        throw new Error(`Barème invalide : tranches manquantes pour ${puissance} CV (${energie})`);
      }
      const derniere = tranches[tranches.length - 1];
      if (derniere.jusquA !== Infinity) {
        throw new Error(`Barème invalide : la dernière tranche de ${puissance} CV (${energie}) doit aller jusqu'à Infinity`);
      }
    }
  }
  return Object.freeze(bareme);
}

/**
 * Ramène une puissance fiscale saisie à la puissance réellement indemnisable.
 * @returns {{ puissanceFiscale: number, puissanceAppliquee: number, ecretee: boolean }}
 */
function normaliserPuissanceFiscale(valeur, bareme = BAREME_PAR_DEFAUT) {
  const puissanceFiscale = Number(valeur);
  if (!Number.isInteger(puissanceFiscale) || puissanceFiscale < 1 || puissanceFiscale > 99) {
    throw new Error("Puissance fiscale invalide");
  }
  const puissanceAppliquee = Math.min(
    bareme.puissanceFiscaleMax,
    Math.max(bareme.puissanceFiscaleMin, puissanceFiscale),
  );
  return {
    puissanceFiscale,
    puissanceAppliquee,
    ecretee: puissanceAppliquee !== puissanceFiscale,
  };
}

/** Distance arrondie au 100 m, bornée à un intervalle qui exclut les saisies aberrantes. */
function normaliserDistance(valeur) {
  const distanceKm = Number(valeur);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 100000) {
    throw new Error("Distance invalide");
  }
  return Math.round(distanceKm * 10) / 10;
}

/**
 * Indemnité annuelle totale pour un kilométrage annuel donné.
 * C'est la fonction de base du barème : elle n'a pas de mémoire, elle lit une table.
 *
 * @param {number} distanceKm kilométrage cumulé sur l'année avec ce véhicule
 * @param {number} puissanceFiscale puissance en CV portée sur la carte grise
 * @param {{ electrique?: boolean, bareme?: object }} [options]
 * @returns {number} montant en euros, arrondi au centime
 */
function indemniteAnnuelle(distanceKm, puissanceFiscale, options = {}) {
  const { electrique = false, bareme = BAREME_PAR_DEFAUT } = options;
  const distance = Math.max(0, Number(distanceKm) || 0);
  if (distance === 0) return 0;
  const { puissanceAppliquee } = normaliserPuissanceFiscale(puissanceFiscale, bareme);
  const table = electrique ? bareme.electrique : bareme.thermique;
  const tranche = table[puissanceAppliquee].find((item) => distance <= item.jusquA);
  return arrondirEuros(distance * tranche.coefficient + tranche.forfait);
}

/**
 * Montant d'UN déplacement, compte tenu de ce qui a déjà été indemnisé dans l'année.
 *
 * Le montant renvoyé est la part marginale : indemnité annuelle après le trajet, moins le total
 * déjà versé. Passer 0 en antériorité donne le montant d'un premier trajet de l'année.
 *
 * @param {object} params
 * @param {number} [params.distanceKmAnterieure] km déjà indemnisés dans l'année pour ce véhicule
 * @param {number} [params.montantAnterieur] euros déjà indemnisés dans l'année pour ce véhicule
 * @param {number} params.distanceKm distance du déplacement à indemniser
 * @param {number} params.puissanceFiscale
 * @param {boolean} [params.electrique]
 * @param {object} [params.bareme]
 */
function calculerIndemnite({
  distanceKmAnterieure = 0,
  montantAnterieur = 0,
  distanceKm,
  puissanceFiscale,
  electrique = false,
  bareme = BAREME_PAR_DEFAUT,
}) {
  const distance = normaliserDistance(distanceKm);
  const distanceAnterieure = Math.max(0, Number(distanceKmAnterieure) || 0);
  const montantDejaVerse = arrondirEuros(Math.max(0, Number(montantAnterieur) || 0));
  const distanceAnnuelle = Math.round((distanceAnterieure + distance) * 10) / 10;
  const indemniteApres = indemniteAnnuelle(distanceAnnuelle, puissanceFiscale, { electrique, bareme });
  const montant = arrondirEuros(indemniteApres - montantDejaVerse);

  // Un montant nul ou négatif ne veut pas dire « trajet gratuit » : il veut dire que l'antériorité
  // fournie est incohérente avec le barème (montant déjà versé supérieur au barème). Refuser est
  // préférable à écrire une ligne fausse dans un registre comptable.
  if (montant <= 0) {
    throw new Error("Montant kilométrique calculé invalide (antériorité incohérente)");
  }

  const puissance = normaliserPuissanceFiscale(puissanceFiscale, bareme);
  return {
    distanceKm: distance,
    distanceKmAnterieure: distanceAnterieure,
    montantAnterieur: montantDejaVerse,
    distanceAnnuelleKm: distanceAnnuelle,
    indemniteAnnuelle: indemniteApres,
    montant,
    // Prix unitaire au kilomètre pour ce trajet précis. Il varie d'un trajet à l'autre : c'est
    // normal, il porte le franchissement de tranche.
    tauxUnitaire: arrondirTaux(montant / distance),
    puissanceFiscale: puissance.puissanceFiscale,
    puissanceAppliquee: puissance.puissanceAppliquee,
    puissanceEcretee: puissance.ecretee,
    electrique: electrique === true,
    baremeLibelle: bareme.libelle,
  };
}

module.exports = {
  BAREME_2026,
  BAREME_PAR_DEFAUT,
  arrondirEuros,
  calculerIndemnite,
  creerBareme,
  indemniteAnnuelle,
  normaliserDistance,
  normaliserPuissanceFiscale,
};
