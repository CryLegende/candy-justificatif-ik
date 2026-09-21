// Registre des indemnités : mémoire annuelle par véhicule, et stockage sur disque.
//
// Pourquoi un registre est indispensable. Le barème étant progressif et annuel (voir bareme.js),
// le montant d'un trajet dépend de tout ce qui a été indemnisé avant lui, sur le même véhicule,
// la même année. Sans mémoire, on ne peut calculer que des premiers trajets.
//
// Le fichier est séparé en deux couches, pour que le stockage disque reste optionnel :
//
//   - `preparerIndemnite(entrees, params)` est PURE. Elle prend le tableau des entrées déjà
//     connues, d'où qu'il vienne (JSON, SQL, API), et rend le calcul complet. Si vous avez déjà
//     une base de données, c'est la seule fonction dont vous avez besoin.
//   - `creerRegistre({ dossier })` ajoute par-dessus un stockage JSON sur disque, écrit de façon
//     atomique. C'est ce que l'API HTTP de ce dépôt utilise.
//
// Format du fichier `<dossier>/indemnites.json` :
//   { "version": 1, "entrees": [ { ... } ] }
//
// Champs d'une entrée (les champs d'adresse et de justificatif sont facultatifs) :
//   id                     identifiant unique (uuid)
//   creeLe                 horodatage ISO 8601 UTC de la saisie
//   date                   date du déplacement, AAAA-MM-JJ
//   annee                  année du déplacement, dérivée de `date`
//   motif                  objet professionnel du déplacement
//   beneficiaire           personne indemnisée
//   vehiculeId             identifiant du véhicule dans le parc, ou null
//   vehiculeLibelle        nom lisible du véhicule
//   immatriculation        immatriculation affichable (AA-123-BB)
//   cleVehicule            immatriculation normalisée, sert de clé de cumul (AA123BB)
//   puissanceFiscale       CV de la carte grise
//   puissanceAppliquee     CV réellement appliqués par le barème (écrêtage 3 à 7)
//   electrique             true si véhicule 100 % électrique
//   distanceKm             distance indemnisée
//   distanceAnnuelleKm     cumul annuel après ce trajet
//   montant                euros dus pour ce trajet
//   tauxUnitaire           montant / distanceKm
//   baremeLibelle          barème appliqué, figé au moment de la saisie
//   adresseDepart          libellé normalisé, ou null
//   adresseArrivee         libellé normalisé, ou null
//   allerRetour            true si la distance compte le retour
//   distanceItineraireKm   distance calculée par l'itinéraire, avant ajustement manuel
//   dureeMinutes           durée estimée de l'aller
//   justificatif           { fichier, genereLe } ou null
//   annuleLe               horodatage ISO si l'indemnité a été annulée
//   motifAnnulation        texte libre
//   payeLe                 horodatage ISO du remboursement

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { calculerIndemnite, BAREME_PAR_DEFAUT } = require("./bareme");

const NOM_FICHIER_REGISTRE = "indemnites.json";
const VERSION_FICHIER = 1;

/**
 * Écriture atomique : on écrit un fichier temporaire, puis on renomme. Un `writeFile` direct
 * interrompu (process tué, disque plein) laisse un JSON tronqué, donc un registre entier perdu.
 * Le rename, lui, est atomique sur un même système de fichiers.
 */
function ecrireJsonAtomique(cible, valeur) {
  const temporaire = `${cible}.tmp`;
  try {
    fs.writeFileSync(temporaire, `${JSON.stringify(valeur, null, 2)}\n`, "utf-8");
    fs.renameSync(temporaire, cible);
    return true;
  } catch (err) {
    try {
      if (fs.existsSync(temporaire)) fs.unlinkSync(temporaire);
    } catch { /* le temporaire n'a plus aucune valeur */ }
    throw err;
  }
}

