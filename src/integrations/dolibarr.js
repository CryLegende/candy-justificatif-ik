// Intégration Dolibarr : pousser une indemnité dans une note de frais.
//
// Ce fichier est un exemple d'intégration, pas une dépendance. Le reste du module ne l'importe
// jamais. Il est fourni parce que c'est ainsi que Candy Bot exploite ses indemnités, et parce que
// la correspondance des identifiants Dolibarr n'est documentée nulle part de façon lisible.
//
// Ce qu'il faut savoir avant de s'en servir :
//
//  - Le type de frais « indemnité kilométrique » porte l'identifiant 4 (code EX_KME) dans les
//    données de référence livrées avec Dolibarr. Vérifiez-le sur votre instance : un identifiant
//    de table de référence n'est pas une constante universelle.
//  - La catégorie fiscale (`fk_c_exp_tax_cat`) encode la puissance du véhicule. La table livrée
//    range les voitures de 3 CV et moins à 7 CV et plus sur les identifiants 4 à 8.
//  - Dolibarr multiplie lui-même quantité par prix unitaire. On envoie donc la distance en
//    quantité et le taux unitaire du trajet en prix unitaire, pas le montant total.
//  - Le taux unitaire varie d'un trajet à l'autre, parce qu'il porte le franchissement de tranche
//    du barème annuel. C'est normal, et c'est pour cela qu'il est calculé par trajet.

const TYPE_FRAIS_KILOMETRIQUE = 4;

const CATEGORIE_FISCALE_PAR_PUISSANCE = {
  3: 4,
  4: 5,
  5: 6,
  6: 7,
  7: 8,
};

/**
 * Corps de la ligne de note de frais correspondant à une indemnité.
 *
 * @param {object} indemnite résultat de calculerIndemnite() ou entrée du registre
 * @param {{ commentaire?: string, dateOperation?: string }} [options]
 * @returns {object} charge utile pour POST /expensereports/{id}/lines
 */
function construireLigneNoteDeFrais(indemnite, { commentaire = "", dateOperation = null } = {}) {
  const categorie = CATEGORIE_FISCALE_PAR_PUISSANCE[indemnite.puissanceAppliquee];
  if (!categorie) {
    throw new Error(`Aucune catégorie fiscale Dolibarr pour ${indemnite.puissanceAppliquee} CV`);
  }
  return {
    fk_c_type_fees: TYPE_FRAIS_KILOMETRIQUE,
    fk_c_exp_tax_cat: categorie,
    date: dateOperation || indemnite.date,
    qty: indemnite.distanceKm,
    value_unit: indemnite.tauxUnitaire,
    // Franchise ou non, l'indemnité kilométrique ne porte pas de TVA récupérable : le barème est
    // forfaitaire et couvre déjà les taxes.
    vatrate: 0,
    comments: commentaire,
  };
}

/**
 * Commentaire de ligne lisible dans Dolibarr. Y écrire les adresses évite d'avoir à ouvrir le
 * justificatif pour savoir de quel trajet il s'agit.
 */
function construireCommentaire(entree) {
  const morceaux = [entree.motif];
  if (entree.adresseDepart && entree.adresseArrivee) {
    morceaux.push(`${entree.adresseDepart} vers ${entree.adresseArrivee}`);
  }
  if (entree.allerRetour) morceaux.push("aller-retour");
  morceaux.push(`${entree.distanceKm} km`);
  if (entree.baremeLibelle) morceaux.push(entree.baremeLibelle);
  return morceaux.filter(Boolean).join(" - ").slice(0, 250);
}

module.exports = {
  CATEGORIE_FISCALE_PAR_PUISSANCE,
  TYPE_FRAIS_KILOMETRIQUE,
  construireCommentaire,
  construireLigneNoteDeFrais,
};
