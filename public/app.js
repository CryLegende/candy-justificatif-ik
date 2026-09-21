// Interface : un seul fichier, sans dépendance ni étape de construction.
// Elle ne fait que trois choses : appeler l'API, afficher ce qu'elle renvoie, et garder en
// mémoire l'adresse choisie dans une liste de suggestions (pour ne pas re-géocoder un texte
// ambigu au moment de l'enregistrement).

const $ = (id) => document.getElementById(id);

// Jeton d'API, si le serveur en exige un (variable IK_JETON). Gardé dans le navigateur, demandé
// une seule fois au premier refus.
const CLE_JETON = "ik:jeton";

const etat = {
  vehicules: [],
  pointDepart: null,
  pointArrivee: null,
  trajet: null,
  config: null,
};

async function api(chemin, options = {}) {
  const enTetes = { ...(options.headers || {}) };
  if (options.body) enTetes["Content-Type"] = "application/json";
  const jeton = localStorage.getItem(CLE_JETON);
  if (jeton) enTetes["x-ik-jeton"] = jeton;

  const reponse = await fetch(`/api${chemin}`, { ...options, headers: enTetes });
  if (reponse.status === 401) {
    const saisi = prompt("Jeton d'accès à l'API :");
    if (saisi) {
      localStorage.setItem(CLE_JETON, saisi);
      return api(chemin, options);
    }
    throw new Error("Accès refusé");
  }
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok || donnees.succes === false) {
    throw new Error(donnees.erreur || `Erreur ${reponse.status}`);
  }
  return donnees;
}

function euros(valeur) {
  return `${Number(valeur || 0).toFixed(2).replace(".", ",")} €`;
}

