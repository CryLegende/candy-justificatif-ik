// Récapitulatif annuel : le document que l'on remet au comptable, ou que l'on garde au dossier.
//
// Un justificatif prouve un trajet. Le récapitulatif, lui, aligne tous les trajets d'une année,
// véhicule par véhicule, et donne les totaux. C'est la pièce qui répond à « combien d'indemnités
// kilométriques sur l'exercice, et sur quelle base ».
//
// Comme le justificatif, ce module rend du HTML et rien d'autre : ni disque, ni réseau, ni PDF.
// Passez le résultat à `src/pdf.js` si vous voulez un PDF.

const { echapper, dateFr, euros } = require("./justificatif");

/** Distance affichee avec son unite. Le module justificatif expose la meme regle sans unite. */
function km(valeur) {
  return `${Number(valeur || 0).toFixed(1).replace(".", ",")} km`;
}

/**
 * Regroupe des entrées par véhicule, en conservant l'ordre chronologique dans chaque groupe.
 * Les annulations sont écartées : elles n'ont pas été versées, elles n'ont donc rien à faire
 * dans un total remis à un tiers.
 */
function grouperParVehicule(entrees) {
  const groupes = new Map();
  for (const entree of entrees) {
    if (!entree || entree.annuleLe) continue;
    const cle = entree.cleVehicule || entree.immatriculation || "sans-vehicule";
    if (!groupes.has(cle)) {
      groupes.set(cle, {
        cle,
        immatriculation: entree.immatriculation || "",
        puissanceFiscale: entree.puissanceFiscale,
        electrique: entree.electrique === true,
        libelle: entree.vehiculeLibelle || "",
        lignes: [],
      });
    }
    groupes.get(cle).lignes.push(entree);
  }
  for (const groupe of groupes.values()) {
    groupe.lignes.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    groupe.distanceKm = Math.round(groupe.lignes.reduce((t, e) => t + (Number(e.distanceKm) || 0), 0) * 10) / 10;
    groupe.montant = Math.round(groupe.lignes.reduce((t, e) => t + (Number(e.montant) || 0), 0) * 100) / 100;
  }
  return [...groupes.values()].sort((a, b) => b.montant - a.montant);
}

