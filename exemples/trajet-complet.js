// Chaîne complète en dehors de tout serveur : deux adresses, un barème, un PDF.
//
//   node exemples/trajet-complet.js "1 Rue de la Paix, Paris" "Place du Capitole, Toulouse"
//
// Le fichier produit est ecrit dans le dossier courant.

const fs = require("fs");
const path = require("path");
const {
  construireCartePng,
  construireHtmlJustificatif,
  creerItineraire,
  htmlVersPdf,
  pdfDisponible,
  preparerIndemnite,
} = require("../src");

const depart = process.argv[2] || "1 Rue de la Paix, 75002 Paris";
const arrivee = process.argv[3] || "Place du Capitole, 31000 Toulouse";

async function principal() {
  // 1. Adresses et itinéraire.
  const trajet = await creerItineraire().resoudre({ depart, arrivee, allerRetour: true });
  console.log(`${trajet.depart.libelle} vers ${trajet.arrivee.libelle}`);
  console.log(`${trajet.allerKm} km aller, ${trajet.distanceKm} km retenus, ${trajet.dureeMinutes} min`);

  // 2. Barème. Le tableau d'entrées est vide : c'est un premier trajet de l'année. En usage
  //    réel, on passe ici les entrées déjà enregistrées pour ce véhicule.
  const indemnite = preparerIndemnite([], {
    date: new Date().toISOString().slice(0, 10),
    immatriculation: "AA-123-BB",
    puissanceFiscale: 5,
    electrique: false,
    distanceKm: trajet.distanceKm,
  });
  console.log(`Indemnité : ${indemnite.montant} euros (${indemnite.tauxUnitaire} euro/km)`);

  // 3. Document.
  const html = construireHtmlJustificatif({
    entreprise: "Exemple SARL",
    beneficiaire: "Prénom Nom",
    date: indemnite.date,
    motif: "Rendez-vous client",
    immatriculation: indemnite.immatriculation,
    libellePuissance: `${indemnite.puissanceFiscale} CV`,
    libelleEnergie: "Thermique",
    trajet,
    montant: indemnite.montant,
    baremeLibelle: indemnite.baremeLibelle,
    carteDataUri: await construireCartePng(trajet.geometrie),
  });

  if (pdfDisponible()) {
    const sortie = path.join(process.cwd(), "justificatif-exemple.pdf");
    fs.writeFileSync(sortie, await htmlVersPdf(html));
    console.log(`PDF : ${sortie}`);
    await require("../src/pdf").fermerNavigateur();
  } else {
    const sortie = path.join(process.cwd(), "justificatif-exemple.html");
    fs.writeFileSync(sortie, html, "utf-8");
    console.log(`HTML (puppeteer absent) : ${sortie}`);
  }
}

principal().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
