// Fond de carte statique du justificatif : tuiles OpenStreetMap assemblées localement.
//
// Ce module est FACULTATIF. Il dépend de `sharp`, déclaré en dépendance optionnelle : si sharp
// n'est pas installé, `construireCartePng` rend null et le justificatif sort sans carte, sans
// autre conséquence. Rien dans le calcul de l'indemnité n'en dépend.
//
// Pourquoi assembler soi-même plutôt qu'appeler une API de carte statique : ces API imposent une
// clé, un quota et souvent une mention obligatoire. Les tuiles OSM brutes se récupèrent sans clé,
// et l'assemblage local reste un usage raisonnable tant que le nombre de tuiles par document est
// borné, ce que fait MAX_TUILES.
//
// Politique d'usage des tuiles : https://operations.osmfoundation.org/policies/tiles/
// Pour un volume régulier, pointez IK_TUILES_URL vers votre propre serveur de tuiles.

const { fetchAvecDelai } = require("./geocodage");

const TAILLE_TUILE = 256;
const LARGEUR_MAX = 2048;
const HAUTEUR_MAX = 1024;
const MAX_TUILES = 36;
// Rapport largeur/hauteur du cadre réservé à la carte dans le PDF. La fenêtre est étirée à ce
// rapport avant téléchargement : sans cela la carte entre dans son cadre par la hauteur et laisse
// deux bandes vides, ce qui écrase le tracé.
const RAPPORT_CARTE = 178 / 62;
const URL_TUILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ZOOM_REFERENCE = 20;

// Projection Web Mercator, dans les deux sens.
function lonVersX(lon, z) {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
function latVersY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z);
}
function xVersLon(x, z) {
  return (x / Math.pow(2, z)) * 360 - 180;
}
function yVersLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Zoom retenu : le plus détaillé dont la fenêtre demandée tient dans l'assemblage autorisé.
 * Le raisonnement porte sur la taille en pixels, pas sur un nombre de tuiles : le découpage en
 * tuiles est un détail de téléchargement, l'image est recadrée ensuite.
 */
function choisirZoom(minLon, minLat, maxLon, maxLat) {
  for (let z = 17; z >= 2; z -= 1) {
    const l = (lonVersX(maxLon, z) - lonVersX(minLon, z)) * TAILLE_TUILE;
    const h = (latVersY(minLat, z) - latVersY(maxLat, z)) * TAILLE_TUILE;
    if (l <= LARGEUR_MAX && h <= HAUTEUR_MAX) return z;
  }
  return 2;
}

/**
 * Étire la fenêtre au rapport du cadre, autour de son centre. Le calcul se fait en coordonnées de
 * tuiles à un zoom de référence : dans cet espace les rapports sont linéaires, l'échelle s'annule,
 * seul compte le rapport largeur/hauteur.
 */
function ajusterAuRapport(minLon, minLat, maxLon, maxLat, rapport) {
  const etendue = Math.pow(2, ZOOM_REFERENCE);
  const x0 = lonVersX(minLon, ZOOM_REFERENCE);
  const x1 = lonVersX(maxLon, ZOOM_REFERENCE);
  const y0 = latVersY(maxLat, ZOOM_REFERENCE);
  const y1 = latVersY(minLat, ZOOM_REFERENCE);
  let l = Math.max(x1 - x0, 1e-9);
  let h = Math.max(y1 - y0, 1e-9);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (l / h < rapport) l = h * rapport; else h = l / rapport;
  const borner = (y) => Math.min(etendue, Math.max(0, y));
  return {
    minLon: xVersLon(Math.max(0, cx - l / 2), ZOOM_REFERENCE),
    maxLon: xVersLon(Math.min(etendue, cx + l / 2), ZOOM_REFERENCE),
    maxLat: yVersLat(borner(cy - h / 2), ZOOM_REFERENCE),
    minLat: yVersLat(borner(cy + h / 2), ZOOM_REFERENCE),
  };
}

/** Réduit le nombre de points du tracé : au-delà, le SVG grossit sans rien ajouter de visible. */
function reduire(points, max) {
  if (points.length <= max) return points;
  const pas = Math.ceil(points.length / max);
  const sortie = points.filter((_, i) => i % pas === 0);
  if (sortie[sortie.length - 1] !== points[points.length - 1]) sortie.push(points[points.length - 1]);
  return sortie;
}

/**
 * Carte du trajet en PNG, encodée en data URI, prête à poser dans un `<img src>`.
 *
 * @param {Array} geometrie liste de [lon, lat], telle que rendue par creerItineraire().resoudre()
 * @param {{ urlTuiles?: string }} [options]
 * @returns {Promise<string|null>} data URI, ou null si la carte n'a pas pu être produite
 */
