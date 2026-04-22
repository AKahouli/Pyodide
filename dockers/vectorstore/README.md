🎯 Objectif
Ce guide permet de lancer le service vectorstore en local via Docker Compose en utilisant les services distants (Redis, PostgreSQL, ADK, etc.).

🧱 1. Prérequis
💻 Installer Docker (Windows)
1-Télécharger Docker Desktop : https://www.docker.com/products/docker-desktop/
2-Installer Docker Desktop puis redémarrer le PC
3-Vérifier l’installation : 
docker --version
docker compose version

🔐 2. Connexion à Azure Container Registry (ACR) par : docker login yscrmetachatbot001.azurecr.io
A utiliser apres le lancement de la commande :
DOCKER_REGISTRY_SERVER_USERNAME= yscrmetachatbot001
DOCKER_REGISTRY_SERVER_PASSWORD= zD3E1oAVw5PLYEw2hUaPtggrvPgYqAuKBwzokHfy4d+ACRDhdJ4c

📁 3. Structure du projet
Le projet contient : 
** docker-compose.yml (services vectorstore + celery)
** .env (configuration complète) NB: c'est un fichier caché, vous devez activer cache file option dans le répartoire pour le consulter

⚙️ 4. Configuration (.env)
Le fichier .env est déjà configuré pour utiliser les services distants : Aucune modification n’est nécessaire pour démarrer et il faut utiliser le même REDIS avec ADK sinon vous pouvez changer les instances de la base et redis lancés dans votre local.
* Redis distant
* PostgreSQL distant
* Qdrant distant
* ADK distant
* ....

▶️ 5. Lancer le projet :Dans le dossier contenant docker-compose.yml : docker compose up -d

🔍 6. Vérification des containers : docker ps
Tu dois voir :
* vectorstore API (port 3413)
* celery workers
* flower (port 5564)

🌐 7. Accès aux services
API vectorstore : http://localhost:3413
Flower (monitoring celery) : http://localhost:5564 avec user metachatbot et mdp metachatbot

📜 8. Logs des containers :
 docker compose logs -f 
ou pour seulement el conteneur principal du vectorstore : docker logs -f yellowstorm-vectorstore-api-dev

⛔ 9. Arrêter les services : docker compose down
