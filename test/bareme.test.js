// Les montants attendus ci-dessous viennent du barème publié, pas du code. Si un test casse
// après une mise à jour des coefficients, c'est le test qu'il faut relire en premier : il dit
// quelle était la règle avant.

const test = require("node:test");
const assert = require("node:assert");
const {
  calculerIndemnite,
  creerBareme,
  indemniteAnnuelle,
  normaliserPuissanceFiscale,
} = require("../src/bareme");

test("applique les tranches voiture du barème en vigueur", () => {
  assert.strictEqual(indemniteAnnuelle(4000, 6), 2660);
  assert.strictEqual(indemniteAnnuelle(6000, 5), 3537);
  assert.strictEqual(indemniteAnnuelle(21000, 5), 8967);
});

test("applique la majoration électrique par le tableau publié", () => {
  assert.strictEqual(indemniteAnnuelle(4000, 6, { electrique: true }), 3192);
  assert.strictEqual(indemniteAnnuelle(6000, 5, { electrique: true }), 4242);
});

test("plafonne les véhicules de plus de 7 CV à la tranche 7 CV", () => {
  assert.strictEqual(indemniteAnnuelle(4000, 9), indemniteAnnuelle(4000, 7));
  assert.strictEqual(indemniteAnnuelle(4000, 9), 2788);
});

test("relève les véhicules de moins de 3 CV à la tranche 3 CV", () => {
  assert.strictEqual(indemniteAnnuelle(1000, 2), indemniteAnnuelle(1000, 3));
  assert.strictEqual(normaliserPuissanceFiscale(2).ecretee, true);
});

test("calcule la part marginale quand un trajet franchit une tranche", () => {
  const indemnite = calculerIndemnite({
    distanceKmAnterieure: 4900,
    montantAnterieur: indemniteAnnuelle(4900, 5),
    distanceKm: 200,
    puissanceFiscale: 5,
  });
  assert.strictEqual(indemnite.distanceAnnuelleKm, 5100);
  assert.strictEqual(indemnite.indemniteAnnuelle, 3215.7);
  assert.strictEqual(indemnite.montant, 99.3);
});

test("le taux unitaire multiplié par la distance retombe sur le montant", () => {
  const indemnite = calculerIndemnite({ distanceKm: 137.4, puissanceFiscale: 4 });
  const reconstitue = Math.round(indemnite.tauxUnitaire * indemnite.distanceKm * 100) / 100;
  assert.strictEqual(reconstitue, indemnite.montant);
});

test("refuse une antériorité incohérente plutôt que d'écrire un montant négatif", () => {
  assert.throws(() => calculerIndemnite({
    distanceKmAnterieure: 100,
    montantAnterieur: 10000,
    distanceKm: 10,
    puissanceFiscale: 5,
  }), /invalide/);
});

test("refuse une distance nulle, négative ou absurde", () => {
  for (const distance of [0, -5, 100001, "abc"]) {
    assert.throws(() => calculerIndemnite({ distanceKm: distance, puissanceFiscale: 5 }));
  }
});

test("un barème personnalisé doit couvrir l'infini sur sa dernière tranche", () => {
  assert.throws(() => creerBareme({
    thermique: { 3: [{ jusquA: 5000, coefficient: 0.5, forfait: 0 }] },
  }), /Infinity/);
});
