# 📌 Processus SDLC & Bonnes Pratiques

## 🎯 Objectif

Afin de garantir :

-   ✔ **Qualité**
-   ✔ **Responsabilité**
-   ✔ **Clarté**
-   ✔ **Traçabilité**
-   ✔ **Zéro ambiguïté**

Nous suivons le cycle **SDLC** à chaque sprint, accompagné des bonnes
pratiques associées.

Ce cadre a pour objectif de :

-   Structurer nos développements
-   Clarifier les responsabilités à chaque étape
-   Éviter toute interpration ou besoin implicite
-   Assurer un contrôle qualité rigoureux avant chaque mise en
    production

Merci de bien vous référer à ce processus durant vos activités :
Planning, Développement, Pull Request, QA, Release & Maintenance

<img width="1024" height="1536" alt="SDLC_Yellowstorm" src="https://github.com/user-attachments/assets/6ecce566-7fc3-44e3-9258-ae313cf0b6dc" />


# 1️⃣ User Story détaillée et comprise

## 🔹 Structure recommandée

### 📌 Titre

Clair, court, orienté valeur métier.

### 📌 Description (format standard)

En tant que \[type d'utilisateur\]
Je veux \[action\]
Afin de \[bénéfice métier\]

------------------------------------------------------------------------

## ✅ Critères d'acceptation (Given / When / Then)

Inclure Obligatoirement: 
- Cas nominal
- Cas erreur
- Cas limites
- Permissions

------------------------------------------------------------------------

## ✅ Definition of Ready (DoR)

Avant qu’une User Story parte en développement, elle doit avoir :: 
- Description claire
- Critères d’acceptation validés
- Cas limites mentionnés

------------------------------------------------------------------------

## ✅ Definition of Done (DoD)

Une tâche est Done uniquement si :

-   Code mergé
-   Revue validée
-   Tests unitaires OK
-   Tests fonctionnels OK
-   Pas de régression
-   Documentation mise à jour
-   Déployé en environnement production

------------------------------------------------------------------------

# 2️⃣ Life Cycle d'une Tâche
```
Backlog\
↓\
En cours\
↓\
Dev terminé\
↓\
Pull Request\
↓\
Review\
↓\
Corrections\
↓\
Validation PR\
↓\
Déploiement\
↓\
Test QA / Demandeur\
↓\
Clôture
```
------------------------------------------------------------------------

# 3️⃣  Amélioration du Processus de Développement

## 🔹 Pull Request de qualité

Chaque PR doit inclure systématiquement :

-   🎯 Contexte
-   🔍 Ce qui a été fait
-   📸 Screenshots / GIF
-   🧪 Comment tester
-   📌 Impact / risques
-   🔗 Lien vers l'US

Vérifications supplémentaires :

-   Variables d'environnement ajoutées / modifiées
-   Mise à jour documentation (si nécessaire)
-   Nouvelles librairies ajoutées (préciser lesquelles + justification)


## 🔹 Checklist Pull Request

Avant validation technique :

- Code lisible

- Pas de code mort

- Logs propres

- Gestion des erreurs

- Sécurité respectée

- Performance vérifiée

Avant validation fonctionnelle :

- 📐 Respect de la User Story

- 🧪 Testé par le reviewer

------------------------------------------------------------------------

# 4️⃣ Bonnes pratiques QA & Tests

## Types de tests à couvrir

-   Cas nominal
-   Cas limites
-   Cas erreurs
-   Smoke Test
-   Test exploratoire
-   Tests multi-navigateurs
-   Tests de non-régression

------------------------------------------------------------------------

# 🐞 Priorisation des bugs

-   🔴 Bloquant
-   🟠 Majeur
-   🟡 Mineur

Chaque bug doit inclure :

-   Environnement
-   Version
-   Étapes précises
-   Résultat attendu
-   Résultat obtenu
-   Logs ou captures
