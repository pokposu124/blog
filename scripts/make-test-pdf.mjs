/**
 * 스모크 테스트용 PDF를 만든다.
 *
 * Files API 업로드와 file_id 첨부가 도는지 보는 게 목적이라 내용은 최소한이다.
 * pdf-lib 표준 폰트는 한글을 인코딩하지 못해(별도 TTF 임베드 필요) 영문으로 쓴다.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import fs from "node:fs";

const PAGES = [
  [
    "TESTCORP INC. - ANNUAL REPORT (synthetic fixture, not a real company)",
    "",
    "1. Business overview",
    "The company makes industrial precision components.",
    "FY2025 revenue was KRW 412.0bn; operating profit KRW 74.2bn (18.0% margin).",
  ],
  [
    "2. Revenue and customer concentration",
    "",
    "The top two customers account for 58% of revenue.",
    "Customer A grew from 31% of revenue in 2023 to 41% in 2025.",
    "Average utilisation is 82%; break-even utilisation is about 63%.",
  ],
  [
    "3. Principal risks",
    "",
    "Capitalised development cost rose from 21% of R&D in 2023 to 44% in 2025.",
    "Receivable days lengthened from 62 to 91.",
    "Emissions rules effective 2027 imply about KRW 40bn of retrofit per line.",
  ],
];

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (const lines of PAGES) {
  const page = doc.addPage([595, 842]);
  lines.forEach((line, i) => {
    page.drawText(line, { x: 56, y: 780 - i * 22, size: 11, font });
  });
}
const out = process.argv[2] ?? "./test-fixture.pdf";
fs.writeFileSync(out, await doc.save());
console.log(`${out} (${PAGES.length} pages) 생성됨`);
