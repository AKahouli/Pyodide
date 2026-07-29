import os
import subprocess

OUT = os.path.dirname(os.path.abspath(__file__))
INVOICES_DIR = os.path.join(OUT, "invoices")
os.makedirs(INVOICES_DIR, exist_ok=True)

COMPANIES = {
    "GreenLeaf Technologies": {
        "address": "42 Avenue des Télécommunications\n75013 Paris, France",
        "siret": "852 147 963 00025",
        "iban": "FR76 3000 4002 3000 0102 3049 872",
        "logo": "🌿",
    },
    "MediSupply Pharma": {
        "address": "17 Rue du Laboratoire\n69002 Lyon, France",
        "siret": "924 581 367 00041",
        "iban": "FR76 3000 4002 4000 0203 4051 963",
        "logo": "⚕️",
    },
    "BuildRight Construction": {
        "address": "8 Boulevard du Bâtiment\n13001 Marseille, France",
        "siret": "798 624 135 00018",
        "iban": "FR76 3000 4002 5000 0304 5062 174",
        "logo": "🏗️",
    },
    "Oceanic Logistics": {
        "address": "3 Quai du Havre\n76600 Le Havre, France",
        "siret": "631 842 975 00033",
        "iban": "FR76 3000 4002 6000 0405 6073 285",
        "logo": "🚢",
    },
}

BUYER = {
    "name": "YellowStorm SAS",
    "address": "128 Rue de Rivoli\n75001 Paris, France",
    "siret": "834 297 651 00019",
    "iban": "FR76 3000 4002 1000 0506 7084 396",
}

INVOICES = [
    {   "ref": "GL-2026-05-001", "date": "2026-05-02", "due": "2026-05-16",
        "vendor": "GreenLeaf Technologies",
        "lines": [
            ("Maintenance serveurs Q2 2026 — Lot A", 2, 1200.00),
            ("Support technique 24/7 — 1 mois", 1, 1800.00),
        ]},
    {   "ref": "GL-2026-05-002", "date": "2026-05-03", "due": "2026-05-17",
        "vendor": "GreenLeaf Technologies",
        "lines": [
            ("Infrastructure cloud — mise en place initiale", 1, 4500.00),
            ("Stockage objet 500 Go — abonnement annuel", 1, 2400.00),
            ("Bande passante dédiée 1 Gbps", 1, 1740.00),
        ]},
    {   "ref": "GL-2026-05-003", "date": "2026-05-10", "due": "2026-05-24",
        "vendor": "GreenLeaf Technologies",
        "lines": [
            ("Licences utilisateur — pack entreprise (25 u.)", 25, 50.00),
            ("Renouvellement certificat SSL Wildcard", 1, 600.00),
            ("Audit de sécurité — rapport Q2", 1, 650.00),
        ]},
    {   "ref": "MS-2026-05-001", "date": "2026-05-05", "due": "2026-05-19",
        "vendor": "MediSupply Pharma",
        "lines": [
            ("Masques chirurgicaux type IIR — boîte de 50", 200, 18.50),
            ("Gels hydroalcooliques 5L — bidon", 50, 32.00),
            ("Gants d'examen nitrile M — carton de 100", 100, 8.50),
        ]},
    {   "ref": "MS-2026-05-002", "date": "2026-05-08", "due": "2026-05-22",
        "vendor": "MediSupply Pharma",
        "lines": [
            ("Calibration matériel laboratoire — forfait", 1, 2500.00),
            ("Certificat d'étalonnage COFRAC", 1, 650.00),
        ]},
    {   "ref": "MS-2026-05-003", "date": "2026-05-12", "due": "2026-05-26",
        "vendor": "MediSupply Pharma",
        "lines": [
            ("Chambre froide pharmaceutique 4-8°C", 1, 7500.00),
            ("Sonnette température connectée — lot de 5", 5, 260.00),
            ("Installation et mise en service", 1, 1000.00),
        ]},
    {   "ref": "BR-2026-05-001", "date": "2026-05-04", "due": "2026-05-18",
        "vendor": "BuildRight Construction",
        "lines": [
            ("Acier structurel HEA 200 — lot 4.2 T", 4200, 1.85),
            ("Béton prêt à l'emploi C25/30 — m³", 18, 145.00),
            ("Location grue mobile 50T — 3 jours", 3, 850.00),
        ]},
    {   "ref": "BR-2026-05-002", "date": "2026-05-09", "due": "2026-05-23",
        "vendor": "BuildRight Construction",
        "lines": [
            ("Poutres acier galvanisé — lot SS-771", 12, 280.00),
            ("Plaques de plâtre BA13 — palette de 50", 8, 95.00),
            ("Laine de verre GR32 — rouleau 10m²", 20, 42.00),
        ]},
    {   "ref": "BR-2026-05-003", "date": "2026-05-12", "due": "2026-05-26",
        "vendor": "BuildRight Construction",
        "lines": [
            ("Contrat maintenance CVC — mai 2026", 1, 4800.00),
            ("Intervention urgente climatisation — main d'oeuvre", 1, 1200.00),
            ("Pièces détachées groupe froid", 1, 1200.00),
        ]},
    {   "ref": "BR-2026-05-004", "date": "2026-05-18", "due": "2026-06-01",
        "vendor": "BuildRight Construction",
        "lines": [
            ("Échafaudage mobile 12m — location 1 mois", 1, 2800.00),
            ("Filet de sécurité — lot de 10", 10, 95.00),
            ("Casques de chantier — lot de 20", 20, 45.00),
        ]},
    {   "ref": "OL-2026-05-001", "date": "2026-05-03", "due": "2026-05-17",
        "vendor": "Oceanic Logistics",
        "lines": [
            ("Transport maritime conteneur 40' HC — route AS-42", 1, 2800.00),
            ("Assurance fret maritime — 1.5% valeur", 1, 600.00),
            ("Frais de dossier portuaire", 1, 400.00),
        ]},
    {   "ref": "OL-2026-05-002", "date": "2026-05-07", "due": "2026-05-21",
        "vendor": "Oceanic Logistics",
        "lines": [
            ("Stockage entrepôt logistique — mars 2026", 1, 3500.00),
            ("Préparation de commandes — 120 colis", 120, 12.50),
            ("Gestion des retours — forfait mensuel", 1, 1200.00),
        ]},
    {   "ref": "OL-2026-05-003", "date": "2026-05-14", "due": "2026-05-28",
        "vendor": "Oceanic Logistics",
        "lines": [
            ("Fret express aérien — shipment XZ-901", 1, 1800.00),
        ]},
]


