# Jeu de données de démonstration — Carrefour / Danone

Contrat d'approvisionnement de produits alimentaires (secteur grande distribution / agroalimentaire). Structure parallèle aux jeux Orange/Huawei et Bouygues/Ericsson, avec des données de nature radicalement différente pour tester l'adaptabilité du RAG à des domaines variés.

---

## Structure du graphe de documents

```
                    ┌───────────────────────────────────────┐
                    │  01-contrat-principal.md              │
                    │  Contrat CAR-DAN-2025-0051            │
                    │  Signé le 2 juin 2025                 │
                    │  24 articles, ~20 pages               │
                    │  Volume annuel estimé : ~4 200 000 €  │
                    └────────────────┬──────────────────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  │                  │                  │
                  │  "reference_     │  "reference_     │
                  │  technique"     │  financiere"     │
                  │  (art. 2, 4, 5) │  (art. 3, 12)    │
                  │                  │                  │
           ┌──────▼──────────────┐ ┌─▼──────────────────▼──┐
           │  02-annexe-1.md     │ │  03-annexe-2.md        │
           │  Cahier des Charges │ │  Conditions de         │
           │  Techniques & Log.  │ │  Paiement & Garanties  │
           │  8 sections, ~10 pg │ │  9 sections, ~10 pg    │
           │                     │ │                        │
           │  Produits Danone :  │ │  Paiement : 45 j fin   │
           │  Activia, Danette,  │ │  de mois                │
           │  Evian, Actimel,    │ │  Pénalité : 100€/pal.  │
           │  Blédina, Alpro     │ │  TS objectif : ≥ 98%   │
           └────────┬────────────┘ └────────┬───────────────┘
                    │                       │
                    └───"reference_croisee"──┘
                        (§4 ↔ Annexe 2 §1.1)
                        (§5 ↔ Annexe 2 §5)
```

---

## Edges du graphe

| # | Source | Cible | Type | Justification |
|---|--------|-------|------|---------------|
| E1 | `01-contrat-principal` | `02-annexe-1` | `reference_technique` | Art. 1 (déf. Annexe 1), art. 2 (objet/produits), art. 4 (livraison/logistique), art. 5 (qualité) |
| E2 | `01-contrat-principal` | `03-annexe-2` | `reference_financiere` | Art. 3 (prix, renvoi §1), art. 9 (garanties, renvoi §3), art. 12 (pénalités, renvoi §5) |
| E3 | `02-annexe-1` | `03-annexe-2` | `reference_croisee` | Annexe 1 §4.3 (créneaux) → Annexe 2 §4 (Taux de Service) ; Annexe 1 §4 (Sites) → Annexe 2 §1.1 (paiement) |

---

## Requêtes de test cross-documents

### Q1 — Contrat + Annexe 1 (produits et volumes)

> **"Quelles sont les gammes de produits Danone référencées chez Carrefour et quels sont leurs volumes annuels estimés ?"**

| Document | Section | Données |
|----------|---------|---------|
| Contrat | Art. 2.3 | 4 200 000 € HT de volume annuel indicatif |
| Annexe 1 | §2.1 (7 réf.) | Activia×2, Danette×2, Yaourt nature, Actimel×2 |
| Annexe 1 | §2.2 (3 réf.) | Evian 50cl, 1,5L, 75cl |
| Annexe 1 | §2.3 (3 réf.) | Blédina petits pots et lait |
| Annexe 1 | §2.4 (3 réf.) | Alpro lait avoine, yaourt soja, dessert |
| Annexe 1 | Total estimé | 3 149 750 € HT (sous-total) |

### Q2 — Contrat + Annexe 2 (conditions financières)

> **"Quelles sont les conditions de paiement entre Carrefour et Danone ?"**

| Document | Section | Données |
|----------|---------|---------|
| Contrat | Art. 3.3 | Renvoi à l'Annexe 2 section 1 |
| Annexe 2 | §1.2.1 | Paiement 45 jours fin de mois (LME) |
| Annexe 2 | §1.2.2 | Intérêts moratoires 1,5 %/mois, indemnité 40 € |
| Annexe 2 | §1.3 (tableau) | RB 3 %, RV 2-5 %, MA 8 %, coopération 100 k€ |

### Q3 — Annexe 1 + Annexe 2 (logistique et pénalités)

> **"Quels sont les sites de livraison Carrefour et les pénalités applicables en cas de retard ?"**

| Document | Section | Données |
|----------|---------|---------|
| Annexe 1 | §4.1 (8 entrepôts) | Lille, Lieusaint, Strasbourg, Nantes, Orléans, Lyon, Bordeaux, Marseille |
| Annexe 1 | §4.3 (3 créneaux) | A (J+2 frais), B (J+2 frais), C (J+3 sec) |
| Annexe 2 | §5.1.1 | 100 € par palette non livrée à l'heure |
| Annexe 2 | §5.1.2 | 200 €/palette si retard > 24h |

### Q4 — Tous les documents (triple-saut)

> **"Qui a signé le contrat, quelles sont les certifications qualité obligatoires et quel est le taux de remise de base ?"**

| Document | Section | Données |
|----------|---------|---------|
| Contrat | Signatures | Claire Vernet (Danone) / Marc Legrand (Carrefour) |
| Annexe 1 | §3.1 (tableau) | IFS Food Grade B, ISO 22000, ISO 9001, HACCP |
| Annexe 2 | §1.3 (ligne 1) | Remise de base 3 % sur prix catalogue |