async function construireCartePng(geometrie, { urlTuiles = URL_TUILES } = {}) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    // sharp absent : cas normal, pas une panne. Le justificatif se passe de carte.
    return null;
  }

  try {
    if (!Array.isArray(geometrie) || geometrie.length < 2) return null;
    const lons = geometrie.map((p) => p[0]);
    const lats = geometrie.map((p) => p[1]);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    // Marge pour ne pas coller le tracé au bord, puis mise au rapport du cadre.
    const margeLon = (maxLon - minLon) * 0.08 || 0.004;
    const margeLat = (maxLat - minLat) * 0.08 || 0.004;
    const fenetre = ajusterAuRapport(
      minLon - margeLon, minLat - margeLat, maxLon + margeLon, maxLat + margeLat, RAPPORT_CARTE,
    );

    const z = choisirZoom(fenetre.minLon, fenetre.minLat, fenetre.maxLon, fenetre.maxLat);
    const tuileXMin = Math.floor(lonVersX(fenetre.minLon, z));
    const tuileXMax = Math.floor(lonVersX(fenetre.maxLon, z));
    const tuileYMin = Math.floor(latVersY(fenetre.maxLat, z));
    const tuileYMax = Math.floor(latVersY(fenetre.minLat, z));
    const colonnes = tuileXMax - tuileXMin + 1;
    const lignes = tuileYMax - tuileYMin + 1;
    if (colonnes < 1 || lignes < 1 || colonnes * lignes > MAX_TUILES) return null;

    const largeur = colonnes * TAILLE_TUILE;
    const hauteur = lignes * TAILLE_TUILE;

    const telechargements = [];
    for (let tx = tuileXMin; tx <= tuileXMax; tx += 1) {
      for (let ty = tuileYMin; ty <= tuileYMax; ty += 1) {
        const url = urlTuiles.replace("{z}", z).replace("{x}", tx).replace("{y}", ty);
        telechargements.push(
          fetchAvecDelai(url, {}, 7000)
            .then((r) => (r.ok ? r.arrayBuffer() : null))
            .then((buf) => (buf
              ? {
                input: Buffer.from(buf),
                left: (tx - tuileXMin) * TAILLE_TUILE,
                top: (ty - tuileYMin) * TAILLE_TUILE,
              }
              : null))
            .catch(() => null),
        );
      }
    }
    const tuiles = (await Promise.all(telechargements)).filter(Boolean);
    if (!tuiles.length) return null;

    const versPixels = ([lon, lat]) => [
      lonVersX(lon, z) * TAILLE_TUILE - tuileXMin * TAILLE_TUILE,
      latVersY(lat, z) * TAILLE_TUILE - tuileYMin * TAILLE_TUILE,
    ];
    const points = reduire(geometrie, 400).map(versPixels);
    const trace = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const [dx, dy] = versPixels(geometrie[0]);
    const [ax, ay] = versPixels(geometrie[geometrie.length - 1]);
    const calque = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}">
        <polyline points="${trace}" fill="none" stroke="#1d4ed8" stroke-width="5"
          stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>
        <circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="8" fill="#16a34a" stroke="#fff" stroke-width="2.5"/>
        <circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="8" fill="#dc2626" stroke="#fff" stroke-width="2.5"/>
      </svg>`,
    );

    const mosaique = await sharp({
      create: { width: largeur, height: hauteur, channels: 3, background: "#e8ecf0" },
    })
      .composite([...tuiles, { input: calque, left: 0, top: 0 }])
      .png()
      .toBuffer();

    // Recadrage sur la fenêtre demandée. L'assemblage est aligné sur des tuiles entières et
    // déborde donc toujours, jusqu'à 255 px de chaque côté. Sans découpe, ce débord passe pour de
    // la carte utile et écrase le tracé dans un cadre déjà bas.
    const origineX = tuileXMin * TAILLE_TUILE;
    const origineY = tuileYMin * TAILLE_TUILE;
    const gauche = Math.min(largeur - 16, Math.max(0, Math.round(lonVersX(fenetre.minLon, z) * TAILLE_TUILE - origineX)));
    const haut = Math.min(hauteur - 16, Math.max(0, Math.round(latVersY(fenetre.maxLat, z) * TAILLE_TUILE - origineY)));
    const droite = Math.min(largeur, Math.round(lonVersX(fenetre.maxLon, z) * TAILLE_TUILE - origineX));
    const bas = Math.min(hauteur, Math.round(latVersY(fenetre.minLat, z) * TAILLE_TUILE - origineY));

    // Palette indexée : un fond de carte n'a qu'une poignée de couleurs, inutile de doubler le
    // poids du PDF pour du 24 bits.
    const png = await sharp(mosaique)
      .extract({
        left: gauche,
        top: haut,
        width: Math.min(largeur - gauche, Math.max(16, droite - gauche)),
        height: Math.min(hauteur - haut, Math.max(16, bas - haut)),
      })
      .png({ palette: true, quality: 90, effort: 7 })
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    // Toute panne de carte est absorbée : le justificatif reste valable sans illustration.
    return null;
  }
}

module.exports = {
  MAX_TUILES,
  RAPPORT_CARTE,
  URL_TUILES,
  ajusterAuRapport,
  choisirZoom,
  construireCartePng,
  latVersY,
  lonVersX,
};
