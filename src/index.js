// Point d'entrée de la bibliothèque : tout ce qui est utilisable depuis un autre projet.
//
// Les modules sont indépendants les uns des autres, à une exception près : `registre` a besoin de
// `bareme`. Vous pouvez donc n'en prendre qu'un morceau :
//
//   const { calculerIndemnite } = require("indemnites-kilometriques/src/bareme");
//   const { creerItineraire } = require("indemnites-kilometriques/src/itineraire");
//
// La chaîne complète (adresses, itinéraire, barème, justificatif) est assemblée par
// `creerServiceIk`, qui n'est rien d'autre qu'un raccourci sur les modules ci-dessous.

const bareme = require("./bareme");
const registre = require("./registre");
const geocodage = require("./geocodage");
const itineraire = require("./itineraire");
const carte = require("./carte");
const justificatif = require("./justificatif");
const recapitulatif = require("./recapitulatif");
const vehicules = require("./vehicules");
const pdf = require("./pdf");

/**
 * Assemble les modules en un service prêt à l'emploi.
 *
 * @param {object} options
 * @param {string} options.dossierDonnees dossier où vivent les fichiers JSON et les pièces
 * @param {string} [options.urlBan] instance BAN, si vous en hébergez une
 * @param {string} [options.urlOsrm] instance OSRM, si vous en hébergez une
 * @param {string} [options.urlTuiles] serveur de tuiles, si vous en hébergez un
 * @param {object} [options.bareme] barème à appliquer, par défaut le barème français en vigueur
 * @param {string} [options.entreprise] raison sociale imprimée sur les documents
 */
function creerServiceIk({
  dossierDonnees,
  urlBan,
  urlOsrm,
  urlTuiles,
  bareme: baremeChoisi = bareme.BAREME_PAR_DEFAUT,
  entreprise = "",
}) {
  const registreIk = registre.creerRegistre({ dossier: dossierDonnees });
  const parc = vehicules.creerParc({ dossier: dossierDonnees });
  const routeur = itineraire.creerItineraire({ urlOsrm, urlBan });
  const geocodeur = geocodage.creerGeocodeur({ urlBan });

  return {
    bareme: baremeChoisi,
    entreprise,
    registre: registreIk,
    parc,
    geocodeur,
    itineraire: routeur,

    /** Distance et tracé entre deux adresses. */
    resoudreTrajet(trajet) {
      return routeur.resoudre(trajet);
    },

    /** Montant d'un déplacement, sans rien enregistrer. */
    apercu(params) {
      return registreIk.preparer({ ...params, bareme: baremeChoisi });
    },

    /** Carte du trajet en PNG data URI, ou null. */
    carteDuTrajet(geometrie) {
      return carte.construireCartePng(geometrie, { urlTuiles });
    },

    /** Justificatif HTML d'un déplacement. */
    justificatifHtml(donnees) {
      return justificatif.construireHtmlJustificatif({
        entreprise,
        baremeLibelle: baremeChoisi.libelle,
        ...donnees,
      });
    },

    /** Récapitulatif annuel HTML. */
    recapitulatifHtml(annee, options = {}) {
      return recapitulatif.construireHtmlRecapitulatif({
        annee,
        entrees: registreIk.lister({ annee }),
        entreprise,
        baremeLibelle: baremeChoisi.libelle,
        ...options,
      });
    },
  };
}

module.exports = {
  ...bareme,
  ...registre,
  ...geocodage,
  ...itineraire,
  ...carte,
  ...justificatif,
  ...recapitulatif,
  ...vehicules,
  ...pdf,
  creerServiceIk,
};