### Q5 — Calcul de pénalité (Annexe 1 + Annexe 2)

> **"Si Danone livre 80 palettes de Danette avec 2 jours de retard, quelle est la pénalité ?"**

| Document | Section | Données |
|----------|---------|---------|
| Annexe 2 | §5.1.1 | 100 € par palette (1er jour) |
| Annexe 2 | §5.1.2 | 200 €/palette/jour supplémentaire |
| Calcul | | Jour 1 : 80×100 = 8 000 € ; Jour 2 : 80×200 = 16 000 € → **24 000 €** |
| Annexe 2 | §5.3 | Plafond : 5 % du CA annuel (soit env. 210 000 €) |

### Q6 — Qualité et rappel (Contrat + Annexe 1 + Annexe 2)

> **"En cas de défaut qualité sur un produit Blédina, quelles sont les procédures et les indemnités applicables ?"**

| Document | Section | Données |
|----------|---------|---------|
| Contrat | Art. 9.3 | Renvoi aux modalités de l'Annexe 2 |
| Annexe 1 | §3.4 | Traçabilité complète par lot |
| Annexe 2 | §3.2 | Notification sous 4h, procédure sous 24h |
| Annexe 2 | §3.3 | Remboursement + 10 000 € indemnité forfaitaire par réf. |

### Q7 — Taux de Service (Annexe 2)

> **"Quel est l'objectif de Taux de Service pour les produits frais et quelles sont les pénalités associées ?"**

| Document | Section | Données |
|----------|---------|---------|
| Annexe 2 | §4.2 | TS global ≥ 98 %, TS frais ≥ 99 %, Conformité DLC ≥ 95 % |
| Annexe 2 | §4.3 | TS < 98 % → 200 €/point ; TS < 95 % → 500 €/point |

### Q8 — Test de distinction cross-sectoriel

> **"Combien de lots de livraison y a-t-il dans le contrat Huawei/Orange et dans le contrat Danone/Carrefour ?"**

| Dataset | Document | Données |
|---------|----------|---------|
| Orange/Huawei | Annexe 1 §4.1 | 4 lots (Île-de-France, AuRA, Occitanie, PACA) |
| Carrefour/Danone | Annexe 1 §4.3 | 3 créneaux hebdomadaires (A, B, C) |

### Q9 — Test de distinction cross-sectoriel

> **"Quel est le taux de pénalité de retard hebdomadaire chez Orange/Huawei vs le taux de pénalité palette chez Carrefour/Danone ?"**

| Dataset | Document | Données |
|---------|----------|---------|
| Orange/Huawei | Annexe 2 §5.2 | 0,5 % du montant du lot par semaine |
| Carrefour/Danone | Annexe 2 §5.1.1 | 100 € par palette non livrée |

### Q10 — Test négatif

> **"Quel est le chiffre d'affaires d'Intermarché avec Lactalis ?"**

Aucun document du jeu ne contient cette information.

---

## Métadonnées comparatives (3 jeux de données)

| Élément | Orange/Huawei | Bouygues/Ericsson | Carrefour/Danone |
|---------|---------------|-------------------|------------------|
| Secteur | Télécoms | Télécoms | **Grande distribution** / Agroalimentaire |
| Fournisseur | Huawei France | Ericsson France | **Danone France** |
| Acheteur | Orange France | Bouygues Telecom | **Carrefour France** |
| Montant | 12 450 000 € | 11 200 000 € | **~4 200 000 € (volume annuel estimé)** |
| N° contrat | ORG-HW-2025-0042 | BFG-ERIC-2025-0037 | **CAR-DAN-2025-0051** |
| Date signature | 15/03/2025 | 10/04/2025 | **02/06/2025** |
| Lots / Créneaux | 4 lots géographiques | 3 lots géographiques | **3 créneaux hebdomadaires** |
| Équipement / Produit phare | AAU5639W (antenne) | AIR 6488 (antenne) | **Activia, Evian, Danette, Blédina** |
| Taux pénalité | 0,5 %/semaine | 0,4 %/semaine | **100 €/palette (unitaire forfaitaire)** |
| Tribunal | Paris | Nanterre | **Évry** |
| Certifications | CE, 3GPP, RoHS, REACH | CE, 3GPP, RoHS | **IFS Food, ISO 22000, ISO 9001, HACCP** |
| Particularité | Incoterms FCA | Incoterms DAP | **Loi Gallé (GPA), chaîne du froid, Nutri-Score** |

---

## Utilisation combinée des 3 jeux

Les trois jeux ensemble permettent de tester :
1. **Distinction inter-domaines** : télécoms vs grande distribution (Q8, Q9)
2. **Non-confusion** : données spécifiques à chaque contrat ne doivent pas se mélanger
3. **Adaptabilité du schéma** : le RAG doit fonctionner aussi bien avec des antennes 5G qu'avec des yaourts
4. **Requêtes mixtes** : "quel contrat a le montant le plus élevé ?" (Orange 12,45M€ > Bouygues 11,2M€ > Carrefour 4,2M€)
5. **Terminologie sectorielle** : DLC/DLUO (agroalimentaire) vs SLAs/PVR (télécoms)
