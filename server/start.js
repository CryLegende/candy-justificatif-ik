// Démarrage du serveur. Toute la configuration passe par des variables d'environnement, pour que
// la même image Docker serve en local et en production sans être reconstruite.
//
//   IK_PORT            port d'écoute (défaut 3200)
//   IK_DOSSIER_DONNEES dossier des fichiers JSON et des pièces (défaut ./donnees)
//   IK_ENTREPRISE      raison sociale imprimée sur les documents
//   IK_JETON           si défini, toutes les routes de l'API exigent ce jeton
//   IK_BAN_URL         instance de la Base Adresse Nationale
//   IK_OSRM_URL        instance OSRM
//   IK_TUILES_URL      serveur de tuiles, motif {z}/{x}/{y}

const path = require("path");
const { creerApplication } = require("./app");
const { fermerNavigateur } = require("../src/pdf");

const port = Number(process.env.IK_PORT) || 3200;
const dossierDonnees = process.env.IK_DOSSIER_DONNEES
  ? path.resolve(process.env.IK_DOSSIER_DONNEES)
  : path.join(__dirname, "..", "donnees");

const app = creerApplication({
  dossierDonnees,
  entreprise: process.env.IK_ENTREPRISE || "",
  jeton: process.env.IK_JETON || "",
  urlBan: process.env.IK_BAN_URL || undefined,
  urlOsrm: process.env.IK_OSRM_URL || undefined,
  urlTuiles: process.env.IK_TUILES_URL || undefined,
});

const serveur = app.listen(port, () => {
  console.log(`Indemnites kilometriques : http://localhost:${port}`);
  console.log(`Donnees : ${dossierDonnees}`);
  if (!process.env.IK_JETON) {
    console.log("Aucun jeton configure : l'API est ouverte a qui atteint ce port.");
  }
});

// Arrêt propre : sans cela, Chromium survit au conteneur et garde le dossier de profil ouvert.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    serveur.close(() => {
      fermerNavigateur().finally(() => process.exit(0));
    });
  });
}