/** Immatriculation réduite à sa forme comparable : c'est la clé de cumul annuel. */
function normaliserImmatriculation(valeur) {
  return String(valeur || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
}

/** Immatriculation telle qu'elle sera affichée et imprimée. */
function formaterImmatriculation(valeur) {
  return String(valeur || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

/** Date de déplacement en AAAA-MM-JJ, et l'année qui sert au cumul. */
function analyserDate(valeur) {
  const date = String(valeur || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date de déplacement invalide");
  const analysee = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(analysee.getTime()) || analysee.toISOString().slice(0, 10) !== date) {
    throw new Error("Date de déplacement invalide");
  }
  return { date, annee: analysee.getUTCFullYear() };
}

/**
 * Refuse une date que le barème chargé ne couvre pas.
 * Le plafond vient de `valableJusquAu` : au-delà, les coefficients de l'année suivante n'ont pas
 * encore été vérifiés, et calculer quand même serait inventer un montant.
 */
function verifierDateSupportee(date, bareme = BAREME_PAR_DEFAUT, aujourdhui = new Date()) {
  const jour = aujourdhui.toISOString().slice(0, 10);
  if (date > jour) throw new Error("La date du déplacement ne peut pas être dans le futur");
  if (bareme.valableJusquAu && date > bareme.valableJusquAu) {
    throw new Error(
      `Le barème intégré n'est vérifié que jusqu'au ${bareme.valableJusquAu}. `
      + "Mettez à jour les coefficients avant de saisir un déplacement postérieur.",
    );
  }
}

/** Entrées d'un même véhicule, annulations comprises (l'appelant filtre ensuite). */
function entreesDuVehicule(entrees, cleVehicule) {
  return (Array.isArray(entrees) ? entrees : []).filter((e) => e && e.cleVehicule === cleVehicule);
}

/**
 * Calcule ce que vaut un déplacement, en tenant compte du registre fourni.
 * Fonction pure : aucun accès disque, aucun effet de bord. C'est le point d'entrée à utiliser
 * si vos données vivent ailleurs que dans le fichier JSON de ce dépôt.
 *
 * @param {Array} entrees entrées déjà enregistrées (toutes années, tous véhicules)
 * @param {object} params
 * @param {string} params.date date du déplacement, AAAA-MM-JJ
 * @param {string} params.immatriculation
 * @param {number} params.puissanceFiscale
 * @param {boolean} [params.electrique]
 * @param {number} params.distanceKm
 * @param {object} [params.bareme]
 */
function preparerIndemnite(entrees, {
  date,
  immatriculation,
  puissanceFiscale,
  electrique = false,
  distanceKm,
  bareme = BAREME_PAR_DEFAUT,
}) {
  const dateAnalysee = analyserDate(date);
  verifierDateSupportee(dateAnalysee.date, bareme);

  const immatAffichee = formaterImmatriculation(immatriculation);
  const cleVehicule = normaliserImmatriculation(immatriculation);
  if (cleVehicule.length < 4) throw new Error("Immatriculation invalide");

  const estElectrique = electrique === true;
  const duVehicule = entreesDuVehicule(entrees, cleVehicule);

  // Garde-fou : une même plaque ne peut pas changer de puissance ou d'énergie en cours d'année.
  // Si elle le fait, le cumul annuel mélange deux barèmes et le total devient faux sans bruit.
  const incoherente = duVehicule.find((e) => (
    Number(e.puissanceFiscale) !== Number(puissanceFiscale)
    || (e.electrique === true) !== estElectrique
  ));
  if (incoherente) {
    throw new Error("Cette immatriculation existe déjà avec une autre puissance fiscale ou une autre énergie");
  }

  // Une indemnité annulée n'a pas été versée : elle sort du cumul, sinon les trajets suivants
  // partent d'un total fictif et sont sous-évalués.
  const deLAnnee = duVehicule.filter((e) => Number(e.annee) === dateAnalysee.annee && !e.annuleLe);
  const distanceKmAnterieure = deLAnnee.reduce((t, e) => t + (Number(e.distanceKm) || 0), 0);
  const montantAnterieur = deLAnnee.reduce((t, e) => t + (Number(e.montant) || 0), 0);

  const calcul = calculerIndemnite({
    distanceKmAnterieure,
    montantAnterieur,
    distanceKm,
    puissanceFiscale,
    electrique: estElectrique,
    bareme,
  });

  return {
    ...calcul,
    date: dateAnalysee.date,
    annee: dateAnalysee.annee,
    immatriculation: immatAffichee,
    cleVehicule,
    nombreTrajetsAnterieurs: deLAnnee.length,
  };
}

/**
 * Registre adossé à un fichier JSON.
 * @param {{ dossier: string }} options dossier de données, créé s'il n'existe pas
 */
function creerRegistre({ dossier }) {
  if (!dossier) throw new Error("creerRegistre : dossier de données requis");
  const fichier = path.join(dossier, NOM_FICHIER_REGISTRE);

  function lire() {
    if (!fs.existsSync(fichier)) return { version: VERSION_FICHIER, entrees: [] };
    try {
      const contenu = JSON.parse(fs.readFileSync(fichier, "utf-8"));
      return {
        version: Number(contenu.version) || VERSION_FICHIER,
        entrees: Array.isArray(contenu.entrees) ? contenu.entrees : [],
      };
    } catch {
      // Fichier illisible : on rend un registre vide plutôt que de planter au démarrage, mais on
      // n'écrase rien tant que l'appelant n'écrit pas. Le fichier fautif reste sur le disque.
      return { version: VERSION_FICHIER, entrees: [] };
    }
  }

  function ecrire(registre) {
    if (!fs.existsSync(dossier)) fs.mkdirSync(dossier, { recursive: true });
    ecrireJsonAtomique(fichier, { version: VERSION_FICHIER, entrees: registre.entrees });
  }

  return {
    fichier,

    /** Toutes les entrées, de la plus récente à la plus ancienne. */
    lister({ annee = null } = {}) {
      return lire().entrees
        .filter((e) => (annee ? Number(e.annee) === Number(annee) : true))
        .slice()
        .sort((a, b) => String(b.creeLe || b.date || "").localeCompare(String(a.creeLe || a.date || "")));
    },

    /** Années présentes dans le registre, ordre décroissant. */
    annees() {
      return [...new Set(lire().entrees.map((e) => Number(e.annee)).filter(Boolean))]
        .sort((a, b) => b - a);
    },

    /** Une entrée par son identifiant. */
    trouver(id) {
      return lire().entrees.find((e) => e && e.id === id) || null;
    },

    /** Calcul d'un déplacement contre le contenu actuel du registre, sans rien écrire. */
    preparer(params) {
      return preparerIndemnite(lire().entrees, params);
    },

    /**
     * Enregistre une indemnité. Le calcul est refait ici contre l'état du registre au moment de
     * l'écriture : un aperçu affiché il y a dix minutes peut être périmé.
     */
    ajouter(params, complements = {}) {
      const registre = lire();
      const calcul = preparerIndemnite(registre.entrees, params);
      const entree = {
        id: crypto.randomUUID(),
        creeLe: new Date().toISOString(),
        date: calcul.date,
        annee: calcul.annee,
        immatriculation: calcul.immatriculation,
        cleVehicule: calcul.cleVehicule,
        puissanceFiscale: calcul.puissanceFiscale,
        puissanceAppliquee: calcul.puissanceAppliquee,
        electrique: calcul.electrique,
        distanceKm: calcul.distanceKm,
        distanceAnnuelleKm: calcul.distanceAnnuelleKm,
        montant: calcul.montant,
        tauxUnitaire: calcul.tauxUnitaire,
        baremeLibelle: calcul.baremeLibelle,
        ...complements,
      };
      registre.entrees.push(entree);
      ecrire(registre);
      return entree;
    },

    /** Complète une entrée existante (nom du justificatif généré, référence externe, etc.). */
    completer(id, champs) {
      const registre = lire();
      const entree = registre.entrees.find((e) => e && e.id === id);
      if (!entree) return null;
      Object.assign(entree, champs);
      ecrire(registre);
      return entree;
    },

    /**
     * Annule une indemnité sans la supprimer. À préférer à la suppression dès que l'indemnité a
     * été communiquée ou comptabilisée : la pièce reste, la charge disparaît.
     */
    annuler(id, { motif = "", annuleLe = null } = {}) {
      const registre = lire();
      const entree = registre.entrees.find((e) => e && e.id === id);
      if (!entree) return null;
      entree.annuleLe = annuleLe || new Date().toISOString();
      if (motif) entree.motifAnnulation = String(motif).slice(0, 300);
      ecrire(registre);
      return entree;
    },

    /** Horodate le remboursement effectif. */
    marquerPaye(id, { payeLe = null } = {}) {
      const registre = lire();
      const entree = registre.entrees.find((e) => e && e.id === id);
      if (!entree) return null;
      entree.payeLe = payeLe || new Date().toISOString();
      ecrire(registre);
      return entree;
    },

    /** Supprime définitivement une entrée. Réservé aux saisies erronées non transmises. */
    supprimer(id) {
      const registre = lire();
      const index = registre.entrees.findIndex((e) => e && e.id === id);
      if (index < 0) return null;
      const [entree] = registre.entrees.splice(index, 1);
      ecrire(registre);
      return entree;
    },

    /** Totaux d'une année, annulations exclues. */
    totaux(annee) {
      const entrees = lire().entrees.filter((e) => Number(e.annee) === Number(annee) && !e.annuleLe);
      return {
        annee: Number(annee),
        nombre: entrees.length,
        distanceKm: Math.round(entrees.reduce((t, e) => t + (Number(e.distanceKm) || 0), 0) * 10) / 10,
        montant: Math.round(entrees.reduce((t, e) => t + (Number(e.montant) || 0), 0) * 100) / 100,
      };
    },
  };
}

module.exports = {
  NOM_FICHIER_REGISTRE,
  analyserDate,
  creerRegistre,
  ecrireJsonAtomique,
  formaterImmatriculation,
  normaliserImmatriculation,
  preparerIndemnite,
  verifierDateSupportee,
};
