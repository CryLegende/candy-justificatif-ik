// API HTTP du module, et application prête à servir l'interface.
//
// Deux entrées :
//   - `creerRouteur(options)` rend un routeur Express que vous montez où vous voulez dans une
//     application existante : `app.use("/ik", creerRouteur({ dossierDonnees }))`.
//   - `creerApplication(options)` rend une application complète, routeur plus interface statique.
//     C'est ce que lance `server/start.js`, et ce que fait tourner l'image Docker.
//
// Aucune route ne contient de logique métier : elles valident une entrée, appellent `src/`, et
// mettent en forme une réponse. Le calcul reste testable sans serveur.

const express = require("express");
const fs = require("fs");
const path = require("path");

const { creerServiceIk } = require("../src");
const { construireCsv, construireHtmlRecapitulatif } = require("../src/recapitulatif");
const { htmlVersPdf, pdfDisponible } = require("../src/pdf");

const DOSSIER_JUSTIFICATIFS = "justificatifs";

function nettoyer(valeur, longueurMax = 160) {
  return String(valeur || "").trim().replace(/\s+/g, " ").slice(0, longueurMax);
}

/** Réponse d'erreur uniforme. Le message métier est rendu tel quel : il est écrit pour l'humain. */
function repondreErreur(res, err, code = 400) {
  const message = err && err.message ? err.message : "Erreur inattendue";
  res.status(code).json({ succes: false, erreur: message });
}

/** Enveloppe une route async pour que toute exception finisse en réponse HTTP et pas en crash. */
function route(gestionnaire, codeParDefaut = 400) {
  return (req, res) => {
    Promise.resolve(gestionnaire(req, res)).catch((err) => {
      if (!res.headersSent) repondreErreur(res, err, err.statusCode || codeParDefaut);
    });
  };
}

/**
 * Routeur de l'API.
 *
 * @param {object} options voir creerServiceIk, plus :
 * @param {string} [options.jeton] si défini, toutes les routes exigent ce jeton
 *   (en-tête `x-ik-jeton`, ou paramètre `?jeton=` pour les liens de téléchargement)
 */
