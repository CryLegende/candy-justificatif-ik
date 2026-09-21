const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { creerRegistre, preparerIndemnite } = require("../src/registre");

function dossierTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ik-test-"));
}

test("le cumul annuel est tenu par véhicule et par année", () => {
  const entrees = [
    { cleVehicule: "AA123AA", annee: 2026, puissanceFiscale: 5, electrique: false, distanceKm: 3000, montant: 1908 },
    { cleVehicule: "AA123AA", annee: 2025, puissanceFiscale: 5, electrique: false, distanceKm: 900, montant: 572.4 },
  ];
  const memeVehicule = preparerIndemnite(entrees, {
    date: "2026-06-02", immatriculation: "AA-123-AA", puissanceFiscale: 5, distanceKm: 100,
  });
  const autreVehicule = preparerIndemnite(entrees, {
    date: "2026-06-02", immatriculation: "BB-456-BB", puissanceFiscale: 5, distanceKm: 100,
  });
  assert.strictEqual(memeVehicule.distanceKmAnterieure, 3000);
  assert.strictEqual(autreVehicule.distanceKmAnterieure, 0);
});

test("une indemnité annulée sort du cumul annuel", () => {
  const entrees = [
    { cleVehicule: "AA123AA", annee: 2026, puissanceFiscale: 5, electrique: false, distanceKm: 3000, montant: 1908 },
    { cleVehicule: "AA123AA", annee: 2026, puissanceFiscale: 5, electrique: false, distanceKm: 500, montant: 318, annuleLe: "2026-07-01T10:00:00.000Z" },
  ];
  const suivante = preparerIndemnite(entrees, {
    date: "2026-08-02", immatriculation: "AA-123-AA", puissanceFiscale: 5, distanceKm: 50,
  });
  assert.strictEqual(suivante.distanceKmAnterieure, 3000);
});

test("refuse une plaque déjà connue avec une autre puissance", () => {
  const entrees = [{ cleVehicule: "AA123AA", annee: 2026, puissanceFiscale: 5, electrique: false, distanceKm: 10, montant: 6.36 }];
  assert.throws(() => preparerIndemnite(entrees, {
    date: "2026-06-02", immatriculation: "AA-123-AA", puissanceFiscale: 7, distanceKm: 10,
  }), /puissance fiscale/);
});

test("refuse une date future ou hors couverture du barème", () => {
  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.throws(() => preparerIndemnite([], {
    date: demain, immatriculation: "AA-123-AA", puissanceFiscale: 5, distanceKm: 10,
  }), /futur/);
  assert.throws(() => preparerIndemnite([], {
    date: "2099-01-01", immatriculation: "AA-123-AA", puissanceFiscale: 5, distanceKm: 10,
  }), /futur|barème/);
});

test("enregistre, annule et supprime sur disque", () => {
  const dossier = dossierTemporaire();
  try {
    const registre = creerRegistre({ dossier });
    const entree = registre.ajouter(
      { date: "2026-03-14", immatriculation: "AA-123-BB", puissanceFiscale: 5, distanceKm: 40 },
      { motif: "Rendez-vous", beneficiaire: "Testeur" },
    );
    assert.strictEqual(registre.lister().length, 1);
    assert.strictEqual(registre.totaux(2026).nombre, 1);

    registre.annuler(entree.id, { motif: "Erreur de saisie" });
    assert.strictEqual(registre.totaux(2026).nombre, 0, "une annulation sort des totaux");
    assert.ok(registre.trouver(entree.id).annuleLe, "l'entrée reste au registre");

    registre.supprimer(entree.id);
    assert.strictEqual(registre.lister().length, 0);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test("le fichier du registre reste lisible et versionné", () => {
  const dossier = dossierTemporaire();
  try {
    const registre = creerRegistre({ dossier });
    registre.ajouter({ date: "2026-03-14", immatriculation: "AA-123-BB", puissanceFiscale: 5, distanceKm: 40 });
    const contenu = JSON.parse(fs.readFileSync(path.join(dossier, "indemnites.json"), "utf-8"));
    assert.strictEqual(contenu.version, 1);
    assert.strictEqual(contenu.entrees[0].cleVehicule, "AA123BB");
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});
