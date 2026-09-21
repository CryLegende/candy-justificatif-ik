// Parc de véhicules : la fiche qui porte la puissance fiscale, et la pièce qui la prouve.
//
// Pourquoi un parc séparé du registre. La puissance fiscale et l'énergie décident du barème
// appliqué. Les ressaisir à chaque déplacement, c'est se tromper une fois sur dix et fausser le
// cumul annuel sans s'en apercevoir, puisque le contrôle de cohérence du registre refuse ensuite
// les saisies suivantes. Une fiche véhicule saisie une fois retire ce risque.
//
// La pièce jointe (en France, la carte grise) est conservée une fois par véhicule et rattachée à
// chaque justificatif produit. Elle établit deux choses qu'un tableau de kilomètres ne dit pas :
// que le véhicule est bien celui déclaré, et que sa puissance fiscale est celle utilisée.
//
// Fichier `<dossier>/vehicules.json` :
//   { "version": 1, "vehicules": [ {
//       "id": "uuid", "libelle": "Voiture perso", "immatriculation": "AA-123-BB",
//       "puissanceFiscale": 5, "electrique": false,
//       "documentNom": "carte-grise.pdf", "documentType": "application/pdf",
//       "ajouteLe": "2026-03-14T08:12:00.000Z"
//   } ] }
// Les octets du document vivent à part, dans `<dossier>/vehicules-documents/<id>`.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ecrireJsonAtomique, formaterImmatriculation, normaliserImmatriculation } = require("./registre");

const NOM_FICHIER_VEHICULES = "vehicules.json";
const DOSSIER_DOCUMENTS = "vehicules-documents";
const VERSION_FICHIER = 1;
const TAILLE_MAX_DOCUMENT = 12 * 1024 * 1024;

// Types acceptés pour la pièce du véhicule. Liste blanche volontaire : ce fichier est renvoyé
// ensuite par l'API, et servir un type arbitraire ouvre la porte à un HTML exécuté dans le
// navigateur de l'utilisateur.
const TYPES_DOCUMENT = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};

function nettoyerTexte(valeur, longueurMax = 80) {
  return String(valeur || "").trim().replace(/\s+/g, " ").slice(0, longueurMax);
}

/** Vérifie une fiche avant écriture, et rend sa forme normalisée. */
function normaliserVehicule(brut) {
  const immatriculation = formaterImmatriculation(brut.immatriculation);
  if (normaliserImmatriculation(immatriculation).length < 4) {
    throw new Error("Immatriculation invalide");
  }
  const puissanceFiscale = Number(brut.puissanceFiscale);
  if (!Number.isInteger(puissanceFiscale) || puissanceFiscale < 1 || puissanceFiscale > 99) {
    throw new Error("Puissance fiscale invalide");
  }
  return {
    libelle: nettoyerTexte(brut.libelle) || immatriculation,
    immatriculation,
    puissanceFiscale,
    electrique: brut.electrique === true,
  };
}

/**
 * Parc adossé à un dossier de données.
 * @param {{ dossier: string }} options
 */
