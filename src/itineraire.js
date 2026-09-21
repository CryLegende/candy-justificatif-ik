// Calcul d'itinéraire routier via OSRM.
//
// Ce qui est calculé, et pourquoi. La distance retenue pour une indemnité kilométrique est la
// distance de l'itinéraire routier entre deux adresses, pas une trace GPS réelle. C'est la
// méthode attendue : une trace réelle inclut les détours personnels, les arrêts, les erreurs de
// navigation, et rend le justificatif contestable au lieu de le renforcer.
//
// OSRM rend le trajet le plus rapide. Le tracé complet (`geometrie`) est conservé : il sert à
// dessiner la carte du justificatif, et il permet de vérifier a posteriori quelle route a servi
// de base au calcul.
//
// L'instance publique https://router.project-osrm.org est une démonstration, sans engagement de
// service. Pour un usage régulier, hébergez votre propre OSRM et passez son URL en configuration
// (variable IK_OSRM_URL). Voir docs/deploiement.md.

const { creerGeocodeur, fetchAvecDelai, normaliserPoint } = require("./geocodage");

const URL_OSRM = "https://router.project-osrm.org";

/** Mètres vers kilomètres, arrondi au 100 m. */
function versKm(metres) {
  return Math.round((Number(metres) / 1000) * 10) / 10;
}

/**
 * Service d'itinéraire.
 * @param {{ urlOsrm?: string, urlBan?: string }} [options]
 */
function creerItineraire({ urlOsrm = URL_OSRM, urlBan } = {}) {
  const geocodeur = creerGeocodeur({ urlBan });

  /** Point de départ ou d'arrivée : coordonnées déjà choisies, sinon géocodage de l'adresse. */
  async function resoudreExtremite(adresse, point) {
    const choisi = normaliserPoint(point);
    if (choisi) return { ...choisi, requete: adresse || choisi.libelle, libelle: choisi.libelle || adresse };
    return geocodeur.geocoder(adresse);
  }

  return {
    /**
     * Itinéraire entre deux points connus (lat/lon).
     * @returns {Promise<{distanceMetres:number, dureeSecondes:number, geometrie:Array}>}
     */
    async entre(depart, arrivee) {
      const coords = `${depart.lon},${depart.lat};${arrivee.lon},${arrivee.lat}`;
      const url = `${urlOsrm.replace(/\/$/, "")}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
      const reponse = await fetchAvecDelai(url);
      if (!reponse.ok) throw new Error(`Calcul d'itinéraire indisponible (OSRM ${reponse.status})`);
      const donnees = await reponse.json();
      if (donnees.code !== "Ok" || !Array.isArray(donnees.routes) || !donnees.routes.length) {
        throw new Error("Aucun itinéraire routier trouvé entre ces deux adresses");
      }
      const meilleure = donnees.routes[0];
      // Repli sur un segment droit si OSRM ne renvoie pas de géométrie : la distance reste juste,
      // seule la carte devient approximative.
      const geometrie = (meilleure.geometry && Array.isArray(meilleure.geometry.coordinates))
        ? meilleure.geometry.coordinates.map(([lon, lat]) => [Number(lon), Number(lat)])
        : [[depart.lon, depart.lat], [arrivee.lon, arrivee.lat]];
      return {
        distanceMetres: Number(meilleure.distance) || 0,
        dureeSecondes: Number(meilleure.duration) || 0,
        geometrie,
      };
    },

    /**
     * Chaîne complète : deux adresses vers une distance indemnisable.
     *
     * Un aller-retour double la distance de l'aller plutôt que de demander un second itinéraire.
     * C'est volontaire : le retour par un sens unique ou une bretelle différente produirait un
     * kilométrage légèrement différent à l'aller et au retour, ce qui est exact mais illisible
     * sur un justificatif, et impossible à recontrôler.
     *
     * @param {object} trajet
     * @param {string} trajet.depart adresse de départ en texte libre
     * @param {string} trajet.arrivee adresse d'arrivée en texte libre
     * @param {boolean} [trajet.allerRetour]
     * @param {object} [trajet.pointDepart] coordonnées déjà choisies pour le départ
     * @param {object} [trajet.pointArrivee] coordonnées déjà choisies pour l'arrivée
     */
    async resoudre({ depart, arrivee, allerRetour = false, pointDepart = null, pointArrivee = null }) {
      const [de, vers] = await Promise.all([
        resoudreExtremite(depart, pointDepart),
        resoudreExtremite(arrivee, pointArrivee),
      ]);
      const route = await this.entre(de, vers);
      const allerKm = versKm(route.distanceMetres);
      const distanceKm = Math.round(allerKm * (allerRetour ? 2 : 1) * 10) / 10;
      return {
        depart: de,
        arrivee: vers,
        allerRetour: allerRetour === true,
        allerKm,
        distanceKm,
        dureeMinutes: Math.round(route.dureeSecondes / 60),
        geometrie: route.geometrie,
        source: "OpenStreetMap / OSRM (itinéraire routier le plus rapide)",
      };
    },
  };
}

module.exports = {
  URL_OSRM,
  creerItineraire,
  versKm,
};
