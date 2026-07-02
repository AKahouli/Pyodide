# Logical Search — Documentation fonctionnelle

> Documentation du **processus complet** : depuis l'indexation logique d'un document jusqu'à sa recherche via le serveur **MCP Logical Indexing**.
>
> Cette documentation décrit **le fonctionnement métier** du système : ce qu'il fait, dans quel ordre, et comment l'utiliser. Aucune connaissance du code n'est requise.

---

## 1. Vue d'ensemble — Pourquoi "logical" ?

Contrairement à une indexation classique qui découpe un document en **morceaux de taille fixe**, l'indexation **logique** reconstruit la **structure réelle du document** — titres, sections, sous-sections, paragraphes, tableaux, figures — *avant* de l'indexer.

Cela apporte quatre bénéfices clés :

1. **Naviguer** dans le document comme dans une table des matières.
2. **Chercher en hybride** (sémantique + mots-clés) sur deux granularités : **sections** (titres) et **blocs** (contenu).
3. **Citer précisément** : chaque réponse peut renvoyer à un bloc, une page, et même la **zone visuelle** exacte sur la page.
4. **Adapter la stratégie** : petit document → tout lire d'un coup, grand document → recherche ciblée.

### Schéma global

```
   ┌───────────────────────────────────────────────────┐
   │             1.  Pipeline d'indexation              │
   │                                                    │
   │   Document source ──▶ Analyse de mise en page      │
   │                  ──▶ Extraction du texte           │
   │                  ──▶ Reconstruction de l'arbre     │
   │                       logique (sections, blocs)    │
   │                  ──▶ Traitement des images         │
   │                  ──▶ Détection de la langue        │
   │                  ──▶ Génération des embeddings     │
   │                  ──▶ Stockage structuré            │
   └───────────────────────────────────────────────────┘
                          │
                          ▼  (base partagée, lecture seule)
   ┌───────────────────────────────────────────────────┐
   │            Données indexées (structurées)          │
   │   Documents · Sections · Blocs · Images · Mots     │
   └───────────────────────────────────────────────────┘
                          │
                          ▼
   ┌───────────────────────────────────────────────────┐
   │           2.  Serveur MCP Logical Search           │
   │                                                    │
   │   Outils de navigation, de recherche hybride       │
   │   et d'ancrage de citations.                       │
   └───────────────────────────────────────────────────┘
```

---

## 2. Phase 1 — Indexation logique

### 2.1. Déclenchement

L'indexation est lancée **en asynchrone** pour un document donné, identifié par :

- son **fichier** (nom et emplacement dans le stockage objet),
- son **espace de travail** (workspace),
- son **utilisateur propriétaire**.

Le système répond immédiatement avec un **identifiant de tâche** ; le traitement réel s'exécute en arrière-plan.

### 2.2. Le pipeline d'indexation, étape par étape

| # | Étape | Ce qu'il se passe |
|---|-------|-------------------|
| 1 | **Récupération** | Le document est téléchargé depuis le stockage objet vers un espace de travail temporaire. |
| 2 | **Normalisation** | Si le document n'est pas déjà un PDF (Office, image…), il est converti. Tout le pipeline travaille ensuite sur un PDF. |
| 3 | **Analyse de mise en page** | Un service spécialisé détecte sur chaque page les **zones visuelles** : titre principal, titre de section, paragraphe, tableau, figure… Chaque zone est associée à un **rectangle (bbox)** et à une **étiquette**. |
| 4 | **Extraction du texte** | Le texte est récupéré à l'intérieur de chaque zone. Pour un PDF natif, aucune OCR n'est nécessaire — c'est très rapide. |
| 5 | **Reconstruction de l'arbre logique** | À partir des zones et de leurs étiquettes, le système reconstruit la **hiérarchie** : titres ↔ sections ↔ sous-sections ↔ paragraphes. Il produit aussi un **sommaire** (TOC) lisible. |
| 6 | **Positions au mot** | Pour chaque bloc de texte, on enregistre les **coordonnées de chaque mot** sur la page. C'est ce qui permettra plus tard de surligner précisément une citation. |
| 7 | **Traitement des images** | Chaque image/figure/graphique est : découpée (crop), filtrée (les visuels non pertinents sont écartés), encodée, et rattachée à sa section. Une description textuelle est produite et stockée *comme du contenu* — l'image devient ainsi cherchable comme du texte. |
| 8 | **Détection de la langue** | La langue dominante du document est détectée. Elle conditionne la qualité de la recherche full-text (lemmatisation, stop-words…). |
| 9 | **Stockage structuré** | Document, sections, blocs, images et positions au mot sont enregistrés ensemble, isolés par utilisateur et workspace. |
| 10 | **Embeddings** | On calcule, en parallèle, un embedding sémantique pour : (a) **le contenu de chaque bloc**, (b) **le titre de chaque section**. C'est ce qui rend la recherche sémantique possible. |

### 2.3. Ce que produit l'indexation

À la fin, on dispose d'une représentation **riche et navigable** du document :

- **Le document** lui-même (métadonnées + sommaire généré).
- Une **liste ordonnée de sections** hiérarchisées (titre, page de début, ordre).
- Une **liste de blocs** rattachés à leur section (texte, type, page, bbox).
- Une **liste d'images** rattachées à leur section (avec leur description textuelle).
- Pour chaque bloc : la **position de chaque mot** sur la page.
- Pour les sections et les blocs : un **embedding sémantique** + un index **full-text**.

### 2.4. Garanties importantes

- **Isolation** : un document n'est jamais visible en dehors de son couple `(utilisateur, workspace)`.
- **Idempotence** : ré-indexer le même document remplace proprement l'ancien contenu — pas de doublons.
- **Robustesse** : si une image n'est pas exploitable ou si une page pose problème, le pipeline saute proprement l'élément en question et continue.

### 2.5. Exemple — indexer un rapport (entrée / sortie)

> *Contexte : un analyste financier dépose `IFRS15.pdf` (50 pages, français) dans son workspace **Finance KB**.*

#### Entrée envoyée au système

```yaml
Document      : IFRS15.pdf
Emplacement   : stockage objet  →  users/u-42/workspaces/ws-finance/IFRS15.pdf
Workspace     : Finance KB  (id : ws-finance)
Utilisateur   : u-42
Origine       : s3://vectorstore/users/u-42/workspaces/ws-finance/IFRS15.pdf
```

#### Sortie immédiate (accusé de réception)

