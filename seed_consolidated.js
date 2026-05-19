import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = "https://kcinqpwkwpzbosxtkwyl.supabase.co";
const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjaW5xcHdrd3B6Ym9zeHRrd3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MjIwMTYsImV4cCI6MjA5MzI5ODAxNn0.AGL2hXQ5N3uQikqSbWFsZ1uxBlWZUm9o1ipMFlAFjBg";

const csvPath = path.resolve(__dirname, 'Consolidated_Staff_Data.csv');

if (!fs.existsSync(csvPath)) {
  console.error(`CSV file not found at: ${csvPath}`);
  process.exit(1);
}

const rows = [];

console.log("Parsing Consolidated_Staff_Data.csv...");

fs.createReadStream(csvPath)
  .pipe(csv())
  .on('data', (row) => {
    // Clean empty fields to null for robust database compatibility
    const cleanRow = {};
    for (const [key, value] of Object.entries(row)) {
      const trimmed = value ? value.trim() : '';
      if (trimmed === '') {
        cleanRow[key] = null;
      } else if (trimmed.toLowerCase() === 'true') {
        cleanRow[key] = true;
      } else if (trimmed.toLowerCase() === 'false') {
        cleanRow[key] = false;
      } else {
        cleanRow[key] = trimmed;
      }
    }
    rows.push(cleanRow);
  })
  .on('end', async () => {
    console.log(`Parsed ${rows.length} rows successfully. Starting upload to Supabase table "Consolodated Staff List"...`);
    
    // Upload in chunks of 50 to avoid PostgreSQL timeouts and request limits
    const chunkSize = 50;
    let successfulCount = 0;
    
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      
      try {
        const response = await fetch(`${supabaseUrl}/rest/v1/Consolodated%20Staff%20List`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': anonKey,
            'Authorization': `Bearer ${anonKey}`,
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify(chunk)
        });
        
        if (!response.ok) {
          const errMsg = await response.text();
          console.error(`\n❌ Error uploading chunk starting at index ${i}:`, errMsg);
        } else {
          successfulCount += chunk.length;
          process.stdout.write(`\r🚀 Upload progress: ${successfulCount} / ${rows.length} rows inserted...`);
        }
      } catch (err) {
        console.error(`\n❌ Network error uploading chunk at index ${i}:`, err.message);
      }
    }
    
    console.log(`\n\n🎉 Seeding finished! Successfully loaded ${successfulCount} of ${rows.length} records into "Consolodated Staff List".`);
  });
