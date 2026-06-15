# Jeu de données de démonstration — Réconciliation de factures avec relevés bancaires

Pipeline de réconciliation automatique entre factures fournisseurs (PDF) et relevé bancaire (CSV), avec des écarts intentionnels pour tester la robustesse du workflow.

## Structure

```
reconcialiation/
├── invoices/                        # 13 factures au format HTML + PDF
│   ├── GL-2026-05-001.{html,pdf}   # GreenLeaf Technologies
│   ├── GL-2026-05-002.{html,pdf}
│   ├── GL-2026-05-003.{html,pdf}
│   ├── MS-2026-05-001.{html,pdf}   # MediSupply Pharma
│   ├── MS-2026-05-002.{html,pdf}
│   ├── MS-2026-05-003.{html,pdf}
│   ├── BR-2026-05-001.{html,pdf}   # BuildRight Construction
│   ├── BR-2026-05-002.{html,pdf}
│   ├── BR-2026-05-003.{html,pdf}
│   ├── BR-2026-05-004.{html,pdf}
│   ├── OL-2026-05-001.{html,pdf}   # Oceanic Logistics
│   ├── OL-2026-05-002.{html,pdf}
│   └── OL-2026-05-003.{html,pdf}
├── statements/
│   └── bank-statement-2026-05.csv  # Relevé bancaire mai 2026 (18 lignes)
├── generate_dataset.py             # Script de génération
└── README-TEST.md
```

## Fournisseurs

| Société | SIRET | IBAN |
|---------|-------|------|
| GreenLeaf Technologies | 852 147 963 00025 | FR76 3000 4002 3000 0102 3049 872 |
| MediSupply Pharma | 924 581 367 00041 | FR76 3000 4002 4000 0203 4051 963 |
| BuildRight Construction | 798 624 135 00018 | FR76 3000 4002 5000 0304 5062 174 |
| Oceanic Logistics | 631 842 975 00033 | FR76 3000 4002 6000 0405 6073 285 |

**Acheteur :** YellowStorm SAS — SIRET 834 297 651 00019

## Scénarios de réconciliation

### Correspondances parfaites (✅)

| Facture | Montant TTC | Transaction | Montant | Statut |
|---------|-------------|-------------|---------|--------|
| GL-2026-05-001 | 5 040,00 € | VIR-20260503-001 | 5 040,00 € | ✅ |
| GL-2026-05-002 | 10 368,00 € | VIR-20260505-002 | 10 368,00 € | ✅ |
| GL-2026-05-003 | 3 000,00 € | VIR-20260514-006 | 3 000,00 € | ✅ |
| MS-2026-05-002 | 3 780,00 € | VIR-20260518-009 | 3 780,00 € | ✅ |
| BR-2026-05-002 | 5 952,00 € | VIR-20260522-012 | 5 952,00 € | ✅ |
| BR-2026-05-003 | 8 640,00 € | VIR-20260529-015 | 8 640,00 € | ✅ |
| OL-2026-05-001 | 4 560,00 € | VIR-20260510-004 | 4 560,00 € | ✅ |
| OL-2026-05-002 | 7 440,00 € | VIR-20260520-010 | 7 440,00 € | ✅ |
| OL-2026-05-003 | 2 160,00 € | VIR-20260527-014 | 2 160,00 € | ✅ |

### Écarts intentionnels

| # | Type | Facture | Montant | Relevé | Montant | Description |
|---|------|---------|---------|--------|---------|-------------|
| 1 | ⚠️ Paiement partiel | MS-2026-05-001 | 7 380,00 € | VIR-20260507-003 | 6 000,00 € | Payé 6 000 € au lieu de 7 380 € (solde 1 380 €) |
| 2 | ⚠️ Référence erronée | MS-2026-05-003 | 11 760,00 € | VIR-20260525-013 | 11 760,00 € | Montant correct mais référence "MS-2026-04-015" (ancienne facture) |
| 3 | ⚠️ Paiement en double | BR-2026-05-001 | 15 516,00 € | VIR-20260512-005 + VIR-20260517-008 | 15 516,00 € x2 | Payé deux fois le même montant (31 032 € au lieu de 15 516 €) |
| 4 | ❌ Facture impayée | BR-2026-05-004 | 5 580,00 € | — | 0,00 € | Aucun paiement trouvé sur le relevé |
| 5 | ❓ Paiement orphelin | — | — | VIR-20260515-007 | 1 200,00 € | Virement sans facture correspondante (fournisseur inconnu, réf. 4478X) |
| 6 | ⚠️ Trop-perçu | GL-2026-05-002 | 10 368,00 € | VIR-20260521-011 | 500,00 € | Paiement complémentaire de 500 € sans justification (total perçu : 10 868 €) |
| 7 | ❓ Acompte sans facture | — | — | VIR-20260531-016 | 1 000,00 € | Acompte GreenLeaf sur facture future non encore émise |
| 8 | ℹ️ Frais bancaires | — | — | FRAIS-202605 | 45,00 € (débit) | Frais de tenue de compte mai 2026 (hors périmètre réconciliation) |

## Requêtes de test

### Q1 — Rapport de réconciliation complet

> "Génère le rapport de réconciliation entre les factures et le relevé bancaire de mai 2026."

Résultat attendu : tableau complet avec 13 factures + 4 lignes de relevé sans facture, statut pour chaque ligne.

### Q2 — Factures impayées

> "Quelles sont les factures impayées ou partiellement payées ?"

Résultat attendu : MS-2026-05-001 (partiel, solde 1 380 €), BR-2026-05-004 (impayée, 5 580 €).

### Q3 — Anomalies de montant

> "Y a-t-il des écarts de montant entre les factures et les paiements ?"

Résultat attendu :
- MS-2026-05-001 : payé 6 000 €, attendu 7 380 € (écart -1 380 €)
- GL-2026-05-002 : payé 10 868 €, attendu 10 368 € (trop-perçu 500 €)
- BR-2026-05-001 : payé 31 032 €, attendu 15 516 € (doublon 15 516 €)

### Q4 — Paiements sans facture

> "Quels sont les virements qui ne correspondent à aucune facture ?"

Résultat attendu :
- VIR-20260515-007 (1 200,00 €) — fournisseur inconnu
- VIR-20260531-016 (1 000,00 €) — acompte GreenLeaf sans facture

### Q5 — Références incohérentes

> "Y a-t-il des paiements avec des références qui ne correspondent pas aux factures ?"

Résultat attendu : MS-2026-05-003 payé avec la référence "MS-2026-04-015" (ancienne facture) au lieu de "MS-2026-05-003".

### Q6 — Doublons

> "Détecte les paiements en double."

Résultat attendu : BR-2026-05-001 payé deux fois le 12/05 et le 17/05 (15 516 € x2).

### Q7 — Solde du relevé

> "Le solde calculé du relevé est-il correct ?"

Vérification : solde initial 45 280,12 € + total crédits - total débits = solde final 147 667,12 €.

## Utilisation dans le playbook

1. Uploader les 13 fichiers PDF dans le nœud **"Collecter les factures"**
2. Uploader `bank-statement-2026-05.csv` dans le nœud **"Collecter les relevés"**
3. Lancer le nœud **"Réconcilier factures et relevés"**
4. Vérifier le rapport produit pour chaque scénario ci-dessus