def ttc(lines):
    ht = sum(qty * up for _, qty, up in lines)
    return ht, round(ht * 0.20, 2), round(ht * 1.20, 2)


def invoice_html(inv):
    vendor = COMPANIES[inv["vendor"]]
    ht_total, tva_total, ttc_total = ttc(inv["lines"])
    lines_html = "".join(
        f"""
        <tr>
            <td>{desc}</td>
            <td style="text-align:right">{qty}</td>
            <td style="text-align:right">{up:.2f} €</td>
            <td style="text-align:right">{qty * up:.2f} €</td>
        </tr>"""
        for desc, qty, up in inv["lines"]
    )
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>{inv['ref']}</title></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;color:#222">
<div style="max-width:800px;margin:0 auto;padding:40px">
    <table style="width:100%;border-collapse:collapse">
    <tr>
        <td style="width:50%">
            <div style="font-size:32px;font-weight:bold;color:#1a56db">{inv['ref']}</div>
            <div style="font-size:12px;color:#666;margin-top:4px">FACTURE</div>
        </td>
        <td style="width:50%;text-align:right;font-size:36px;color:#1a56db">{vendor['logo']}</td>
    </tr>
    </table>
    <hr style="border:1px solid #1a56db;margin:20px 0">

    <table style="width:100%;border-collapse:collapse">
    <tr>
        <td style="width:50%;vertical-align:top">
            <div style="font-size:11px;font-weight:bold;color:#666;text-transform:uppercase;letter-spacing:1px">Fournisseur</div>
            <div style="font-size:14px;font-weight:bold;margin-top:4px">{inv['vendor']}</div>
            <div style="font-size:12px;color:#444;margin-top:4px;white-space:pre-line">{vendor['address']}</div>
            <div style="font-size:11px;color:#666;margin-top:4px">SIRET: {vendor['siret']}</div>
        </td>
        <td style="width:50%;vertical-align:top">
            <div style="font-size:11px;font-weight:bold;color:#666;text-transform:uppercase;letter-spacing:1px">Client</div>
            <div style="font-size:14px;font-weight:bold;margin-top:4px">{BUYER['name']}</div>
            <div style="font-size:12px;color:#444;margin-top:4px;white-space:pre-line">{BUYER['address']}</div>
            <div style="font-size:11px;color:#666;margin-top:4px">SIRET: {BUYER['siret']}</div>
        </td>
    </tr>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-top:20px">
    <tr>
        <td style="font-size:12px;padding:6px 0"><strong>Date d'émission :</strong> {inv['date']}</td>
        <td style="font-size:12px;padding:6px 0"><strong>Date d'échéance :</strong> {inv['due']}</td>
    </tr>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-top:20px">
    <thead>
    <tr style="background:#1a56db;color:#fff;font-size:12px;text-transform:uppercase">
        <th style="padding:10px;text-align:left">Désignation</th>
        <th style="padding:10px;text-align:right">Qté</th>
        <th style="padding:10px;text-align:right">Prix unit.</th>
        <th style="padding:10px;text-align:right">Total HT</th>
    </tr>
    </thead>
    <tbody>
    {lines_html}
    </tbody>
    </table>

    <table style="width:40%;border-collapse:collapse;margin-top:20px;margin-left:auto">
    <tr>
        <td style="font-size:13px;padding:6px;border-bottom:1px solid #ddd">Total HT</td>
        <td style="font-size:13px;padding:6px;text-align:right;border-bottom:1px solid #ddd">{ht_total:.2f} €</td>
    </tr>
    <tr>
        <td style="font-size:13px;padding:6px;border-bottom:1px solid #ddd">TVA (20%)</td>
        <td style="font-size:13px;padding:6px;text-align:right;border-bottom:1px solid #ddd">{tva_total:.2f} €</td>
    </tr>
    <tr style="font-weight:bold;font-size:16px;color:#1a56db">
        <td style="padding:8px 6px;border-top:2px solid #1a56db">Total TTC</td>
        <td style="padding:8px 6px;text-align:right;border-top:2px solid #1a56db">{ttc_total:.2f} €</td>
    </tr>
    </table>

    <div style="margin-top:30px;padding:15px;background:#f0f4ff;border-radius:6px;font-size:12px">
        <strong style="color:#1a56db">Informations de paiement</strong><br>
        IBAN: {vendor['iban']}<br>
        Réf. virement : <strong>{inv['ref']}</strong><br>
        Échéance : {inv['due']}
    </div>

    <hr style="margin-top:40px;border:0;border-top:1px solid #ccc">
    <div style="font-size:10px;color:#999;text-align:center;margin-top:10px">
        {inv['vendor']} — SIRET {vendor['siret']}<br>
        Document généré automatiquement — {inv['ref']} — Page 1/1
    </div>
</div>
</body>
</html>"""


# Detect browser for PDF conversion
edge_path = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
chrome_path = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
browser = edge_path if os.path.exists(edge_path) else chrome_path

for inv in INVOICES:
    html = invoice_html(inv)
    html_path = os.path.join(INVOICES_DIR, f"{inv['ref']}.html")
    pdf_path = os.path.join(INVOICES_DIR, f"{inv['ref']}.pdf")

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)

    ht, tva, ttc_v = ttc(inv["lines"])
    abs_html = os.path.abspath(html_path)
    abs_pdf = os.path.abspath(pdf_path)
    url = "file:///" + abs_html.replace("\\", "/").replace(" ", "%20")
    cmd = [
        browser,
        "--headless=new",
        f"--print-to-pdf={abs_pdf}",
        "--no-margins",
        url,
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=15)
    print(f"  {inv['ref']} | {inv['vendor']:26s} | TTC: {ttc_v:>8.2f} €")
    print("  {} | {:26s} | TTC: {:>8.2f} EUR".format(inv["ref"], inv["vendor"], ttc_v))
print("\nOK {} invoice PDFs generated in {}".format(len(INVOICES), INVOICES_DIR))
