/**
 * DOZN Export Apps Script
 * 
 * Instructions:
 * 1. Create a new Google Sheet.
 * 2. Setup headers matching DOZN format.
 * 3. Open Extensions > Apps Script.
 * 4. Paste this code.
 * 5. Update the API_BASE_URL.
 */

const API_BASE_URL = 'https://gc.ai/api/export/dozn';

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('GreenChemistry.ai')
      .addItem('Import Analysis', 'showImportDialog')
      .addToUi();
}

function showImportDialog() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('Import Analysis', 'Enter Analysis ID:', ui.ButtonSet.OK_CANCEL);
  
  if (response.getSelectedButton() == ui.Button.OK) {
    const analysisId = response.getResponseText();
    importAnalysisData(analysisId);
  }
}

function importAnalysisData(analysisId) {
  const url = `${API_BASE_URL}/${analysisId}`;
  const response = UrlFetchApp.fetch(url);
  const json = JSON.parse(response.getContentText());
  
  if (json.success) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const data = json.data;
    
    // Example mapping - Adjust based on actual DOZN spreadsheet layout
    sheet.getRange('B2').setValue(data.protocol_name);
    sheet.getRange('B3').setValue(data.date);
    
    // Populate chemicals
    if (data.chemicals && data.chemicals.length > 0) {
      const startRow = 10;
      data.chemicals.forEach((chem, index) => {
        const row = startRow + index;
        sheet.getRange(row, 1).setValue(chem.name);
        sheet.getRange(row, 2).setValue(chem.mass || chem.amount);
        sheet.getRange(row, 3).setValue(chem.role);
        sheet.getRange(row, 4).setValue(chem.merck_catalog || 'N/A');
      });
    }
    
    SpreadsheetApp.getUi().alert('Import Complete!');
  } else {
    SpreadsheetApp.getUi().alert('Error: ' + json.error);
  }
}
