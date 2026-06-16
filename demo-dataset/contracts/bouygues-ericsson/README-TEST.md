# Jeu de données de démonstration — Bouygues Telecom / Ericsson

Structure parallèle au jeu Orange/Huawei (`demo-dataset/`), avec des données, prix et spécifications différentes pour tester la capacité du RAG à distinguer les deux contextes.

---

## Structure du graphe de documents

```
                    ┌──────────────────────────────────────┐
                    │  01-contrat-principal.md             │
                    │  Contrat BFG-ERIC-2025-0037          │
                    │  Signé le 10 avril 2025              │
                    │  22 articles, ~20 pages              │
                    │  Montant : 11 200 000 € HT           │
                    └────────────────┬─────────────────────┘
                                     │
                  ┌──────────────────┼───────────────────┐
                  │                  │                   │
                  │  "reference_     │  "reference_      │
                  │   technique"    │   financiere"      │
                  │  (art. 1, 4)    │   (art. 3, 11)     │
                  │                  │                   │
           ┌──────▼──────────────┐ ┌─▼───────────────────▼──┐
           │  02-annexe-1.md     │ │  03-annexe-2.md        │
           │  Cahier des         │ │  Conditions de         │
           │  Charges Techniques │ │  Paiement & Garanties  │
           │  8 sections, ~10 pg │ │  9 sections, ~10 pg    │
           │                     │ │                        │
           │  Équipements :      │ │  Acompte : 1 680 000 € │
           │  RAN6624×36         │ │  Garantie : 36 mois    │
           │  AIR6488×150        │ │  Pénalité : 0,4%/sem   │
           │  RRUS4478×48        │ │  SLA P1 : 1h / 6h     │
           └────────┬────────────┘ └────────┬───────────────┘
                    │                       │
                    └───"reference_croisee"──┘
                        (§4 ↔ Annexe 2 §1.1)
                        (§4.4 ↔ Annexe 2 §5)
```

---

## Edges du graphe

| # | Source | Cible | Type | Justification |
|---|--------|-------|------|---------------|
| E1 | `01-contrat-principal` | `02-annexe-1` | `reference_technique` | Art. 1 (déf. Annexe 1), art. 2 (objet), art. 4 (livraison/réception) |
| E2 | `01-contrat-principal` | `03-annexe-2` | `reference_financiere` | Art. 3.3 (renvoi pour paiement), art. 8.1 (renvoi garanties), art. 11.1 (pénalités) |
| E3 | `02-annexe-1` | `03-annexe-2` | `reference_croisee` | Annexe 1 §4.4 (pénalités) → Annexe 2 §5 ; Annexe 1 §4.3 (jalons) → Annexe 2 §1.1 |

---

## Requêtes de test cross-documents

### Q1 — Contrat + Annexe 1 (contexte fusionné)

> **"Quel est le montant total du contrat Bouygues Telecom / Ericsson et quels sont les équipements livrés ?"**

| Document | Section | Données |
|----------|---------|---------|
| Contrat | Art. 3.1 | 11 200 000 € HT (6 postes) |
| Annexe 1 | §2.1 (9 lignes) | RAN Compute 6624×36, AIR 6488×150, RRUS 4478×48, RRUS 4488×60, routeur 6673×24, ENM×2, RBS 6624×20 |

### Q2 — Contrat + Annexe 2 (référence contractuelle)

> **"Quelles sont les pénalités de retard et le plafond applicable ?"**

| Document | Section | Données |
|----------|---------|---------|
| Contrat | Art. 11.1 | Renvoi à l'Annexe 2 section 5 |
| Annexe 2 | §5.2 (formule) | P = M × 0,4 % × S semaines |
| Annexe 2 | §5.4 (plafond) | 10 % × 11 200 000 = 1 120 000 € |

### Q3 — Annexe 1 + Annexe 2 (planning ↔ paiement)

> **"Quel est le planning des 3 lots et le calendrier de paiement associé ?"**

| Document | Section | Données |
|----------|---------|---------|
| Annexe 1 | §4.1 (3 lots) | Lot 1 : J+75/105, Lot 2 : J+150/180, Lot 3 : J+220/250 |
| Annexe 1 | §4.3 (11 jalons) | J+0 à J+320 |
| Annexe 2 | §1.1 (échéancier) | Acompte 15 %, J1 : 30 %, J2 : 25 %, J3 : 20 %, Solde 10 % |

### Q4 — Tous les documents (triple-saut)

> **"Qui a signé le contrat, quelle est la garantie bancaire d'acompte et quel équipement est livré en 64T64R ?"**

| Document | Section | Données |
|----------|---------|---------|
| Contrat | Signatures | Erik Lindgren (Ericsson) / Julien Dubois (Bouygues) |
| Annexe 2 | §2.1 | Garantie restitution d'acompte : 1 680 000 €, sous 15 jours |
| Annexe 1 | §2.1 / §3.2.2 | AIR 6488 (64T64R) — 150 unités |

