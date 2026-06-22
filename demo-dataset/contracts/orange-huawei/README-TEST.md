# Jeu de données de démonstration — Contrat Télécoms Orange / Huawei

## Structure du graphe de documents

```
                    ┌─────────────────────────────────────┐
                    │  01-contrat-principal.md            │
                    │  Contrat ORG-HW-2025-0042           │
                    │  Signé le 15 mars 2025              │
                    │  19 articles, 20 pages              │
                    └────────────────┬────────────────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  │                  │                  │
                  │  "reference_     │  "reference_     │
                  │   technique"     │  financiere"     │
                  │  (art. 1, 2, 4)  │  (art. 3, 9, 10) │
                  │                  │                  │
           ┌──────▼──────────────┐ ┌─▼──────────────────▼──┐
           │  02-annexe-1.md     │ │  03-annexe-2.md       │
           │  Cahier des         │ │  Conditions de        │
           │  Charges Techniques │ │  Paiement & Garanties │
           │  8 sections, 10 pg  │ │  8 sections, 10 pg    │
           └────────┬────────────┘ └────────┬──────────────┘
                    │                       │
                    └───"reference_croisee"──┘
                        (§4 ↔ Annexe 2 §1.1)
                        (§5 ↔ Annexe 2 §3.5)
```

## Edges du graphe

| # | Source | Cible | Type | Justification |
|---|--------|-------|------|---------------|
| E1 | `01-contrat-principal` | `02-annexe-1` | `reference_technique` | Préambule §G, art. 1 déf. « Annexe 1 », art. 2, art. 4 renvoient aux spécifications techniques |
| E2 | `01-contrat-principal` | `03-annexe-2` | `reference_financiere` | Préambule §H, art. 3.4 (paiement), art. 11.1 (pénalités, renvoi §3), art. 8 renvoie aux garanties |
| E3 | `02-annexe-1` | `03-annexe-2` | `reference_croisee` | Annexe 1 §4.4 → pénalités Annexe 2 §5 ; Annexe 1 §4.3 → échéancier Annexe 2 §1.1 ; Annexe 1 §8 → documents associés |

---

## Requêtes de test cross-documents

Chaque requête est accompagnée des documents à traverser et des sections précises contenant la réponse.

### Q1 — Contrat + Annexe 1 (contexte fusionné)

> **"Quel est le montant total du contrat signé entre Orange et Huawei, et quels sont les modèles d'équipements livrés avec leurs quantités ?"**

| Document | Section | Données |
|----------|---------|---------|
| Contrat | Art. 3.1 (tableau) | 12 450 000 € HT, décomposé en 5 postes |
| Annexe 1 | §2.1 (tableau 10 lignes) | 7 types + 3 compléments : BBU5900×45, AAU5639W×180, RRU5906×60, MBTS CX×15, ATN910C×30, iMaster NCE×3, BTS3900×25, kits câblage×45, antennes rechange×1 lot, filtres×30 |

### Q2 — Contrat + Annexe 2 (référence contractuelle)

> **"Quelles sont les pénalités applicables en cas de retard de livraison, quel est leur plafond, et à quel article du contrat cela renvoie-t-il ?"**

| Document | Section | Données |
|----------|---------|---------|
| Contrat | Art. 11.1 | Renvoi à l'Annexe 2 pour le calcul : « selon les modalités définies à l'Annexe 2, section 3 » |
| Annexe 2 | §5.2.1 (formule) | P = M × 0,5 % × S semaines |
| Annexe 2 | §5.3.1 (plafond) | 10 % × 12 450 000 = 1 245 000 € max |

**Réponse attendue :** pénalité = (montant HT du lot × 0,5 % × nb semaines de retard), plafonné à 1 245 000 €, après un délai de tolérance de 5 jours ouvrés (§5.5). Application prévue à l'art. 11 du contrat principal.

### Q3 — Annexe 1 + Annexe 2 (planning ↔ paiement)

> **"Quel est le planning de livraison des 4 lots et le calendrier de paiement associé ?"**

| Document | Section | Données |
|----------|---------|---------|
| Annexe 1 | §4.1 (tableau 4 lots) | Lot 1 : J+90/120, Lot 2 : J+150/180, Lot 3 : J+210/240, Lot 4 : J+270/300 |
| Annexe 1 | §4.3 (jalons) | 8 jalons détaillés de J+0 à J+345 |
| Annexe 2 | §1.1 (échéancier) | Acompte 15 %, Jalon 1 : 25 %, Jalon 2 : 20 %, Jalon 3 : 20 %, Jalon 4 : 15 %, Solde : 5 % |

**Réponse attendue :** 4 lots géographiques (Île-de-France, AuRA, Occitanie, PACA) livrés entre J+90 et J+270, avec paiements échelonnés de 15 % à la signature à 5 % à la réception définitive. Tableaux croisés disponibles dans Annexe 1 §4 et Annexe 2 §1.

### Q4 — Tous les documents (triple-saut)

> **"Qui sont les signataires du contrat et dans quel délai le Fournisseur doit-il fournir la garantie bancaire de restitution d'acompte ?"**

