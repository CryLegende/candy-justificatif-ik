// Justificatif de trajet : construction du document HTML, prêt à imprimer ou à convertir en PDF.
//
// Ce module ne fait ni réseau ni disque, et ne dépend d'aucun moteur de rendu. Il prend des
// données et rend une chaîne HTML autonome (styles compris). Vous pouvez donc :
//   - la passer à `src/pdf.js` pour obtenir un PDF,
//   - la servir telle quelle dans un navigateur,
//   - la convertir avec l'outil de votre choix.
//
// Ce que le document démontre, et ce qu'il ne démontre pas. Il établit la distance d'un
// déplacement entre deux adresses normalisées, à une date, pour un motif et un véhicule donnés.
// Il n'établit pas la présence sur place : c'est le rôle de la section « annexes », alimentée par
// l'appelant avec ce dont il dispose (relevé d'activité, rendez-vous, bon d'intervention, ticket).

// Au-delà, la liste est tronquée et le nombre restant est annoncé, pour que le document tienne
// sur une page.
const MAX_LIGNES_ANNEXES = 12;

function echapper(valeur) {
  return String(valeur == null ? "" : valeur)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function dateFr(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return String(iso || "");
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a}`;
}

/** Distance en francais : separateur decimal virgule, comme sur tout document fiscal. */
function km(valeur) {
  if (valeur == null || !Number.isFinite(Number(valeur))) return "";
  return String(valeur).replace(".", ",");
}

function euros(valeur) {
  if (valeur == null || !Number.isFinite(Number(valeur))) return "";
  return `${Number(valeur).toFixed(2).replace(".", ",")} €`;
}

/**
 * Tableau des pièces d'appui jointes au trajet.
 * Chaque ligne est libre : { heure, libelle, intervenant, detail }. Aucune n'est obligatoire.
 */
function rendreAnnexes(annexes, titre) {
  const liste = Array.isArray(annexes) ? annexes.filter(Boolean) : [];
  if (!liste.length) return "";
  const retenues = liste.slice(0, MAX_LIGNES_ANNEXES);
  const masquees = liste.length - retenues.length;
  const lignes = retenues.map((item) => `<tr>
      <td class="hh">${echapper(item.heure || "")}</td>
      <td>${echapper(item.libelle || "")}</td>
      <td class="qui">${echapper(item.intervenant || "")}</td>
      <td class="det">${echapper(item.detail || "")}</td>
    </tr>`).join("");
  return `<div class="annexes">
    <div class="annexes-titre">${echapper(titre || "Éléments enregistrés le jour du déplacement")}</div>
    <table class="journal"><tbody>${lignes}</tbody></table>
    ${masquees > 0 ? `<div class="reste">et ${masquees} autre${masquees > 1 ? "s" : ""} élément${masquees > 1 ? "s" : ""} le même jour.</div>` : ""}
  </div>`;
}

const STYLES = `
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2937; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 2px; letter-spacing: .2px; }
  .sous-titre { color: #6b7280; font-size: 11px; margin-bottom: 14px; }
  .entreprise { font-weight: 700; font-size: 13px; color: #111827; }
  table.info { width: 100%; border-collapse: collapse; margin: 10px 0; }
  table.info th { text-align: left; width: 34%; padding: 6px 8px; background: #f3f4f6;
    border: 1px solid #e5e7eb; font-weight: 600; vertical-align: top; }
  table.info td { padding: 6px 8px; border: 1px solid #e5e7eb; vertical-align: top; }
  .pastille { font-weight: 700; }
  .carte { margin: 8px 0; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; text-align: center; }
  .carte img { display: block; margin: 0 auto; width: 100%; height: auto; max-height: 104mm; }
  .carte.basse img { max-height: 62mm; }
  .annexes { margin: 10px 0 0; }
  .annexes-titre { font-weight: 700; font-size: 12px; margin-bottom: 4px; }
  table.journal { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  table.journal td { padding: 3px 6px; border: 1px solid #e5e7eb; vertical-align: top; }
  table.journal td.hh { width: 11%; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.journal td.qui { width: 16%; white-space: nowrap; }
  table.journal td.det { color: #4b5563; }
  .reste { margin-top: 4px; font-size: 10px; color: #6b7280; font-style: italic; }
  .alerte { margin: 8px 0; padding: 8px 10px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; }
  .mentions { margin-top: 16px; font-size: 10px; color: #6b7280; line-height: 1.5;
    border-top: 1px solid #e5e7eb; padding-top: 10px; }
  .montant { font-size: 13px; }
`;

/**
 * Document HTML autonome du justificatif.
 *
 * @param {object} donnees
 * @param {string} [donnees.entreprise] raison sociale affichée en tête
 * @param {string} donnees.beneficiaire personne indemnisée
 * @param {string} donnees.date date du déplacement, AAAA-MM-JJ
 * @param {string} donnees.motif objet professionnel du déplacement
 * @param {string} donnees.immatriculation
 * @param {string} [donnees.libellePuissance] par exemple "5 CV"
 * @param {string} [donnees.libelleEnergie] par exemple "Thermique" ou "Électrique"
 * @param {object} donnees.trajet résultat de creerItineraire().resoudre()
 * @param {number} [donnees.distanceDeclaree] distance retenue si elle diffère de l'itinéraire
 * @param {number} [donnees.montant] indemnité calculée, affichée si fournie
 * @param {string} [donnees.baremeLibelle]
 * @param {string} [donnees.carteDataUri] image de carte, ou null
 * @param {Array} [donnees.annexes] pièces d'appui du jour
 * @param {string} [donnees.titreAnnexes]
 * @param {string} [donnees.mentionsComplementaires] texte ajouté aux mentions légales
 * @returns {string} HTML complet
 */
function construireHtmlJustificatif(donnees) {
  const {
    entreprise = "",
    beneficiaire = "",
    date,
    motif = "",
    immatriculation = "",
    libellePuissance = "",
    libelleEnergie = "",
    trajet,
    distanceDeclaree = null,
    montant = null,
    baremeLibelle = "",
    carteDataUri = null,
    annexes = [],
    titreAnnexes = "",
    mentionsComplementaires = "",
  } = donnees;

  if (!trajet || !trajet.depart || !trajet.arrivee) {
    throw new Error("construireHtmlJustificatif : trajet incomplet");
  }

  const htmlAnnexes = rendreAnnexes(annexes, titreAnnexes);
  // La carte cède la place aux annexes : le document vise une page, et une trace d'activité
  // horodatée vaut mieux qu'un grand fond de carte.
  const classeCarte = htmlAnnexes ? "carte basse" : "carte";

  const typeTrajet = trajet.allerRetour ? "Aller-retour" : "Aller simple";
  const ligneDistance = trajet.allerRetour
    ? `${km(trajet.allerKm)} km aller x 2 = <strong>${km(trajet.distanceKm)} km</strong>`
    : `<strong>${km(trajet.distanceKm)} km</strong>`;
  const ecart = distanceDeclaree != null && Math.abs(Number(distanceDeclaree) - trajet.distanceKm) > 0.05;
  const noteEcart = ecart
    ? `<div class="alerte">Distance indemnisée retenue : <strong>${echapper(km(distanceDeclaree))} km</strong>
        (ajustée manuellement, itinéraire théorique : ${km(trajet.distanceKm)} km).</div>`
    : "";

  const ligne = (cle, valeur) => `<tr><th>${echapper(cle)}</th><td>${valeur}</td></tr>`;

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Justificatif de trajet professionnel</title>
<style>${STYLES}</style></head><body>
  ${entreprise ? `<div class="entreprise">${echapper(entreprise)}</div>` : ""}
  <h1>Justificatif de trajet professionnel</h1>
  <div class="sous-titre">Indemnité kilométrique${baremeLibelle ? ` - ${echapper(baremeLibelle)}` : ""}</div>

  <table class="info">
    ${ligne("Bénéficiaire", echapper(beneficiaire))}
    ${ligne("Date du déplacement", echapper(dateFr(date)))}
    ${ligne("Véhicule", `${echapper(immatriculation)}${libellePuissance ? ` - ${echapper(libellePuissance)}` : ""}`)}
    ${libelleEnergie ? ligne("Énergie", echapper(libelleEnergie)) : ""}
    ${ligne("Motif professionnel", echapper(motif))}
    ${ligne("Adresse de départ", `<span class="pastille" style="color:#16a34a">&#9679; </span>${echapper(trajet.depart.libelle)}`)}
    ${ligne("Adresse d'arrivée", `<span class="pastille" style="color:#dc2626">&#9679; </span>${echapper(trajet.arrivee.libelle)}`)}
    ${ligne("Type de trajet", echapper(typeTrajet))}
    ${ligne("Distance", `<span class="montant">${ligneDistance}</span>`)}
    ${trajet.dureeMinutes != null ? ligne("Durée estimée", `${echapper(trajet.dureeMinutes)} min${trajet.allerRetour ? " (aller)" : ""}`) : ""}
    ${montant != null ? ligne("Indemnité", `<span class="montant"><strong>${echapper(euros(montant))}</strong></span>`) : ""}
  </table>
  ${noteEcart}

  ${carteDataUri ? `<div class="${classeCarte}"><img src="${carteDataUri}" alt="Itinéraire"/></div>` : ""}

  ${htmlAnnexes}

  <div class="mentions">
    Le présent document justifie la réalité et la distance d'un déplacement professionnel ouvrant droit à
    indemnité kilométrique. La distance retenue correspond à l'itinéraire routier le plus rapide entre les
    deux adresses (source : ${echapper(trajet.source || "OpenStreetMap / OSRM")}) ; les adresses sont
    normalisées par la Base Adresse Nationale (api-adresse.data.gouv.fr), service public de l'État. Seul le
    trajet professionnel est indemnisé, à l'exclusion de tout détour à caractère personnel. L'indemnité est
    calculée selon le barème kilométrique forfaitaire de l'administration fiscale${baremeLibelle ? ` (${echapper(baremeLibelle)})` : ""},
    lequel couvre la dépréciation du véhicule, les frais de réparation et d'entretien, les pneumatiques, la
    consommation de carburant ou d'énergie et les primes d'assurance. Le véhicule utilisé est un véhicule
    personnel du bénéficiaire.${mentionsComplementaires ? ` ${echapper(mentionsComplementaires)}` : ""}
    Document établi le ${echapper(new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" }))}.
  </div>
</body></html>`;
}

module.exports = {
  MAX_LIGNES_ANNEXES,
  construireHtmlJustificatif,
  dateFr,
  echapper,
  euros,
  km,
};