### Q5 — Calcul concret de pénalité (Annexe 1 + Annexe 2)

> **"Si le Lot 3 (Grand Ouest) est livré avec 2 semaines de retard, quelle est la pénalité due ?"**

| Document | Section | Données |
|----------|---------|---------|
| Annexe 1 | §2.1 (prix) | Lot 3 : 10×RAN6624 + 44×AIR6488 + 14×RRUS4478 + 18×RRUS4488 + 5×RBS6624 + 6×routeurs = 380k + 739,2k + 91k + 140,4k + 170k + 50,4k = **1 571 000 €** |
| Annexe 2 | §5.2 | P = 1 571 000 × 0,4 % × 2 = **12 568 € HT** |

### Q6 — Garanties (Contrat + Annexe 2)

> **"Pendant combien de temps les équipements Ericsson sont-ils garantis et quelle extension est possible ?"**

| Document | Section | Données |
|----------|---------|---------|
| Contrat | Art. 8.1(a) | Renvoi à l'Annexe 2 |
| Annexe 2 | §3.1 | 36 mois à compter du PVR |
| Annexe 2 | §3.3 | Extension 24 mois possible → 380 000 € HT |
| Annexe 2 | §3.4 | Pièces rechange : 10 ans |

### Q7 — SLA et escalade (Annexe 2)

> **"Quel est le SLA pour un incident critique et la procédure d'escalade ?"**

| Document | Section | Données |
|----------|---------|---------|
| Annexe 2 | §4.1 (P1) | Intervention 1h, résolution 6h, disponibilité 99,999 % |
| Annexe 2 | §4.2 (tableau 4 niveaux) | N1: Support (immédiat), N2: R&D (4h), N3: Directeur technique (24h), N4: DG (48h) |
| Annexe 2 | §4.3 (P1) | Pénalité : 2 000 €/h (intervention), 2 500 €/h supp. (résolution) |

### Q8 — Test de distinction (cross-dataset)

> **"Quel est le montant du contrat signé par Orange avec Huawei, et quel est le montant signé par Bouygues avec Ericsson ?"**

| Dataset | Document | Données |
|---------|----------|---------|
| Orange/Huawei | Contrat art. 3.1 | 12 450 000 € HT |
| Bouygues/Ericsson | Contrat art. 3.1 | 11 200 000 € HT |

**Test clé** : le RAG doit correctement distinguer les deux contextes et associer chaque montant au bon acheteur.

### Q9 — Test de distinction technique

> **"Quelles sont les antennes 64T64R livrées à Orange (par Huawei) et à Bouygues (par Ericsson) et leurs quantités respectives ?"**

| Dataset | Section | Données |
|---------|---------|---------|
| Orange/Huawei | Annexe 1 §2.1 | AAU5639W (64T64R) — 180 unités à 18 500 € |
| Bouygues/Ericsson | Annexe 1 §2.1 | AIR 6488 (64T64R) — 150 unités à 16 800 € |

### Q10 — Test négatif

> **"Quel est le montant du contrat de Free Mobile avec Nokia ?"**

Aucun document ne contient cette information. Test d'absence d'hallucination.

---

## Métadonnées comparatives pour l'indexation

| Élément | Orange / Huawei | Bouygues / Ericsson |
|---------|----------------|---------------------|
| Montant contrat | 12 450 000 € | 11 200 000 € |
| N° contrat | ORG-HW-2025-0042 | BFG-ERIC-2025-0037 |
| Date signature | 15 mars 2025 | 10 avril 2025 |
| Signataires | Liang Zhang / Sophie Delamare | Erik Lindgren / Julien Dubois |
| RCS Fournisseur | Nanterre 518 235 498 | Nanterre 842 512 007 |
| RCS Acheteur | Paris 380 129 866 | Nanterre 397 480 930 |
| Tribunal compétent | Paris | Nanterre |
| Lots | 4 (IdF, AuRA, Occitanie, PACA) | 3 (Nord-Ouest, Sud-Est, Grand Ouest) |
| Équipement phare | AAU5639W (64T64R) — 180 u. | AIR 6488 (64T64R) — 150 u. |
| Taux pénalité | 0,5 %/semaine | 0,4 %/semaine |
| Acompte | 1 867 500 € (15 %) | 1 680 000 € (15 %) |
| SLA P1 intervention | 2h | 1h |
| Extension garantie | 450 000 € (24 mois) | 380 000 € (24 mois) |

---

## Utilisation combinée des deux jeux

Les deux jeux peuvent être utilisés **ensemble** pour tester :
1. **Distinction de contexte** : le RAG doit répondre en fonction du bon dataset (Q8, Q9)
2. **Filtrage par entité** : requêtes spécifiques à un acheteur ou fournisseur
3. **Comparaison** : "quel contrat a le taux de pénalité le plus élevé ?" (Orange/Huawei : 0,5 % vs Bouygues/Ericsson : 0,4 %)
4. **Non-confusion** : s'assurer que des données d'un contrat ne contaminent pas la réponse sur l'autre
