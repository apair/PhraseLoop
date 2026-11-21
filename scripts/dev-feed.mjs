// Local stand-in for the published sheet: serves a generated CSV with CORS on http://localhost:8787/sheet.csv
import { createServer } from 'node:http';

const rows = Number(process.argv[2] ?? 200);
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const lines = ['Date,Original,Native alternatives,Corrected sentence,Explanation'];
for (let i = 0; i < rows; i++) {
  const date = i % 5 === 0 ? `2026-11-${String(20 - Math.floor(i / 5) % 20).padStart(2, '0')}` : '';
  lines.push(
    [date, `I am agree with sample ${i}`, `I agree with sample ${i}.\nSample ${i} makes sense to me.`, `I agree with sample ${i}.`, `"Agree" is a verb, so do not use "am" (item ${i}).`]
      .map(q)
      .join(','),
  );
}
const body = lines.join('\n');
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(body);
}).listen(8787, () => console.log(`Serving ${rows} sample rows on http://localhost:8787/sheet.csv`));