```yaml
Statut        : "queued"  (en file d'attente)
Tâche         : c2f3-7a18-…
Message       : "Indexation logique en cours pour IFRS15.pdf"
```

#### Sortie finale du pipeline (après ~15 s)

```yaml
Fichier               : IFRS15.pdf
Pages totales         : 50
Langue détectée       : français
Sections identifiées  : 27
Blocs extraits        : 312
Images traitées       : 4   (1 schéma, 3 graphiques)
Sommaire généré       : "1. Introduction
                         1.1 Champ d'application
                         2. Modèle en 5 étapes
                         2.1 Étape 1 — Identifier le contrat
                         …"
Embeddings calculés   : 312 (blocs) + 27 (titres de sections)
Durée totale          : 14 400 ms
Statut                : completed
```

#### Aperçu de quelques éléments produits

**Une section :**
```yaml
Titre         : "Modèle en 5 étapes"
Page de début : 2
Plage         : pages 2 à 4
Nombre de blocs : 18
Images        : 1
```

**Un bloc de texte :**
```yaml
Type     : text
Section  : "Modèle en 5 étapes"
Page     : 2
Contenu  : "Étape 1 — Identifier le contrat conclu avec le client. Un contrat
            existe lorsque les parties l'ont approuvé et se sont engagées à
            exécuter leurs obligations respectives…"
Zone     : rectangle (x:72, y:240 → x:520, y:312) sur la page 2
```

**Un bloc image :**
```yaml
Type        : figure
Section     : "Modèle en 5 étapes"
Page        : 3
Description : "Schéma circulaire présentant les 5 étapes de reconnaissance
               du chiffre d'affaires selon IFRS 15, avec flèches reliant
               chaque étape à la suivante."
Image       : (encodée, prête à être affichée)
```

**Une position de mot (pour les highlights futurs) :**
```yaml
Bloc  : "Étape 1 — Identifier le contrat…"
Page  : 2
Mots  :
  - "Étape"      → rectangle (72, 240 → 110, 256)
  - "1"          → rectangle (112, 240 → 122, 256)
  - "Identifier" → rectangle (140, 240 → 215, 256)
  - …
```

→ Le document est désormais **prêt à être interrogé** par le serveur MCP.

---

## 3. Phase 2 — Recherche via le MCP Logical Search

### 3.1. Principes

- Le serveur MCP expose **un catalogue d'outils** qu'un agent (LLM ou client) peut appeler.
- Chaque appel est **scopé** par utilisateur (identité) et par workspace (périmètre métier). Sans cela, l'appel est refusé.
- Tous les outils sont **en lecture seule** — ils ne modifient pas l'indexation.

### 3.2. Le catalogue d'outils

