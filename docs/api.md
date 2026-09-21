# API HTTP

Base : `/api`. Les réponses sont en JSON, sauf les documents (PDF, HTML, CSV) et la pièce jointe
d'un véhicule.

Toutes les réponses JSON portent `succes`. En cas d'échec, le corps est
`{ "succes": false, "erreur": "message lisible" }` et le code HTTP est 400 (saisie), 401
(jeton), 404 (introuvable) ou 502 (service externe indisponible).

## Authentification

Si la variable `IK_JETON` est renseignée, chaque requête doit porter l'en-tête `x-ik-jeton`.
Pour les liens ouverts dans un onglet (justificatif, récapitulatif), le jeton est accepté en
paramètre d'URL `?jeton=`.

Si `IK_JETON` est vide, l'API est ouverte. Ne l'exposez alors pas au-delà de votre réseau local.

## Configuration

### `GET /api/config`

```json
{
  "succes": true,
  "entreprise": "Exemple SARL",
  "pdf": true,
  "bareme": {
    "libelle": "Barème kilométrique 2026 (revenus 2025)",
    "source": "https://www.impots.gouv.fr/node/4002",
    "valableJusquAu": "2027-12-31",
    "aVerifierApres": "2027-03-01",
    "aVerifier": false,
    "perime": false
  },
  "annees": [2026]
}
```

`pdf` vaut `false` quand Puppeteer n'est pas installé : les documents sortent alors en HTML.
`aVerifier` signale qu'un nouvel arrêté a pu paraître, `perime` que la saisie est bloquée.

## Véhicules

| Méthode | Chemin | Effet |
| --- | --- | --- |
| `GET` | `/api/vehicules` | Liste du parc |
| `POST` | `/api/vehicules` | Ajoute `{ libelle, immatriculation, puissanceFiscale, electrique }` |
| `PUT` | `/api/vehicules/:id` | Modifie les mêmes champs |
| `DELETE` | `/api/vehicules/:id` | Supprime la fiche et sa pièce jointe |
| `POST` | `/api/vehicules/:id/document` | Joint `{ nom, contenuBase64 }` (PDF, JPG, PNG, WEBP, HEIC, 12 Mo) |
| `GET` | `/api/vehicules/:id/document` | Renvoie la pièce jointe |
| `DELETE` | `/api/vehicules/:id/document` | Retire la pièce jointe |

Supprimer un véhicule ne touche pas aux indemnités déjà enregistrées : elles portent leur propre
copie de l'immatriculation et de la puissance.

## Adresses et trajet

### `GET /api/adresses?q=`

Suggestions de la Base Adresse Nationale, à partir de trois caractères.

```json
{ "succes": true, "suggestions": [
  { "libelle": "1 Rue de la Paix 75002 Paris", "lat": 48.86, "lon": 2.33,
    "commune": "Paris", "codePostal": "75002", "contexte": "75, Paris", "score": 0.97 }
] }
```

### `POST /api/trajet`

```json
{ "depart": "Place du Capitole, Toulouse", "arrivee": "Place de la Comédie, Montpellier",
  "allerRetour": true, "pointDepart": null, "pointArrivee": null }
```

`pointDepart` et `pointArrivee` acceptent une suggestion déjà choisie (`{ libelle, lat, lon }`).
Les fournir évite un second géocodage, qui pourrait retenir une autre adresse que celle cliquée.

Réponse : `{ succes, trajet: { depart, arrivee, allerRetour, allerKm, distanceKm,
dureeMinutes, source } }`. Le tracé complet n'est pas renvoyé, il ne sert qu'à la carte.

## Indemnités

### `POST /api/indemnites/apercu`

Calcule sans rien enregistrer. Corps : `{ date, vehiculeId, distanceKm }`, ou
`{ date, immatriculation, puissanceFiscale, electrique, distanceKm }`.

La réponse contient le montant, le taux unitaire, le cumul annuel du véhicule, et l'écrêtage de
puissance le cas échéant.

### `POST /api/indemnites`

```json
{
  "date": "2026-09-20",
  "beneficiaire": "Prénom Nom",
  "vehiculeId": "uuid",
  "motif": "Rendez-vous client",
  "depart": "Place du Capitole, Toulouse",
  "arrivee": "Place de la Comédie, Montpellier",
  "allerRetour": true,
  "distanceKm": null,
  "annexes": []
}
```

Déroulé : le trajet est résolu **avant** l'écriture, pour qu'une adresse introuvable fasse
échouer la saisie entière au lieu de laisser une indemnité sans justificatif. La distance
retenue est celle fournie, sinon celle de l'itinéraire. Le justificatif est ensuite produit et
rangé ; si cette dernière étape échoue, l'indemnité reste enregistrée et la réponse porte un
`avertissement`.

`annexes` accepte des lignes libres `{ heure, libelle, intervenant, detail }`, imprimées sous la
carte. C'est là que l'on adosse le déplacement à une trace indépendante : rendez-vous,
intervention, bon de livraison.

### Autres routes

| Méthode | Chemin | Effet |
| --- | --- | --- |
| `GET` | `/api/indemnites?annee=2026` | Liste, années disponibles, totaux |
| `GET` | `/api/indemnites/:id/justificatif` | Le document produit à la saisie |
| `POST` | `/api/indemnites/:id/annuler` | Marque annulée, avec `{ motif }` |
| `DELETE` | `/api/indemnites/:id` | Supprime l'entrée et son justificatif |

Annuler et supprimer ne servent pas au même cas. Une indemnité communiquée ou comptabilisée
s'annule : la pièce reste, le montant sort des totaux et du cumul annuel. Une saisie erronée qui
n'a pas quitté la machine se supprime.

### `GET /api/recapitulatif/:annee?format=pdf|html|csv`

Récapitulatif annuel groupé par véhicule, annulations exclues. Le CSV sort en point-virgule avec
virgule décimale et BOM, c'est-à-dire lisible par Excel en configuration française.