| Document | Section | Données |
|----------|---------|---------|
| Contrat | Signatures (p. 20) | Liang Zhang (DG Huawei France) et Sophie Delamare (Directrice Achats Réseau Orange) |
| Annexe 2 | §2.1.1 | Garantie de restitution d'acompte de 1 867 500 € sous 15 jours calendaires |
| Annexe 2 | §2.1.3 | Valable jusqu'à réception Lot 1 |

### Q5 — Calcul concret de pénalité (Annexe 1 + Annexe 2)

> **"Si le Lot 1 (Île-de-France) est livré avec 3 semaines de retard, quel est le montant de la pénalité due par Huawei ?"**

| Document | Section | Données |
|----------|---------|---------|
| Annexe 1 | §4.2 (détail Lot 1) | 12 BBU5900 + 48 AAU5639W + 16 RRU5906 + 4 MBTS CX + 8 ATN910 + 1 iMaster NCE + 8 BTS3900 + 12 kits câblage + 12 filtres |
| Annexe 1 | §2.1 (prix unitaires) | Permet de recalculer : (12×42k)+(48×18,5k)+(16×8,2k)+(4×56k)+(8×9,6k)+(1×78k)+(8×36,8k)+(12×1,2k)+(12×2,8k) = 504k+888k+131,2k+224k+76,8k+78k+294,4k+14,4k+33,6k = **2 244 400 €** |
| Annexe 2 | §5.2.1 (formule) | P = 2 244 400 × 0,5 % × 3 = **33 666 €** |
| Annexe 2 | §5.2.2 (exemple) | Confirme la méthode avec un exemple à 28 656 € (basé sur estimation antérieure) |

### Q6 — Garanties longue durée (Contrat + Annexe 1 + Annexe 2)

> **"Pendant combien de temps les équipements sont-ils garantis et pendant combien de temps les pièces de rechange sont-elles disponibles ?"**

| Document | Section | Données |
|----------|---------|---------|
| Contrat | Art. 8.1(a) | Garantie constructeur « décrite à l'Annexe 2 » |
| Annexe 2 | §3.1.1 | 36 mois à compter du PVR de chaque Lot |
| Annexe 2 | §3.2.3 | Pièces de rechange garanties 10 ans à compter de la réception |
| Annexe 2 | §3.3 | Extension possible de 24 mois supplémentaires (avenant 450k€) |

### Q7 — Governance et escalade (Annexe 2 uniquement, mais référence au contrat)

> **"Quelle est la procédure d'escalade en cas de non-respect des SLA ?"**

| Document | Section | Données |
|----------|---------|---------|
| Annexe 2 | §4.2 (tableau 4 niveaux) | N1 : Ingénieur support (immédiat), N2 : Ingénieur senior R&D (4h), N3 : Directeur technique (24h), N4 : DG (72h) |
| Contrat | Art. 9.2(e) | Renvoi à l'Annexe 2 pour SLA |

### Q8 — Test limite : contenu isolé (document unique)

> **"Quel est le numéro RCS d'Orange Telecom France ?"**

| Document | Section | Données |
|----------|---------|---------|
| Contrat | Page de garde | RCS Paris 380 129 866 |

Un seul document suffit. Utile pour vérifier que le RAG ne fait pas de faux positifs.

### Q9 — Test négatif (hors périmètre)

> **"Quel est le volume de données prévu sur le réseau 5G d'Orange pour 2026 ?"**

Aucun document du jeu ne contient cette information. Permet de tester le comportement du RAG face à une requête hors scope (refus / « information non trouvée » vs hallucination).

---

## Métadonnées pour l'indexation

| Document | Pages | Entités principales | Mots-clés |
|----------|-------|---------------------|-----------|
| 01-contrat-principal.md | 20 | Huawei, Orange, Liang Zhang, Sophie Delamare, RCS Nanterre 518 235 498, RCS Paris 380 129 866, 12 450 000 €, assurance 5M€ | contrat, achat, équipements télécoms, 5G, fournisseur, acheteur, loi française, RGPD, confidentialité, propriété intellectuelle, pénalités, garantie, livraison |
| 02-annexe-1.md | 10 | BBU5900 (45), AAU5639W (180), RRU5906 (60), MBTS CX (15), ATN910C (30), iMaster NCE (3), BTS3900 (25), Lannion, 3GPP R17, Île-de-France | spécifications techniques, 3GPP, planning, lots, livraison, installation, réception, PVR, IOT, interopérabilité, Nokia, Ericsson, formation |
| 03-annexe-2.md | 10 | acompte 1 867 500€, garantie bancaire, 36 mois garantie, 10 ans pièces rechange, 450k€ extension, SLA P1-P4, pénalités 0,5%/sem, plafond 10% (1 245 000€) | paiement, garantie, SLA, pénalités, banque, assurance, maintenance, reporting, escalade, force majeure |

---

## Utilisation du jeu de données

1. **Ingérer les 3 documents** dans le système de workspace documents
2. **Créer les 3 edges** dans le graphe de documents (selon le tableau ci-dessus)
3. **Lancer les indexations** (embeddings + graphe)
4. **Exécuter les requêtes Q1 à Q9** en vérifiant :
   - La navigation correcte dans le graphe (combien de sauts)
   - La qualité de la réponse fusionnée
   - L'absence d'hallucination sur Q9
