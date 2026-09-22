const ExcelJS = require('exceljs');
(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Customers');
  ws.addRow(['customer_id', 'legal_name', 'country', 'segment']);
  const rows = [
    ['C001', 'Sony Europe B.V.', 'NL', 'Enterprise'],
    ['C002', 'Sony France SAS', 'FR', 'Enterprise'],
    ['C003', 'Acme Industries', 'DE', 'SMB'],
    ['C004', 'Global Trading Co', 'UK', 'Enterprise'],
    ['C001', 'Duplicate Identity Row', 'NL', 'SMB'],
    [null, 'No Identity Row', 'FR', 'SMB'],
    ['C005', 'Nordic Supplies AB', 'SE', 'SMB'],
  ];
  for (const r of rows) ws.addRow(r);
  const contacts = wb.addWorksheet('Contacts');
  contacts.addRow(['email', 'customer_id']);
  contacts.addRow(['a@example.com', 'C001']);
  await wb.xlsx.writeFile('C:/prog/YellowStorm-poc/qa-assets/customers.xlsx');
  console.log('written');
})();