const STYLES = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2937; font-size: 11px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sous-titre { color: #6b7280; font-size: 11px; margin-bottom: 14px; }
  .entreprise { font-weight: 700; font-size: 13px; color: #111827; }
  .vehicule { margin: 14px 0 4px; font-weight: 700; font-size: 12px; }
  .vehicule span { font-weight: 400; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 4px 6px; border: 1px solid #e5e7eb; vertical-align: top; }
  thead th { background: #f3f4f6; text-align: left; font-weight: 600; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tfoot td { background: #f9fafb; font-weight: 700; }
  .total { margin-top: 18px; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px;
    background: #f9fafb; font-size: 13px; display: flex; justify-content: space-between; }
  .mentions { margin-top: 14px; font-size: 9.5px; color: #6b7280; line-height: 1.5;
    border-top: 1px solid #e5e7eb; padding-top: 8px; }
`;

function rendreGroupe(groupe) {
  const lignes = groupe.lignes.map((e) => `<tr>
      <td>${echapper(dateFr(e.date))}</td>
      <td>${echapper(e.motif || "")}</td>
      <td>${echapper(e.adresseDepart || "")}</td>
      <td>${echapper(e.adresseArrivee || "")}</td>
      <td>${e.allerRetour ? "A/R" : "Aller"}</td>
      <td class="num">${km(e.distanceKm)}</td>
      <td class="num">${echapper(euros(e.montant))}</td>
    </tr>`).join("");

  const energie = groupe.electrique ? "électrique" : "thermique";
  const puissance = groupe.puissanceFiscale ? `${groupe.puissanceFiscale} CV` : "";
  return `<div class="vehicule">${echapper(groupe.immatriculation)}
      <span>${[groupe.libelle, puissance, energie].filter(Boolean).map(echapper).join(" - ")}</span></div>
    <table>
      <thead><tr>
        <th>Date</th><th>Motif</th><th>Départ</th><th>Arrivée</th><th>Trajet</th>
        <th class="num">Distance</th><th class="num">Indemnité</th>
      </tr></thead>
      <tbody>${lignes}</tbody>
      <tfoot><tr>
        <td colspan="5">Total ${echapper(groupe.immatriculation)} (${groupe.lignes.length} déplacement${groupe.lignes.length > 1 ? "s" : ""})</td>
        <td class="num">${km(groupe.distanceKm)}</td>
        <td class="num">${echapper(euros(groupe.montant))}</td>
      </tr></tfoot>
    </table>`;
}

/**
 * Récapitulatif annuel en HTML.
 *
 * @param {object} params
 * @param {number|string} params.annee
 * @param {Array} params.entrees entrées du registre pour cette année
 * @param {string} [params.entreprise]
 * @param {string} [params.beneficiaire]
 * @param {string} [params.baremeLibelle]
 * @returns {string} HTML complet
 */
function construireHtmlRecapitulatif({
  annee,
  entrees,
  entreprise = "",
  beneficiaire = "",
  baremeLibelle = "",
}) {
  const groupes = grouperParVehicule(Array.isArray(entrees) ? entrees : []);
  const totalKm = Math.round(groupes.reduce((t, g) => t + g.distanceKm, 0) * 10) / 10;
  const totalMontant = Math.round(groupes.reduce((t, g) => t + g.montant, 0) * 100) / 100;
  const nombre = groupes.reduce((t, g) => t + g.lignes.length, 0);

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Récapitulatif des indemnités kilométriques ${echapper(annee)}</title>
<style>${STYLES}</style></head><body>
  ${entreprise ? `<div class="entreprise">${echapper(entreprise)}</div>` : ""}
  <h1>Récapitulatif des indemnités kilométriques ${echapper(annee)}</h1>
  <div class="sous-titre">
    ${beneficiaire ? `Bénéficiaire : ${echapper(beneficiaire)}. ` : ""}${echapper(baremeLibelle)}
  </div>

  ${groupes.length
    ? groupes.map(rendreGroupe).join("")
    : "<p>Aucun déplacement enregistré pour cette année.</p>"}

  <div class="total">
    <span>Total ${echapper(annee)} : ${nombre} déplacement${nombre > 1 ? "s" : ""}, ${km(totalKm)}</span>
    <strong>${echapper(euros(totalMontant))}</strong>
  </div>

  <div class="mentions">
    Montants calculés au barème kilométrique forfaitaire de l'administration fiscale${baremeLibelle ? ` (${echapper(baremeLibelle)})` : ""}.
    Le barème est annuel et progressif : le montant d'un déplacement dépend du kilométrage déjà
    parcouru dans l'année avec le même véhicule, ce qui explique que deux trajets de même distance
    n'aient pas nécessairement la même indemnité. Les déplacements annulés sont exclus de ce
    récapitulatif. Document établi le ${echapper(new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" }))}.
  </div>
</body></html>`;
}

/** Même contenu, au format CSV, pour reprise dans un tableur ou un logiciel de comptabilité. */
function construireCsv(entrees) {
  const colonnes = [
    "date", "immatriculation", "puissanceFiscale", "electrique", "motif", "beneficiaire",
    "adresseDepart", "adresseArrivee", "allerRetour", "distanceKm", "montant", "bareme", "annule",
  ];
  const echapperCsv = (v) => {
    const texte = String(v == null ? "" : v);
    return /[";\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
  };
  const lignes = (Array.isArray(entrees) ? entrees : []).map((e) => [
    e.date, e.immatriculation, e.puissanceFiscale, e.electrique ? "oui" : "non", e.motif,
    e.beneficiaire, e.adresseDepart, e.adresseArrivee, e.allerRetour ? "oui" : "non",
    String(e.distanceKm ?? "").replace(".", ","), String(e.montant ?? "").replace(".", ","),
    e.baremeLibelle, e.annuleLe ? "oui" : "non",
  ].map(echapperCsv).join(";"));
  // Point-virgule et BOM : c'est ce qu'attend Excel en configuration française. Sans le BOM, les
  // accents ressortent en mojibake à l'ouverture.
  return `\ufeff${[colonnes.join(";"), ...lignes].join("\r\n")}\r\n`;
}

module.exports = {
  construireCsv,
  construireHtmlRecapitulatif,
  grouperParVehicule,
};
