// Conversion HTML vers PDF, via Puppeteer.
//
// Puppeteer est déclaré en dépendance OPTIONNELLE. Sans lui, tout le reste du module fonctionne :
// le justificatif reste disponible en HTML, imprimable depuis un navigateur. `htmlVersPdf` lève
// alors une erreur explicite plutôt que d'échouer sur un `require` introuvable.
//
// Pourquoi un navigateur plutôt qu'une bibliothèque PDF : le document est une page HTML avec des
// styles d'impression (@page, tableaux, image de carte). Un moteur de rendu web le pose au pixel
// près sans avoir à repositionner quoi que ce soit à la main.
//
// Dans une image Docker, installez Chromium par le gestionnaire de paquets et pointez
// PUPPETEER_EXECUTABLE_PATH dessus : le Chromium téléchargé par Puppeteer ne démarre pas sur
// Alpine, et l'image pèse 300 Mo de moins ainsi. Voir le Dockerfile de ce dépôt.

let navigateurPartage = null;
let fermetureEnCours = null;

function chargerPuppeteer() {
  try {
    return require("puppeteer");
  } catch {
    throw new Error(
      "Génération PDF indisponible : le paquet puppeteer n'est pas installé. "
      + "Installez-le (npm install puppeteer) ou utilisez la sortie HTML.",
    );
  }
}

/**
 * Navigateur réutilisé d'un rendu à l'autre. Un démarrage de Chromium coûte environ une seconde :
 * le relancer à chaque PDF rendrait l'interface poussive dès deux documents d'affilée.
 */
async function obtenirNavigateur() {
  if (navigateurPartage && navigateurPartage.connected) return navigateurPartage;
  const puppeteer = chargerPuppeteer();
  navigateurPartage = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    // Obligatoire en conteneur : sans espace de noms utilisateur, le bac à sable de Chromium
    // refuse de démarrer. Le conteneur reste l'enveloppe d'isolation.
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  return navigateurPartage;
}

/**
 * Rend un document HTML en PDF A4.
 *
 * @param {string} html document complet, styles compris
 * @param {{ paysage?: boolean }} [options]
 * @returns {Promise<Buffer>} contenu du PDF
 */
async function htmlVersPdf(html, { paysage = false } = {}) {
  const navigateur = await obtenirNavigateur();
  const page = await navigateur.newPage();
  try {
    // `networkidle0` attend la fin des chargements : la carte est une image en data URI, donc
    // déjà présente, mais une police distante ou une image externe ajoutée par l'appelant le
    // serait moins.
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    const pdf = await page.pdf({
      format: "A4",
      landscape: paysage,
      printBackground: true,
      preferCSSPageSize: true,
    });
    // Puppeteer 24 rend un Uint8Array. Le convertir en Buffer évite qu'un framework HTTP le
    // sérialise en JSON ({"0":37,"1":80,...}) au lieu de l'envoyer en binaire.
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

/** Ferme le navigateur partagé. À appeler à l'arrêt du processus. */
async function fermerNavigateur() {
  if (!navigateurPartage) return;
  if (fermetureEnCours) return fermetureEnCours;
  fermetureEnCours = navigateurPartage.close().catch(() => {}).finally(() => {
    navigateurPartage = null;
    fermetureEnCours = null;
  });
  return fermetureEnCours;
}

/** Indique si la génération PDF est disponible dans cet environnement. */
function pdfDisponible() {
  try {
    require.resolve("puppeteer");
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  fermerNavigateur,
  htmlVersPdf,
  pdfDisponible,
};