function dateFr(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return iso || "";
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a}`;
}

function afficherMessage(element, texte, type = "erreur") {
  element.textContent = texte;
  element.className = `message ${type}`;
  element.hidden = !texte;
}

/** Retarde un appel tant que l'utilisateur tape : une frappe ne doit pas valoir une requête. */
function differer(fonction, delai) {
  let minuteur = null;
  return (...args) => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => fonction(...args), delai);
  };
}

// ── Onglets ───────────────────────────────────────────────────────────────────
const onglets = [
  { bouton: "onglet-saisie", vue: "vue-saisie" },
  { bouton: "onglet-historique", vue: "vue-historique" },
  { bouton: "onglet-vehicules", vue: "vue-vehicules" },
];

function ouvrirOnglet(idBouton) {
  for (const onglet of onglets) {
    const actif = onglet.bouton === idBouton;
    $(onglet.bouton).setAttribute("aria-selected", String(actif));
    $(onglet.vue).hidden = !actif;
  }
  if (idBouton === "onglet-historique") chargerHistorique();
  if (idBouton === "onglet-vehicules") chargerVehicules();
}

for (const onglet of onglets) {
  $(onglet.bouton).addEventListener("click", () => ouvrirOnglet(onglet.bouton));
}

// ── Configuration et barème ───────────────────────────────────────────────────
async function chargerConfig() {
  const donnees = await api("/config");
  etat.config = donnees;
  $("bareme-libelle").textContent = donnees.bareme.libelle;
  $("lien-bareme").href = donnees.bareme.source;

  const avertissement = $("avertissement-bareme");
  if (donnees.bareme.perime) {
    avertissement.textContent = `Le barème intégré n'est vérifié que jusqu'au ${dateFr(donnees.bareme.valableJusquAu)}. `
      + "Les déplacements postérieurs sont refusés tant que les coefficients n'ont pas été mis à jour.";
    avertissement.hidden = false;
  } else if (donnees.bareme.aVerifier) {
    avertissement.textContent = "Un nouvel arrêté a pu paraître. Vérifiez les coefficients du barème "
      + "avant de continuer à saisir des déplacements.";
    avertissement.hidden = false;
  }
  if (!donnees.pdf) {
    afficherMessage($("message-saisie"),
      "Puppeteer n'est pas installé : les justificatifs seront produits en HTML, pas en PDF.", "ok");
  }
}

// ── Véhicules ─────────────────────────────────────────────────────────────────
async function chargerVehicules() {
  const donnees = await api("/vehicules");
  etat.vehicules = donnees.vehicules;
  rendreSelecteurVehicules();
  rendreListeVehicules();
}

function rendreSelecteurVehicules() {
  const selecteur = $("champ-vehicule");
  const choisi = selecteur.value;
  selecteur.innerHTML = etat.vehicules.length
    ? etat.vehicules.map((v) => `<option value="${v.id}">${v.libelle} (${v.immatriculation}, ${v.puissanceFiscale} CV${v.electrique ? ", électrique" : ""})</option>`).join("")
    : '<option value="">Ajoutez d\'abord un véhicule</option>';
  if (choisi) selecteur.value = choisi;
}

function rendreListeVehicules() {
  const conteneur = $("liste-vehicules");
  $("vehicules-vide").hidden = etat.vehicules.length > 0;
  conteneur.innerHTML = etat.vehicules.map((v) => `
    <div class="vehicule" data-id="${v.id}">
      <div>
        <div class="nom">${v.libelle}</div>
        <div class="meta">${v.immatriculation} - ${v.puissanceFiscale} CV - ${v.electrique ? "électrique" : "thermique"}</div>
      </div>
      <div class="espace"></div>
      ${v.documentNom
        ? `<a class="etiquette ok" href="/api/vehicules/${v.id}/document" target="_blank" rel="noopener">${v.documentNom}</a>
           <button type="button" class="discret" data-action="retirer-document">Retirer</button>`
        : `<label class="etiquette" style="cursor:pointer">
             Joindre la carte grise
             <input type="file" data-action="document" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" hidden>
           </label>`}
      <button type="button" class="discret danger" data-action="supprimer">Supprimer</button>
    </div>`).join("");
}

$("liste-vehicules").addEventListener("click", async (evenement) => {
  const bouton = evenement.target.closest("button");
  if (!bouton) return;
  const id = bouton.closest(".vehicule").dataset.id;
  try {
    if (bouton.dataset.action === "supprimer") {
      if (!confirm("Supprimer ce véhicule ? Les indemnités déjà enregistrées ne sont pas touchées.")) return;
      await api(`/vehicules/${id}`, { method: "DELETE" });
    }
    if (bouton.dataset.action === "retirer-document") {
      await api(`/vehicules/${id}/document`, { method: "DELETE" });
    }
    await chargerVehicules();
  } catch (err) {
    afficherMessage($("message-vehicule"), err.message);
  }
});

$("liste-vehicules").addEventListener("change", async (evenement) => {
  const champ = evenement.target;
  if (champ.dataset.action !== "document" || !champ.files.length) return;
  const fichier = champ.files[0];
  const id = champ.closest(".vehicule").dataset.id;
  try {
    // FileReader rend une data URI ; le serveur retire le préfixe avant décodage.
    const contenuBase64 = await new Promise((resoudre, rejeter) => {
      const lecteur = new FileReader();
      lecteur.onload = () => resoudre(lecteur.result);
      lecteur.onerror = () => rejeter(new Error("Lecture du fichier impossible"));
      lecteur.readAsDataURL(fichier);
    });
    await api(`/vehicules/${id}/document`, {
      method: "POST",
      body: JSON.stringify({ nom: fichier.name, contenuBase64 }),
    });
    await chargerVehicules();
  } catch (err) {
    afficherMessage($("message-vehicule"), err.message);
  }
});

$("formulaire-vehicule").addEventListener("submit", async (evenement) => {
  evenement.preventDefault();
  try {
    await api("/vehicules", {
      method: "POST",
      body: JSON.stringify({
        libelle: $("champ-libelle").value,
        immatriculation: $("champ-immatriculation").value,
        puissanceFiscale: Number($("champ-puissance").value),
        electrique: $("champ-electrique").checked,
      }),
    });
    evenement.target.reset();
    afficherMessage($("message-vehicule"), "Véhicule ajouté.", "ok");
    await chargerVehicules();
  } catch (err) {
    afficherMessage($("message-vehicule"), err.message);
  }
});

// ── Autocomplétion d'adresse ──────────────────────────────────────────────────
// Le point choisi est mémorisé avec ses coordonnées. Sans cela, le serveur re-géocoderait le
// texte au moment d'enregistrer, et pourrait retenir une autre adresse que celle cliquée.
function brancherAutocompletion(idBloc, idChamp, cleEtat) {
  const bloc = $(idBloc);
  const champ = $(idChamp);
  let liste = null;

  function fermer() {
    if (liste) liste.remove();
    liste = null;
  }

  const chercher = differer(async () => {
    const requete = champ.value.trim();
    if (requete.length < 3) return fermer();
    try {
      const donnees = await api(`/adresses?q=${encodeURIComponent(requete)}`);
      fermer();
      if (!donnees.suggestions.length) return;
      liste = document.createElement("ul");
      liste.innerHTML = donnees.suggestions.map((s, index) => `
        <li data-index="${index}">${s.libelle}<small>${[s.codePostal, s.commune].filter(Boolean).join(" ")}</small></li>`).join("");
      liste.addEventListener("mousedown", (evenement) => {
        // mousedown et pas click : le clic arrive après le blur, qui a déjà fermé la liste.
        const ligne = evenement.target.closest("li");
        if (!ligne) return;
        const choisi = donnees.suggestions[Number(ligne.dataset.index)];
        champ.value = choisi.libelle;
        etat[cleEtat] = choisi;
        fermer();
        rafraichirTrajet();
      });
      bloc.appendChild(liste);
    } catch {
      fermer();
    }
  }, 250);

  champ.addEventListener("input", () => {
    // Le texte a changé : le point mémorisé ne correspond plus.
    etat[cleEtat] = null;
    chercher();
  });
  champ.addEventListener("blur", () => setTimeout(fermer, 120));
}

brancherAutocompletion("bloc-depart", "champ-depart", "pointDepart");
brancherAutocompletion("bloc-arrivee", "champ-arrivee", "pointArrivee");

// ── Trajet et aperçu du montant ───────────────────────────────────────────────
async function rafraichirTrajet() {
  const depart = $("champ-depart").value.trim();
  const arrivee = $("champ-arrivee").value.trim();
  if (!depart || !arrivee) return;
  try {
    const donnees = await api("/trajet", {
      method: "POST",
      body: JSON.stringify({
        depart,
        arrivee,
        allerRetour: $("champ-aller-retour").checked,
        pointDepart: etat.pointDepart,
        pointArrivee: etat.pointArrivee,
      }),
    });
    etat.trajet = donnees.trajet;
    // La distance calculée alimente le champ, mais reste modifiable : un détour professionnel
    // justifié n'est pas une erreur, il est signalé sur le justificatif.
    $("champ-distance").value = donnees.trajet.distanceKm;
    await rafraichirApercu();
  } catch (err) {
    afficherMessage($("message-saisie"), err.message);
  }
}

async function rafraichirApercu() {
  const vehiculeId = $("champ-vehicule").value;
  const date = $("champ-date").value;
  const distanceKm = Number($("champ-distance").value);
  if (!vehiculeId || !date || !distanceKm) return;
  try {
    const donnees = await api("/indemnites/apercu", {
      method: "POST",
      body: JSON.stringify({ vehiculeId, date, distanceKm }),
    });
    const a = donnees.apercu;
    $("resume-montant").textContent = euros(a.montant);
    // Le cumul annuel est affiché parce qu'il explique le montant : à barème progressif, deux
    // trajets identiques ne valent pas la même chose selon la position dans l'année.
    $("resume-detail").textContent = `${a.distanceKm} km au ${a.tauxUnitaire.toFixed(3).replace(".", ",")} €/km. `
      + `Cumul ${a.annee} pour ce véhicule : ${a.distanceAnnuelleKm} km.`
      + (a.puissanceEcretee ? ` Puissance ${a.puissanceFiscale} CV plafonnée à ${a.puissanceAppliquee} CV.` : "");
    afficherMessage($("message-saisie"), "");
  } catch (err) {
    $("resume-montant").textContent = "-";
    $("resume-detail").textContent = err.message;
  }
}

const apercuDiffere = differer(rafraichirApercu, 300);
for (const id of ["champ-date", "champ-distance", "champ-vehicule"]) {
  $(id).addEventListener("change", rafraichirApercu);
}
$("champ-distance").addEventListener("input", apercuDiffere);
$("champ-aller-retour").addEventListener("change", rafraichirTrajet);
$("bouton-recalculer").addEventListener("click", rafraichirTrajet);

// ── Enregistrement ────────────────────────────────────────────────────────────
$("formulaire-indemnite").addEventListener("submit", async (evenement) => {
  evenement.preventDefault();
  const bouton = $("bouton-enregistrer");
  bouton.disabled = true;
  bouton.textContent = "Enregistrement...";
  try {
    const donnees = await api("/indemnites", {
      method: "POST",
      body: JSON.stringify({
        date: $("champ-date").value,
        beneficiaire: $("champ-beneficiaire").value,
        vehiculeId: $("champ-vehicule").value,
        motif: $("champ-motif").value,
        depart: $("champ-depart").value.trim() || null,
        arrivee: $("champ-arrivee").value.trim() || null,
        allerRetour: $("champ-aller-retour").checked,
        pointDepart: etat.pointDepart,
        pointArrivee: etat.pointArrivee,
        distanceKm: Number($("champ-distance").value) || null,
      }),
    });
    afficherMessage($("message-saisie"),
      donnees.avertissement || `Indemnité de ${euros(donnees.entree.montant)} enregistrée.`,
      donnees.avertissement ? "erreur" : "ok");
    $("champ-motif").value = "";
    $("champ-depart").value = "";
    $("champ-arrivee").value = "";
    $("champ-distance").value = "";
    etat.pointDepart = null;
    etat.pointArrivee = null;
    $("resume-montant").textContent = "-";
    $("resume-detail").textContent = "Renseignez un véhicule, une date et une distance.";
  } catch (err) {
    afficherMessage($("message-saisie"), err.message);
  } finally {
    bouton.disabled = false;
    bouton.textContent = "Enregistrer et produire le justificatif";
  }
});

// ── Historique ────────────────────────────────────────────────────────────────
async function chargerHistorique() {
  const selecteurAnnee = $("champ-annee");
  const donneesAnnees = await api("/indemnites");
  const annees = donneesAnnees.annees.length ? donneesAnnees.annees : [new Date().getFullYear()];
  const anneeCourante = selecteurAnnee.value && annees.includes(Number(selecteurAnnee.value))
    ? Number(selecteurAnnee.value)
    : annees[0];
  selecteurAnnee.innerHTML = annees.map((a) => `<option value="${a}">${a}</option>`).join("");
  selecteurAnnee.value = String(anneeCourante);

  const donnees = await api(`/indemnites?annee=${anneeCourante}`);
  const corps = $("corps-historique");
  $("historique-vide").hidden = donnees.entrees.length > 0;
  corps.innerHTML = donnees.entrees.map((e) => `
    <tr class="${e.annuleLe ? "annulee" : ""}" data-id="${e.id}">
      <td>${dateFr(e.date)}</td>
      <td>${e.motif || ""}<span class="sous">${[e.adresseDepart, e.adresseArrivee].filter(Boolean).join(" vers ") || "Distance saisie"}</span></td>
      <td class="serre">${e.immatriculation}<span class="sous">${e.beneficiaire || ""}</span></td>
      <td class="num">${String(e.distanceKm).replace(".", ",")} km</td>
      <td class="num">${euros(e.montant)}</td>
      <td>
        <div class="actions">
          ${e.justificatif ? `<a class="discret" href="/api/indemnites/${e.id}/justificatif" target="_blank" rel="noopener">Justificatif</a>` : ""}
          ${e.annuleLe ? "" : '<button type="button" class="discret" data-action="annuler">Annuler</button>'}
          <button type="button" class="discret danger" data-action="supprimer">Supprimer</button>
        </div>
      </td>
    </tr>`).join("");

  const totaux = donnees.totaux || { nombre: 0, distanceKm: 0, montant: 0 };
  $("totaux").innerHTML = `
    <div>Déplacements<strong>${totaux.nombre}</strong></div>
    <div>Distance<strong>${String(totaux.distanceKm).replace(".", ",")} km</strong></div>
    <div>Indemnités<strong>${euros(totaux.montant)}</strong></div>`;
}

$("champ-annee").addEventListener("change", chargerHistorique);

$("corps-historique").addEventListener("click", async (evenement) => {
  const bouton = evenement.target.closest("button");
  if (!bouton) return;
  const id = bouton.closest("tr").dataset.id;
  try {
    if (bouton.dataset.action === "annuler") {
      const motif = prompt("Motif de l'annulation (facultatif) :") || "";
      // Annuler plutôt que supprimer : la pièce reste au dossier, le montant sort des totaux et
      // du cumul annuel qui sert à calculer les trajets suivants.
      await api(`/indemnites/${id}/annuler`, { method: "POST", body: JSON.stringify({ motif }) });
    }
    if (bouton.dataset.action === "supprimer") {
      if (!confirm("Supprimer définitivement cette indemnité et son justificatif ?")) return;
      await api(`/indemnites/${id}`, { method: "DELETE" });
    }
    await chargerHistorique();
  } catch (err) {
    alert(err.message);
  }
});

function ouvrirRecapitulatif(format) {
  const annee = $("champ-annee").value || new Date().getFullYear();
  const jeton = localStorage.getItem(CLE_JETON);
  // Un téléchargement ouvert dans un onglet ne passe pas d'en-tête : le jeton voyage en paramètre.
  const suffixe = jeton ? `&jeton=${encodeURIComponent(jeton)}` : "";
  window.open(`/api/recapitulatif/${annee}?format=${format}${suffixe}`, "_blank", "noopener");
}

$("bouton-recap-pdf").addEventListener("click", () => ouvrirRecapitulatif("pdf"));
$("bouton-recap-csv").addEventListener("click", () => ouvrirRecapitulatif("csv"));

// ── Démarrage ─────────────────────────────────────────────────────────────────
$("champ-date").value = new Date().toISOString().slice(0, 10);
chargerConfig().catch((err) => afficherMessage($("message-saisie"), err.message));
chargerVehicules().catch((err) => afficherMessage($("message-saisie"), err.message));