function creerParc({ dossier }) {
  if (!dossier) throw new Error("creerParc : dossier de données requis");
  const fichier = path.join(dossier, NOM_FICHIER_VEHICULES);
  const dossierDocuments = path.join(dossier, DOSSIER_DOCUMENTS);

  function lire() {
    if (!fs.existsSync(fichier)) return { vehicules: [] };
    try {
      const contenu = JSON.parse(fs.readFileSync(fichier, "utf-8"));
      return { vehicules: Array.isArray(contenu.vehicules) ? contenu.vehicules : [] };
    } catch {
      return { vehicules: [] };
    }
  }

  function ecrire(parc) {
    if (!fs.existsSync(dossier)) fs.mkdirSync(dossier, { recursive: true });
    ecrireJsonAtomique(fichier, { version: VERSION_FICHIER, vehicules: parc.vehicules });
  }

  function cheminDocument(id) {
    // `id` vient d'une URL : le réduire aux caractères d'un uuid empêche un ../ de sortir du
    // dossier de données.
    const sur = String(id || "").replace(/[^a-zA-Z0-9-]/g, "");
    if (!sur) throw new Error("Identifiant de véhicule invalide");
    return path.join(dossierDocuments, sur);
  }

  return {
    fichier,

    lister() {
      return lire().vehicules.slice().sort((a, b) => String(a.libelle).localeCompare(String(b.libelle), "fr"));
    },

    trouver(id) {
      return lire().vehicules.find((v) => v && v.id === id) || null;
    },

    ajouter(brut) {
      const parc = lire();
      const fiche = normaliserVehicule(brut);
      const cle = normaliserImmatriculation(fiche.immatriculation);
      if (parc.vehicules.some((v) => normaliserImmatriculation(v.immatriculation) === cle)) {
        throw new Error("Ce véhicule est déjà enregistré");
      }
      const vehicule = {
        id: crypto.randomUUID(),
        ...fiche,
        documentNom: null,
        documentType: null,
        ajouteLe: new Date().toISOString(),
      };
      parc.vehicules.push(vehicule);
      ecrire(parc);
      return vehicule;
    },

    /**
     * Modifie une fiche. Attention : changer la puissance fiscale ou l'énergie d'un véhicule déjà
     * utilisé fait diverger la fiche du registre, qui refusera les saisies suivantes tant que la
     * cohérence n'est pas rétablie. C'est voulu, et c'est le bon endroit pour s'en apercevoir.
     */
    modifier(id, brut) {
      const parc = lire();
      const vehicule = parc.vehicules.find((v) => v && v.id === id);
      if (!vehicule) return null;
      Object.assign(vehicule, normaliserVehicule({ ...vehicule, ...brut }));
      ecrire(parc);
      return vehicule;
    },

    supprimer(id) {
      const parc = lire();
      const index = parc.vehicules.findIndex((v) => v && v.id === id);
      if (index < 0) return null;
      const [vehicule] = parc.vehicules.splice(index, 1);
      ecrire(parc);
      try {
        fs.rmSync(cheminDocument(id), { force: true });
      } catch { /* la fiche est partie, le fichier orphelin ne bloque rien */ }
      return vehicule;
    },

    /**
     * Enregistre la pièce du véhicule (carte grise).
     * @param {string} id
     * @param {{ nom: string, contenuBase64: string }} document
     */
    enregistrerDocument(id, { nom, contenuBase64 }) {
      const parc = lire();
      const vehicule = parc.vehicules.find((v) => v && v.id === id);
      if (!vehicule) return null;

      const nomFichier = nettoyerTexte(nom, 120);
      const extension = path.extname(nomFichier).toLowerCase();
      const type = TYPES_DOCUMENT[extension];
      if (!type) {
        throw new Error(`Format non accepté (${Object.keys(TYPES_DOCUMENT).join(", ")})`);
      }
      const octets = Buffer.from(String(contenuBase64 || "").replace(/^data:[^,]+,/, ""), "base64");
      if (!octets.length) throw new Error("Document vide");
      if (octets.length > TAILLE_MAX_DOCUMENT) {
        throw new Error(`Document trop volumineux (maximum ${Math.round(TAILLE_MAX_DOCUMENT / 1024 / 1024)} Mo)`);
      }

      if (!fs.existsSync(dossierDocuments)) fs.mkdirSync(dossierDocuments, { recursive: true });
      fs.writeFileSync(cheminDocument(id), octets);
      vehicule.documentNom = nomFichier;
      vehicule.documentType = type;
      ecrire(parc);
      return vehicule;
    },

    /** Octets et type du document, ou null s'il n'y en a pas. */
    lireDocument(id) {
      const vehicule = this.trouver(id);
      if (!vehicule || !vehicule.documentNom) return null;
      const chemin = cheminDocument(id);
      if (!fs.existsSync(chemin)) return null;
      return {
        nom: vehicule.documentNom,
        type: vehicule.documentType || "application/octet-stream",
        octets: fs.readFileSync(chemin),
      };
    },

    supprimerDocument(id) {
      const parc = lire();
      const vehicule = parc.vehicules.find((v) => v && v.id === id);
      if (!vehicule) return null;
      try {
        fs.rmSync(cheminDocument(id), { force: true });
      } catch { /* déjà absent */ }
      vehicule.documentNom = null;
      vehicule.documentType = null;
      ecrire(parc);
      return vehicule;
    },
  };
}

module.exports = {
  DOSSIER_DOCUMENTS,
  NOM_FICHIER_VEHICULES,
  TAILLE_MAX_DOCUMENT,
  TYPES_DOCUMENT,
  creerParc,
  normaliserVehicule,
};