function creerRouteur(options = {}) {
  const service = creerServiceIk(options);
  const routeur = express.Router();
  const dossierJustificatifs = path.join(options.dossierDonnees, DOSSIER_JUSTIFICATIFS);
  const jetonAttendu = options.jeton ? String(options.jeton) : "";

  // Le corps peut contenir une carte grise en base64 : la limite par défaut d'Express (100 ko)
  // refuserait une photo de document.
  routeur.use(express.json({ limit: "16mb" }));

  if (jetonAttendu) {
    routeur.use((req, res, next) => {
      const fourni = req.get("x-ik-jeton") || req.query.jeton || "";
      if (fourni !== jetonAttendu) {
        return res.status(401).json({ succes: false, erreur: "Jeton manquant ou invalide" });
      }
      return next();
    });
  }

  // ── Configuration ───────────────────────────────────────────────────────────
  routeur.get("/config", (req, res) => {
    const bareme = service.bareme;
    const aujourdhui = new Date().toISOString().slice(0, 10);
    res.json({
      succes: true,
      entreprise: service.entreprise,
      pdf: pdfDisponible(),
      bareme: {
        libelle: bareme.libelle,
        source: bareme.source,
        valableJusquAu: bareme.valableJusquAu,
        aVerifierApres: bareme.aVerifierApres,
        // Deux états distincts : « il faut vérifier si un nouvel arrêté est paru » n'est pas
        // « le barème ne couvre plus cette date ». Le premier informe, le second bloque.
        aVerifier: Boolean(bareme.aVerifierApres && aujourdhui >= bareme.aVerifierApres),
        perime: Boolean(bareme.valableJusquAu && aujourdhui > bareme.valableJusquAu),
      },
      annees: service.registre.annees(),
    });
  });

  // ── Véhicules ───────────────────────────────────────────────────────────────
  routeur.get("/vehicules", (req, res) => {
    res.json({ succes: true, vehicules: service.parc.lister() });
  });

  routeur.post("/vehicules", route((req, res) => {
    res.json({ succes: true, vehicule: service.parc.ajouter(req.body || {}) });
  }));

  routeur.put("/vehicules/:id", route((req, res) => {
    const vehicule = service.parc.modifier(req.params.id, req.body || {});
    if (!vehicule) return repondreErreur(res, new Error("Véhicule introuvable"), 404);
    return res.json({ succes: true, vehicule });
  }));

  routeur.delete("/vehicules/:id", route((req, res) => {
    const vehicule = service.parc.supprimer(req.params.id);
    if (!vehicule) return repondreErreur(res, new Error("Véhicule introuvable"), 404);
    return res.json({ succes: true });
  }));

  routeur.post("/vehicules/:id/document", route((req, res) => {
    const vehicule = service.parc.enregistrerDocument(req.params.id, req.body || {});
    if (!vehicule) return repondreErreur(res, new Error("Véhicule introuvable"), 404);
    return res.json({ succes: true, vehicule });
  }));

  routeur.get("/vehicules/:id/document", route((req, res) => {
    const document = service.parc.lireDocument(req.params.id);
    if (!document) return repondreErreur(res, new Error("Aucun document"), 404);
    res.setHeader("Content-Type", document.type);
    // `inline` plutôt que `attachment` : une carte grise se consulte, elle ne se télécharge pas.
    res.setHeader("Content-Disposition", `inline; filename="${document.nom}"`);
    return res.send(document.octets);
  }));

  routeur.delete("/vehicules/:id/document", route((req, res) => {
    const vehicule = service.parc.supprimerDocument(req.params.id);
    if (!vehicule) return repondreErreur(res, new Error("Véhicule introuvable"), 404);
    return res.json({ succes: true, vehicule });
  }));

  // ── Adresses et trajet ──────────────────────────────────────────────────────
  routeur.get("/adresses", route(async (req, res) => {
    const suggestions = await service.geocodeur.rechercher(req.query.q || "");
    res.json({ succes: true, suggestions });
  }, 502));

  routeur.post("/trajet", route(async (req, res) => {
    const corps = req.body || {};
    const trajet = await service.resoudreTrajet({
      depart: corps.depart,
      arrivee: corps.arrivee,
      allerRetour: corps.allerRetour === true,
      pointDepart: corps.pointDepart || null,
      pointArrivee: corps.pointArrivee || null,
    });
    // La géométrie complète pèse plusieurs milliers de points : inutile au formulaire, elle
    // n'est utilisée qu'à la génération du justificatif.
    const { geometrie, ...resume } = trajet;
    res.json({ succes: true, trajet: resume });
  }, 502));

  // ── Indemnités ──────────────────────────────────────────────────────────────

  /** Fiche véhicule du parc, ou véhicule décrit directement dans la requête. */
  function resoudreVehicule(corps) {
    if (corps.vehiculeId) {
      const vehicule = service.parc.trouver(corps.vehiculeId);
      if (!vehicule) throw new Error("Véhicule introuvable");
      return vehicule;
    }
    return {
      id: null,
      libelle: "",
      immatriculation: corps.immatriculation,
      puissanceFiscale: corps.puissanceFiscale,
      electrique: corps.electrique === true,
    };
  }

  function apercuDepuisCorps(corps) {
    const vehicule = resoudreVehicule(corps);
    const apercu = service.apercu({
      date: corps.date,
      immatriculation: vehicule.immatriculation,
      puissanceFiscale: vehicule.puissanceFiscale,
      electrique: vehicule.electrique,
      distanceKm: corps.distanceKm,
    });
    return { apercu, vehicule };
  }

  routeur.post("/indemnites/apercu", route((req, res) => {
    const { apercu, vehicule } = apercuDepuisCorps(req.body || {});
    res.json({ succes: true, apercu: { ...apercu, vehiculeId: vehicule.id, vehiculeLibelle: vehicule.libelle } });
  }));

  routeur.get("/indemnites", (req, res) => {
    const annee = req.query.annee ? Number(req.query.annee) : null;
    const entrees = service.registre.lister({ annee });
    res.json({
      succes: true,
      entrees,
      annees: service.registre.annees(),
      totaux: annee ? service.registre.totaux(annee) : null,
    });
  });

  /**
   * Produit et range le justificatif d'une entrée.
   * Best effort : si la carte, le rendu PDF ou l'écriture échouent, l'indemnité reste enregistrée
   * et le document pourra être regénéré. Perdre le PDF est réparable, perdre la saisie non.
   */
  async function produireJustificatif(entree, trajet, annexes = []) {
    const carteDataUri = trajet.geometrie ? await service.carteDuTrajet(trajet.geometrie) : null;
    const html = service.justificatifHtml({
      beneficiaire: entree.beneficiaire,
      date: entree.date,
      motif: entree.motif,
      immatriculation: entree.immatriculation,
      libellePuissance: entree.puissanceAppliquee !== entree.puissanceFiscale
        ? `${entree.puissanceFiscale} CV (barème plafonné à ${entree.puissanceAppliquee} CV)`
        : `${entree.puissanceFiscale} CV`,
      libelleEnergie: entree.electrique ? "Électrique" : "Thermique, hybride ou hydrogène",
      trajet,
      distanceDeclaree: entree.distanceKm,
      montant: entree.montant,
      carteDataUri,
      annexes,
    });

    if (!fs.existsSync(dossierJustificatifs)) fs.mkdirSync(dossierJustificatifs, { recursive: true });
    if (pdfDisponible()) {
      const pdf = await htmlVersPdf(html);
      const fichier = `${entree.id}.pdf`;
      fs.writeFileSync(path.join(dossierJustificatifs, fichier), pdf);
      return { fichier, type: "application/pdf", genereLe: new Date().toISOString() };
    }
    // Repli sans Puppeteer : le document reste consultable et imprimable depuis un navigateur.
    const fichier = `${entree.id}.html`;
    fs.writeFileSync(path.join(dossierJustificatifs, fichier), html, "utf-8");
    return { fichier, type: "text/html; charset=utf-8", genereLe: new Date().toISOString() };
  }

  routeur.post("/indemnites", route(async (req, res) => {
    const corps = req.body || {};
    const motif = nettoyer(corps.motif);
    const beneficiaire = nettoyer(corps.beneficiaire, 120);
    if (!motif) throw new Error("Le motif professionnel est obligatoire");
    if (!beneficiaire) throw new Error("Le bénéficiaire est obligatoire");

    const vehicule = resoudreVehicule(corps);

    // Le trajet est résolu AVANT l'écriture : une adresse introuvable doit faire échouer la
    // saisie entière, pas laisser une indemnité sans justificatif dans le registre.
    let trajet = null;
    if (corps.depart && corps.arrivee) {
      trajet = await service.resoudreTrajet({
        depart: corps.depart,
        arrivee: corps.arrivee,
        allerRetour: corps.allerRetour === true,
        pointDepart: corps.pointDepart || null,
        pointArrivee: corps.pointArrivee || null,
      });
    }

    // Distance retenue : celle saisie si elle est fournie, sinon celle de l'itinéraire. Un écart
    // entre les deux est signalé sur le justificatif plutôt que corrigé en silence.
    const distanceKm = corps.distanceKm != null && corps.distanceKm !== ""
      ? corps.distanceKm
      : (trajet ? trajet.distanceKm : null);
    if (distanceKm == null) throw new Error("Indiquez une distance, ou deux adresses");

    const entree = service.registre.ajouter({
      date: corps.date,
      immatriculation: vehicule.immatriculation,
      puissanceFiscale: vehicule.puissanceFiscale,
      electrique: vehicule.electrique,
      distanceKm,
    }, {
      motif,
      beneficiaire,
      vehiculeId: vehicule.id,
      vehiculeLibelle: vehicule.libelle || "",
      adresseDepart: trajet ? trajet.depart.libelle : null,
      adresseArrivee: trajet ? trajet.arrivee.libelle : null,
      allerRetour: trajet ? trajet.allerRetour : null,
      distanceItineraireKm: trajet ? trajet.distanceKm : null,
      dureeMinutes: trajet ? trajet.dureeMinutes : null,
      justificatif: null,
    });

    let avertissement = null;
    if (trajet) {
      try {
        const justificatif = await produireJustificatif(entree, trajet, corps.annexes || []);
        service.registre.completer(entree.id, { justificatif });
        entree.justificatif = justificatif;
      } catch (err) {
        avertissement = `Indemnité enregistrée, justificatif non généré : ${err.message}`;
      }
    }

    res.json({ succes: true, entree, avertissement });
  }));

  routeur.get("/indemnites/:id/justificatif", route((req, res) => {
    const entree = service.registre.trouver(req.params.id);
    if (!entree) return repondreErreur(res, new Error("Indemnité introuvable"), 404);
    if (!entree.justificatif) return repondreErreur(res, new Error("Aucun justificatif généré"), 404);
    const chemin = path.join(dossierJustificatifs, entree.justificatif.fichier);
    if (!fs.existsSync(chemin)) return repondreErreur(res, new Error("Fichier absent"), 404);
    res.setHeader("Content-Type", entree.justificatif.type || "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="justificatif-${entree.date}-${entree.cleVehicule}.pdf"`);
    return res.send(fs.readFileSync(chemin));
  }));

  routeur.post("/indemnites/:id/annuler", route((req, res) => {
    const entree = service.registre.annuler(req.params.id, { motif: nettoyer((req.body || {}).motif, 300) });
    if (!entree) return repondreErreur(res, new Error("Indemnité introuvable"), 404);
    return res.json({ succes: true, entree });
  }));

  routeur.delete("/indemnites/:id", route((req, res) => {
    const entree = service.registre.supprimer(req.params.id);
    if (!entree) return repondreErreur(res, new Error("Indemnité introuvable"), 404);
    if (entree.justificatif) {
      try {
        fs.rmSync(path.join(dossierJustificatifs, entree.justificatif.fichier), { force: true });
      } catch { /* le fichier orphelin ne bloque rien */ }
    }
    return res.json({ succes: true });
  }));

  // ── Récapitulatif annuel ────────────────────────────────────────────────────
  routeur.get("/recapitulatif/:annee", route(async (req, res) => {
    const annee = Number(req.params.annee);
    if (!Number.isInteger(annee)) throw new Error("Année invalide");
    const entrees = service.registre.lister({ annee }).slice().reverse();
    const format = String(req.query.format || "pdf");

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="indemnites-${annee}.csv"`);
      return res.send(construireCsv(entrees));
    }

    const html = construireHtmlRecapitulatif({
      annee,
      entrees,
      entreprise: service.entreprise,
      beneficiaire: nettoyer(req.query.beneficiaire, 120),
      baremeLibelle: service.bareme.libelle,
    });

    if (format === "html" || !pdfDisponible()) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(html);
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="indemnites-${annee}.pdf"`);
    return res.send(await htmlVersPdf(html));
  }));

  return routeur;
}

/**
 * Application complète : API sous /api, interface statique à la racine.
 * @param {object} options voir creerRouteur
 */
function creerApplication(options = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", creerRouteur(options));
  // Pas de cache long : les fichiers de l'interface n'ont pas d'empreinte dans leur nom, une
  // mise a jour du module laisserait sinon le navigateur sur l'ancienne version. L'ETag suffit.
  app.use(express.static(path.join(__dirname, "..", "public"), { etag: true, maxAge: 0 }));
  app.get("/sante", (req, res) => res.json({ succes: true }));
  return app;
}

module.exports = {
  creerApplication,
  creerRouteur,
};
