# Déploiement

## Docker

```bash
docker compose up -d --build
```

L'interface répond sur `http://localhost:3200`. Tout l'état vit dans `./donnees`, monté sur
`/donnees` dans le conteneur : registre, fiches véhicules, cartes grises, justificatifs. C'est
le seul dossier à sauvegarder, et le seul à restaurer.

L'image installe Chromium par le gestionnaire de paquets d'Alpine plutôt que par le
téléchargement de Puppeteer. Le binaire distribué par Puppeteer est lié à la glibc et ne démarre
pas sur Alpine, qui utilise musl. Les polices `ttf-freefont` sont nécessaires : sans elles, le
PDF sort avec des carrés à la place du texte.

## Sans Docker

```bash
npm install
npm start
```

Node 20 ou plus. `npm install` tire Chromium (environ 200 Mo) pour Puppeteer. Si vous n'avez pas
besoin des PDF, `npm install --omit=optional` suffit : les documents sortiront en HTML.

## Variables d'environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `IK_PORT` | `3200` | Port d'écoute |
| `IK_DOSSIER_DONNEES` | `./donnees` | Où vivent les données |
| `IK_ENTREPRISE` | vide | Raison sociale imprimée sur les documents |
| `IK_JETON` | vide | Si renseigné, exigé sur toutes les routes de l'API |
| `IK_BAN_URL` | BAN publique | Instance de géocodage |
| `IK_OSRM_URL` | OSRM public | Instance de calcul d'itinéraire |
| `IK_TUILES_URL` | tuiles OSM | Serveur de tuiles, motif `{z}/{x}/{y}` |

## Accès et sécurité

Le module contient des adresses, des immatriculations, des cartes grises et des noms de
personnes. Ce sont des données personnelles.

Sans `IK_JETON`, l'API est ouverte à qui atteint le port. C'est acceptable sur une machine
personnelle, pas sur un serveur exposé. Deux options :

- renseigner `IK_JETON` avec une valeur longue et aléatoire (l'interface la demande une fois et
  la garde dans le navigateur) ;
- ou monter le routeur dans une application qui a déjà son authentification, comme décrit dans
  [bibliotheque.md](bibliotheque.md).

Dans les deux cas, mettez du TLS devant si le service sort de votre réseau local.

## Services externes

Par défaut, le module appelle trois services publics et gratuits :

- la Base Adresse Nationale (`api-adresse.data.gouv.fr`), service de l'État, sans clé ;
- OSRM (`router.project-osrm.org`), **instance de démonstration sans engagement de service** ;
- les tuiles OpenStreetMap, soumises à une
  [politique d'usage](https://operations.osmfoundation.org/policies/tiles/).

Pour un usage régulier, hébergez au moins votre propre OSRM. Il est le seul des trois à se
trouver sur le chemin critique : si le calcul d'itinéraire échoue, la saisie d'un déplacement
avec deux adresses échoue aussi. Le géocodage et les tuiles ne bloquent rien d'aussi sévère.

```yaml
# extrait de docker-compose.yml
services:
  osrm:
    image: osrm/osrm-backend
    command: osrm-routed --algorithm mld /data/france-latest.osrm
    volumes:
      - ./osrm:/data
```

Puis `IK_OSRM_URL: "http://osrm:5000"`. La préparation des données France demande plusieurs Go
de disque et une bonne heure de calcul, une seule fois.

## Sauvegarde

Le dossier de données contient :

```
donnees/
  indemnites.json          registre des déplacements
  vehicules.json           fiches du parc
  vehicules-documents/     cartes grises, sans extension, nommées par identifiant
  justificatifs/           un PDF ou HTML par indemnité
```

Les fichiers JSON sont écrits de façon atomique (fichier temporaire puis renommage), donc une
copie prise à chaud est toujours un JSON complet, jamais tronqué.

Les justificatifs se regénèrent difficilement : ils portent la carte et les adresses telles
qu'elles étaient au moment de la saisie. Sauvegardez le dossier entier, pas seulement les JSON.

## Mise à jour

```bash
git pull
docker compose up -d --build
```

Les données ne sont pas touchées. Le fichier du registre porte un numéro de version, prévu pour
qu'une future migration sache d'où elle part.
