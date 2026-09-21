const test = require("node:test");
const assert = require("node:assert");

const { construireHtmlJustificatif } = require("../src/justificatif");
const { construireCsv, construireHtmlRecapitulatif, grouperParVehicule } = require("../src/recapitulatif");

const trajet = {
  depart: { libelle: "1 Rue de la Paix, 75002 Paris" },
  arrivee: { libelle: "Place du Capitole, 31000 Toulouse" },
  allerRetour: true,
  allerKm: 678.3,
  distanceKm: 1356.6,
  dureeMinutes: 402,
  source: "OpenStreetMap / OSRM",
};

test("le justificatif porte les mentions qui le rendent opposable", () => {
  const html = construireHtmlJustificatif({
    beneficiaire: "Testeur", date: "2026-03-14", motif: "Salon professionnel",
    immatriculation: "AA-123-BB", libellePuissance: "5 CV", libelleEnergie: "Thermique",
    trajet, montant: 862.79, baremeLibelle: "Barème 2026",
  });
  assert.match(html, /Justificatif de trajet professionnel/);
  assert.match(html, /1356,6 km/);
  assert.ok(!html.includes("1356.6"), "pas de separateur decimal anglais sur un document francais");
  assert.match(html, /862,79/);
  assert.match(html, /Base Adresse Nationale/);
  assert.match(html, /barème kilométrique forfaitaire/);
});

test("un écart entre distance retenue et itinéraire est signalé, pas masqué", () => {
  const html = construireHtmlJustificatif({
    beneficiaire: "Testeur", date: "2026-03-14", motif: "Tournée",
    immatriculation: "AA-123-BB", trajet, distanceDeclaree: 1400,
  });
  assert.match(html, /ajustée manuellement/);
});

test("le HTML échappe ce que l'utilisateur a saisi", () => {
  const html = construireHtmlJustificatif({
    beneficiaire: "<script>alert(1)</script>", date: "2026-03-14", motif: "Test",
    immatriculation: "AA-123-BB", trajet,
  });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("le récapitulatif groupe par véhicule et totalise hors annulations", () => {
  const entrees = [
    { date: "2026-01-10", cleVehicule: "AA123BB", immatriculation: "AA-123-BB", puissanceFiscale: 5, distanceKm: 100, montant: 63.6 },
    { date: "2026-02-10", cleVehicule: "AA123BB", immatriculation: "AA-123-BB", puissanceFiscale: 5, distanceKm: 50, montant: 31.8 },
    { date: "2026-02-11", cleVehicule: "CC456DD", immatriculation: "CC-456-DD", puissanceFiscale: 4, distanceKm: 20, montant: 12.12 },
    { date: "2026-03-01", cleVehicule: "AA123BB", immatriculation: "AA-123-BB", puissanceFiscale: 5, distanceKm: 900, montant: 572.4, annuleLe: "2026-03-02T09:00:00.000Z" },
  ];
  const groupes = grouperParVehicule(entrees);
  assert.strictEqual(groupes.length, 2);
  assert.strictEqual(groupes[0].montant, 95.4);
  assert.strictEqual(groupes[0].lignes.length, 2);

  const html = construireHtmlRecapitulatif({ annee: 2026, entrees });
  assert.match(html, /107,52/);
});

test("le CSV sort en point-virgule, virgule décimale et BOM pour un tableur français", () => {
  const csv = construireCsv([
    { date: "2026-01-10", immatriculation: "AA-123-BB", distanceKm: 100.5, montant: 63.92, motif: "Client; urgent" },
  ]);
  assert.ok(csv.startsWith("\ufeff"));
  assert.match(csv, /100,5;63,92/);
  assert.match(csv, /"Client; urgent"/);
});
