// Géocodage d'adresses via la Base Adresse Nationale (BAN).
//
// Pourquoi la BAN plutôt qu'un service commercial : c'est le référentiel officiel des adresses
// françaises, publié par l'État, sans clé d'API, sans quota contractuel, et sans condition
// d'affichage de carte. Pour une pièce justificative destinée à l'administration fiscale, citer
// la source publique de normalisation des adresses vaut mieux que citer un fournisseur privé.
//
// Deux usages distincts, volontairement séparés :
//   - `rechercher()` sert l'autocomplétion : plusieurs résultats, réponse rapide, l'humain choisit.
//   - `geocoder()` sert le calcul : un seul résultat, celui que la BAN classe premier.
//
// Préférer toujours `rechercher()` dans une interface. Un « 1er résultat » suffit pour une rue
// nommée, mais rate régulièrement les centres commerciaux, zones d'activité et lieux-dits, et une
// erreur d'adresse se propage en silence jusqu'au montant de l'indemnité.

const URL_BAN = "https://api-adresse.data.gouv.fr/search/";
const USER_AGENT = "indemnites-kilometriques/1.0";
const DELAI_GEOCODAGE_MS = 9000;
const DELAI_RECHERCHE_MS = 6000;

/**
 * fetch avec délai maximal. Sans cela, une API lente bloque la requête HTTP appelante jusqu'au
 * timeout du navigateur, et l'utilisateur ne voit qu'un formulaire figé.
 */
function fetchAvecDelai(url, options = {}, delaiMs = DELAI_GEOCODAGE_MS) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), delaiMs);
  const headers = { "User-Agent": USER_AGENT, ...(options.headers || {}) };
  return fetch(url, { ...options, headers, signal: controleur.signal })
    .finally(() => clearTimeout(minuteur));
}

/** Adresse ramenée à une ligne propre, bornée en longueur. */
function nettoyerAdresse(valeur) {
  return String(valeur || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Une entité BAN convertie en point exploitable. */
function versPoint(feature) {
  const [lon, lat] = feature.geometry.coordinates;
  const p = feature.properties || {};
  return {
    libelle: p.label || "",
    lat: Number(lat),
    lon: Number(lon),
    commune: p.city || "",
    codePostal: p.postcode || "",
    contexte: p.context || "",
    type: p.type || "",
    score: Number(p.score) || 0,
  };
}

/**
 * Géocodeur configurable.
 * @param {{ urlBan?: string }} [options] URL d'une instance BAN auto-hébergée, le cas échéant
 */
function creerGeocodeur({ urlBan = URL_BAN } = {}) {
  return {
    /**
     * Résout une adresse en un point unique.
     * @throws si l'adresse est introuvable ou le service indisponible
     */
    async geocoder(adresseBrute) {
      const requete = nettoyerAdresse(adresseBrute);
      if (requete.length < 3) throw new Error("Adresse trop courte");
      const url = new URL(urlBan);
      url.searchParams.set("q", requete);
      url.searchParams.set("limit", "1");
      url.searchParams.set("autocomplete", "0");

      const reponse = await fetchAvecDelai(url.toString(), {}, DELAI_GEOCODAGE_MS);
      if (!reponse.ok) throw new Error(`Géocodage indisponible (BAN ${reponse.status})`);
      const donnees = await reponse.json();
      const feature = Array.isArray(donnees.features) ? donnees.features[0] : null;
      if (!feature || !feature.geometry) throw new Error(`Adresse introuvable : "${requete}"`);
      return { ...versPoint(feature), requete };
    },

    /**
     * Suggestions d'adresses pour un champ de saisie.
     * @returns {Promise<Array>} liste éventuellement vide, jamais nulle
     */
    async rechercher(requeteBrute, { limite = 6 } = {}) {
      const requete = nettoyerAdresse(requeteBrute);
      if (requete.length < 3) return [];
      const url = new URL(urlBan);
      url.searchParams.set("q", requete);
      url.searchParams.set("limit", String(limite));
      url.searchParams.set("autocomplete", "1");

      const reponse = await fetchAvecDelai(url.toString(), {}, DELAI_RECHERCHE_MS);
      if (!reponse.ok) throw new Error(`Recherche d'adresse indisponible (BAN ${reponse.status})`);
      const donnees = await reponse.json();
      return (Array.isArray(donnees.features) ? donnees.features : [])
        .filter((f) => f && f.geometry && Array.isArray(f.geometry.coordinates))
        .map(versPoint);
    },
  };
}

/**
 * Point déjà choisi par l'utilisateur dans une liste de suggestions.
 * Le renvoyer tel quel évite de re-géocoder, donc évite qu'un second appel à la BAN retienne une
 * autre adresse que celle qui a été cliquée.
 */
function normaliserPoint(point) {
  if (point && typeof point === "object"
    && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon))) {
    return {
      libelle: nettoyerAdresse(point.libelle || point.label),
      lat: Number(point.lat),
      lon: Number(point.lon),
      commune: point.commune || point.city || "",
      codePostal: point.codePostal || point.postcode || "",
      contexte: point.contexte || point.context || "",
      score: 1,
    };
  }
  return null;
}

module.exports = {
  DELAI_GEOCODAGE_MS,
  DELAI_RECHERCHE_MS,
  URL_BAN,
  USER_AGENT,
  creerGeocodeur,
  fetchAvecDelai,
  nettoyerAdresse,
  normaliserPoint,
};