| Libellé fonctionnel | Nom de l'outil MCP | Granularité | À quoi il sert |
|---------------------|--------------------|-------------|----------------|
| Choisir une stratégie | `get_document_strategy` | document | Quand le nom du fichier est connu : décide s'il faut **tout lire** ou **chercher**. |
| Lire tout le document | `read_content` | document | Charge intégralement un document court, balisé par page, avec les images en ligne. |
| Recherche unifiée | `search` | sections + blocs | Recherche hybride globale. Le couteau suisse. |
| Recherche de sections | `search_sections` | sections | Trouver les bonnes zones de haut niveau. Résultats légers. |
| Recherche de blocs | `search_blocks` | blocs | Trouver des **preuves précises** dans le contenu. |
| Sommaire du document | `get_document_map` | document | Vue hiérarchique navigable (titres, page_range, nombre de blocs, présence d'images). |
| Lire une section | `read_section` | section | Contenu complet d'une section **+ ses images**. |
| Lire les blocs d'une section | `read_blocks` | section | Liste détaillée des blocs sans les images. |
| Élargir le contexte | `expand_context` | sections voisines | Sections juste avant / juste après une section donnée. |
| Lire par page | `read_page` | page | Tout le contenu d'une page (ou plage de pages). |
| Ancrer les citations | `locate_answer_citations` | bloc + mot | Outil **terminal** qui transforme une citation textuelle en référence vérifiable (page + zone à surligner). |

### 3.3. La règle de stratégie

Un seuil de pages (configurable) détermine le mode :

- **Petit document** (≤ seuil) → stratégie **"tout lire"**. On charge tout, l'agent répond directement.
- **Grand document** (> seuil) → stratégie **"chercher"**. On utilise les outils de navigation et de recherche.

**Cas particulier** : si le nom du fichier n'est **pas connu** (ex. question ouverte sur tout un workspace), on ne tente pas de choisir une stratégie — on lance directement une **recherche unifiée**.

### 3.4. Comment fonctionne la recherche unifiée

La recherche unifiée combine **trois signaux** pour trouver les sections les plus pertinentes :

1. **Signal "titre de section"** : on cherche les sections dont le titre est sémantiquement proche de la question **et/ou** qui matchent ses mots-clés.
2. **Signal "contenu agrégé"** : on regarde quels **blocs** sont sémantiquement proches de la question, puis on remonte aux sections qui les contiennent.
3. **Signal "bloc précis"** : recherche hybride directement sur le contenu des blocs (sémantique + mots-clés).

Ces trois signaux sont **fusionnés** en un score combiné. Pour chaque section retenue, on rassemble **tous ses blocs** et on les concatène en un texte lisible. Le top 10 final est retourné, trié par score.

> **Cas des images** : les figures sont stockées **avec leur description textuelle**. Une question du type *"montre-moi le graphique de revenu trimestriel"* fait donc remonter les sections concernées comme une question de texte. Pour récupérer la **vraie image**, on appelle ensuite *Lire une section*.

### 3.5. Flux d'usage recommandés

#### Cas A — Question ouverte (fichier inconnu)

```
search(question, workspace)                              # Recherche unifiée
        │
        ▼  on identifie 1 à 3 sections pertinentes
read_section(section_id, …)                              # détail + images
expand_context(section_id, …)                            # si section incomplète
        │
        ▼  l'agent rédige sa réponse
locate_answer_citations(blocs choisis, textes exacts)    # Ancrer les citations
```

#### Cas B — Fichier connu

```
get_document_strategy(fichier, workspace)                # Choisir une stratégie
        │
        ├─  "read_all"  ─▶  read_content(fichier, workspace)
        │                       puis  locate_answer_citations(…)
        │
        └─  "search"    ─▶  search / get_document_map / read_section /
                             read_blocks / expand_context / read_page
                             puis  locate_answer_citations(…)
```

### 3.6. La règle d'or des citations

Pour toute réponse qui s'appuie sur des sources documentaires :

1. Le **dernier outil appelé doit être "Ancrer les citations"**.
2. On lui passe les blocs cités (par leur identifiant de bloc) et le **texte exact** repris dans la réponse.
3. L'outil retourne, pour chaque citation : la **page**, la **source du document**, le **texte trouvé**, et la **zone à surligner** (rectangle).
4. Si un texte cité **ne peut pas être localisé**, la citation est **retirée** de la réponse — on ne garde que ce qui est vérifiable.
5. La réponse finale ne cite **que** les références ainsi validées.

Cette règle garantit qu'**aucune citation n'est inventée** et que chaque preuve est cliquable / surlignable dans le PDF d'origine.

### 3.7. Exemples bout en bout

#### Exemple 1 — Q/R sur un petit document (entrée / sortie)

> *Question utilisateur : "Quel est le résultat du T2 d'après le mémo ?"*
> *Fichier connu : `Memo_Q2.pdf` (6 pages).*

##### Étape 1 — Choisir une stratégie  · `get_document_strategy`

**Entrée :**
```yaml
fichier   : Memo_Q2.pdf
workspace : Finance KB
```

**Sortie :**
```yaml
fichier        : Memo_Q2.pdf
pages totales  : 6
seuil          : 20
stratégie      : "read_all"   →  on charge tout
```

##### Étape 2 — Lire tout le document  · `read_content`

**Entrée :**
```yaml
fichier   : Memo_Q2.pdf
workspace : Finance KB
```

**Sortie (extrait) :**
```yaml
fichier   : Memo_Q2.pdf
pages     : 6
sources   :
  - page : 1
    contenu :
      <page_1>
        <block id="73">Memo trimestriel — T2</block>
        <block id="74">EBITDA grew 12% QoQ, supported by margin expansion…</block>
        <block id="75">Revenue reached €245M, up 8% YoY…</block>
      </page_1>
  - page : 2
    contenu : <page_2>…</page_2>
  - …
```

##### Étape 3 — L'agent rédige sa réponse

> *"Le T2 montre un EBITDA en hausse de 12% par rapport au trimestre précédent, soutenu par une expansion des marges."*

##### Étape 4 — Ancrer les citations  · `locate_answer_citations`

**Entrée :**
```yaml
workspace : Finance KB
fichier   : Memo_Q2.pdf
citations :
  - bloc          : "74"
    texte exact   : "EBITDA grew 12% QoQ"
    référence     : 1
```

**Sortie :**
```yaml
citations :
  - référence       : "[1]"
    source          : s3://vectorstore/.../Memo_Q2.pdf
    page            : 1
    texte surligné  : "EBITDA grew 12% QoQ"
    zone surlignage : x=72,  y=318,  largeur=220,  hauteur=14
```

→ L'utilisateur voit la réponse avec une **vignette cliquable** qui ouvre le PDF page 1 et surligne précisément le passage.

---

#### Exemple 2 — Recherche multi-documents (entrée / sortie)

> *Question : "Quel est le modèle en 5 étapes du chiffre d'affaires IFRS 15 ?"*
> *Workspace **Finance KB**, fichier inconnu.*

##### Étape 1 — Recherche unifiée  · `search`

**Entrée :**
```yaml
question  : "modèle en 5 étapes IFRS 15 reconnaissance du revenu"
workspace : Finance KB
```

**Sortie (top 3 sur 10) :**
```yaml
résultats :
  - rang 1 :
      section       : "Modèle en 5 étapes"
      fichier       : IFRS15.pdf
      pages         : 2-4
      score         : 0.91
      images        : 1
      aperçu contenu: "Étape 1 — Identifier le contrat… Étape 2 — Identifier
                       les obligations de performance… Étape 3 — Déterminer
                       le prix de la transaction… Étape 4 — Allouer le prix…
                       Étape 5 — Reconnaître le produit…"
  - rang 2 :
      section : "Champ d'application"
      fichier : IFRS15.pdf
      pages   : 1
      score   : 0.62
  - rang 3 :
      section : "Comparaison IFRS 15 vs IAS 18"
      fichier : Guide_Comptable.pdf
      pages   : 14-15
      score   : 0.55
```

##### Étape 2 — Lire la section retenue  · `read_section`

**Entrée :**
```yaml
section   : "Modèle en 5 étapes"  (id technique : sec_3)
workspace : Finance KB
fichier   : IFRS15.pdf
```

**Sortie (extrait) :**
```yaml
section :
  titre   : "Modèle en 5 étapes"
  pages   : 2-4
  images  :
    - description : "Schéma circulaire des 5 étapes…"
      image       : (encodée, prête à afficher)
blocs :
  - id : "14579"  page : 2  contenu : "Étape 1 — Identifier le contrat…"
  - id : "14580"  page : 2  contenu : "Étape 2 — Identifier les obligations de performance…"
  - id : "14581"  page : 3  contenu : "Étape 3 — Déterminer le prix de la transaction…"
  - id : "14582"  page : 3  contenu : "Étape 4 — Allouer le prix aux obligations…"
  - id : "14583"  page : 4  contenu : "Étape 5 — Reconnaître le produit lorsque l'obligation est remplie…"
```

##### Étape 3 — L'agent rédige et ancre 2 citations  · `locate_answer_citations`

**Entrée d'ancrage :**
```yaml
workspace : Finance KB
fichier   : IFRS15.pdf
citations :
  - bloc        : "14579"
    texte exact : "Identifier le contrat conclu avec le client"
    référence   : 1
  - bloc        : "14580"
    texte exact : "Identifier les obligations de performance"
    référence   : 2
```

**Sortie :**
```yaml
citations :
  - "[1]"  page 2  zone (72, 240, 380, 14)  source : s3://…/IFRS15.pdf
  - "[2]"  page 2  zone (72, 268, 360, 14)  source : s3://…/IFRS15.pdf
```

---

#### Exemple 3 — Fichier connu + grand document (stratégie "search")

> *Question : "Comment IFRS 15 traite-t-il les contrats à long terme ?"*
> *Fichier connu : `IFRS15.pdf` (50 pages).*

##### Étape 1 — Choisir une stratégie  · `get_document_strategy`

**Entrée :**
```yaml
fichier   : IFRS15.pdf
workspace : Finance KB
```

**Sortie :**
```yaml
fichier       : IFRS15.pdf
pages totales : 50
seuil         : 20
stratégie     : "search"   →  on ne charge PAS tout, on cherche
```

→ 50 pages, c'est trop pour tout lire. On bascule en mode recherche.

##### Étape 2 — Sommaire du document  · `get_document_map`  (optionnel, pour se repérer)

**Entrée :**
```yaml
fichier   : IFRS15.pdf
workspace : Finance KB
```

**Sortie (extrait) :**
```yaml
fichier      : IFRS15.pdf
pages totales: 50
sections     :
  - "Introduction"                        pages 1     blocs : 4   images : 0
  - "Champ d'application"                 pages 1-2   blocs : 8   images : 0
  - "Modèle en 5 étapes"                  pages 2-4   blocs : 18  images : 1
  - "Identification du contrat"           pages 5-7   blocs : 24  images : 0
  - "Obligations de performance"          pages 8-11  blocs : 31  images : 0
  - "Cas particulier — contrats à long terme"   pages 12-15  blocs : 27  images : 1
  - "Reconnaissance dans le temps"        pages 16-18 blocs : 22  images : 1
  - …
```

→ La section *"Cas particulier — contrats à long terme"* (pages 12-15) est clairement la cible.

##### Étape 3 — Recherche de blocs ciblée  · `search_blocks`  (option A : aller vite)

**Entrée :**
```yaml
question  : "traitement des contrats à long terme reconnaissance"
workspace : Finance KB
fichier   : IFRS15.pdf
```

**Sortie (top 3) :**
```yaml
résultats :
  - bloc    : "14881"
    section : "Cas particulier — contrats à long terme"  (sec_12)
    page    : 13
    score   : 0.88
    contenu : "Lorsqu'un contrat s'étale sur plusieurs exercices et que le
               transfert de contrôle est progressif, le produit est reconnu
               à l'avancement (méthode des intrants ou des extrants)…"
  - bloc    : "14883"
    section : "Cas particulier — contrats à long terme"
    page    : 13
    score   : 0.81
    contenu : "Critères pour reconnaître à l'avancement : (a) le client reçoit
               et consomme simultanément les avantages…"
  - bloc    : "14897"
    section : "Reconnaissance dans le temps"  (sec_13)
    page    : 17
    score   : 0.74
    contenu : "Méthode des intrants : ratio coûts engagés / coûts totaux estimés…"
```

##### Étape 4 — Lire la section complète + ses images  · `read_section`

**Entrée :**
```yaml
section   : sec_12
workspace : Finance KB
fichier   : IFRS15.pdf
```

**Sortie :**
```yaml
section :
  titre  : "Cas particulier — contrats à long terme"
  pages  : 12-15
  blocs  : 27
  images :
    - description : "Tableau récapitulatif des seuils de reconnaissance
                     par type de contrat (court terme / long terme / mixte)."
      image       : (encodée, affichable)
blocs :
  - id : "14880"  page : 12  type : title  contenu : "Cas particulier — contrats à long terme"
  - id : "14881"  page : 13  type : text   contenu : "Lorsqu'un contrat s'étale sur plusieurs…"
  - id : "14882"  page : 13  type : text   contenu : "Trois conditions doivent être réunies…"
  - id : "14883"  page : 13  type : text   contenu : "Critères pour reconnaître à l'avancement…"
  - id : "14884"  page : 14  type : table  contenu : "Tableau récapitulatif : seuils…"
  - …
```

##### Étape 5 — Élargir le contexte  · `expand_context`  (si nécessaire)

**Entrée :**
```yaml
section   : sec_12
workspace : Finance KB
fichier   : IFRS15.pdf
avant     : 1
après     : 1
```

**Sortie :**
```yaml
section cible : "Cas particulier — contrats à long terme"  pages 12-15
section avant : "Obligations de performance"               pages 8-11
                aperçu : "Une obligation de performance est une promesse…"
section après : "Reconnaissance dans le temps"             pages 16-18
                aperçu : "La reconnaissance dans le temps s'applique…"
```

##### Étape 6 — L'agent rédige et ancre les citations  · `locate_answer_citations`

**Entrée :**
```yaml
workspace : Finance KB
fichier   : IFRS15.pdf
citations :
  - bloc        : "14881"
    texte exact : "le produit est reconnu à l'avancement"
    référence   : 1
  - bloc        : "14883"
    texte exact : "le client reçoit et consomme simultanément les avantages"
    référence   : 2
```

**Sortie :**
```yaml
citations :
  - "[1]"  page 13  zone (72, 412, 285, 14)  source : s3://…/IFRS15.pdf
  - "[2]"  page 13  zone (90, 588, 410, 14)  source : s3://…/IFRS15.pdf
```

→ La réponse renvoie **2 citations vérifiables** pointant chacune vers une zone précise du PDF page 13.

---

#### Exemple 4 — Question sur un visuel (entrée / sortie)

> *Question : "Quelle est la tendance du chiffre d'affaires trimestriel ?"*

##### Étape 1 — Recherche de blocs  · `search_blocks`

**Entrée :**
```yaml
question  : "courbe de revenu trimestriel tendance"
workspace : Finance KB
fichier   : IFRS15.pdf
```

**Sortie :**
```yaml
résultats :
  - bloc      : "14920"
    type      : figure
    section   : "Performance financière"  (sec_7)
    page      : 18
    score     : 0.84
    contenu   : "Graphique en courbe montrant une tendance ascendante du chiffre
                 d'affaires sur les 8 derniers trimestres, passant de 180M€ à 245M€."
    images de la section : 2
```

##### Étape 2 — Lire la section pour récupérer l'image réelle  · `read_section`

**Entrée :** section `sec_7`, fichier `IFRS15.pdf`.

**Sortie :**
```yaml
section :
  titre  : "Performance financière"
  pages  : 17-19
  images :
    - description : "Graphique en courbe — chiffre d'affaires trimestriel…"
      image       : (visuel encodé, affichable / analysable par l'agent)
    - description : "Tableau récapitulatif des marges par segment…"
      image       : (visuel encodé)
```

→ L'agent peut **présenter le graphique** à l'utilisateur, ou l'analyser visuellement pour confirmer la tendance, puis ancrer la citation textuelle correspondante.

---

#### Exemple 5 — Lecture par page (entrée / sortie)  · `read_page`

> *Question : "Que dit la page 13 du rapport IFRS 15 ?"*

**Entrée :**
```yaml
workspace    : Finance KB
fichier      : IFRS15.pdf
page début   : 12
page fin     : 14    (marge de contexte volontaire)
```

**Sortie :**
```yaml
blocs :
  - page : 12  type : text   contenu : "…fin de la section précédente."
  - page : 13  type : title  contenu : "Cas particulier — contrats à long terme"
  - page : 13  type : text   contenu : "Lorsqu'un contrat s'étale sur plusieurs exercices…"
  - page : 13  type : table  contenu : "Tableau récapitulatif : seuils de reconnaissance par type de contrat…"
  - page : 14  type : text   contenu : "Exemple chiffré — un contrat de 36 mois pour 1,2M€…"
```

→ L'agent résume, cite, puis **ancre** comme dans les autres flux.

---

## 4. Points clés à retenir

- **Indexation = comprendre la structure** (sections, blocs, images, positions au mot), pas juste découper.
- **Recherche = hybride et multi-granularité** (titres + contenu + blocs précis), avec un score combiné.
- **Citations = vérifiées** : aucune référence ne sort sans avoir été localisée précisément.
- **Isolation = stricte** : un utilisateur ne voit jamais les documents d'un autre.
- **Idempotence = garantie** : ré-indexer remplace proprement, sans accumulation.

---

## 5. Référence rapide — Quel outil utiliser ?

| Situation | Outil à appeler |
|-----------|-----------------|
| Je ne connais pas le nom du fichier | Recherche unifiée — `search` |
| Je connais le nom du fichier | Choisir une stratégie d'abord — `get_document_strategy` |
| Document court | Lire tout le document — `read_content` |
| Document long, besoin d'un plan | Sommaire du document — `get_document_map` |
| Identifier les bonnes zones | Recherche de sections — `search_sections` |
| Trouver une preuve textuelle | Recherche de blocs — `search_blocks` |
| Voir une section entière + images | Lire une section — `read_section` |
| Voir les blocs d'une section sans images | Lire les blocs d'une section — `read_blocks` |
| Avoir le contexte autour d'une section | Élargir le contexte — `expand_context` |
| Aller à une page précise | Lire par page — `read_page` |
| Finaliser une réponse avec citations | Ancrer les citations — `locate_answer_citations` |

---

## 6. Cas concrets — l'agent choisit les outils qu'il faut, et seulement ceux-là

> Un agent **n'enchaîne pas tous les outils**. Il sélectionne le **minimum nécessaire** en fonction de la question, du fait que le `file_name` est connu ou non, et de la taille du document. Voici deux cas typiques.

---

### Cas A — Question ciblée sur un document connu (4 outils)

> **Question de l'analyste :**
> *"D'après **IFRS15.pdf**, comment reconnaît-on le revenu d'un contrat de maintenance pluriannuel ?"*
>
> `file_name` connu → premier outil obligatoire : `get_document_strategy`.

#### Étape 1 — Choisir la stratégie  · `get_document_strategy`

> *Intention : le fichier est connu, c'est l'outil mandatory first. Il me dit si je lis tout ou si je cherche.*

**Entrée :**
```yaml
fichier   : IFRS15.pdf
workspace : Finance KB
```

**Sortie :**
```yaml
pages totales : 50
seuil         : 20
stratégie     : "search"
```

> *50 pages > seuil → mode **search**. Je ne charge pas tout, je cible.*

#### Étape 2 — Trouver les preuves textuelles précises  · `search_blocks`

> *Intention : ma question est précise. Pas besoin de plan ni de recherche large — j'attaque directement les blocs.*

**Entrée :**
```yaml
question  : "reconnaissance à l'avancement contrat de maintenance pluriannuel"
workspace : Finance KB
fichier   : IFRS15.pdf
limite    : 5
```

**Sortie :**
```yaml
- bloc "14881"  section sec_12  page 13  score 0.91
   contenu : "Lorsqu'un contrat s'étale sur plusieurs exercices et que le transfert
              de contrôle est progressif, le produit est reconnu à l'avancement…"
- bloc "14883"  section sec_12  page 13  score 0.86
   contenu : "Critères pour reconnaître à l'avancement : le client reçoit et consomme
              simultanément les avantages procurés par la prestation…"
- bloc "14899"  section sec_13  page 17  score 0.74
   contenu : "Cette méthode est privilégiée pour les contrats de maintenance pluriannuels…"
```

> *Trois blocs solides, deux sections concernées. J'ouvre la section principale pour le contexte complet.*

#### Étape 3 — Ouvrir la section principale  · `read_section`

> *Intention : récupérer le contenu intégral de `sec_12` pour rédiger une réponse cohérente, et au passage le visuel récapitulatif.*

**Entrée :**
```yaml
section   : sec_12
workspace : Finance KB
fichier   : IFRS15.pdf
```

**Sortie :**
```yaml
section :
  titre  : "Cas particulier — contrats à long terme"
  pages  : 12-15
  blocs  : 27
  images :
    - description : "Tableau récapitulatif des seuils de reconnaissance par
                     type de contrat (court / long terme / mixte)."
      image       : (visuel encodé)
blocs :
  - id "14880"  page 12  title  "Cas particulier — contrats à long terme"
  - id "14881"  page 13  text   "Lorsqu'un contrat s'étale sur plusieurs…"
  - id "14883"  page 13  text   "Critères pour reconnaître à l'avancement…"
  - …
```

> *J'ai assez pour rédiger. **Pas besoin** de `read_blocks`, `expand_context`, `get_document_map` ni `read_page` — la section suffit.*

#### Étape 4 — Ancrer les citations  · `locate_answer_citations`

> *Intention : verrouiller chaque citation par une preuve visuelle. Outil terminal, jamais optionnel.*

**Entrée :**
```yaml
workspace : Finance KB
fichier   : IFRS15.pdf
citations :
  - bloc "14881"  texte "le produit est reconnu à l'avancement"                     référence 1
  - bloc "14883"  texte "le client reçoit et consomme simultanément les avantages"  référence 2
  - bloc "14899"  texte "contrats de maintenance pluriannuels"                      référence 3
```

**Sortie :**
```yaml
citations :
  - "[1]"  page 13  zone (72, 412, 285, 14)  source : s3://…/IFRS15.pdf
  - "[2]"  page 13  zone (90, 588, 410, 14)  source : s3://…/IFRS15.pdf
  - "[3]"  page 17  zone (72, 168, 360, 14)  source : s3://…/IFRS15.pdf
```

> **Bilan : 4 outils appelés.** `get_document_strategy` → `search_blocks` → `read_section` → `locate_answer_citations`. Aucun outil superflu.

---

### Cas B — Question ouverte sur un workspace (3 outils)

> **Question de l'analyste :**
> *"Quelle est notre politique interne pour les contrats de maintenance ?"*
>
> `file_name` **inconnu** → la règle dit : **ne pas** appeler `get_document_strategy`, attaquer directement avec `search`.

#### Étape 1 — Recherche unifiée sur tout le workspace  · `search`

> *Intention : je ne sais pas dans quel fichier se trouve la politique. Je cherche partout dans le workspace.*

**Entrée :**
```yaml
question  : "politique interne contrats de maintenance"
workspace : Finance KB
```

**Sortie (top 2 sur 10) :**
```yaml
- rang 1 : section "Application aux contrats de maintenance"
           fichier Note_Application_Interne.pdf   pages 3-5   score 0.88   images 0
           contenu : "Politique du groupe : pour tout contrat de maintenance dont la
                      durée dépasse 12 mois, la reconnaissance à l'avancement est la
                      règle par défaut. Utiliser la méthode des intrants…"
- rang 2 : section "Cas particulier — contrats à long terme"
           fichier IFRS15.pdf                     pages 12-15  score 0.71  images 1
```

> *La réponse est dans le rang 1, contenu déjà concaténé. Je n'ai même pas besoin de relire la section. Il me manque juste le `block_id` exact pour citer.*

#### Étape 2 — Récupérer les `block_id` de la section  · `read_blocks`

> *Intention : `search` ne me donne que le contenu concaténé ; pour `locate_answer_citations` j'ai besoin du `block_id` du passage cité.*

**Entrée :**
```yaml
section   : sec_4
workspace : Finance KB
fichier   : Note_Application_Interne.pdf
```

**Sortie :**
```yaml
- id "22115"  page 3  text  "Politique du groupe : pour tout contrat de maintenance…"
- id "22116"  page 4  text  "Utiliser la méthode des intrants…"
- …
```

#### Étape 3 — Ancrer la citation  · `locate_answer_citations`

**Entrée :**
```yaml
workspace : Finance KB
fichier   : Note_Application_Interne.pdf
citations :
  - bloc "22115"
    texte "pour tout contrat de maintenance dont la durée dépasse 12 mois, la reconnaissance à l'avancement est la règle par défaut"
    référence 1
```

**Sortie :**
```yaml
citations :
  - "[1]"  page 3  zone (72, 245, 460, 28)  source : s3://…/Note_Application_Interne.pdf
```

> **Bilan : 3 outils appelés.** `search` → `read_blocks` → `locate_answer_citations`. Pas de `get_document_strategy` (fichier inconnu au départ), pas de plan, pas d'élargissement de contexte.

---

### 🎯 Ce qu'il faut retenir

| Situation | Outils suffisants |
|-----------|-------------------|
| Fichier connu, question précise | `get_document_strategy` → `search_blocks` → `read_section` → `locate_answer_citations` |
| Fichier inconnu, recherche workspace | `search` → `read_blocks` → `locate_answer_citations` |
| Petit document connu (≤ seuil) | `get_document_strategy` → `read_content` → `locate_answer_citations` |
| Besoin d'une image / figure | + `read_section` (seul outil qui rend les images en mode `search`) |
| Section partielle ou ambiguë | + `expand_context` |
| Question sur une page précise | + `read_page` |
| Besoin d'un plan / sommaire | + `get_document_map` |

> **Règle pratique :** chaque outil ajouté coûte un appel ; on n'appelle un outil **que s'il apporte une information manquante** pour répondre. La seule étape **jamais optionnelle** quand on cite des sources est la dernière : `locate_answer_citations`.

---

### 🟦 Cas réel — Lundi matin, préparation du comité financier

> **Contexte (réel).**
> Lundi 09h12. Sarah, analyste senior chez un groupe industriel, prépare une note pour le comité financier de mercredi. Le groupe vient de signer un contrat de maintenance de **3 ans** avec un client ferroviaire pour **2,4 M€**. La direction comptable doit valider le traitement IFRS 15 avant la clôture du trimestre.
>
> Sarah ouvre son assistant IA branché sur le workspace **Finance KB** (qui contient `IFRS15.pdf`, `Note_Application_Interne.pdf`, des memos précédents, etc.) et tape :
>
> > **Sarah :** *"Pour le contrat ferroviaire de 3 ans / 2,4 M€ signé vendredi, je dois proposer un traitement IFRS 15 pour le comité de mercredi. Quelle méthode de reconnaissance je dois recommander, et quelle est la position interne du groupe ? Donne-moi un texte que je peux coller dans ma note."*

---

#### Ce que l'agent fait, dans la vraie vie

**09:12:04 — L'agent réfléchit.**
> *"Sarah ne nomme aucun fichier précis. La question porte sur (1) la méthode IFRS 15 applicable et (2) la doctrine interne. Je ne peux pas appeler `get_document_strategy` — il faut un `file_name`. Je commence donc par `search`."*

**09:12:05 — Appel 1/4 : `search`**

```yaml
question  : "contrat de maintenance pluriannuel reconnaissance du revenu IFRS 15 politique interne"
workspace : Finance KB
```

Le système renvoie 10 sections classées. Les 3 premières :

```yaml
- rang 1 : "Application aux contrats de maintenance"
           fichier Note_Application_Interne.pdf   pages 3-5   score 0.89
           contenu : "Politique du groupe : pour tout contrat de maintenance dont
                      la durée dépasse 12 mois, la reconnaissance à l'avancement
                      est la règle par défaut. Utiliser la méthode des intrants
                      (ratio coûts engagés / coûts totaux estimés)…"
- rang 2 : "Cas particulier — contrats à long terme"
           fichier IFRS15.pdf                     pages 12-15  score 0.85   images 1
- rang 3 : "Reconnaissance dans le temps"
           fichier IFRS15.pdf                     pages 16-18  score 0.77
```

**09:12:07 — L'agent réfléchit.**
> *"Parfait. Le rang 1 me donne la doctrine interne (durée > 12 mois → avancement → méthode des intrants). Le rang 2 me donne la base IFRS 15. Le contenu concaténé renvoyé par `search` est déjà assez riche pour rédiger la note. Je n'ai pas besoin de `read_section` ni de `get_document_map` ni de l'image. **Mais** j'ai besoin des `block_id` exacts pour ancrer mes deux citations clés."*

**09:12:08 — Appel 2/4 : `read_blocks` sur la section interne**

```yaml
section   : sec_4
workspace : Finance KB
fichier   : Note_Application_Interne.pdf
```

Sortie :

```yaml
- id "22115"  page 3  text  "Politique du groupe : pour tout contrat de maintenance
                              dont la durée dépasse 12 mois, la reconnaissance à
                              l'avancement est la règle par défaut."
- id "22116"  page 4  text  "Utiliser la méthode des intrants (ratio coûts engagés
                              / coûts totaux estimés)."
- id "22117"  page 4  text  "Toute exception doit faire l'objet d'une validation
                              par le comité financier."
```

**09:12:09 — Appel 3/4 : `read_blocks` sur la section IFRS 15**

```yaml
section   : sec_12
workspace : Finance KB
fichier   : IFRS15.pdf
```

Sortie (extrait) :

```yaml
- id "14881"  page 13  text  "Lorsqu'un contrat s'étale sur plusieurs exercices
                                et que le transfert de contrôle est progressif,
                                le produit est reconnu à l'avancement."
- id "14883"  page 13  text  "Critères : le client reçoit et consomme simultanément
                                les avantages procurés par la prestation."
```

**09:12:10 — L'agent rédige le texte demandé par Sarah :**

> *"Le contrat de maintenance ferroviaire signé le [date] (durée 36 mois, 2,4 M€) entre dans le champ des prestations de services exécutées dans le temps au sens d'IFRS 15. **Le produit doit être reconnu à l'avancement** [1], dès lors que le client reçoit et consomme simultanément les avantages procurés [2]. La doctrine interne du groupe confirme cette approche pour tout contrat de maintenance d'une durée supérieure à 12 mois [3] et impose la **méthode des intrants** (ratio coûts engagés / coûts totaux estimés) [4]. Une dérogation nécessiterait l'approbation du comité financier [5]. **Recommandation** : appliquer la méthode des intrants ; le CA reconnu au 31/12 sera proportionnel aux coûts engagés sur la période."*

**09:12:11 — Appel 4/4 : `locate_answer_citations` (terminal)**

```yaml
workspace : Finance KB
citations :
  - bloc "14881"  texte "le produit est reconnu à l'avancement"                     ref 1  fichier IFRS15.pdf
  - bloc "14883"  texte "le client reçoit et consomme simultanément les avantages"  ref 2  fichier IFRS15.pdf
  - bloc "22115"  texte "durée dépasse 12 mois, la reconnaissance à l'avancement est la règle par défaut"  ref 3  fichier Note_Application_Interne.pdf
  - bloc "22116"  texte "méthode des intrants (ratio coûts engagés / coûts totaux estimés)"                ref 4  fichier Note_Application_Interne.pdf
  - bloc "22117"  texte "validation par le comité financier"                        ref 5  fichier Note_Application_Interne.pdf
```

Sortie :

```yaml
citations :
  - "[1]"  page 13  IFRS15.pdf                       zone (72, 412, 285, 14)
  - "[2]"  page 13  IFRS15.pdf                       zone (90, 588, 410, 14)
  - "[3]"  page 3   Note_Application_Interne.pdf     zone (72, 245, 460, 28)
  - "[4]"  page 4   Note_Application_Interne.pdf     zone (72, 132, 380, 14)
  - "[5]"  page 4   Note_Application_Interne.pdf     zone (72, 188, 290, 14)
```

**09:12:12 — Sarah voit s'afficher** : son texte rédigé, prêt à coller dans la note du comité, avec **5 références cliquables** qui ouvrent chacune le bon PDF à la bonne page et **surlignent le passage exact**. Elle vérifie en 30 secondes, copie-colle dans Word, envoie à son N+1.

---

#### Décomposition de ce qui s'est passé

| Heure | Ce que fait l'agent | Pourquoi |
|-------|---------------------|----------|
| 09:12:04 | Réflexion | Question ouverte, pas de fichier nommé → `search` |
| 09:12:05 | `search` (1/4) | Trouve la doctrine interne **et** la base IFRS 15 en un seul appel |
| 09:12:07 | Réflexion | Contenu suffisant ; manque seulement les `block_id` |
| 09:12:08 | `read_blocks` (2/4) | Récupère les 3 `block_id` de la note interne |
| 09:12:09 | `read_blocks` (3/4) | Récupère les 2 `block_id` côté IFRS 15 |
| 09:12:10 | Rédaction | Texte court, ancré, prêt à coller |
| 09:12:11 | `locate_answer_citations` (4/4) | Verrouille les 5 références |
| 09:12:12 | Livraison | Réponse + 5 highlights cliquables |

#### Pourquoi **pas** ces outils ?

- ❌ `get_document_strategy` → aucun `file_name` n'a été donné par Sarah.
- ❌ `get_document_map` → on connaît déjà précisément les bonnes sections.
- ❌ `search_sections`, `search_blocks` → `search` a tout donné, raffiner serait redondant.
- ❌ `read_section` → on n'a besoin **ni des images, ni du tableau** pour cette note.
- ❌ `expand_context` → les sections trouvées sont autosuffisantes.
- ❌ `read_page` → aucune page précise n'est en jeu.
- ❌ `read_content` → les deux fichiers utiles dépassent largement le seuil de lecture totale (ou ne sont pas explicitement ciblés).

---

### 🟦 Cas réel — Mardi après-midi, revue d'un manuel comptable précis

> **Contexte (réel).**
> Mardi 14h47. Marc, responsable consolidation, doit répondre à un mail d'un commissaire aux comptes sur un point précis : la définition d'une **obligation de performance distincte** au sens d'IFRS 15. Il sait exactement dans quel document chercher — c'est la norme officielle `IFRS15.pdf` (50 pages) qu'il vient de mettre à jour dans le workspace.
>
> Marc ouvre son assistant IA sur le workspace **Finance KB** et tape :
>
> > **Marc :** *"Dans **IFRS15.pdf**, qu'est-ce qu'une obligation de performance distincte ? Donne-moi la définition exacte avec la référence à la page."*

---

#### Ce que l'agent fait

**14:47:01 — L'agent réfléchit.**
> *"Marc me donne le `file_name` (`IFRS15.pdf`). La règle est claire : **mandatory first → `get_document_strategy`**. Je n'attaque pas avec `search` parce que le fichier est connu."*

**14:47:02 — Appel 1/4 : `get_document_strategy`**

```yaml
fichier   : IFRS15.pdf
workspace : Finance KB
```

Sortie :

```yaml
pages totales : 50
seuil         : 20
stratégie     : "search"
```

**14:47:03 — L'agent réfléchit.**
> *"50 pages, donc mode `search`. La question est ciblée sur une notion précise. Je lance la recherche unifiée `search` scopée au fichier : elle me ramène la (ou les) bonne(s) section(s) avec leur contenu déjà concaténé — c'est plus contextuel que des blocs isolés."*

**14:47:04 — Appel 2/4 : `search`**

```yaml
question  : "obligation de performance distincte définition critères"
workspace : Finance KB
fichier   : IFRS15.pdf
```

Sortie (top 2 sur 10) :

```yaml
- rang 1 : section "Obligations de performance"   sec_5   pages 8-11   score 0.93   images 0
           contenu (concat. blocs) : "Une obligation de performance est une promesse,
            dans un contrat, de transférer au client un bien ou un service distinct.
            Un bien ou service est distinct si (a) le client peut en tirer avantage
            seul ou avec d'autres ressources facilement disponibles, et (b) la
            promesse est identifiable séparément des autres promesses du contrat.
            Si les deux critères ne sont pas réunis, les biens ou services sont
            regroupés en une seule obligation de performance combinée…"
- rang 2 : section "Modèle en 5 étapes"            sec_3   pages 2-4    score 0.61   images 1
```

**14:47:05 — L'agent réfléchit.**
> *"`sec_5` est clairement la bonne section et son contenu agrégé contient déjà la définition. Pour ancrer mes citations, j'ai besoin des `block_id` exacts des phrases utilisées. Le résultat de `search` a indiqué `images : 0` pour cette section — donc **pas besoin de `read_section`** (qui sert surtout à récupérer les images). J'appelle `read_blocks` qui me renvoie les blocs ordonnés, en plus léger."*

**14:47:05 — Appel 3/4 : `read_blocks`**

```yaml
section   : sec_5
workspace : Finance KB
fichier   : IFRS15.pdf
```

Sortie (extrait) :

```yaml
blocs :
  - id "14721"  page 8   text  "Une obligation de performance est une promesse,
                                 dans un contrat, de transférer au client un bien
                                 ou un service distinct…"
  - id "14722"  page 8   text  "Un bien ou service est distinct si (a) le client
                                 peut en tirer avantage seul…"
  - id "14723"  page 9   text  "Si les deux critères ne sont pas réunis, les biens
                                 ou services sont regroupés en une seule obligation
                                 de performance combinée."
  - …
```

**14:47:06 — L'agent rédige la réponse à Marc :**

> *"Selon IFRS 15, **une obligation de performance est une promesse, dans un contrat, de transférer au client un bien ou un service distinct** [1]. Un bien ou service est qualifié de distinct si **deux critères cumulatifs** sont remplis : (a) le client peut en tirer avantage seul ou avec d'autres ressources facilement disponibles, et (b) la promesse est identifiable séparément des autres promesses du contrat [1]. À défaut, les biens ou services sont **regroupés en une obligation combinée** [2]. — Réf. IFRS15.pdf, page 8 et 9."*

**14:47:07 — Appel 4/4 : `locate_answer_citations` (terminal)**

```yaml
workspace : Finance KB
fichier   : IFRS15.pdf
citations :
  - bloc "14721"  texte "promesse, dans un contrat, de transférer au client un bien ou un service distinct"  ref 1
  - bloc "14723"  texte "regroupés en une seule obligation de performance combinée"                          ref 2
```

Sortie :

```yaml
citations :
  - "[1]"  page 8  IFRS15.pdf  zone (72, 285, 480, 42)
  - "[2]"  page 9  IFRS15.pdf  zone (72, 142, 410, 28)
```

**14:47:08 — Marc voit s'afficher** la définition reformulée avec deux références. Il clique sur **[1]** → le PDF s'ouvre page 8, le passage est surligné. Il copie la définition exacte du bloc, la colle dans sa réponse au commissaire aux comptes, ajoute son commentaire d'application, envoie le mail.

---

#### Décomposition

| Heure | Action de l'agent | Pourquoi |
|-------|-------------------|----------|
| 14:47:01 | Réflexion | `file_name` fourni → règle mandatory first |
| 14:47:02 | `get_document_strategy` (1/4) | Vérifier le mode : `search` ou `read_all` |
| 14:47:04 | `search` (2/4) | Recherche hybride scopée au fichier → ramène la bonne section avec contenu déjà concaténé |
| 14:47:05 | `read_blocks` (3/4) | Récupérer les `block_id` exacts pour pouvoir citer (pas d'image dans la section → inutile d'appeler `read_section`) |
| 14:47:06 | Rédaction | Définition + 2 critères + cas d'exception |
| 14:47:07 | `locate_answer_citations` (4/4) | 2 citations verrouillées |
| 14:47:08 | Livraison | Définition exacte + 2 highlights |

#### Pourquoi **pas** ces outils ?

- ❌ `get_document_map` → la question ne demande pas un plan, juste une définition.
- ❌ `search_sections` → `search` (unifié) couvre déjà la dimension titres.
- ❌ `search_blocks` → `read_blocks` me donne déjà tous les blocs ordonnés de la section retenue.
- ❌ `read_section` → la section `sec_5` ne contient **aucune image** (`images : 0` retourné par `search`). `read_section` est l'outil à utiliser **quand on a besoin des images** ; pour récupérer juste les blocs, `read_blocks` est plus léger.
- ❌ `expand_context` → la définition est autosuffisante dans `sec_5`.
- ❌ `read_page` → on n'a pas une page précise à demander à l'avance.
- ❌ `read_content` → 50 pages, on est en mode `search`.

---

### Comparatif des deux cas réels

| | Cas Sarah (file_name **inconnu**) | Cas Marc (file_name **connu**) |
|---|-----------------------------------|--------------------------------|
| Premier outil | `search` | `get_document_strategy` (mandatory first) |
| Nombre d'appels | 4 | 4 |
| Réponse | Texte long + recommandation | Définition courte |
| Citations verrouillées | 5 | 2 |
| Outils utilisés | `search`, `read_blocks` ×2, `locate_answer_citations` | `get_document_strategy`, `search`, `read_blocks`, `locate_answer_citations` |
| Outils **non utilisés** | 7 sur 11 | 7 sur 11 |

> Dans les deux cas, l'agent appelle **moins de la moitié** des outils du catalogue. Le bon réflexe est de **partir de la question** et de ne convoquer un outil que quand il manque une information précise.

---

**Fin du document.**

